import { describe, expect, it } from "vitest";
import { parseSchedulerState, vocabularyScheduler } from "./vocabulary-scheduler";
import type { ReviewRating } from "./srs";

describe("FSRS vocabulary scheduler", () => {
  const now = new Date("2026-10-04T01:00:00.000Z");
  it("produces valid future schedules for all four ratings and short relearning for Again", () => {
    const fresh = vocabularyScheduler.migrate([], now);
    const due = (["again", "hard", "good", "easy"] as ReviewRating[]).map((rating) => {
      const result = vocabularyScheduler.schedule(fresh, rating, now);
      expect(result.reps).toBe(1);
      expect(result.stability).toBeGreaterThan(0);
      expect(result.due.getTime()).toBeGreaterThan(now.getTime());
      return result.due.getTime();
    });
    expect(due[0]).toBeLessThan(due[2]);
    expect(due[2]).toBeLessThan(due[3]);
  });
  it("replays historical ratings and survives JSON backup round-trip", () => {
    const history = [{ rating: "good" as const, reviewedAt: "2026-10-01T01:00:00.000Z" }, { rating: "easy" as const, reviewedAt: "2026-10-02T01:00:00.000Z" }];
    const card = vocabularyScheduler.migrate(history, now);
    expect(card.reps).toBe(2);
    const resumed = vocabularyScheduler.schedule(parseSchedulerState(JSON.stringify(card)), "again", now);
    const direct = vocabularyScheduler.schedule(card, "again", now);
    expect(resumed).toEqual(direct);
    expect(resumed.lapses).toBeGreaterThan(card.lapses);
  });
  it("rejects malformed state instead of silently creating invalid dates", () => {
    expect(() => parseSchedulerState('{"due":"invalid"}')).toThrow("Invalid vocabulary scheduler state");
    expect(() => parseSchedulerState('{"due":"2026-10-04T01:00:00.000Z","stability":1,"difficulty":1}')).toThrow("Invalid vocabulary scheduler state");
    expect(() => parseSchedulerState("null")).toThrow("Invalid vocabulary scheduler state");
  });
});
