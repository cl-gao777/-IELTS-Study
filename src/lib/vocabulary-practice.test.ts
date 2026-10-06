import { describe, expect, it } from "vitest";
import type { VocabularyEntry } from "./vocabulary";
import { vocabularyPracticeContext, vocabularyRecallCue, vocabularyReviewQueue } from "./vocabulary-practice";

const word = (id: string, dueAt: string) => ({ id, dueAt } as VocabularyEntry);

describe("active vocabulary recall", () => {
  it("orders only due cards, preserves the library, and admits a relearning card exactly when due", () => {
    const words = [word("future", "2026-10-05T10:01:00Z"), word("later", "2026-10-05T09:00:00Z"), word("oldest", "2026-10-04T09:00:00Z")];
    const original = [...words];
    expect(vocabularyReviewQueue(words, Date.parse("2026-10-05T10:00:00Z")).map((item) => item.id)).toEqual(["oldest", "later"]);
    expect(vocabularyReviewQueue(words, Date.parse("2026-10-05T10:01:00Z"), new Set(["later"])).map((item) => item.id)).toEqual(["oldest", "future"]);
    expect(words).toEqual(original);
  });
  it("prioritises due reviews and introduced words over older unlearned words", () => {
    const entries = [
      { ...word("new", "2026-10-01T09:00:00Z"), hasReviewHistory: false, repetitions: 0, learningStartedAt: null },
      { ...word("introduced", "2026-10-05T09:00:00Z"), hasReviewHistory: false, repetitions: 0, learningStartedAt: "2026-10-05T08:59:00Z" },
      { ...word("reviewed", "2026-10-04T09:00:00Z"), hasReviewHistory: true, repetitions: 0, learningStartedAt: null },
    ];
    expect(vocabularyReviewQueue(entries, Date.parse("2026-10-05T10:00:00Z")).map((item) => item.id)).toEqual(["reviewed", "introduced", "new"]);
  });
  it("does not leak the answer when definitions repeat the word, use phrase whitespace, or smart apostrophes", () => {
    expect(vocabularyRecallCue({ term: "ambiguity", meaningZh: "ambiguity：歧义", definitionEn: "Ambiguity means more than one interpretation." })).toEqual({ title: "______：歧义", detail: "______ means more than one interpretation." });
    expect(vocabularyRecallCue({ term: "rely on", meaningZh: "依赖", definitionEn: "To rely\non means to depend on." }).detail).toBe("To ______ means to depend on.");
    expect(vocabularyRecallCue({ term: "consumer's goods", meaningZh: "消费品", definitionEn: "Consumer’s goods are items for personal use." }).detail).toBe("______ are items for personal use.");
    expect(vocabularyPracticeContext({ term: "rely on", sourceSentence: "We rely on evidence; they RELY\non evidence too.", example: "" })).toBe("We ______ evidence; they ______ evidence too.");
  });
  it("uses an actual gap in a fallback example and treats missing information as unavailable", () => {
    expect(vocabularyPracticeContext({ term: "economic", sourceSentence: "No relevant context.", example: "Economic growth differs from economical use." })).toBe("______ growth differs from economical use.");
    expect(vocabularyPracticeContext({ term: "economic", sourceSentence: "", example: "No context." })).toBeNull();
    expect(vocabularyRecallCue({ term: "evidence", meaningZh: "", definitionEn: "evidence" }).title).toBe("");
    expect(vocabularyRecallCue({ term: "evidence", meaningZh: "“evidence”：", definitionEn: "" }).title).toBe("");
  });
});
