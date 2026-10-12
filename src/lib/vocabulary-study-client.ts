import type { VocabularyStudyState, VocabularyStudyUpdate } from "./vocabulary-course";

const recoveryKey = "ielts-studio-vocabulary-study";
type Heartbeat = NonNullable<VocabularyStudyUpdate["heartbeat"]> & { restoreVersion: number };
type StudyTransport = (update?: VocabularyStudyUpdate) => Promise<VocabularyStudyState>;
export interface VocabularyStudySnapshot { study: VocabularyStudyState | null; ready: boolean; busy: boolean; message: string; unsavedSeconds: number }
export class VocabularyStudyRestoreConflict extends Error {
  constructor(readonly study: VocabularyStudyState) { super("数据已恢复，旧计时缓存已清除，请按恢复后的状态继续。"); }
}
const transport: StudyTransport = async (update) => {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
  const response = await fetch("/api/vocabulary/study", { method: update ? "PUT" : "GET", cache: "no-store", signal: controller.signal,
    ...(update ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) } : {}) });
  const payload = await response.json();
  if (response.status === 409 && Number.isSafeInteger(payload.study?.restoreVersion)) throw new VocabularyStudyRestoreConflict(payload.study);
  if (!response.ok) throw new Error(payload.error || "学习时间暂时无法保存。");
  if (!Number.isSafeInteger(payload.restoreVersion) || payload.restoreVersion < 1) throw new Error("学习协议已更新，请刷新页面后继续。");
  return payload as VocabularyStudyState;
  } finally { clearTimeout(timeout); }
};

