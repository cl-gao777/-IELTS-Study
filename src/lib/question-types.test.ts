import { describe, expect, it } from "vitest";
import { manualPracticeSchema, questionKinds, questionSchema, questionOptions } from "./question-types";
import { htmlToPlainText } from "./material-text";
import { seedPracticeSets } from "../server/seed-data";
describe("editable question abstraction", () => {
  it("supports every required reading/listening family", () => expect(questionKinds).toHaveLength(17));
  it("supplies decision options without duplicating each renderer", () => expect(questionOptions({ id: "1", kind: "yes-no-not-given", prompt: "Claim", answers: ["YES"], explanation: "" })).toEqual(["YES", "NO", "NOT GIVEN"]));
  it("rejects choice answers that can never be selected", () => expect(questionSchema.safeParse({ id: "1", kind: "multiple-choice", prompt: "Choose", options: ["A", "B"], answers: ["C"] }).success).toBe(false));
  it("rejects a reference answer exceeding its own word limit", () => expect(questionSchema.safeParse({ id: "1", kind: "short-answer", prompt: "What surface?", answers: ["dark surfaces"], maxWords: 1 }).success).toBe(false));
  it("rejects duplicate question identifiers", () => expect(manualPracticeSchema.safeParse({ questions: [{ id: "same", kind: "short-answer", prompt: "One", answers: ["a"] }, { id: "same", kind: "short-answer", prompt: "Two", answers: ["b"] }] }).success).toBe(false));
  it("permits a pure study session without objective questions", () => expect(manualPracticeSchema.parse({ questions: [] }).questions).toEqual([]));
  it("does not permit external or script diagram URLs", () => expect(questionSchema.safeParse({ id: "1", kind: "map-labelling", prompt: "Name", answers: ["gate"], imageUrl: "javascript:alert(1)" }).success).toBe(false));
  it("keeps all original example evidence verbatim", () => { for (const set of seedPracticeSets) for (const question of set.questions) expect((set.passage || set.transcript).includes(question.evidence || "NOT PROVIDED")).toBe(true); });
});
describe("plain text HTML import", () => {
  it("removes executable content and retains text boundaries", () => expect(htmlToPlainText('<style>body{color:red}</style><h1>Urban &amp; rural</h1><script>alert(1)</script><p>Two<br>lines &#65;.</p>')).toBe("Urban & rural\n\nTwo\nlines A."));
});

describe("grouped answer schema", () => {
  const group = ["21", "22"].map((id) => ({ id, kind: "multiple-choice", prompt: `Question ${id}: choose two letters for questions 21-22.`, options: ["A", "B", "C", "D"], answers: ["B", "D"], answerGroup: "21-22", maxWords: 1 }));
  it("retains an optional answer group while accepting existing ungrouped questions", () => {
    const parsed = manualPracticeSchema.parse({ questions: group });
    expect(parsed.questions.map((question) => question.answerGroup)).toEqual(["21-22", "21-22"]);
    expect(questionSchema.safeParse({ id: "1", kind: "short-answer", prompt: "Amount", answers: ["20", "twenty"] }).success).toBe(true);
  });
  it("rejects singleton groups, missing targets and divergent answer pools", () => {
    expect(manualPracticeSchema.safeParse({ questions: [group[0]] }).success).toBe(false);
    expect(manualPracticeSchema.safeParse({ questions: group.map((question) => ({ ...question, answers: ["B"] })) }).success).toBe(false);
    expect(manualPracticeSchema.safeParse({ questions: [group[0], { ...group[1], answers: ["A", "D"] }] }).success).toBe(false);
  });
  it("rejects normalized duplicate targets and mixed word limits", () => {
    expect(manualPracticeSchema.safeParse({ questions: group.map((question) => ({ ...question, answers: ["B", "b"] })) }).success).toBe(false);
    expect(manualPracticeSchema.safeParse({ questions: [group[0], { ...group[1], maxWords: 2 }] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...group[0], answerGroup: " " }).success).toBe(false);
  });
});

it("preserves official numbering and validated alias targets on import", () => {
  const pair = [6, 7].map((number) => ({ id: String(number), originalQuestionNumber: number, kind: "short-answer", prompt: "See original paper", answers: ["books", "toys"], answerGroup: "6-7", answerGroupTargets: [["books", "some books"], ["toys", "some toys"]], maxWords: 3 }));
  const parsed = manualPracticeSchema.parse({ questions: pair });
  expect(parsed.questions[0].originalQuestionNumber).toBe(6);
  expect(parsed.questions[0].answerGroupTargets?.[0]).toContain("some books");
  expect(questionSchema.safeParse({ ...pair[0], answerGroup: undefined }).success).toBe(false);
  expect(questionSchema.safeParse({ ...pair[0], originalQuestionNumber: 0 }).success).toBe(false);
});
