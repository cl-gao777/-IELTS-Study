import { describe, expect, it } from "vitest";
import { parseSchedulerState, vocabularyScheduler } from "./vocabulary-scheduler";
import { State } from "ts-fsrs";
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
  it("previews the same four schedules without mutating the card", () => {
    const card = vocabularyScheduler.migrate([], now);
    const before = JSON.stringify(card);
    const preview = vocabularyScheduler.preview(card, now);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const scheduled = vocabularyScheduler.schedule(card, rating, now);
      expect(preview[rating].dueAt).toBe(scheduled.due.toISOString());
    }
    expect(JSON.stringify(card)).toBe(before);
    expect(preview.again.intervalSeconds).toBe(60);
    expect(preview.good.intervalSeconds).toBe(600);
  });
  it("extends successive successful due reviews and relearns a forgotten mature card in minutes", () => {
    let card = vocabularyScheduler.schedule(vocabularyScheduler.migrate([], now), "good", now);
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      const reviewedAt = new Date(card.due);
      card = vocabularyScheduler.schedule(card, "good", reviewedAt);
      intervals.push(card.scheduled_days);
      expect(card.state).toBe(State.Review);
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    const forgottenAt = new Date(card.due);
    const forgotten = vocabularyScheduler.schedule(card, "again", forgottenAt);
    expect(forgotten.state).toBe(State.Relearning);
    expect(forgotten.lapses).toBe(card.lapses + 1);
    expect(forgotten.due.getTime() - forgottenAt.getTime()).toBe(10 * 60_000);
    expect(forgotten.scheduled_days).toBe(0);
  });
  it("replays history at its recorded dates rather than moving old reviews to today", () => {
    const firstDate = new Date("2025-02-01T00:00:00.000Z");
    const lastDate = new Date("2025-02-10T00:00:00.000Z");
    const first = vocabularyScheduler.schedule(vocabularyScheduler.migrate([], firstDate), "easy", firstDate);
    const expected = vocabularyScheduler.schedule(first, "good", lastDate);
    const replayed = vocabularyScheduler.migrate([
      { rating: "good", reviewedAt: lastDate.toISOString() },
      { rating: "easy", reviewedAt: firstDate.toISOString() },
    ], now);
    expect(replayed).toEqual(expected);
    expect(replayed.last_review).toEqual(lastDate);
    expect(replayed.due.getTime()).toBeLessThan(now.getTime());
  });
  it("rejects malformed state instead of silently creating invalid dates", () => {
    expect(() => parseSchedulerState('{"due":"invalid"}')).toThrow("Invalid vocabulary scheduler state");
    expect(() => parseSchedulerState('{"due":"2026-10-04T01:00:00.000Z","stability":1,"difficulty":1}')).toThrow("Invalid vocabulary scheduler state");
    expect(() => parseSchedulerState("null")).toThrow("Invalid vocabulary scheduler state");
  });
});
