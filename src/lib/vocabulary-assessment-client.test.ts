import { afterEach, describe, expect, it } from "vitest";
import { VocabularyAssessmentClient } from "./vocabulary-assessment-client";
import type { VocabularyAssessment } from "./vocabulary-assessment";

function fixture() {
  let assessment: VocabularyAssessment = { id: "assessment-1", revision: 1, status: "active", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", result: null,
    questions: Array.from({ length: 30 }, (_, index) => ({ id: "q" + index, band: "ngsl-1", prompt: "The ______ is stable.", meaningZh: "经济" })), draft: { answers: {}, currentIndex: 0 } };
  const values = new Map<string, string>(); const cache = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let failRead = false; let rejectWrite: (() => void) | undefined; let holdWrite = false; const calls: string[] = [];
  const send = async (method: "GET" | "POST" | "PUT", body?: unknown) => {
    calls.push(method); const input = body as { action?: string; id?: string; expectedRevision?: number; answers: Record<string, string>; currentIndex: number };
    if (method === "GET" && failRead) throw new TypeError("offline");
    if (method === "PUT") {
      if (input.id !== assessment.id || input.expectedRevision !== assessment.revision) return { ok: false, status: 409, payload: { assessment: structuredClone(assessment), error: "changed" } };
      assessment = { ...assessment, revision: assessment.revision + 1, draft: { answers: structuredClone(input.answers), currentIndex: input.currentIndex } };
      if (holdWrite) { holdWrite = false; await new Promise<void>((_resolve, reject) => { rejectWrite = () => reject(new TypeError("ack lost")); }); }
    }
    if (method === "POST" && input.action === "submit") assessment = { ...assessment, status: "completed", revision: assessment.revision + 1, result: { total: 30, answered: Object.values(assessment.draft.answers).filter(Boolean).length, skipped: Object.values(assessment.draft.answers).filter((answer) => !answer).length, correct: 0, bands: [], recommendedCourseId: "general", recommendedStartRank: 1, startBand: "ngsl-1", feedback: [], completedAt: "2026-10-07T00:00:00.000Z" } };
    return { ok: true, status: 200, payload: { assessment: structuredClone(assessment) } };
  };
  return { send, cache, calls, values, hold: () => { holdWrite = true; }, release: () => rejectWrite?.(), held: () => Boolean(rejectWrite), readFailure: (value: boolean) => { failRead = value; }, restore: () => { assessment = { ...assessment, revision: assessment.revision + 2, draft: { answers: {}, currentIndex: 0 } }; }, server: () => assessment };
}
const clients: VocabularyAssessmentClient[] = [];
const make = (f: ReturnType<typeof fixture>) => { const client = new VocabularyAssessmentClient(f.send); clients.push(client); return client; };
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); });
describe("independent vocabulary diagnostic recovery", () => {
  it("restores local typing after a failed read without erasing recovery", async () => {
    const f = fixture(); const first = make(f); await first.initialize(f.cache); first.change({ id: "q0", value: "economy" }); first.dispose();
    const before = [...f.values.values()]; f.readFailure(true); const resumed = make(f); await resumed.initialize(f.cache);
    expect([...f.values.values()]).toEqual(before); f.readFailure(false); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().assessment!.draft.answers.q0).toBe("economy"); await resumed.flush();
    expect(f.server().draft.answers.q0).toBe("economy");
  });
  it("keeps later typing when an earlier checkpoint committed but its response was lost", async () => {
    const f = fixture(); const first = make(f); await first.initialize(f.cache); first.change({ id: "q0", value: "eco" }); f.hold();
    const saving = first.flush(); for (let index = 0; index < 10 && !f.held(); index++) await Promise.resolve();
    expect(f.held()).toBe(true); first.change({ id: "q0", value: "economy" }); first.dispose(); f.release(); await saving;
    const resumed = make(f); await resumed.initialize(f.cache); expect(resumed.getSnapshot().assessment!.draft.answers.q0).toBe("economy");
    await resumed.flush(); expect(f.server().draft.answers.q0).toBe("economy");
  });
  it("rejects a pre-restore local draft after the diagnostic revision jumps", async () => {
    const f = fixture(); const first = make(f); await first.initialize(f.cache); first.change({ id: "q0", value: "old" }); first.dispose(); f.restore();
    const resumed = make(f); await resumed.initialize(f.cache); expect(resumed.getSnapshot().assessment!.draft.answers).toEqual({});
  });
  it("requires all thirty answers or explicit skips and only submits diagnostic state", async () => {
    const f = fixture(); const client = make(f); await client.initialize(f.cache); client.change({ id: "q0", value: "" }, 1);
    await client.submit(); expect(f.server().status).toBe("active");
    for (const question of f.server().questions) client.change({ id: question.id, value: "" }, 30);
    await client.submit(); expect(f.server().result).toMatchObject({ correct: 0, skipped: 30, total: 30 });
    expect(f.calls.filter((method) => method === "POST")).toHaveLength(1);
  });
});
