import type { VocabularyEntry, VocabularyReviewMode } from "./vocabulary";
import type { VocabularyCardDraft, VocabularySession, VocabularySessionResponse, VocabularyReviewRecord } from "./vocabulary-session";
import { canRecoverVocabularyDraft, parseVocabularyRecovery, sameVocabularyCheckpoint, vocabularyRecoveryKey, type VocabularyRecovery, type VocabularySubmission, type VocabularyPendingOperation } from "./vocabulary-recovery";
import type { VocabularyDispositionOperation, VocabularyTargetCounts, VocabularyTargetSnapshot, VocabularyTargetState, VocabularyTermDisposition } from "./vocabulary-target";
import { vocabularyCardReviewBinding } from "./vocabulary-card-presentation";

type Reply = Partial<VocabularySessionResponse> & { word?: VocabularyEntry; review?: VocabularyReviewRecord; existing?: boolean;
  operation?: { operationId: string; action: string } | null; targets?: VocabularyTargetSnapshot[]; restoreVersion?: number;
  queuePreview?: { scheduledDue: number; nextScheduledAt: string | null } };
export type VocabularyTransport = (url: string, body?: unknown) => Promise<{ ok: boolean; status: number; payload: Reply }>;
const submissionLabel = (pending: NonNullable<VocabularyRecovery["pending"]>) => pending.supplemental
  ? pending.input.purpose === "consolidation" ? "用法巩固" : "追加练习" : "评分";
export interface VocabularyClientSnapshot {
  words: VocabularyEntry[]; session: VocabularySession | null; mode: VocabularyReviewMode;
  view: "review" | "courses" | "library"; ready: boolean; busy: boolean; saving: boolean;
  message: string; clock: number; pending: VocabularyRecovery["pending"];
  conflicted: NonNullable<VocabularyRecovery["conflicted"]> | null;
  pendingOperation: VocabularyPendingOperation | null;
  targetStates: VocabularyTargetState[]; termDispositions: VocabularyTermDisposition[]; targetCounts: VocabularyTargetCounts | null;
  queuePreview: { scheduledDue: number; nextScheduledAt: string | null } | null;
}

