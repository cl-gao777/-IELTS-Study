import { mockStateSchema, type MockResult, type MockSession, type MockState } from "./mock-exam";

export interface MockClientSnapshot { session: MockSession | null; state: MockState | null; dataEpoch: string; loading: boolean; busy: boolean; frozen: boolean; writer: boolean; error: string; pendingSubmission: boolean; recoveryCopy: unknown }
export interface MockClientTransport { request(url: string, body?: unknown, keepalive?: boolean): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }>; read(): unknown; write(value: unknown): void; writerId: string }
type CheckpointJournal = { revision: number; state: MockState };
type Cached = { id: string; dataEpoch: string; revision: number; state: MockState; writerId: string; pendingSubmission: boolean; pendingCheckpoint?: CheckpointJournal | null };
export class MockExamClient {
  private view: MockClientSnapshot = { session: null, state: null, dataEpoch: "", loading: true, busy: false, frozen: false, writer: false, error: "", pendingSubmission: false, recoveryCopy: null };
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private pendingCheckpoint: CheckpointJournal | null = null;
  private ownsCache = false;
  private pauseGeneration = 0;
  constructor(private transport: MockClientTransport) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<MockClientSnapshot>) {
    this.view = { ...this.view, ...next };
    const { session, state, frozen } = this.view;
    if (session && state && !frozen && this.ownsCache) { try {
      const existing = this.transport.read() as Cached | null;
      if (this.view.writer || !existing || existing.writerId === this.transport.writerId) this.transport.write({ id: session.id, dataEpoch: session.dataEpoch, revision: session.revision, state, writerId: this.transport.writerId, pendingSubmission: this.view.pendingSubmission, pendingCheckpoint: this.pendingCheckpoint } satisfies Cached);
    } catch { /* SQLite checkpoints still work without browser storage. */ } }
    this.listeners.forEach((listener) => listener());
  }
  freeze = (message = "数据已恢复或草稿冲突；请导出本页内容后刷新。") => { this.publish({ frozen: true, writer: false, busy: false, state: this.view.state ? { ...this.view.state, paused: true } : null, error: message }); };
  private async send(url: string, body?: unknown, keepalive = false) {
    const response = await this.transport.request(url, body, keepalive);
    if (!response.ok) {
      const message = typeof response.payload.error === "string" ? response.payload.error : "本地服务暂时不可用，草稿仍保留。";
      if (response.status === 409 && response.payload.code !== "WRITER_CONFLICT") this.freeze(message);
      if (response.payload.code === "WRITER_CONFLICT") this.publish({ writer: false, state: this.view.state ? { ...this.view.state, paused: true } : null });
      throw new Error(message);
    }
    return response;
  }
  async initialize() {
    try {
      const response = await this.send("/api/mock-exam/session");
      const session = response.payload.session as MockSession | null;
      const dataEpoch = String(response.payload.dataEpoch);
      let state = session?.state ?? null, pendingSubmission = false, cache: Cached | null = null;
      try { cache = this.transport.read() as Cached | null; } catch { /* Ignore malformed storage. */ }
      const checkpointSaved = session && cache?.pendingCheckpoint && session.revision === cache.pendingCheckpoint.revision + 1 && JSON.stringify(session.state) === JSON.stringify(cache.pendingCheckpoint.state);
      const canRecover = session && cache && session.status === "active" && cache.id === session.id && cache.dataEpoch === dataEpoch && (cache.revision === session.revision || checkpointSaved) &&
        (cache.writerId === session.writerId || !session.writerId || Date.parse(session.leaseUntil ?? "") <= Date.now());
      if (canRecover && cache) {
        const parsed = mockStateSchema.safeParse(cache.state);
        if (parsed.success) { state = parsed.data; pendingSubmission = cache.pendingSubmission === true; this.ownsCache = cache.writerId === this.transport.writerId; }
      }
      const recoveryCopy = cache && !canRecover ? cache : null;
      this.publish({ session, dataEpoch, state: state ? { ...state, paused: true } : null, pendingSubmission, loading: false, recoveryCopy, ...(recoveryCopy ? { error: "另有浏览器草稿未自动合并；可通过导出草稿保留副本。" } : {}) });
      if (pendingSubmission) await this.querySubmission();
    } catch (error) { this.publish({ loading: false, error: error instanceof Error ? error.message : "无法恢复考试", frozen: true }); }
  }
  change(update: Partial<MockState>) {
    if (!this.view.writer || this.view.frozen || this.view.busy || this.view.pendingSubmission || !this.view.state || this.view.state.paused) return;
    this.publish({ state: { ...this.view.state, ...update }, error: "" });
  }
  tick(seconds: number) {
    const state = this.view.state;
    if (!state || !this.view.writer || state.paused || this.view.busy || this.view.frozen) return;
    this.publish({ state: { ...state, durations: { ...state.durations, [state.stage]: state.durations[state.stage] + seconds } } });
  }
  async start(listeningSetId: string, readingSetId: string) {
    if (this.view.busy || this.view.frozen) return;
    this.publish({ busy: true, error: "" });
    try {
      const response = await this.send("/api/mock-exam/session", { action: "start", dataEpoch: this.view.dataEpoch, listeningSetId, readingSetId });
      const session = response.payload.session as MockSession;
      this.ownsCache = true;
      this.publish({ session, state: { ...session.state, paused: true } });
    } catch (error) { this.publish({ error: String((error as Error).message) }); }
    finally { this.publish({ busy: false }); }
  }
  async resume() {
    if (this.view.busy || this.view.frozen || !this.view.session || this.view.session.status !== "active") return;
    const generation = this.pauseGeneration;
    this.publish({ busy: true, error: "" });
    try {
      const current = this.view.session;
      const response = await this.send("/api/mock-exam/session", { action: "claim", id: current.id, dataEpoch: current.dataEpoch, writerId: this.transport.writerId });
      const session = response.payload.session as MockSession;
      if (session.revision !== current.revision) {
        this.publish({ session, state: { ...session.state, paused: true }, error: "另一页面已保存更新，已加载最新草稿；请再点击继续。" }); return;
      }
      this.ownsCache = true;
      if (generation !== this.pauseGeneration) {
        this.publish({ session, writer: true, state: { ...this.view.state!, paused: true } });
        await this.checkpoint(true, true); return;
      }
      this.publish({ session, writer: true, state: { ...this.view.state!, paused: this.view.pendingSubmission } });
      await this.checkpoint();
      if (generation !== this.pauseGeneration) await this.checkpoint(true, true);
    } catch (error) { this.publish({ error: (error as Error).message }); }
    finally { this.publish({ busy: false }); }
  }
  checkpoint(release = false, keepalive = false): Promise<boolean> {
    let saved = false;
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (this.pendingCheckpoint && !this.view.frozen) {
        // Never replace an unresolved journal with a new request at the old revision.
        try {
          const response = await this.send("/api/mock-exam/session"), updated = response.payload.session as MockSession | null, journal = this.pendingCheckpoint;
          const current = this.view.session;
          if (!current || response.payload.dataEpoch !== current.dataEpoch) { this.freeze(); return; }
          if (updated?.id === current.id && updated.revision === journal.revision + 1 && JSON.stringify(updated.state) === JSON.stringify(journal.state)) {
            this.pendingCheckpoint = null; this.publish({ session: updated, ...(updated.writerId === null ? { writer: false } : {}), error: "" });
          } else if (updated?.id === current.id && updated.revision === journal.revision) this.pendingCheckpoint = null;
          else { this.freeze("保存结果与草稿版本不一致，请先导出内容再刷新。"); return; }
        } catch (error) { this.publish({ error: (error as Error).message }); return; }
      }
      const { session, state, writer, frozen } = this.view;
      if (!session || !state || !writer || frozen || session.status !== "active") return;
      try {
        this.pendingCheckpoint = { revision: session.revision, state: structuredClone(state) }; this.publish({});
        const response = await this.send("/api/mock-exam/session", { action: "checkpoint", id: session.id, dataEpoch: session.dataEpoch, writerId: this.transport.writerId, expectedRevision: session.revision, state, release }, keepalive);
        const updated = response.payload.session as MockSession;
        if (this.view.frozen) return;
        this.pendingCheckpoint = null;
        this.publish({ session: updated, ...(release ? { writer: false } : {}), error: "" }); saved = true;
      } catch (error) {
        if (!this.view.frozen) {
          try {
            const read = await this.send("/api/mock-exam/session"), updated = read.payload.session as MockSession | null;
            if (updated?.id === session.id && updated.dataEpoch === session.dataEpoch && updated.revision === session.revision + 1 && JSON.stringify(updated.state) === JSON.stringify({ ...state, ...(release ? { paused: true } : {}) })) {
              this.pendingCheckpoint = null; this.publish({ session: updated, ...(release ? { writer: false } : {}), error: "" }); saved = true; return;
            }
            if (String(read.payload.dataEpoch) !== session.dataEpoch) this.freeze();
            else if (updated && updated.revision !== session.revision) this.freeze("服务端已更新，未合并本页草稿。请先导出再刷新。");
          } catch { /* Journal survives an unavailable server and can reconcile on reload. */ }
        }
        this.publish({ error: (error as Error).message });
      }
    });
    return this.queue.then(() => saved);
  }
  pause = async (keepalive = false) => {
    this.pauseGeneration += 1;
    if (!this.view.state || this.view.frozen) return;
    this.publish({ state: { ...this.view.state, paused: true } });
    if (this.view.busy || !this.view.writer) return;
    this.publish({ busy: true });
    try { await this.checkpoint(true, keepalive); } finally { this.publish({ busy: false }); }
  };
  async nextStage() {
    const state = this.view.state;
    if (!state || !this.view.writer || state.paused || this.view.busy || this.view.frozen || state.stage === "writing") return;
    const stage = state.stage === "listening" ? "reading" : "writing";
    this.publish({ state: { ...state, stage, audioPosition: state.audioPosition }, busy: true });
    await this.checkpoint(); this.publish({ busy: false });
  }
  async querySubmission(): Promise<"completed" | "processing" | "retry" | "unknown"> {
    const session = this.view.session; if (!session) return "unknown";
    try {
      const response = await this.send(`/api/submissions/${session.submissionId}?dataEpoch=${encodeURIComponent(session.dataEpoch)}`);
      if (response.payload.status === "completed") {
        this.publish({ session: { ...session, status: "completed", result: response.payload.result as MockResult }, pendingSubmission: false, writer: false }); return "completed";
      }
      if (response.payload.status === "processing") { this.publish({ pendingSubmission: true, error: "提交正在处理；稍后点击查询结果。" }); return "processing"; }
      if (response.payload.status === "failed" || response.payload.status === "not-found") return "retry";
      return "unknown";
    } catch (error) { this.publish({ pendingSubmission: true, error: "无法确认提交结果，保留原回答。请稍后查询。" + (error as Error).message }); return "unknown"; }
  }
  async submit() {
    if (this.view.busy || this.view.frozen || !this.view.session || !this.view.state) return;
    if (this.view.pendingSubmission) {
      const result = await this.querySubmission();
      if (result !== "retry") return;
    }
    if (!this.view.writer) { this.publish({ error: "请先继续本轮，取得编辑权限后重试原提交。" }); return; }
    this.publish({ busy: true, state: { ...this.view.state, paused: true }, error: "" });
    try {
      if (!await this.checkpoint()) return;
      const session = this.view.session!;
      this.publish({ pendingSubmission: true });
      const response = await this.send("/api/mock-exam", { sessionId: session.id, submissionId: session.submissionId, dataEpoch: session.dataEpoch, writerId: this.transport.writerId });
      if (response.status === 202) { this.publish({ error: "提交正在处理；稍后查询结果。" }); return; }
      this.publish({ session: { ...session, status: "completed", result: response.payload as unknown as MockResult }, pendingSubmission: false, writer: false });
    } catch (error) { this.publish({ error: (error as Error).message }); if (!this.view.frozen) await this.querySubmission(); }
    finally { this.publish({ busy: false }); }
  }
  async end() {
    if (!this.view.session || this.view.frozen || this.view.busy) return;
    const session = this.view.session;
    if (session.status === "active" && !this.view.writer) {
      try {
        const response = await this.send("/api/mock-exam/session", { action: "claim", id: session.id, dataEpoch: session.dataEpoch, writerId: this.transport.writerId });
        const updated = response.payload.session as MockSession;
        if (updated.revision !== session.revision) { this.publish({ error: "会话已有更新，请先导出本页草稿再刷新。" }); return; }
        this.ownsCache = true; this.publish({ session: updated, writer: true });
      } catch (error) { this.publish({ error: (error as Error).message }); return; }
    }
    await this.pause();
    try {
      const current = this.view.session!;
      await this.send("/api/mock-exam/session", { action: "end", id: current.id, dataEpoch: current.dataEpoch, expectedRevision: current.revision });
      this.publish({ session: null, state: null, pendingSubmission: false, writer: false });
    } catch (error) { this.publish({ error: (error as Error).message }); }
  }
}
