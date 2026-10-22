import type { MorphologyAnswerResult, MorphologyAttemptInput, MorphologySessionInput, MorphologyWorkspace } from "./morphology";
import { morphologyAttemptInputSchema } from "./morphology";

export const morphologyRecoveryKey = "ielts-studio-morphology-recovery";
export const morphologyRetainedKey = "ielts-studio-morphology-retained";
export const morphologyTimePrefix = "ielts-studio-morphology-time:segment:";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type MorphologyTransport = (path: string, method?: "GET" | "PUT" | "POST", body?: unknown) => Promise<{ status: number; payload: unknown }>;
export interface MorphologyClientSnapshot {
  workspace: MorphologyWorkspace | null; ready: boolean; busy: boolean; saving: boolean;
  message: string; frozen: boolean; retainedInput: string; pending: MorphologyAttemptInput | null; verifiedMissing: boolean;
}
type Recovery = { dataEpoch: string; sessionId: string; revision: number; questionId: string | null; input: string; pending: MorphologyAttemptInput | null; checkpoint?: { revision: number; input: string } | null };
type SubmissionProof = { sessionId: string; lessonVersion: number; result: MorphologyAnswerResult };
type SubmissionWorkspace = MorphologyWorkspace & { submission?: SubmissionProof; currentSessionId?: string | null };
const transport: MorphologyTransport = async (path, method = "GET", body) => {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { method, cache: "no-store", signal: controller.signal,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, payload: await response.json() };
  } finally { clearTimeout(timer); }
};
const currentId = (workspace: MorphologyWorkspace | null) => workspace?.session?.state.questions[workspace.session.state.questionIndex]?.id ?? null;
const isWorkspace = (value: unknown): value is MorphologyWorkspace => Boolean(value && typeof value === "object" && typeof (value as MorphologyWorkspace).dataEpoch === "string" && "session" in value);
const errorText = (value: unknown) => value && typeof value === "object" && "error" in value ? String(value.error) : "保存暂时失败，回答已保留。";

