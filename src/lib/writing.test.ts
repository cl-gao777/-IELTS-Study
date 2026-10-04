import { describe, expect, it } from "vitest";
import { countWritingWords, parseWritingFeedback, writingDraftSchema } from "./writing";

export const validFeedback = {
  overallBand: 6.5,
  overall: "A clear response with one recurring preposition error.",
  criteria: { taskResponse: 6.5, coherenceCohesion: 6.5, lexicalResource: 6.5, grammarAccuracy: 6 },
  criterionFeedback: { taskResponse: "Position is clear.", coherenceCohesion: "Logical paragraphs.", lexicalResource: "Use precise collocations.", grammarAccuracy: "Check prepositions." },
  strongSentences: ["Public transport connects communities."],
  weakSentences: [{ original: "Pay attention on this issue.", suggestion: "Pay attention to this issue.", explanation: "Use attention to." }],
  grammarErrors: [{ category: "Preposition", original: "attention on", correction: "attention to", explanation: "The noun takes to." }],
  vocabularyProblems: [], betterExpressions: [], rewrite: "Governments should pay attention to this issue.", actionItems: ["Review attention to."],
};

describe("writing feedback parser", () => {
  it("accepts complete fenced JSON without losing sentence-level errors", () => {
    expect(parseWritingFeedback(`Here is feedback:\n\`\`\`json\n${JSON.stringify(validFeedback)}\n\`\`\``)).toEqual(validFeedback);
  });
  it("rejects invented out-of-range scores, non-half bands, and incomplete criteria", () => {
    expect(() => parseWritingFeedback(JSON.stringify({ ...validFeedback, overallBand: 10 }))).toThrow();
    expect(() => parseWritingFeedback(JSON.stringify({ ...validFeedback, overallBand: 6.7 }))).toThrow();
    expect(() => parseWritingFeedback(JSON.stringify({ ...validFeedback, criteria: { taskResponse: 6 } }))).toThrow();
  });
  it("rejects generic prose and unknown taxonomy instead of manufacturing feedback", () => {
    expect(() => parseWritingFeedback("Your essay looks great!")).toThrow();
    expect(() => parseWritingFeedback(JSON.stringify({ ...validFeedback, grammarErrors: [{ ...validFeedback.grammarErrors[0], category: "Miscellaneous" }] }))).toThrow();
  });
});

describe("writing draft constraints", () => {
  it("counts contractions and hyphenated words without counting punctuation", () => {
    expect(countWritingWords("  It's a well-known fact.\n\nTransport costs 20%. — ")).toBe(7);
    expect(countWritingWords(" \n ")).toBe(0);
  });
  it("rejects executable or remote image URLs", () => {
    const draft = { id: "4e2d39bb-65c7-449d-9faa-c4cb7a0c78aa", groupId: "4e2d39bb-65c7-449d-9faa-c4cb7a0c78aa", version: 1, taskType: "task-1", category: "Table", prompt: "Compare the table.", image: "javascript:alert(1)", essay: "", elapsedSeconds: 0, timeLimitMinutes: 20, status: "draft", updatedAt: new Date().toISOString() };
    expect(writingDraftSchema.safeParse(draft).success).toBe(false);
    expect(writingDraftSchema.safeParse({ ...draft, image: "data:image/png;base64,aGVsbG8=" }).success).toBe(true);
    expect(writingDraftSchema.safeParse({ ...draft, image: "", category: "Opinion" }).success).toBe(false);
  });
});
