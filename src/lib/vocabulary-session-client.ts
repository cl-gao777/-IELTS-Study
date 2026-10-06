import type { VocabularyEntry, VocabularyReviewMode } from "./vocabulary";
import type { VocabularyCardDraft, VocabularySession, VocabularySessionResponse, VocabularyReviewRecord } from "./vocabulary-session";
import { isVocabularyNew, vocabularyReviewQueue } from "./vocabulary-practice";
import { canRecoverVocabularyDraft, parseVocabularyRecovery, sameVocabularyCheckpoint, vocabularyRecoveryKey, type VocabularyRecovery, type VocabularySubmission } from "./vocabulary-recovery";

type Reply = Partial<VocabularySessionResponse> & { word?: VocabularyEntry; review?: VocabularyReviewRecord; existing?: boolean };
export type VocabularyTransport = (url: string, body?: unknown) => Promise<{ ok: boolean; status: number; payload: Reply }>;
export interface VocabularyClientSnapshot {
  words: VocabularyEntry[]; session: VocabularySession | null; mode: VocabularyReviewMode;
  view: "review" | "library"; ready: boolean; busy: boolean; saving: boolean;
  message: string; clock: number; pending: VocabularyRecovery["pending"];
}

export const vocabularyTransport: VocabularyTransport = async (url, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { method: body === undefined ? "GET" : url.endsWith("/session") ? "PUT" : "POST",
      cache: "no-store", signal: controller.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { ok: response.ok, status: response.status, payload: await response.json() as Reply };
  } finally { clearTimeout(timeout); }
};