/** Foreground samples only; retries reuse the exact heartbeat id. */
export class VocabularyStudyClient {
  private snapshot: VocabularyStudySnapshot = { study: null, ready: false, busy: false, message: "", unsavedSeconds: 0 };
  private listeners = new Set<() => void>();
  private queue: Heartbeat[] = [];
  private milliseconds = 0;
  private lastSample: number | null = null;
  private wasActive = false;
  private chain: Promise<void> = Promise.resolve();
  private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private epoch = 0;
  private bufferVersion: number | null = null;
  constructor(private send: StudyTransport = transport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<VocabularyStudySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, unsavedSeconds: Math.floor(this.milliseconds / 1000) + this.queue.reduce((total, item) => total + item.seconds, 0) };
    this.remember(); for (const listener of this.listeners) listener();
  }
  private remember() {
    try { this.storage?.setItem(recoveryKey, JSON.stringify({ milliseconds: this.milliseconds, queue: this.queue, restoreVersion: this.bufferVersion })); } catch { /* Server statistics remain intact. */ }
  }
  private adopt(study: VocabularyStudyState) {
    const changed = this.bufferVersion !== null && this.bufferVersion !== study.restoreVersion;
    if (changed) { this.queue = []; this.milliseconds = 0; this.lastSample = null; this.wasActive = false; }
    this.bufferVersion = study.restoreVersion;
    this.update({ study, ready: true, ...(changed ? { message: "数据已恢复，旧计时缓存已清除。" } : {}) });
  }
  private failed(error: unknown) {
    if (error instanceof VocabularyStudyRestoreConflict) this.adopt(error.study);
    this.update({ message: error instanceof Error ? error.message : "时间已保留，连接恢复后会继续保存。" });
  }
  async initialize(storage = this.storage) {
    this.storage = storage; const epoch = ++this.epoch;
    this.lastSample = null; this.wasActive = false;
    try {
      const recovery = JSON.parse(storage?.getItem(recoveryKey) || "null");
      this.bufferVersion = Number.isSafeInteger(recovery?.restoreVersion) && recovery.restoreVersion > 0 ? recovery.restoreVersion : null;
      if (this.bufferVersion && Number.isFinite(recovery?.milliseconds) && recovery.milliseconds >= 0 && recovery.milliseconds < 15_000) this.milliseconds = recovery.milliseconds;
      if (Array.isArray(recovery?.queue)) this.queue = recovery.queue.filter((item: Heartbeat) => item.restoreVersion === this.bufferVersion && /^[0-9a-f-]{36}$/i.test(item.id) && Number.isInteger(item.seconds) && item.seconds > 0 && item.seconds <= 15).slice(0, 2000);
    } catch { /* Ignore malformed local recovery. */ }
    this.update({ busy: true, message: "" });
    try { const study = await this.send(); if (epoch === this.epoch) this.adopt(study); }
    catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof Error ? error.message : "学习时间暂时无法读取。" }); }
    finally { if (epoch === this.epoch) { this.update({ busy: false }); if (this.snapshot.ready && this.queue.length) void this.flush(); } }
  }
  sample(now: number, active: boolean) {
    const elapsed = this.lastSample === null ? 0 : now - this.lastSample;
    // A long timer gap may be sleep or a suspended tab; it is not study time.
    if (this.wasActive && elapsed > 0 && elapsed <= 3000) this.milliseconds += elapsed;
    this.lastSample = now;
    this.wasActive = active && this.snapshot.ready && !this.snapshot.study?.paused;
    while (this.milliseconds >= 15_000) {
      if (this.bufferVersion) this.queue.push({ id: crypto.randomUUID(), seconds: 15, restoreVersion: this.bufferVersion }); this.milliseconds -= 15_000;
    }
    this.update({});
    if (this.queue.length && this.snapshot.ready) void this.flush();
  }
  flush(final = false) {
    if (final) {
      const seconds = Math.floor(this.milliseconds / 1000);
      if (seconds && this.bufferVersion) { this.queue.push({ id: crypto.randomUUID(), seconds, restoreVersion: this.bufferVersion }); this.milliseconds -= seconds * 1000; this.update({}); }
    }
    const epoch = this.epoch;
    const run = async () => {
      while (this.queue.length && epoch === this.epoch && this.snapshot.ready) {
        const heartbeat = this.queue[0];
        try {
          const { restoreVersion, ...packet } = heartbeat;
          const study = await this.send({ heartbeat: packet, restoreVersion });
          if (epoch !== this.epoch) return;
          if (this.queue[0]?.id === heartbeat.id) this.queue.shift();
          this.adopt(study); this.update({ message: "" });
        } catch (error) { if (epoch === this.epoch) this.failed(error); return; }
      }
    };
    this.chain = this.chain.catch(() => undefined).then(run); return this.chain;
  }
  async configure(update: Omit<VocabularyStudyUpdate, "heartbeat">) {
    const epoch = this.epoch;
    this.wasActive = false; this.update({ busy: true });
    await this.flush(true);
    const run = async () => {
      if (epoch !== this.epoch) return;
      try { const study = await this.send({ ...update, restoreVersion: this.snapshot.study?.restoreVersion }); if (epoch === this.epoch) { this.adopt(study); this.update({ message: "" }); } }
      catch (error) { if (epoch === this.epoch) this.failed(error); }
      finally { if (epoch === this.epoch) this.update({ busy: false }); }
    };
    this.chain = this.chain.catch(() => undefined).then(run); await this.chain;
  }
  async refresh() {
    await this.flush(true);
    const epoch = this.epoch;
    const run = async () => {
      if (epoch !== this.epoch) return;
      try { const study = await this.send(); if (epoch === this.epoch) this.adopt(study); }
      catch (error) { if (epoch === this.epoch) this.update({ message: error instanceof Error ? error.message : "时间暂时无法读取。" }); }
    };
    this.chain = this.chain.catch(() => undefined).then(run); await this.chain;
  }
  resetAfterRestore() { ++this.epoch; this.queue = []; this.milliseconds = 0; this.bufferVersion = null; this.lastSample = null; this.wasActive = false; try { this.storage?.removeItem(recoveryKey); } catch {} this.update({ ready: false, study: null }); void this.initialize(this.storage); }
  dispose() { ++this.epoch; this.wasActive = false; this.lastSample = null; }
}