/** Only the server moves a card forward; local storage carries an unsubmitted input, never grades. */
export class MorphologyClient {
  private snapshot: MorphologyClientSnapshot = { workspace: null, ready: false, busy: false, saving: false, message: "", frozen: false, retainedInput: "", pending: null, verifiedMissing: false };
  private listeners = new Set<() => void>();
  private storage?: StorageLike;
  private dirty = false;
  private disposed = false;
  private generation = 0;
  private checkpoint: Recovery["checkpoint"] = null;
  private timer?: ReturnType<typeof setTimeout>;
  private flushing: Promise<void> | null = null;
  constructor(private send: MorphologyTransport = transport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<MorphologyClientSnapshot>) { if (this.disposed) return; this.snapshot = { ...this.snapshot, ...patch }; this.remember(); for (const listener of this.listeners) listener(); }
  private remember() {
    const { workspace, pending } = this.snapshot; const session = workspace?.session;
    if (!workspace || !session || this.snapshot.frozen) return;
    try { this.storage?.setItem(morphologyRecoveryKey, JSON.stringify({ dataEpoch: pending?.dataEpoch ?? workspace.dataEpoch, sessionId: pending?.sessionId ?? session.id,
      revision: pending?.expectedRevision ?? session.revision, questionId: pending?.questionId ?? currentId(workspace), input: pending?.answer ?? session.state.input, pending, checkpoint: this.checkpoint } satisfies Recovery)); } catch {}
  }
  private adopt(workspace: MorphologyWorkspace, keepInput = false) {
    if (this.snapshot.frozen || this.disposed) return;
    const local = this.snapshot.workspace;
    if (keepInput && this.dirty && workspace.session && local?.session?.id === workspace.session.id && currentId(local) === currentId(workspace)) {
      workspace = { ...workspace, session: { ...workspace.session, state: { ...workspace.session.state, input: local.session.state.input } } };
    }
    this.update({ workspace, ready: true });
  }
  private freeze(message: string) {
    ++this.generation; this.dirty = false; clearTimeout(this.timer);
    const retainedInput = this.snapshot.pending?.answer ?? this.snapshot.workspace?.session?.state.input ?? "";
    this.retain(retainedInput); this.update({ frozen: true, busy: false, saving: false, message });
  }
  private retain(input: string) {
    if (!input) return;
    const old = this.snapshot.retainedInput;
    const retainedInput = !old || old === input ? input : old + "\n\n---\n\n" + input;
    try { this.storage?.setItem(morphologyRetainedKey, retainedInput); } catch {}
    this.update({ retainedInput });
  }
  clearRetained() { try { this.storage?.removeItem(morphologyRetainedKey); } catch {} this.update({ retainedInput: "" }); }
  freezeForConflict(message: string) { this.freeze(message); }
  freezeAfterRestore() { this.freeze("数据已恢复。本页已停止保存和计时，请复制未保存内容后刷新。"); }
  async endStaleRound() {
    const old = this.snapshot.workspace; if (!old?.session || !this.snapshot.frozen) return false;
    try {
      const current = await this.request("/api/morphology/session");
      if (!isWorkspace(current) || current.dataEpoch !== old.dataEpoch || current.session?.id !== old.session.id) {
        this.update({ message: "数据库或当前学习轮已变化，旧页面不能结束新状态。请保留输入并刷新。" }); return false;
      }
      const payload = await this.request("/api/morphology/session", "PUT", { action: "end", dataEpoch: current.dataEpoch, sessionId: current.session.id, expectedRevision: current.session.revision });
      if (!isWorkspace(payload)) return false;
      this.update({ frozen: false, pending: null, verifiedMissing: false, message: "旧练习轮已结束，原回答仍单独保留。" }); this.adopt(payload); return true;
    } catch { this.update({ message: "尚未结束旧练习，原回答仍保留，请重试读取状态。" }); return false; }
  }
  private async request(path: string, method?: "GET" | "PUT" | "POST", body?: unknown) {
    if (this.disposed) return null;
    const generation = this.generation;
    let result: Awaited<ReturnType<MorphologyTransport>>;
    try { result = await this.send(path, method, body); }
    catch (error) { if (generation !== this.generation || this.disposed) return null; throw error; }
    if (generation !== this.generation || this.disposed) return null;
    if (result.status === 409) { this.freeze(errorText(result.payload)); return null; }
    if (result.status < 200 || result.status >= 300) throw new Error(errorText(result.payload));
    return result.payload;
  }
  async initialize(storage?: StorageLike) {
    this.storage = storage; this.disposed = false; ++this.generation;
    try { const retainedInput = storage?.getItem(morphologyRetainedKey); if (retainedInput) this.update({ retainedInput }); } catch {}
    try {
      const payload = await this.request("/api/morphology/session"); if (!isWorkspace(payload) || this.disposed || this.snapshot.frozen) return;
      let cached: Recovery | null = null;
      try {
        const raw = JSON.parse(storage?.getItem(morphologyRecoveryKey) || "null");
        if (raw && typeof raw.dataEpoch === "string" && typeof raw.sessionId === "string" && Number.isSafeInteger(raw.revision) && raw.revision > 0
          && (typeof raw.questionId === "string" || raw.questionId === null) && typeof raw.input === "string" && raw.input.length <= 2000) {
          const parsed = raw.pending == null ? null : morphologyAttemptInputSchema.safeParse(raw.pending);
          if (!parsed || (parsed.success && parsed.data.sessionId === raw.sessionId && parsed.data.dataEpoch === raw.dataEpoch && parsed.data.expectedRevision === raw.revision && parsed.data.questionId === raw.questionId)) cached = { ...raw, pending: parsed?.success ? parsed.data : null,
            checkpoint: raw.checkpoint && raw.checkpoint.revision === raw.revision && typeof raw.checkpoint.input === "string" ? raw.checkpoint : null };
          else this.retain(raw.input);
        }
      } catch {}
      this.adopt(payload);
      if (cached?.pending && cached.dataEpoch === payload.dataEpoch) { this.update({ pending: cached.pending }); await this.verifyPending(); }
      else if (cached?.sessionId && cached.dataEpoch === payload.dataEpoch && cached.sessionId === payload.session?.id) {
        const matchingQuestion = cached.questionId === currentId(payload);
        const confirmedOwnCheckpoint = cached.checkpoint?.revision === cached.revision && payload.session.revision === cached.revision + 1 && payload.session.state.input === cached.checkpoint.input;
        if (matchingQuestion && (cached.revision === payload.session.revision || confirmedOwnCheckpoint) && cached.input !== payload.session.state.input && !payload.session.state.results.some(r => r.questionId === cached.questionId)) {
          this.setInput(cached.input);
        } else if (cached.input && cached.input !== payload.session.state.input) {
          this.retain(cached.input); this.update({ message: "本地旧回答与服务端版本不同，已单独保留，不会覆盖当前题目。" });
        }
      } else if (cached?.input && cached.dataEpoch !== payload.dataEpoch) {
        this.retain(cached.input); this.update({ message: "恢复前的旧回答已保留，不会写回数据库。" });
      } else if (cached?.input && cached.sessionId !== payload.session?.id) {
        this.retain(cached.input); this.update({ message: "旧学习轮的本地回答已单独保留，不会覆盖当前学习轮。" });
      }
    } catch (error) { this.update({ ready: true, message: error instanceof Error ? error.message : "暂时无法读取课程状态。" }); }
  }
  setInput(input: string) {
    const { workspace, frozen, pending } = this.snapshot; const session = workspace?.session;
    if (!workspace || !session || this.disposed || frozen || pending || session.state.results.some(r => r.questionId === currentId(workspace))) return;
    this.dirty = true;
    this.update({ workspace: { ...workspace, session: { ...session, state: { ...session.state, input } } } });
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, 550);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flushing) { await this.flushing; if (this.dirty && !this.snapshot.frozen) return this.flush(); return; }
    if (!this.dirty || this.snapshot.frozen || this.snapshot.pending) return;
    const run = async () => {
      while (this.dirty && !this.snapshot.frozen && !this.disposed) {
        const workspace = this.snapshot.workspace; const session = workspace?.session; if (!workspace || !session) return;
        const input = session.state.input; this.checkpoint = { revision: session.revision, input }; this.dirty = false; this.update({ saving: true });
        try {
          const payload = await this.request("/api/morphology/session", "PUT", { action: "save", dataEpoch: workspace.dataEpoch, sessionId: session.id, expectedRevision: session.revision, input });
          if (isWorkspace(payload) && !this.disposed && !this.snapshot.frozen) { this.checkpoint = null; this.adopt(payload, true); }
        } catch {
          // A lost checkpoint response is safe to acknowledge only when exactly our input was saved.
          try {
            const payload = await this.request("/api/morphology/session");
            if (isWorkspace(payload) && payload.dataEpoch === workspace.dataEpoch && payload.session?.id === session.id
              && currentId(payload) === currentId(workspace) && payload.session.revision === session.revision + 1 && payload.session.state.input === input) { this.checkpoint = null; this.adopt(payload, true); }
            else { this.dirty = true; this.update({ message: "输入已保存在浏览器，尚未确认同步。请恢复连接后重试保存。" }); break; }
          } catch { this.dirty = true; this.update({ message: "输入已保存在浏览器，尚未同步。" }); break; }
        } finally { this.update({ saving: false }); }
      }
    };
    this.flushing = run(); try { await this.flushing; } finally { this.flushing = null; }
  }
  async refresh() {
    if (this.snapshot.frozen) return;
    await this.flush(); if (this.dirty || this.snapshot.frozen || this.disposed) return;
    try {
      const payload = await this.request("/api/morphology/session"); if (!isWorkspace(payload)) return;
      if (this.snapshot.workspace && payload.dataEpoch !== this.snapshot.workspace.dataEpoch) { this.freezeAfterRestore(); return; }
      this.adopt(payload);
    } catch { this.update({ message: "暂时无法同步课程状态。" }); }
  }
  async action(action: "practice" | "hint" | "next" | "pause" | "resume" | "end") {
    if (this.snapshot.busy || this.snapshot.frozen || this.snapshot.pending) return;
    await this.flush(); if (this.dirty || this.snapshot.frozen || this.snapshot.busy || this.snapshot.pending || this.disposed) return;
    const workspace = this.snapshot.workspace; const session = workspace?.session; if (!workspace || !session) return;
    this.update({ busy: true, message: "" });
    try {
      const payload = await this.request("/api/morphology/session", "PUT", { action, dataEpoch: workspace.dataEpoch, sessionId: session.id, expectedRevision: session.revision } satisfies MorphologySessionInput);
      if (isWorkspace(payload) && !this.snapshot.frozen) this.adopt(payload);
    } catch (error) { this.update({ message: error instanceof Error ? error.message : "操作尚未确认，请同步后重试。" }); await this.refresh(); }
    finally { this.update({ busy: false }); }
  }
  async start(lessonId: string, lessonVersion: number, retry: "initial" | "whole" | "weak" = "initial") {
    if (this.snapshot.busy || this.snapshot.frozen || this.snapshot.pending) return;
    await this.flush(); if (this.dirty || this.snapshot.frozen || this.snapshot.busy || this.snapshot.pending || this.disposed) return;
    const dataEpoch = this.snapshot.workspace?.dataEpoch; if (!dataEpoch) return;
    this.update({ busy: true, message: "" });
    try {
      const body: MorphologySessionInput = { action: "start", dataEpoch, operationId: crypto.randomUUID(), lessonId, lessonVersion, retry };
      const payload = await this.request("/api/morphology/session", "PUT", body); if (isWorkspace(payload)) this.adopt(payload);
    } catch (error) { this.update({ message: error instanceof Error ? error.message : "尚未开始，请同步后重试。" }); await this.refresh(); }
    finally { this.update({ busy: false }); }
  }
  async submit(gaveUp = false) {
    if (this.snapshot.busy || this.snapshot.frozen || this.snapshot.pending) return;
    await this.flush(); if (this.dirty || this.snapshot.frozen || this.snapshot.busy || this.snapshot.pending || this.disposed) return;
    const workspace = this.snapshot.workspace; const session = workspace?.session; const questionId = currentId(workspace);
    if (!workspace || !session || !questionId || (!gaveUp && !session.state.input.trim())) return;
    const pending: MorphologyAttemptInput = { dataEpoch: workspace.dataEpoch, sessionId: session.id, expectedRevision: session.revision,
      operationId: crypto.randomUUID(), questionId, lessonVersion: session.state.lesson.version, answer: session.state.input, gaveUp };
    this.update({ pending, verifiedMissing: false, busy: true, message: "" }); await this.sendPending();
  }
  private async sendPending() {
    const pending = this.snapshot.pending; if (!pending) return;
    try {
      const payload = await this.request("/api/morphology/attempts", "POST", pending);
      if (isWorkspace(payload) && !this.snapshot.frozen) this.confirmSubmission(payload, pending);
    } catch { await this.verifyPending(); }
    finally { this.update({ busy: false }); }
  }
  private confirmSubmission(workspace: SubmissionWorkspace, pending: MorphologyAttemptInput, proof = workspace.submission) {
    if (this.snapshot.frozen || this.disposed) return;
    const result = proof?.result;
    if (!proof || proof.sessionId !== pending.sessionId || proof.lessonVersion !== pending.lessonVersion || result?.operationId !== pending.operationId
      || result.questionId !== pending.questionId || result.answer !== pending.answer || result.gaveUp !== pending.gaveUp || workspace.dataEpoch !== pending.dataEpoch) {
      this.freeze("提交记录与本次回答不匹配，请保留原回答并刷新页面，不会自动重试评分。"); return;
    }
    this.retainForChangedRound(workspace, pending);
    if (!this.snapshot.frozen) { this.update({ pending: null, verifiedMissing: false, message: "原回答已保存。" }); this.adopt(workspace); }
  }
  private retainForChangedRound(workspace: SubmissionWorkspace, pending: MorphologyAttemptInput) {
    if (workspace.session?.id !== pending.sessionId || currentId(workspace) !== pending.questionId || workspace.session.revision !== pending.expectedRevision + 1
      || (workspace.currentSessionId !== undefined && workspace.currentSessionId !== pending.sessionId)) {
      this.retain(pending.answer); this.update({ pending: null, verifiedMissing: false }); this.freeze("原回答已保存，当前学习轮或题目已变化，请刷新后继续。");
    }
  }
  async verifyPending() {
    const pending = this.snapshot.pending; if (!pending || this.snapshot.frozen) return;
    this.update({ busy: true });
    try {
      const payload = await this.request("/api/morphology/attempts?operationId=" + encodeURIComponent(pending.operationId) + "&dataEpoch=" + encodeURIComponent(pending.dataEpoch)) as { found?: boolean; workspace?: SubmissionWorkspace; submission?: SubmissionProof } | null;
      if (payload?.found && isWorkspace(payload.workspace)) this.confirmSubmission(payload.workspace, pending, payload.submission ?? payload.workspace.submission);
      else if (payload) {
        if (payload.workspace && (payload.workspace.dataEpoch !== pending.dataEpoch || payload.workspace.session?.id !== pending.sessionId || currentId(payload.workspace) !== pending.questionId || payload.workspace.session.revision !== pending.expectedRevision)) this.freeze("原提交尚无保存记录，但当前学习轮已变化。原回答已保留，请刷新后继续。");
        else this.update({ verifiedMissing: true, message: "尚无这次提交的保存记录。可以使用原编号重试，原回答不会丢失。" });
      }
    } catch { this.update({ verifiedMissing: false, message: "无法确认保存结果，原回答已保留。连接恢复后请先核对保存状态。" }); }
    finally { this.update({ busy: false }); }
  }
  async retryPending() { await this.verifyPending(); if (this.snapshot.pending && this.snapshot.verifiedMissing && !this.snapshot.frozen) { this.update({ busy: true }); await this.sendPending(); } }
  dispose() { ++this.generation; clearTimeout(this.timer); this.disposed = true; }
}