/** One serial checkpoint stream; grading is never retried automatically. */
export class VocabularySessionClient {
  private snapshot: VocabularyClientSnapshot;
  private listeners = new Set<() => void>();
  private dirty = false;
  private attempted: VocabularyRecovery["attempted"] = null;
  private startAttempt: VocabularyRecovery["startAttempt"] = null;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private checkpointChain: Promise<void> = Promise.resolve();
  private epoch = 0;
  private storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
  constructor(words: VocabularyEntry[], now: number, private transport = vocabularyTransport) {
    this.snapshot = { words, session: null, mode: "recall", view: "review", ready: false,
      busy: false, saving: false, message: "", clock: now, pending: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(changes: Partial<VocabularyClientSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    if (Object.keys(changes).some((key) => key !== "clock")) this.remember();
    for (const listener of this.listeners) listener();
  }
  private remember() {
    if (!this.storage || !this.snapshot.ready) return;
    const { session, view, pending } = this.snapshot;
    try { this.storage.setItem(vocabularyRecoveryKey, JSON.stringify({ format: 2, session, view, pending, attempted: this.attempted, startAttempt: this.startAttempt, dirty: this.dirty || Boolean(this.attempted) })); }
    catch { /* A failed browser cache does not stop SQLite checkpoints. */ }
  }
  private adopt(payload: Reply) {
    this.dirty = false;
    this.attempted = null;
    const words = payload.words ?? (payload.word ? this.snapshot.words.map((word) => word.id === payload.word!.id ? payload.word! : word) : this.snapshot.words);
    const session = payload.session === undefined ? this.snapshot.session : payload.session;
    this.update({ words, session, mode: session?.state.mode ?? this.snapshot.mode, saving: false });
  }
  private recoveryFromStorage() {
    try { return parseVocabularyRecovery(this.storage?.getItem(vocabularyRecoveryKey) ?? null); }
    catch { return null; }
  }
  private requireEpoch(epoch: number) {
    if (epoch !== this.epoch) throw new Error("STALE_VOCABULARY_OPERATION");
  }
  private async request(url: string, body: unknown, epoch: number) {
    try { const reply = await this.transport(url, body); this.requireEpoch(epoch); return reply; }
    catch (error) { this.requireEpoch(epoch); throw error; }
  }
  async initialize(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    this.storage = storage;
    const epoch = ++this.epoch;
    clearTimeout(this.checkpointTimer);
    const recovery = this.recoveryFromStorage();
    this.startAttempt = recovery?.startAttempt ?? null;
    this.update({ busy: true, ready: false, message: "" });
    try {
      const suffix = recovery?.pending ? `?submissionId=${encodeURIComponent(recovery.pending.input.submissionId)}` : "";
      const result = await this.transport(`/api/vocabulary/session${suffix}`);
      if (!result.ok) throw new Error(result.payload.error || "无法读取本轮状态。");
      if (epoch !== this.epoch) return;
      if (result.payload.session?.status === "active" || result.payload.session?.id === this.startAttempt?.id) this.startAttempt = null;
      this.adopt(result.payload);
      let pending: VocabularyRecovery["pending"] = null;
      let message = "";
      if (recovery?.pending && result.payload.submission) message = "已核对：上次评分已保存，没有重复提交。";
      else if (recovery?.pending && result.payload.session?.status === "active"
        && recovery.pending.input.sessionId === result.payload.session.id
        && recovery.pending.input.expectedSessionRevision === result.payload.session.revision
        && result.payload.words?.some((word) => word.id === recovery.pending!.wordId && word.reviewVersion === recovery.pending!.input.expectedVersion)) {
        pending = recovery.pending;
        message = "上次评分尚未保存。当前回答已保留，可重试保存原评分。";
      }
      if (recovery && !result.payload.submission && canRecoverVocabularyDraft(recovery, result.payload.session ?? null, result.payload.words ?? [])) {
        this.dirty = true;
        // The request may still be executing when this GET observes its old revision.
        if (recovery.attempted?.revision === result.payload.session!.revision) this.attempted = recovery.attempted;
        this.update({ session: { ...recovery.session!, revision: result.payload.session!.revision,
          updatedAt: result.payload.session!.updatedAt }, mode: recovery.session!.state.mode });
      }
      this.update({ ready: true, pending, message, view: recovery?.view === "library" && this.snapshot.session?.status !== "active" ? "library" : "review" });
    } catch (error) {
      if (epoch === this.epoch) this.update({ message: error instanceof Error ? `复习状态加载失败：${error.message} 请重试。` : "复习状态加载失败，请重试。" });
    } finally {
      if (epoch === this.epoch) { this.update({ busy: false }); this.selectCard(); if (this.dirty) this.scheduleCheckpoint(); }
    }
  }
  tick(now: number) { this.update({ clock: now }); this.selectCard(); }
  private selectCard() {
    const { session, words, ready, busy, pending, clock, view } = this.snapshot;
    if (!ready || busy || pending || view !== "review" || session?.status !== "active") return;
    const current = session.state.current;
    if (current) {
      const word = words.find((item) => item.id === current.wordId);
      if (word?.reviewVersion === current.wordVersion) return;
      this.patch({ current: null, skippedIds: [...new Set([...session.state.skippedIds, current.wordId])] });
      this.update({ message: "词条或复习安排已经更新，旧卡本轮暂缓，没有评分。" });
    }
    const state = this.snapshot.session!.state;
    const next = vocabularyReviewQueue(words, clock, new Set(state.skippedIds))[0];
    if (next) this.patch({ current: { wordId: next.id, wordVersion: next.reviewVersion,
      phase: isVocabularyNew(next) ? "learn" : "front", answer: "", gaveUp: false,
      confirmedTypo: false, audioPlayed: false, startedAt: new Date(nowSafe(clock)).toISOString() } });
  }
  private patch(changes: Partial<VocabularySession["state"]>) {
    const session = this.snapshot.session;
    if (!session || session.status !== "active") return;
    this.dirty = true;
    this.update({ session: { ...session, state: { ...session.state, ...changes } }, mode: changes.mode ?? this.snapshot.mode });
    this.scheduleCheckpoint();
  }
  changeDraft(changes: Partial<VocabularyCardDraft>) {
    if (this.snapshot.busy || this.snapshot.pending || !this.snapshot.session?.state.current) return;
    this.patch({ current: { ...this.snapshot.session.state.current, ...changes } });
  }
  private scheduleCheckpoint() {
    clearTimeout(this.checkpointTimer);
    this.checkpointTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, 400);
  }
  flush() {
    clearTimeout(this.checkpointTimer);
    const epoch = this.epoch;
    const run = async () => {
      while (this.dirty && epoch === this.epoch) {
        let session = this.snapshot.session;
        if (session?.status !== "active") { this.dirty = false; break; }
        if (this.attempted) {
          const latest = await this.request("/api/vocabulary/session", undefined, epoch);
          if (!latest.ok) throw new Error(latest.payload.error || "暂时无法核对草稿是否保存，请重试。");
          this.reconcileCheckpoint(latest.payload);
          if (!this.dirty) break;
          session = this.snapshot.session!;
        }
        const { mode, current, skippedIds } = session.state;
        // If an older request may still be running, retry its exact checkpoint first.
        // Only after its revision is known may newer typing advance the next revision.
        const sent = this.attempted ?? { revision: session.revision, state: { mode, current, skippedIds } };
        this.attempted = sent;
        this.dirty = !sameVocabularyCheckpoint(session.state, sent.state);
        this.update({ saving: true });
        let conflicted = false;
        try {
          const result = await this.request("/api/vocabulary/session", { action: "checkpoint", id: session.id,
            expectedRevision: sent.revision, state: sent.state }, epoch);
          if (!result.ok) {
            if (result.status === 409) {
              conflicted = true;
              // A duplicate checkpoint can report 409 even though our exact request won.
              this.reconcileCheckpoint(result.payload, false);
              continue;
            }
            else { this.dirty = true; this.attempted = null; }
            throw new Error(result.payload.error || "本轮状态未保存，请重试。");
          }
          const live = this.snapshot.session;
          this.attempted = null;
          if (this.dirty && live && result.payload.session && live.id === result.payload.session.id) {
            const server = result.payload.session!;
            this.update({ session: { ...server, state: { ...live.state, reviewed: server.state.reviewed,
              learned: server.state.learned, lastSubmissionId: server.state.lastSubmissionId } },
              words: result.payload.words ?? this.snapshot.words, saving: false });
          } else this.adopt(result.payload);
        } catch (error) {
          if (epoch !== this.epoch) throw error;
          if (!conflicted) this.dirty = true;
          if (epoch === this.epoch) this.update({ saving: false, message: error instanceof TypeError ? "连接中断，草稿保留在本机。恢复连接后请重试保存。" : error instanceof Error ? error.message : "草稿尚未保存，请重试。" });
          throw error;
        }
      }
    };
    const next = this.checkpointChain.catch(() => undefined).then(run);
    this.checkpointChain = next;
    return next;
  }
  private reconcileCheckpoint(payload: Reply, allowUnchanged = true) {
    const local = this.snapshot.session;
    const sent = this.attempted;
    const recovery: VocabularyRecovery = { format: 2, session: local, view: this.snapshot.view, dirty: true,
      attempted: sent, startAttempt: this.startAttempt, pending: this.snapshot.pending };
    const server = payload.session ?? null;
    if (!local || !server || (!allowUnchanged && server.revision === local.revision) || !canRecoverVocabularyDraft(recovery, server, payload.words ?? [])) {
      this.adopt(payload); this.update({ pending: null }); this.selectCard();
      throw new Error("本轮状态已在其他页面更新，已读取最新记录；原操作没有继续提交。");
    }
    if (server.revision === local.revision) {
      // A timed-out request could still commit after this read; preserve its identity.
      this.update({ words: payload.words ?? this.snapshot.words, saving: false });
      return;
    }
    const changed = !sameVocabularyCheckpoint(local.state, server.state);
    this.adopt(payload);
    if (changed) {
      this.dirty = true;
      this.update({ session: { ...server, state: { ...local.state, reviewed: server.state.reviewed,
        learned: server.state.learned, lastSubmissionId: server.state.lastSubmissionId } }, mode: local.state.mode });
    }
  }
  private async operation(work: (epoch: number) => Promise<void>, allowPending = false) {
    if (this.snapshot.busy || !this.snapshot.ready || (this.snapshot.pending && !allowPending)) return;
    this.update({ busy: true, message: "" });
    const epoch = this.epoch;
    try { await work(epoch); }
    catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof TypeError ? "连接中断，当前状态已保留，请恢复连接后重试。" : error instanceof Error ? error.message : "操作未保存，请重试。" }); }
    finally { if (epoch === this.epoch) { this.update({ busy: false }); this.selectCard(); } }
  }
  async startRound() {
    await this.operation(async (epoch) => {
      this.startAttempt ??= { id: crypto.randomUUID(), mode: this.snapshot.mode };
      this.remember();
      try {
        const result = await this.request("/api/vocabulary/session", { action: "start", ...this.startAttempt }, epoch);
        if (!result.ok) {
          if (result.status === 409) { this.startAttempt = null; this.adopt(result.payload); }
          throw new Error(result.payload.error || "无法开始本轮复习。");
        }
        this.startAttempt = null; this.adopt(result.payload); this.update({ view: "review" });
      } catch (error) {
        this.requireEpoch(epoch);
        if (this.startAttempt) {
          try {
            const check = await this.request("/api/vocabulary/session", undefined, epoch);
            if (check.ok && (check.payload.session?.status === "active" || check.payload.session?.id === this.startAttempt.id)) {
              this.startAttempt = null; this.adopt(check.payload); this.update({ view: "review", message: "已核对：开始练习的结果已保存，已读取最新一轮。" }); return;
            }
          } catch { this.requireEpoch(epoch); }
        }
        throw error;
      }
    });
  }
  async changeMode(mode: VocabularyReviewMode) {
    if (mode === this.snapshot.mode) return;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (this.snapshot.session?.status !== "active") { this.update({ mode }); return; }
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const state = this.snapshot.session!.state;
      this.patch({ mode, current: null, skippedIds: state.current ? [...new Set([...state.skippedIds, state.current.wordId])] : state.skippedIds });
      await this.flush(); this.requireEpoch(epoch);
      this.update({ message: "已切换练习方式，原词本轮暂缓，没有评分。" });
    });
  }
  async skipCard() {
    await this.operation(async (epoch) => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      await this.flush(); this.requireEpoch(epoch);
      const state = this.snapshot.session!.state;
      if (!state.current) return;
      this.patch({ current: null, skippedIds: [...new Set([...state.skippedIds, state.current.wordId])] });
      await this.flush(); this.requireEpoch(epoch); this.update({ message: "已暂缓此词，没有改变熟练度或原复习安排。" });
    });
  }
  async enterLibrary() {
    await this.operation(async (epoch) => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      await this.flush(); this.requireEpoch(epoch);
      const session = this.snapshot.session;
      if (session?.status === "active") {
        try {
          const result = await this.request("/api/vocabulary/session", { action: "end", id: session.id, expectedRevision: session.revision }, epoch);
          if (!result.ok) {
            if (result.status === 409) this.adopt(result.payload);
            throw new Error(result.payload.error || "结束本轮失败，请重试。");
          }
          this.adopt(result.payload);
        } catch (error) {
          this.requireEpoch(epoch);
          const check = await this.request("/api/vocabulary/session", undefined, epoch);
          if (check.ok) this.adopt(check.payload);
          if (!check.ok || check.payload.session?.id !== session.id || check.payload.session.status !== "ended") throw error;
        }
      }
      this.update({ view: "library", message: "本轮已结束，已保存评分保留。浏览或编辑词条不产生评分。" });
    });
  }
  returnToReview() {
    if (!this.snapshot.busy && !this.snapshot.pending) this.update({ view: "review", message: "" });
  }
  async learnWord(word: VocabularyEntry) {
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const session = this.snapshot.session!;
      const result = await this.request(`/api/vocabulary/${encodeURIComponent(word.id)}/learn`, {
        expectedVersion: word.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision }, epoch);
      if (!result.ok) { if (result.status === 409) this.adopt(result.payload); throw new Error(result.payload.error || "学习安排未保存，请重试。"); }
      this.adopt(result.payload);
      this.update({ message: "已学习，1 分钟后的首次回忆已安排。这次学习没有计入答题成绩。" });
    });
  }
  async reviewWord(word: VocabularyEntry, input: Omit<VocabularySubmission, "expectedVersion" | "sessionId" | "expectedSessionRevision" | "submissionId">) {
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const session = this.snapshot.session!;
      const pending = { wordId: word.id, input: { ...input, expectedVersion: word.reviewVersion,
        sessionId: session.id, expectedSessionRevision: session.revision, submissionId: crypto.randomUUID() } };
      this.update({ pending });
      await this.sendReview(pending, epoch);
    });
  }
  private async sendReview(pending: NonNullable<VocabularyRecovery["pending"]>, epoch: number) {
    try {
      const result = await this.request(`/api/vocabulary/${encodeURIComponent(pending.wordId)}/review`, pending.input, epoch);
      if (!result.ok) {
        if (result.status < 500) { this.update({ pending: null }); if (result.status === 409) this.adopt(result.payload); }
        throw new Error(result.payload.error || "评分尚未保存。");
      }
      this.adopt(result.payload); this.update({ pending: null,
        message: `评分已保存，下次复习：${new Date(result.payload.word!.dueAt).toLocaleString("zh-CN")}。` });
    } catch (error) {
      this.requireEpoch(epoch);
      if (this.snapshot.pending) await this.checkSubmission(epoch);
      if (this.snapshot.pending) throw new Error("评分保存状态尚未确认。当前回答仍保留，请核对保存状态或重试原评分。");
      if (!this.snapshot.message.startsWith("已核对")) throw error;
    }
  }
  async checkSubmission(epoch = this.epoch) {
    const pending = this.snapshot.pending;
    if (!pending) return;
    try {
      const result = await this.request(`/api/vocabulary/session?submissionId=${encodeURIComponent(pending.input.submissionId)}`, undefined, epoch);
      if (!result.ok) throw new Error(result.payload.error || "无法核对评分状态。");
      if (result.payload.submission) {
        this.adopt(result.payload); this.update({ pending: null, message: "已核对：评分已保存，没有重复提交。" });
      } else if (result.payload.session?.status !== "active" || result.payload.session.id !== pending.input.sessionId
        || result.payload.session.revision !== pending.input.expectedSessionRevision
        || !result.payload.words?.some((word) => word.id === pending.wordId && word.reviewVersion === pending.input.expectedVersion)) {
        this.adopt(result.payload); this.update({ pending: null, message: "复习状态已经更新，原请求不再提交；没有追加评分。" });
      } else this.update({ message: "已核对：这次评分尚未保存。可重试保存，仍使用原评分和同一提交编号。" });
    } catch { this.requireEpoch(epoch); this.update({ message: "暂时无法核对评分是否保存。请恢复连接后再核对；不会自动重新评分。" }); }
  }
  async retryReview() {
    await this.operation(async (epoch) => { if (this.snapshot.pending) await this.sendReview(this.snapshot.pending, epoch); }, true);
  }
  async verifyPending() {
    await this.operation(async (epoch) => { await this.checkSubmission(epoch); }, true);
  }
  async refresh() {
    if (this.snapshot.busy) return;
    if (this.snapshot.pending) { await this.verifyPending(); return; }
    await this.initialize(this.storage);
  }
  async saveWord(data: Record<string, string | string[]>, editing?: VocabularyEntry) {
    let saved = false;
    await this.operation(async (epoch) => {
      const url = editing ? `/api/vocabulary/${encodeURIComponent(editing.id)}` : "/api/vocabulary";
      const response = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, ...(editing ? { expectedVersion: editing.reviewVersion } : {}) }) });
      const payload = await response.json() as Reply;
      this.requireEpoch(epoch);
      if (!response.ok || !payload.word) {
        if (response.status === 409) this.adopt(payload);
        throw new Error(response.status === 409 ? `${payload.error || "词条已更新。"} 当前表单未覆盖新内容；请从词库重新打开该词后核对。` : payload.error || "词条未保存，请重试。");
      }
      const word = payload.word;
      this.update({ words: [word, ...this.snapshot.words.filter((item) => item.id !== word.id)],
        message: payload.existing ? "该词已存在，原词条与复习进度保留。" : editing ? "词条已更新，复习进度保留。" : "新词已加入，下一轮先学习再回忆。" });
      saved = true;
    });
    return saved;
  }
  resetAfterRestore() {
    clearTimeout(this.checkpointTimer); this.dirty = false; this.attempted = null; this.startAttempt = null; ++this.epoch;
    try { this.storage?.removeItem(vocabularyRecoveryKey); } catch { /* Remote state is authoritative. */ }
    this.snapshot = { ...this.snapshot, ready: false, pending: null, session: null };
    void this.initialize(this.storage);
  }
  dispose() { clearTimeout(this.checkpointTimer); ++this.epoch; }
}
function nowSafe(now: number) { return Number.isFinite(now) ? now : Date.now(); }
