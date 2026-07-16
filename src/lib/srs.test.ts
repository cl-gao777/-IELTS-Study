import { describe, expect, it } from "vitest";

import { scheduleVocabularyReview } from "./srs";

describe("scheduleVocabularyReview", () => {
  it("schedules a new card for tomorrow after a good recall", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");

    const result = scheduleVocabularyReview(
      {
        repetitions: 0,
        intervalDays: 0,
        easeFactor: 2.5,
      },
      "good",
      now,
    );

    expect(result).toEqual({
      repetitions: 1,
      intervalDays: 1,
      easeFactor: 2.5,
      dueAt: "2026-07-17T12:00:00.000Z",
    });
  });

  it("resets a forgotten card and schedules a short relearning step", () => {
    const result = scheduleVocabularyReview(
      {
        repetitions: 4,
        intervalDays: 18,
        easeFactor: 2.3,
      },
      "again",
      new Date("2026-07-16T12:00:00.000Z"),
    );

    expect(result).toEqual({
      repetitions: 0,
      intervalDays: 0,
      easeFactor: 2.1,
      dueAt: "2026-07-16T12:10:00.000Z",
    });
  });
});