export const vocabularyTransport: VocabularyTransport = async (url, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { method: body === undefined ? "GET" : url.endsWith("/session") || url.endsWith("/targets") ? "PUT" : "POST",
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
  private nextInFlight: Promise<void> | null = null;
  private lastNextKey = "";
  private lastNextCheck = -Infinity;
  private storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
  constructor(words: VocabularyEntry[], now: number, private transport = vocabularyTransport) {
    this.snapshot = { words, session: null, mode: "context", view: "review", ready: false,
      busy: false, saving: false, message: "", clock: now, pending: null, conflicted: null, pendingOperation: null,
      targetStates: [], termDispositions: [], targetCounts: null, queuePreview: null };
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
    const { session, view, pending, conflicted, pendingOperation } = this.snapshot;
    try { this.storage.setItem(vocabularyRecoveryKey, JSON.stringify({ format: 2, session, view, pending, conflicted, pendingOperation, attempted: this.attempted, startAttempt: this.startAttempt, dirty: this.dirty || Boolean(this.attempted) })); }
    catch { /* A failed browser cache does not stop SQLite checkpoints. */ }
  }
  private retainConflicted(card = this.snapshot.session?.state.current, mode = this.snapshot.mode) {
    if (!card || (!card.answer.trim() && !card.gaveUp)) return;
    this.update({ conflicted: { mode, card: structuredClone(card), retainedAt: new Date().toISOString() } });
  }
  clearConflicted() { this.update({ conflicted: null }); }
  private adopt(payload: Reply, preserveUnsaved = false) {
    if (preserveUnsaved) this.retainConflicted();
    this.dirty = false;
    this.attempted = null;
    const words = payload.words ?? (payload.word ? this.snapshot.words.map((word) => word.id === payload.word!.id ? payload.word! : word) : this.snapshot.words);
    const session = payload.session === undefined ? this.snapshot.session : payload.session;
    this.update({ words, session, mode: session?.status === "active" ? session.state.mode : this.snapshot.mode, saving: false,
      targetStates: payload.targetStates ?? this.snapshot.targetStates, termDispositions: payload.termDispositions ?? this.snapshot.termDispositions,
      targetCounts: payload.targetCounts ?? this.snapshot.targetCounts, queuePreview: payload.queuePreview ?? this.snapshot.queuePreview });
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
    await this.synchronize(storage, false);
  }
  private async synchronize(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, keepReady: boolean) {
    this.storage = storage;
    const epoch = ++this.epoch;
    this.nextInFlight = null;
    this.lastNextKey = "";
    clearTimeout(this.checkpointTimer);
    // A background read must keep management panels mounted and preserve the
    // live draft even when browser storage is unavailable.
    const recovery: VocabularyRecovery | null = keepReady ? {
      format: 2, session: this.snapshot.session, view: this.snapshot.view,
      pending: this.snapshot.pending, attempted: this.attempted, startAttempt: this.startAttempt,
      conflicted: this.snapshot.conflicted,
      pendingOperation: this.snapshot.pendingOperation,
      dirty: this.dirty || Boolean(this.attempted),
    } : this.recoveryFromStorage();
    this.startAttempt = recovery?.startAttempt ?? null;
    this.update({ conflicted: recovery?.conflicted ?? null });
    this.update({ busy: true, ready: keepReady, message: "" });
    try {
      const suffix = recovery?.pending ? `?submissionId=${encodeURIComponent(recovery.pending.input.submissionId)}` : "";
      const result = await this.transport(recovery?.pendingOperation
        ? `/api/vocabulary/targets?operationId=${encodeURIComponent(recovery.pendingOperation.input.operationId)}` : `/api/vocabulary/session${suffix}`);
      if (!result.ok) throw new Error(result.payload.error || "无法读取本轮状态。");
      if (epoch !== this.epoch) return;
      if (result.payload.session?.status === "active" || result.payload.session?.id === this.startAttempt?.id) this.startAttempt = null;
      const oldCurrent = recovery?.session?.state.current;
      const server = result.payload.session;
      const recoverDraft = Boolean(recovery && canRecoverVocabularyDraft(recovery, server ?? null, result.payload.words ?? []));
      const changedRound = recovery?.session?.status === "active" && (server?.status !== "active" || server.id !== recovery.session.id
        || !recoverDraft && !sameVocabularyCheckpoint(recovery.session.state, server.state));
      if (oldCurrent && !result.payload.submission && (result.payload.error || changedRound
        || result.payload.words?.some((word) => word.id === oldCurrent.wordId && word.reviewVersion !== oldCurrent.wordVersion)))
        this.retainConflicted(oldCurrent, recovery.session!.state.mode);
      else if (!oldCurrent && server?.status === "ended" && server.state.current) {
        // A course upgrade retains the server's retired cue. Keep it visible,
        // including on a device with no browser cache, without reviving its round.
        this.retainConflicted(server.state.current, server.state.mode);
      }
      this.adopt(result.payload);
      let pending: VocabularyRecovery["pending"] = null;
      let pendingOperation: VocabularyPendingOperation | null = null;
      let message = result.payload.error ?? "";
      if (recovery?.pendingOperation && result.payload.operation) message = "已核对：上次学习选择已保存，没有重复处理。";
      else if (recovery?.pendingOperation && this.operationIsCurrent(recovery.pendingOperation, result.payload)) {
        pendingOperation = recovery.pendingOperation;
        message = "上次学习选择尚未保存，已保留原操作，可核对后重试。";
      }
      if (recovery?.pending && result.payload.submission) message = result.payload.submission.supplemental
        ? `已核对：上次${submissionLabel(recovery.pending)}已保存，复习计划保持不变。` : "已核对：上次评分已保存，没有重复提交。";
      else if (recovery?.pending && result.payload.session?.status === "active"
        && recovery.pending.input.sessionId === result.payload.session.id
        && recovery.pending.input.expectedSessionRevision === result.payload.session.revision
        && result.payload.words?.some((word) => word.id === recovery.pending!.wordId && word.reviewVersion === recovery.pending!.input.expectedVersion)) {
        pending = recovery.pending;
        message = recovery.pending.supplemental
          ? `上次${submissionLabel(recovery.pending)}尚未保存。当前回答已保留，可重试保存原练习结果。` : "上次评分尚未保存。当前回答已保留，可重试保存原评分。";
      }
      if (recovery && !result.payload.submission && !result.payload.operation && recoverDraft) {
        this.dirty = true;
        // The request may still be executing when this GET observes its old revision.
        if (recovery.attempted?.revision === result.payload.session!.revision) this.attempted = recovery.attempted;
        this.update({ session: { ...recovery.session!, revision: result.payload.session!.revision,
          updatedAt: result.payload.session!.updatedAt }, mode: recovery.session!.state.mode });
      }
      this.update({ ready: true, pending, pendingOperation, message, view: recovery?.view !== "review" && recovery?.view && this.snapshot.session?.status !== "active" ? recovery.view : "review" });
    } catch (error) {
      if (epoch === this.epoch) this.update({ message: error instanceof Error ? `复习状态加载失败：${error.message} 请重试。` : "复习状态加载失败，请重试。" });
    } finally {
      if (epoch === this.epoch) { this.update({ busy: false }); await this.selectCard(); if (this.dirty) this.scheduleCheckpoint(); }
    }
  }
  tick(now: number) { this.update({ clock: now }); void this.selectCard(); }
  private selectCard(): Promise<void> {
    const { session, words, ready, busy, pending, pendingOperation, clock, view } = this.snapshot;
    if (this.nextInFlight) return this.nextInFlight;
    if (!ready || busy || pending || pendingOperation || view !== "review" || session?.status !== "active") return Promise.resolve();
    const current = session.state.current;
    if (current) {
      const word = words.find((item) => item.id === current.wordId);
      if (word?.reviewVersion !== current.wordVersion) this.update({ message: "词条或复习安排已经更新，请同步词卡后继续；旧答案尚未评分。" });
      return Promise.resolve();
    }
    const key = session.id + ":" + session.revision;
    const due = this.snapshot.queuePreview ? this.snapshot.queuePreview.scheduledDue > 0
      || session.state.mode === "context" && Boolean(this.snapshot.targetCounts?.nextConsolidationAt && Date.parse(this.snapshot.targetCounts.nextConsolidationAt) <= clock)
      : words.some((word) => Date.parse(word.dueAt) <= clock && !session.state.skippedIds.includes(word.id));
    if (key === this.lastNextKey && clock - this.lastNextCheck < (due ? 1000 : 15_000)) return Promise.resolve();
    this.lastNextKey = key; this.lastNextCheck = clock;
    const epoch = this.epoch;
    this.update({ busy: true });
    const draw = async () => {
      try {
        await this.flush(); this.requireEpoch(epoch);
        const live = this.snapshot.session!;
        const reply = await this.request("/api/vocabulary/session", { action: "next", id: live.id, expectedRevision: live.revision }, epoch);
        if (!reply.ok) {
          if (reply.status === 409) this.adopt(reply.payload, true);
          throw new Error(reply.payload.error || "下一张词卡暂时无法读取，请重试。");
        }
        this.adopt(reply.payload);
      } catch (error) {
        if (epoch !== this.epoch) return;
        // Drawing a card is idempotent: after a lost response read the fixed
        // server assignment instead of inventing a different local question.
        try {
          const check = await this.request("/api/vocabulary/session", undefined, epoch);
          if (check.ok && check.payload.session?.id === session.id && check.payload.session.state.current) {
            this.adopt(check.payload); return;
          }
        } catch { if (epoch !== this.epoch) return; }
        this.update({ message: error instanceof TypeError ? "连接中断，下一张词卡尚未读取。恢复连接后可重试。" : error instanceof Error ? error.message : "下一张词卡尚未读取，请重试。" });
      } finally {
        if (epoch === this.epoch) this.update({ busy: false });
      }
    };
    const task = draw(); this.nextInFlight = task;
    void task.finally(() => { if (this.nextInFlight === task) this.nextInFlight = null; });
    return task;
  }
  private patch(changes: Partial<VocabularySession["state"]>) {
    const session = this.snapshot.session;
    if (!session || session.status !== "active") return;
    this.dirty = true;
    this.update({ session: { ...session, state: { ...session.state, ...changes } }, mode: changes.mode ?? this.snapshot.mode });
    this.scheduleCheckpoint();
  }
  changeDraft(changes: Partial<VocabularyCardDraft>) {
    if (this.snapshot.busy || this.snapshot.pending || this.snapshot.pendingOperation || !this.snapshot.session?.state.current) return;
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
        const { mode, current, skippedIds, courseId } = session.state;
        // If an older request may still be running, retry its exact checkpoint first.
        // Only after its revision is known may newer typing advance the next revision.
        const sent = this.attempted ?? { revision: session.revision, state: { mode, current, skippedIds, courseId: courseId ?? null } };
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
              learned: server.state.learned, supplementalReviewed: server.state.supplementalReviewed,
              lastSubmissionId: server.state.lastSubmissionId } },
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
      this.adopt(payload, true); this.update({ pending: null }); void this.selectCard();
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
        learned: server.state.learned, supplementalReviewed: server.state.supplementalReviewed,
        lastSubmissionId: server.state.lastSubmissionId } }, mode: local.state.mode });
    }
  }
  private async operation(work: (epoch: number) => Promise<void>, allowPending = false) {
    if (this.snapshot.busy || !this.snapshot.ready || ((this.snapshot.pending || this.snapshot.pendingOperation) && !allowPending)) return;
    this.update({ busy: true, message: "" });
    const epoch = this.epoch;
    try { await work(epoch); }
    catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof TypeError ? "连接中断，当前状态已保留，请恢复连接后重试。" : error instanceof Error ? error.message : "操作未保存，请重试。" }); }
    finally { if (epoch === this.epoch) { this.update({ busy: false }); await this.selectCard(); } }
  }
  async startRound(courseId?: string | null, restoreVersion = 1) {
    await this.operation(async (epoch) => {
      this.lastNextKey = "";
      this.startAttempt ??= { id: crypto.randomUUID(), mode: this.snapshot.mode, ...(courseId === undefined ? {} : { courseId }) };
      this.remember();
      try {
        const result = await this.request("/api/vocabulary/session", { action: "start", ...this.startAttempt, restoreVersion }, epoch);
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
  async enterManagement(view: "courses" | "library") {
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
      this.update({ view, message: session?.status === "active" ? "本轮已结束，已保存评分保留。浏览课程或词条不产生评分。" : "" });
    });
  }
  async enterLibrary() { await this.enterManagement("library"); }
  returnToReview() {
    if (!this.snapshot.busy && !this.snapshot.pending && !this.snapshot.pendingOperation) this.update({ view: "review", message: "" });
  }
  async learnWord(word: VocabularyEntry) {
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const session = this.snapshot.session!;
      const current = session.state.current;
      if (current?.target) {
        if (!current.restoreVersion || current.targetStateVersion === undefined) throw new Error("用法学习协议已更新，请同步当前卡后继续。");
        const pending: VocabularyPendingOperation = { kind: "learn", intro: current.purpose === "learn-target", input: {
          wordId: word.id, operationId: crypto.randomUUID(), expectedVersion: word.reviewVersion,
          sessionId: session.id, expectedSessionRevision: session.revision, restoreVersion: current.restoreVersion,
          targetId: current.target.id, targetVersion: current.target.version, expectedStateVersion: current.targetStateVersion,
        } };
        this.update({ pendingOperation: pending }); await this.sendOperation(pending, epoch); return;
      }
      const result = await this.request(`/api/vocabulary/${encodeURIComponent(word.id)}/learn`, {
        expectedVersion: word.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision }, epoch);
      if (!result.ok) { if (result.status === 409) this.adopt(result.payload); throw new Error(result.payload.error || "学习安排未保存，请重试。"); }
      this.adopt(result.payload);
      this.update({ message: "已学习，1 分钟后的首次回忆已安排。这次学习没有计入答题成绩。" });
    });
  }
  private operationIsCurrent(pending: VocabularyPendingOperation, payload: Reply) {
    if (payload.restoreVersion !== undefined && payload.restoreVersion !== pending.input.restoreVersion) return false;
    if (pending.kind === "learn") {
      const { input } = pending; const session = payload.session; const card = session?.state.current;
      return session?.status === "active" && session.id === input.sessionId && session.revision === input.expectedSessionRevision
        && card?.phase === "learn" && card.wordId === input.wordId && card.wordVersion === input.expectedVersion
        && card.target?.id === input.targetId && card.target.version === input.targetVersion
        && card.targetStateVersion === input.expectedStateVersion;
    }
    const { input } = pending;
    if (input.action.endsWith("target")) {
      const target = payload.targets?.find((item) => item.id === input.targetId);
      const state = payload.targetStates?.find((item) => item.targetId === input.targetId);
      return target?.version === input.targetVersion && (state?.version ?? 0) === input.expectedStateVersion;
    }
    const normalized = input.term?.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
    const state = payload.termDispositions?.find((item) => item.normalizedTerm === normalized);
    return (state?.version ?? 0) === input.expectedStateVersion;
  }
  async disposition(input: Omit<VocabularyDispositionOperation, "operationId">) {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const pending: VocabularyPendingOperation = { kind: "disposition", input: { ...input, operationId: crypto.randomUUID() } };
      this.update({ pendingOperation: pending }); await this.sendOperation(pending, epoch);
    });
  }
  private async sendOperation(pending: VocabularyPendingOperation, epoch: number) {
    try {
      const { wordId, ...learning } = pending.kind === "learn" ? pending.input : { wordId: "" };
      const result = await this.request(pending.kind === "learn" ? `/api/vocabulary/${encodeURIComponent(wordId)}/learn` : "/api/vocabulary/targets",
        pending.kind === "learn" ? learning : pending.input, epoch);
      if (!result.ok) {
        if (result.status < 500) { this.update({ pendingOperation: null }); if (result.status === 409) this.adopt(result.payload, true); }
        throw new Error(result.payload.error || "学习选择尚未保存。");
      }
      this.adopt(result.payload);
      const message = pending.kind === "learn" ? pending.intro
        ? "已确认学习这个用法，1 分钟后的语境巩固已安排；原复习计划保持不变。"
        : "已学习，1 分钟后的首次回忆已安排，没有计入答题成绩。"
        : pending.input.action === "know-target" ? "已保存“这个用法已会”的自报选择，不计为答对或实测掌握。"
          : pending.input.action === "pause-term" ? "已暂停整个词，各课程都不再安排；原历史和 FSRS 保留。"
            : "已恢复学习，后续按现有计划安排。";
      this.update({ pendingOperation: null, message });
    } catch (error) {
      this.requireEpoch(epoch);
      if (this.snapshot.pendingOperation) await this.checkOperation(epoch);
      if (this.snapshot.pendingOperation) throw new Error("学习选择的保存状态尚未确认。原操作仍保留，请先核对保存状态。");
      if (!this.snapshot.message.startsWith("已核对")) throw error;
    }
  }
  private async checkOperation(epoch = this.epoch) {
    const pending = this.snapshot.pendingOperation;
    if (!pending) return false;
    try {
      const result = await this.request(`/api/vocabulary/targets?operationId=${encodeURIComponent(pending.input.operationId)}`, undefined, epoch);
      if (!result.ok) throw new Error(result.payload.error || "暂时无法核对学习选择。");
      if (result.payload.operation) {
        this.adopt(result.payload); this.update({ pendingOperation: null, message: "已核对：学习选择已经保存，没有重复处理。" });
      } else if (!this.operationIsCurrent(pending, result.payload)) {
        this.adopt(result.payload, true); this.update({ pendingOperation: null, message: "用法或学习状态已更新，原操作不再提交，没有新增学习记录。" });
      } else {
        this.update({ message: "已核对：这次学习选择尚未保存，可重试原操作。" }); return true;
      }
    } catch { this.requireEpoch(epoch); this.update({ message: "暂时无法核对学习选择是否保存，原操作已保留；不会自动重新提交。" }); }
    return false;
  }
  async retryOperation() {
    await this.operation(async (epoch) => {
      const unsaved = await this.checkOperation(epoch);
      if (unsaved && this.snapshot.pendingOperation) await this.sendOperation(this.snapshot.pendingOperation, epoch);
    }, true);
  }
  async reviewWord(word: VocabularyEntry, input: Omit<VocabularySubmission, "expectedVersion" | "sessionId" | "expectedSessionRevision" | "submissionId">) {
    await this.operation(async (epoch) => {
      await this.flush(); this.requireEpoch(epoch);
      const session = this.snapshot.session!;
      const binding = session.state.current ? vocabularyCardReviewBinding(session.state.current) : null;
      if (!binding) throw new Error("当前用法的题面协议已更新，请同步词卡后继续；原回答尚未提交。");
      const pending = { wordId: word.id, supplemental: Boolean(session.state.current?.supplemental), input: { ...input, ...binding, expectedVersion: word.reviewVersion,
        sessionId: session.id, expectedSessionRevision: session.revision, submissionId: crypto.randomUUID() } };
      this.update({ pending });
      await this.sendReview(pending, epoch);
    });
  }
  private async sendReview(pending: NonNullable<VocabularyRecovery["pending"]>, epoch: number) {
    const label = submissionLabel(pending);
    try {
      const result = await this.request(`/api/vocabulary/${encodeURIComponent(pending.wordId)}/review`, pending.input, epoch);
      if (!result.ok) {
        if (result.status < 500) { this.update({ pending: null }); if (result.status === 409) this.adopt(result.payload, true); }
        throw new Error(result.payload.error || `${label}尚未保存。`);
      }
      this.adopt(result.payload); this.update({ pending: null,
        message: result.payload.review?.supplemental
          ? `${label}已保存，复习计划保持不变。`
          : `评分已保存，下次复习：${new Date(result.payload.word!.dueAt).toLocaleString("zh-CN")}。${result.payload.session?.state.current?.supplemental ? "可以再练一句，这次练习不会重复安排复习。" : ""}` });
    } catch (error) {
      this.requireEpoch(epoch);
      if (this.snapshot.pending) await this.checkSubmission(epoch);
      if (this.snapshot.pending) throw new Error(`${label}保存状态尚未确认。当前回答仍保留，请核对保存状态或重试原${pending.supplemental ? "练习结果" : "评分"}。`);
      if (!this.snapshot.message.startsWith("已核对")) throw error;
    }
  }
  async checkSubmission(epoch = this.epoch) {
    const pending = this.snapshot.pending;
    if (!pending) return false;
    const label = submissionLabel(pending);
    try {
      const result = await this.request(`/api/vocabulary/session?submissionId=${encodeURIComponent(pending.input.submissionId)}`, undefined, epoch);
      if (!result.ok) throw new Error(result.payload.error || `无法核对${label}状态。`);
      if (result.payload.submission) {
        this.adopt(result.payload); this.update({ pending: null, message: result.payload.submission.supplemental
          ? `已核对：${label}已保存，复习计划保持不变。` : "已核对：评分已保存，没有重复提交。" });
      } else if (result.payload.session?.status !== "active" || result.payload.session.id !== pending.input.sessionId
        || result.payload.session.revision !== pending.input.expectedSessionRevision
        || !result.payload.words?.some((word) => word.id === pending.wordId && word.reviewVersion === pending.input.expectedVersion)) {
        this.adopt(result.payload, true); this.update({ pending: null, message: `复习状态已经更新，原请求不再提交；没有追加${label}。` });
      } else {
        this.update({ message: `已核对：这次${label}尚未保存。可重试保存，仍使用原${pending.supplemental ? "练习结果" : "评分"}和同一提交编号。` });
        return true;
      }
    } catch { this.requireEpoch(epoch); this.update({ message: `暂时无法核对${label}是否保存。请恢复连接后再核对；不会自动重新提交。` }); }
    return false;
  }
  async retryReview() {
    await this.operation(async (epoch) => {
      // Even an explicit retry first reads the submission ledger: a previous
      // request can finish after its response was lost or the page was closed.
      const unsaved = this.snapshot.pending ? await this.checkSubmission(epoch) : false;
      if (unsaved && this.snapshot.pending) await this.sendReview(this.snapshot.pending, epoch);
    }, true);
  }
  async verifyPending() {
    await this.operation(async (epoch) => { if (this.snapshot.pendingOperation) await this.checkOperation(epoch); else await this.checkSubmission(epoch); }, true);
  }
  async refresh() {
    if (this.snapshot.busy) return;
    if (this.snapshot.pending || this.snapshot.pendingOperation) { await this.verifyPending(); return; }
    await this.synchronize(this.storage, this.snapshot.ready);
    const { session, words } = this.snapshot;
    const current = session?.state.current;
    if (session?.status === "active" && current && !words.some((word) => word.id === current.wordId && word.reviewVersion === current.wordVersion)) {
      await this.operation(async (epoch) => {
        this.patch({ current: null, skippedIds: [...new Set([...session.state.skippedIds, current.wordId])] });
        await this.flush(); this.requireEpoch(epoch);
        this.update({ message: "旧词卡已同步并暂缓，原回答尚未评分。" });
      });
    }
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
    clearTimeout(this.checkpointTimer); this.dirty = false; this.attempted = null; this.startAttempt = null; this.nextInFlight = null; this.lastNextKey = ""; ++this.epoch;
    try { this.storage?.removeItem(vocabularyRecoveryKey); } catch { /* Remote state is authoritative. */ }
    this.snapshot = { ...this.snapshot, ready: false, pending: null, conflicted: null, pendingOperation: null, targetStates: [], termDispositions: [], targetCounts: null, queuePreview: null, session: null };
    void this.initialize(this.storage);
  }
  dispose() { clearTimeout(this.checkpointTimer); ++this.epoch; }
}
