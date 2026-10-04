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

  it("does not invent a band from a short drill", () => {
    expect(calculateAcademicBand(6, 8, "reading")).toBe(0);
  });
});

it('scores missing, alternate, punctuation, spelling and word-limit cases explicitly', () => {
  const questions = [
    {id:'a',answers:['native flowers'],maxWords:2},
    {id:'b',answers:['False']},
    {id:'c',answers:['20','twenty']},
    {id:'d',answers:['economy']},
    {id:'e',answers:['the local council'],maxWords:2},
  ];
  const result=scoreObjectiveAnswers({a:' Native   Flowers. ',c:'TWENTY',d:'econmy',e:'the local council'},questions);
  expect(result.correct).toBe(2);
  expect(result.details.find(d=>d.id==='b')?.correct).toBe(false);
});

it('uses different full-test reading and listening conversion thresholds',()=>{
 expect(calculateAcademicBand(15,40,'reading')).toBe(5);
 expect(calculateAcademicBand(15,40,'listening')).toBe(4.5);
 expect(calculateAcademicBand(40,40,'reading')).toBe(9);
 expect(calculateAcademicBand(0,40,'listening')).toBe(0);
 expect(calculateAcademicBand(1,0,'reading')).toBe(0);
});
