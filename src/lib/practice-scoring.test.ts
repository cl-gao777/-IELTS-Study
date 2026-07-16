import { describe, expect, it } from "vitest";

import {
  calculateAcademicBand,
  calculateMockOverallBand,
  normalizeAnswer,
  scoreObjectiveAnswers,
} from "./practice-scoring";

describe("normalizeAnswer", () => {
  it("ignores case, surrounding whitespace and repeated spaces", () => {
    expect(normalizeAnswer("  Solar   Energy ")).toBe("solar energy");
  });
});

describe("calculateMockOverallBand", () => {
  it("rounds the three module estimates to the nearest half band", () => {
    expect(calculateMockOverallBand([6.5, 7, 6])).toBe(6.5);
    expect(calculateMockOverallBand([7, 7, 7.5])).toBe(7);
  });
});

describe("scoreObjectiveAnswers", () => {
  it("accepts any configured answer variant", () => {
    const result = scoreObjectiveAnswers(
      { q1: "greenhouse gases", q2: "FALSE" },
      [
        { id: "q1", answers: ["greenhouse gas", "greenhouse gases"] },
        { id: "q2", answers: ["false"] },
      ],
    );

    expect(result.correct).toBe(2);
    expect(result.total).toBe(2);
    expect(result.details.every((detail) => detail.correct)).toBe(true);
  });
});

describe("calculateAcademicBand", () => {
  it("maps common IELTS Academic raw scores to half bands", () => {
    expect(calculateAcademicBand(30, 40, "reading")).toBe(7);
    expect(calculateAcademicBand(23, 40, "listening")).toBe(6);
  });

  it("scales shorter original practice sets to a forty-question equivalent", () => {
    expect(calculateAcademicBand(6, 8, "reading")).toBe(7);
  });
});
