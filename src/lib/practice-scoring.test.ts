import { describe, expect, it } from "vitest";

import {
  calculateAcademicBand,
  calculateMockOverallBand,
  normalizeAnswer,
  scoreObjectiveAnswers,
  groupedAnswerIssues,
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

describe("unordered numbered answer groups", () => {
  const pair = [
    { id: "21", answers: ["B", "D"], answerGroup: "21-22", maxWords: 1 },
    { id: "22", answers: ["B", "D"], answerGroup: "21-22", maxWords: 1 },
  ];

  it("credits both valid orders while keeping one mark and one detail per number", () => {
    for (const answers of [{ "21": "B", "22": "D" }, { "21": "D", "22": "B" }]) {
      const result = scoreObjectiveAnswers(answers, pair);
      expect(result.correct).toBe(2); expect(result.total).toBe(2);
      expect(result.details.map((detail) => detail.id)).toEqual(["21", "22"]);
    }
  });

  it("credits a repeated option only once, including normalized case and punctuation", () => {
    const result = scoreObjectiveAnswers({ "21": " b ", "22": "B." }, pair);
    expect(result.correct).toBe(1);
    expect(result.details.map((detail) => detail.correct)).toEqual([true, false]);
  });

  it("does not credit blank, missing, wrong or combined selections in a single numbered slot", () => {
    expect(scoreObjectiveAnswers({}, pair).correct).toBe(0);
    expect(scoreObjectiveAnswers({ "21": " ", "22": "" }, pair).correct).toBe(0);
    expect(scoreObjectiveAnswers({ "21": "C", "22": "B" }, pair).correct).toBe(1);
    expect(scoreObjectiveAnswers({ "21": "B D", "22": "D" }, pair).correct).toBe(1);
  });

  it("supports three-slot groups, reordered pools and independent groups", () => {
    const triple = ["31", "32", "33"].map((id, index) => ({ id, answerGroup: "31-33", answers: index === 1 ? ["E", "B", "D"] : ["B", "D", "E"] }));
    expect(scoreObjectiveAnswers({ "31": "E", "32": "D", "33": "B" }, triple).correct).toBe(3);
    expect(scoreObjectiveAnswers({ "31": "B", "32": "B", "33": "E" }, triple).correct).toBe(2);
    expect(scoreObjectiveAnswers({ "21": "B", "22": "D", "31": "B", "32": "E", "33": "D" }, [...pair, ...triple]).correct).toBe(5);
  });

  it("keeps ungrouped synonym alternatives and repeated answers working as before", () => {
    const independent = [{ id: "a", answers: ["20", "twenty"] }, { id: "b", answers: ["20", "twenty"] }];
    expect(scoreObjectiveAnswers({ a: "TWENTY", b: "TWENTY" }, independent).correct).toBe(2);
  });

  it("supports distinct multiword targets within the same maximum word limit", () => {
    const group = ["a", "b"].map((id) => ({ id, answers: ["New York", "Los Angeles"], answerGroup: "cities", maxWords: 2 }));
    expect(scoreObjectiveAnswers({ a: "Los Angeles", b: "New York" }, group).correct).toBe(2);
    expect(scoreObjectiveAnswers({ a: "the Los Angeles", b: "New York" }, group).correct).toBe(1);
  });

  it("refuses malformed group pools rather than assigning misleading partial scores", () => {
    const mismatched = [pair[0], { ...pair[1], answers: ["A", "D"] }];
    expect(groupedAnswerIssues(mismatched)).toHaveLength(2);
    expect(() => scoreObjectiveAnswers({ "21": "B", "22": "D" }, mismatched)).toThrow();
    expect(() => scoreObjectiveAnswers({}, [{ ...pair[0], answers: ["B", "b."] }, { ...pair[1], answers: ["B", "b."] }])).toThrow();
    expect(() => scoreObjectiveAnswers({}, [pair[0]])).toThrow();
    expect(() => scoreObjectiveAnswers({}, [pair[0], { ...pair[1], maxWords: 2 }])).toThrow();
    expect(() => scoreObjectiveAnswers({}, ["a", "b"].map((id) => ({ id, answers: ["New York", "London"], answerGroup: "cities", maxWords: 1 })))).toThrow();
  });
});

it('uses different full-test reading and listening conversion thresholds',()=>{
 expect(calculateAcademicBand(15,40,'reading')).toBe(5);
 expect(calculateAcademicBand(15,40,'listening')).toBe(4.5);
 expect(calculateAcademicBand(40,40,'reading')).toBe(9);
 expect(calculateAcademicBand(0,40,'listening')).toBe(0);
 expect(calculateAcademicBand(1,0,'reading')).toBe(0);
});

describe("official aliases within unordered groups", () => {
  const pair = ["6", "7"].map((id) => ({ id, answers: ["books", "toys"], answerGroup: "6-7", answerGroupTargets: [["books", "some books"], ["toys", "some toys"]], maxWords: 3 }));
  it("accepts either official variant and either order", () => {
    expect(scoreObjectiveAnswers({ "6": "some toys", "7": "Some Books." }, pair).correct).toBe(2);
  });
  it("credits two aliases for the same target only once", () => {
    expect(scoreObjectiveAnswers({ "6": "books", "7": "some books" }, pair).correct).toBe(1);
  });
  it("rejects overlapping aliases and inconsistent groups", () => {
    expect(() => scoreObjectiveAnswers({}, pair.map((q) => ({ ...q, answerGroupTargets: [["books", "same"], ["toys", "same"]] })))).toThrow();
    expect(() => scoreObjectiveAnswers({}, [pair[0], { ...pair[1], answerGroupTargets: [["books"], ["toys"]] }])).toThrow();
    expect(() => scoreObjectiveAnswers({}, pair.map((q) => ({ ...q, maxWords: 1 })))).toThrow();
  });
});
