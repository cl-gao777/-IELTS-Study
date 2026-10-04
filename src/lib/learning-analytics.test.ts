import { describe, expect, it } from "vitest";
import { activeStudyStreak, choosePracticeFocus, summarizeObjective, type AnalyticsAttempt } from "./learning-analytics";

function attempt(correct: number, total: number, seconds: number, kind: AnalyticsAttempt["kind"] = "reading"): AnalyticsAttempt {
  return { id: 1, kind, title: "Original test", correct, total, seconds, submittedAt: "2026-10-04T10:00:00.000Z",
    questions: Array.from({ length: total }, (_, i) => ({ id: String(i), kind: "short-answer", prompt: "Test", answers: ["yes"], explanation: "Evidence" })),
    answers: Array.from({ length: total }, (_, i) => ({ questionId: String(i), submitted: i < correct ? "yes" : "no", expected: ["yes"], correct: i < correct })),
  };
}
describe("evidence-based analytics", () => {
  it("weights accuracy by questions rather than averaging unlike length attempts", () => {
    const summary = summarizeObjective([attempt(1, 1, 10), attempt(0, 9, 180)], "reading");
    expect(summary.accuracy).toBe(10);
    expect(summary.secondsPerQuestion).toBe(19);
    expect(summary.byType[0]).toMatchObject({ correct: 1, total: 10, accuracy: 10, secondsPerQuestion: 19 });
  });
  it("does not treat empty or other-skill practice as a zero performance score", () => {
    const summary = summarizeObjective([attempt(0, 0, 0), attempt(5, 5, 60, "listening")], "reading");
    expect(summary.accuracy).toBeNull(); expect(summary.attempts).toBe(0);
    expect(summary.secondsPerQuestion).toBeNull(); expect(summary.byType).toEqual([]);
  });
  it("prefers collecting a missing baseline, then the weaker measured skill", () => {
    const reading = summarizeObjective([attempt(2, 10, 200)], "reading");
    const listening = summarizeObjective([attempt(8, 10, 200, "listening")], "listening");
    expect(choosePracticeFocus(reading, summarizeObjective([], "listening")).skill).toBe("listening");
    expect(choosePracticeFocus(reading, listening).skill).toBe("reading");
  });
  it("keeps yesterday's streak until today ends but breaks at gaps", () => {
    expect(activeStudyStreak(["2026-10-02", "2026-10-03"], "2026-10-04")).toBe(2);
    expect(activeStudyStreak(["2026-10-01", "2026-10-03", "2026-10-04"], "2026-10-04")).toBe(2);
    expect(activeStudyStreak(["2026-10-02"], "2026-10-04")).toBe(0);
  });
});
