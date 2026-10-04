import { describe, expect, it } from "vitest";
import { manualPracticeSchema, questionKinds, questionSchema, questionOptions } from "./question-types";
import { htmlToPlainText } from "./material-text";
import { seedPracticeSets } from "../server/seed-data";
describe("editable question abstraction", () => {
  it("supports every required reading/listening family", () => expect(questionKinds).toHaveLength(14));
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
