import { expect, it } from "vitest";
import { MorphologyStudyClock } from "./morphology-time-client";
import type { MorphologyStudyInput, MorphologyWorkspace } from "./morphology";

it("does not credit recovered five seconds as another tab's new elapsed time", async () => {
  const cache = new Map<string, string>(); const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value); }, removeItem: (key: string) => { cache.delete(key); }, key: (index: number) => [...cache.keys()][index], get length() { return cache.size; } };
  const ledger = new Map<string, number>(); const packets: MorphologyStudyInput[] = []; let offline = true;
  const send = async (packet: MorphologyStudyInput) => { packets.push(packet); if (offline) throw new Error("offline"); ledger.set(packet.segmentId, Math.max(ledger.get(packet.segmentId) ?? 0, packet.seconds)); return {} as MorphologyWorkspace; };
  const binding = () => ({ dataEpoch: "epoch", sessionId: "00000000-0000-4000-8000-000000000001" });
  const first = new MorphologyStudyClock(binding, send, storage); const base = Date.parse("2026-10-22T00:00:00Z");
  for (let second = 0; second <= 5; second++) first.sample(base + second * 1000, true);
  await first.flush(); first.stop(); expect(first.unsavedSeconds).toBe(5);
  offline = false; const next = new MorphologyStudyClock(binding, send, storage); await next.flush(); await next.flush();
  expect([...ledger.values()].reduce((sum, seconds) => sum + seconds, 0)).toBe(5);
  for (let second = 0; second <= 3; second++) next.sample(base + (10 + second) * 1000, true);
  await next.flush(); expect([...ledger.values()].reduce((sum, seconds) => sum + seconds, 0)).toBe(8);
  expect(new Set(packets.map(p => p.segmentId)).size).toBe(2); next.stop();
});

it("does not count paused or background intervals", async () => {
  let seconds = 0; const clock = new MorphologyStudyClock(() => ({ dataEpoch: "epoch", sessionId: "session" }), async packet => { seconds = packet.seconds; return {} as MorphologyWorkspace; });
  clock.sample(0, true); clock.sample(1000, false); clock.sample(20000, false); clock.sample(21000, true); clock.sample(22000, true); clock.sample(23000, false);
  await clock.flush(); expect(seconds).toBe(3); clock.stop();
});
