import { describe, expect, it } from "vitest";
import { VocabularyStudyClient, VocabularyStudyRestoreConflict } from "./vocabulary-study-client";
import type { VocabularyStudyState, VocabularyStudyUpdate } from "./vocabulary-course";

function fixture() {
  let study: VocabularyStudyState = { restoreVersion: 1, dailyGoalSeconds: 900, todaySeconds: 0, paused: false, activeCourseId: "academic", startRank: 1 };
  const seen = new Set<string>(); const totals = new Map<string, number>(); const calls: VocabularyStudyUpdate[] = []; let failure: "before" | "after" | null = null;
  const send = async (update?: VocabularyStudyUpdate) => {
    if (update) calls.push(structuredClone(update));
    if (update && update.restoreVersion !== study.restoreVersion) throw new VocabularyStudyRestoreConflict(structuredClone(study));
    if (update?.heartbeat) {
      if (failure === "before") throw new TypeError("offline");
      seen.add(update.heartbeat.id); const prior = totals.get(update.heartbeat.id) ?? 0;
      study = { ...study, todaySeconds: study.todaySeconds + Math.max(0, update.heartbeat.seconds - prior) };
      totals.set(update.heartbeat.id, Math.max(prior, update.heartbeat.seconds));
      if (failure === "after") { failure = null; throw new TypeError("ack lost"); }
    }
    study = { ...study, ...(update?.paused !== undefined ? { paused: update.paused } : {}), ...(update?.dailyGoalSeconds ? { dailyGoalSeconds: update.dailyGoalSeconds } : {}) };
    return structuredClone(study);
  };
  const values = new Map<string, string>(); const cache = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  return { send, cache, calls, seen, fail: (value: typeof failure) => { failure = value; }, state: () => study,
    restore: () => { study = { ...study, restoreVersion: study.restoreVersion + 2, todaySeconds: 0 }; } };
}
describe("foreground vocabulary study time", () => {
  it("uses the same segment when a recovered snapshot is credited before its owner seals the growing buffer", async () => {
    const f = fixture(); const first = new VocabularyStudyClient(f.send); await first.initialize(f.cache);
    first.sample(0, true); for (let second = 1; second <= 5; second++) first.sample(second * 1000, true);
    const second = new VocabularyStudyClient(f.send); await second.initialize(f.cache); await second.flush();
    expect(f.state().todaySeconds).toBe(5); expect(second.getSnapshot().unsavedSeconds).toBe(0);
    for (let second = 6; second <= 9; second++) first.sample(second * 1000, true);
    await first.flush(true); expect(f.state().todaySeconds).toBe(9); expect(f.seen.size).toBe(1);
    first.dispose(); second.dispose();
  });
  it("claims a pre-upgrade unsealed cache once without changing its historical seconds", async () => {
    const f = fixture(); f.cache.setItem("ielts-studio-vocabulary-study", JSON.stringify({ milliseconds: 5000, queue: [], restoreVersion: 1 }));
    const first = new VocabularyStudyClient(f.send); await first.initialize(f.cache);
    const second = new VocabularyStudyClient(f.send); await second.initialize(f.cache);
    await Promise.all([first.flush(true), second.flush(true)]);
    expect(f.state().todaySeconds).toBe(5); expect(f.seen.size).toBe(1); first.dispose(); second.dispose();
  });
  it("derives one migration ID when two readers see the identical old snapshot before either writes", async () => {
    const f = fixture(); const key = "ielts-studio-vocabulary-study";
    const legacy = JSON.stringify({ milliseconds: 5000, queue: [], restoreVersion: 1 });
    f.cache.setItem(key, legacy); let reads = 0;
    const concurrentCache = { ...f.cache, getItem: (name: string) => name === key && reads++ < 2 ? legacy : f.cache.getItem(name) };
    const first = new VocabularyStudyClient(f.send), second = new VocabularyStudyClient(f.send);
    await Promise.all([first.initialize(concurrentCache), second.initialize(concurrentCache)]);
    await Promise.all([first.flush(true), second.flush(true)]);
    expect(f.state().todaySeconds).toBe(5); expect(f.seen.size).toBe(1);
    const ids = f.calls.filter((call) => call.heartbeat).map((call) => call.heartbeat!.id);
    expect(new Set(ids).size).toBe(1); first.dispose(); second.dispose();
  });
  it("does not copy another tab's five-second buffer into a new heartbeat", async () => {
    const f = fixture(); const first = new VocabularyStudyClient(f.send); await first.initialize(f.cache);
    first.sample(0, true); for (let second = 1; second <= 5; second++) first.sample(second * 1000, true);
    const second = new VocabularyStudyClient(f.send); await second.initialize(f.cache);
    await Promise.all([first.flush(true), second.flush(true)]);
    expect(f.state().todaySeconds).toBe(5); expect(f.seen.size).toBe(1);
    second.sample(10_000, true); second.sample(11_000, true); await second.flush(true);
    expect(f.state().todaySeconds).toBe(6); first.dispose(); second.dispose();
  });
  it("pauses without losing the accumulated seconds and skips hidden/sleep gaps", async () => {
    const f = fixture(); const client = new VocabularyStudyClient(f.send); await client.initialize(f.cache);
    client.sample(0, true); for (let second = 1; second <= 5; second++) client.sample(second * 1000, true);
    await client.configure({ paused: true }); expect(f.state().todaySeconds).toBe(5);
    client.sample(10_000, true); client.sample(11_000, true); expect(client.getSnapshot().unsavedSeconds).toBe(0);
    await client.configure({ paused: false }); client.sample(20_000, true); client.sample(21_000, true);
    client.sample(22_000, false); client.sample(50_000, false); client.sample(60_000, true); client.sample(61_000, true);
    expect(client.getSnapshot().unsavedSeconds).toBe(3);
    client.sample(120_000, true); expect(client.getSnapshot().unsavedSeconds).toBe(3);
    await client.flush(true); expect(f.state().todaySeconds).toBe(8); client.dispose();
  });
  it("retries a lost acknowledgement with the same UUID and never double counts", async () => {
    const f = fixture(); const client = new VocabularyStudyClient(f.send); await client.initialize(f.cache); f.fail("after");
    client.sample(0, true); for (let second = 1; second <= 15; second++) client.sample(second * 1000, true);
    await client.flush(); expect(f.state().todaySeconds).toBe(15); expect(f.seen.size).toBe(1);
    const heartbeats = f.calls.filter((update) => update.heartbeat); expect(heartbeats.length).toBeGreaterThan(1);
    expect(new Set(heartbeats.map((update) => update.heartbeat!.id)).size).toBe(1); client.dispose();
  });
  it("recovers unconfirmed offline time and persists a changed soft goal", async () => {
    const f = fixture(); const first = new VocabularyStudyClient(f.send); await first.initialize(f.cache); f.fail("before");
    first.sample(0, true); for (let second = 1; second <= 15; second++) first.sample(second * 1000, true);
    await first.flush(); expect(first.getSnapshot().unsavedSeconds).toBe(15); first.dispose(); f.fail(null);
    const resumed = new VocabularyStudyClient(f.send); await resumed.initialize(f.cache); await resumed.flush();
    expect(f.state().todaySeconds).toBe(15); expect(resumed.getSnapshot().unsavedSeconds).toBe(0);
    await Promise.all([resumed.configure({ dailyGoalSeconds: 1800, paused: true }), resumed.refresh()]);
    expect(resumed.getSnapshot().study).toMatchObject({ dailyGoalSeconds: 1800, paused: true, todaySeconds: 15 }); resumed.dispose();
  });
  it("discards a pre-restore offline queue when reopening without a broadcast", async () => {
    const f = fixture(); const old = new VocabularyStudyClient(f.send); await old.initialize(f.cache); f.fail("before");
    old.sample(0, true); for (let second = 1; second <= 15; second++) old.sample(second * 1000, true);
    await old.flush(); old.dispose(); const calls = f.calls.length; f.restore(); f.fail(null);
    const resumed = new VocabularyStudyClient(f.send); await resumed.initialize(f.cache); await resumed.flush();
    expect(f.calls).toHaveLength(calls); expect(resumed.getSnapshot().unsavedSeconds).toBe(0);
    expect(f.state().todaySeconds).toBe(0); expect(resumed.getSnapshot().study?.restoreVersion).toBe(3); resumed.dispose();
  });
  it("handles an in-flight stale heartbeat without adding time or replaying its id", async () => {
    const f = fixture(); const client = new VocabularyStudyClient(f.send); await client.initialize(f.cache);
    f.restore(); client.sample(0, true); for (let second = 1; second <= 15; second++) client.sample(second * 1000, true);
    await client.flush(); expect(f.state().todaySeconds).toBe(0); expect(client.getSnapshot().unsavedSeconds).toBe(0);
    expect(client.getSnapshot().study?.restoreVersion).toBe(3); expect(f.seen.size).toBe(0);
    client.sample(16_000, true); client.sample(17_000, true); await client.flush(true);
    expect(f.state().todaySeconds).toBe(1); expect(f.calls.at(-1)?.restoreVersion).toBe(3); client.dispose();
  });
});
