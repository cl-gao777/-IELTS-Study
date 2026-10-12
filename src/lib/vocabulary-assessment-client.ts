import type { VocabularyAssessment, VocabularyAssessmentResponse } from "./vocabulary-assessment";

const cacheKey = "ielts-studio-vocabulary-assessment";
type Draft = VocabularyAssessment["draft"];
type Attempt = { revision: number; draft: Draft };
type Transport = (method: "GET" | "POST" | "PUT", body?: unknown) => Promise<{ ok: boolean; status: number; payload: VocabularyAssessmentResponse }>;
const transport: Transport = async (method, body) => {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
  const response = await fetch("/api/vocabulary/assessment", { method, cache: "no-store", signal: controller.signal, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  return { ok: response.ok, status: response.status, payload: await response.json() };
  } finally { clearTimeout(timeout); }
};
export interface VocabularyAssessmentSnapshot { assessment: VocabularyAssessment | null; ready: boolean; busy: boolean; saving: boolean; message: string }
const sameDraft = (a: Draft, b: Draft) => a.currentIndex === b.currentIndex && JSON.stringify(Object.entries(a.answers).sort()) === JSON.stringify(Object.entries(b.answers).sort());

/** Separate diagnostic state: this client never calls learning or FSRS grading. */
export class VocabularyAssessmentClient {
  private snapshot: VocabularyAssessmentSnapshot = { assessment: null, ready: false, busy: false, saving: false, message: "" };
  private listeners = new Set<() => void>();
  private dirty = false;
  private attempted: Attempt | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private epoch = 0;
  private storage?: Pick<Storage, "getItem" | "setItem">;
  constructor(private send: Transport = transport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<VocabularyAssessmentSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    const value = this.snapshot.assessment;
    try { if (this.snapshot.ready) this.storage?.setItem(cacheKey, JSON.stringify(value ? { id: value.id, revision: value.revision, draft: value.draft, attempted: this.attempted, dirty: this.dirty || Boolean(this.attempted) } : null)); } catch {}
    for (const listener of this.listeners) listener();
  }
  async initialize(storage = this.storage) {
    this.storage = storage; const epoch = ++this.epoch;
    let cached: { id: string; revision: number; draft: Draft; attempted: Attempt | null; dirty: boolean } | null = null;
    try { cached = JSON.parse(storage?.getItem(cacheKey) || "null"); } catch {}
    this.update({ busy: true, ready: false, message: "" });
    try {
      const reply = await this.send("GET"); if (epoch !== this.epoch) return;
      if (!reply.ok) throw new Error(reply.payload.error || "摸底记录暂时无法读取。");
      let assessment = reply.payload.assessment;
      this.dirty = false; this.attempted = null;
      if (assessment?.status === "active" && cached?.dirty && cached.id === assessment.id && this.validDraft(cached.draft, assessment)
        && (cached.revision === assessment.revision || (cached.attempted && this.validDraft(cached.attempted.draft, assessment) && cached.attempted.revision + 1 === assessment.revision && sameDraft(cached.attempted.draft, assessment.draft)))) {
        this.dirty = true;
        this.attempted = cached.attempted?.revision === assessment.revision ? cached.attempted : null;
        assessment = { ...assessment, draft: cached.draft };
      }
      this.update({ assessment, ready: true });
      if (this.dirty) this.schedule();
    } catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof Error ? error.message : "摸底记录暂时无法读取。" }); }
    finally { if (epoch === this.epoch) this.update({ busy: false }); }
  }
  private validDraft(draft: Draft, assessment: VocabularyAssessment) {
    return draft && Number.isInteger(draft.currentIndex) && draft.currentIndex >= 0 && draft.currentIndex <= assessment.questions.length
      && draft.answers && Object.entries(draft.answers).every(([key, answer]) => assessment.questions.some((question) => question.id === key) && typeof answer === "string" && answer.length <= 2000);
  }
  change(answer?: { id: string; value: string }, currentIndex?: number) {
    const assessment = this.snapshot.assessment;
    if (!assessment || assessment.status !== "active" || this.snapshot.busy) return;
    this.dirty = true;
    this.update({ assessment: { ...assessment, draft: { answers: answer ? { ...assessment.draft.answers, [answer.id]: answer.value } : assessment.draft.answers, currentIndex: currentIndex ?? assessment.draft.currentIndex } } });
    this.schedule();
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, 400); }
  flush() {
    clearTimeout(this.timer); const epoch = this.epoch;
    const run = async () => {
      while (this.dirty && epoch === this.epoch) {
        let assessment = this.snapshot.assessment;
        if (!assessment || assessment.status !== "active") { this.dirty = false; return; }
        try {
          if (this.attempted) {
            const check = await this.send("GET"); if (epoch !== this.epoch) return;
            const server = check.payload.assessment;
            if (!check.ok || !server) throw new Error(check.payload.error || "草稿保存状态尚未确认。");
            if (server.id !== assessment.id || server.status !== "active" || (server.revision !== assessment.revision && !(server.revision === this.attempted.revision + 1 && sameDraft(server.draft, this.attempted.draft)))) {
              this.dirty = false; this.attempted = null; this.update({ assessment: server, saving: false, message: "摸底记录已在其他页面更新，已同步最新草稿。" }); return;
            }
            if (server.revision !== assessment.revision) {
              this.attempted = null;
              assessment = { ...server, draft: assessment.draft };
              this.update({ assessment });
              if (sameDraft(server.draft, assessment.draft)) { this.dirty = false; this.update({ saving: false }); return; }
            }
          }
          const sent = this.attempted ?? { revision: assessment.revision, draft: structuredClone(assessment.draft) };
          this.attempted = sent; this.dirty = false; this.update({ saving: true });
          const reply = await this.send("PUT", { id: assessment.id, expectedRevision: sent.revision, ...sent.draft });
          if (epoch !== this.epoch) return;
          const server = reply.payload.assessment;
          if (!reply.ok || !server) {
            if (reply.status === 409 && server) {
              const live = this.snapshot.assessment!;
              if (server.id === live.id && server.status === "active" && server.revision === sent.revision + 1 && sameDraft(server.draft, sent.draft)) {
                this.attempted = null; this.dirty = !sameDraft(live.draft, server.draft); this.update({ assessment: { ...server, draft: live.draft }, saving: false }); continue;
              }
              this.dirty = false; this.attempted = null; this.update({ assessment: server, saving: false }); throw new Error("摸底记录已更新，已读取最新草稿。");
            }
            this.dirty = true; throw new Error(reply.payload.error || "草稿尚未保存，请重试。");
          }
          const live = this.snapshot.assessment!;
          this.attempted = null;
          this.update({ assessment: this.dirty ? { ...server, draft: live.draft } : server, saving: false, message: "" });
        } catch (error) {
          if (epoch === this.epoch) { if (this.attempted) this.dirty = true; this.update({ saving: false, message: error instanceof Error ? error.message : "草稿保留在本机，请重试保存。" }); }
          return;
        }
      }
    };
    this.chain = this.chain.catch(() => undefined).then(run); return this.chain;
  }
  async start() {
    if (this.snapshot.busy) return;
    const epoch = this.epoch; this.update({ busy: true, message: "" });
    try {
      const reply = await this.send("POST", { action: "start" }); if (epoch !== this.epoch) return;
      if (!reply.ok) throw new Error(reply.payload.error || "摸底暂时无法开始。");
      this.dirty = false; this.attempted = null; this.update({ assessment: reply.payload.assessment, ready: true });
    } catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof Error ? error.message : "摸底暂时无法开始。" }); }
    finally { if (epoch === this.epoch) this.update({ busy: false }); }
  }
  async submit() {
    if (this.snapshot.busy) return;
    await this.flush(); const assessment = this.snapshot.assessment;
    if (this.dirty || !assessment || assessment.questions.some((question) => !Object.hasOwn(assessment.draft.answers, question.id))) return;
    const epoch = this.epoch; this.update({ busy: true, message: "" });
    try {
      const reply = await this.send("POST", { action: "submit", id: assessment.id, expectedRevision: assessment.revision });
      if (epoch !== this.epoch) return;
      if (!reply.ok) { if (reply.status === 409) this.update({ assessment: reply.payload.assessment }); throw new Error(reply.payload.error || "结果尚未确认，请重试。"); }
      this.update({ assessment: reply.payload.assessment });
    } catch (error) {
      if (epoch !== this.epoch) return;
      try { const check = await this.send("GET"); if (epoch !== this.epoch) return; if (check.ok && check.payload.assessment?.id === assessment.id && check.payload.assessment.status === "completed") { this.update({ assessment: check.payload.assessment }); return; } } catch {}
      this.update({ message: error instanceof Error ? error.message : "结果尚未确认，请重试。", });
    } finally { if (epoch === this.epoch) this.update({ busy: false }); }
  }
  dispose() { clearTimeout(this.timer); ++this.epoch; }
}
