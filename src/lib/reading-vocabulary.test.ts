import { describe, expect, it } from "vitest";
import { extractReadingBody, readingBodySentences, readingTargetLemma } from "./reading-vocabulary";

describe("reading vocabulary provenance", () => {
  it("cuts questions and answers, removes furniture, rejoins wrapped words", () => {
    const body = extractReadingBody([{ page: 1, text: "Reading Passage 1\nYou should spend about 20 minutes on Questions 1–13.\nURBAN GARDENS\nA\nUrban gardens protect native insects and reduce pol-\nlution in nearby streets.\n1" },
      { page: 2, text: "British Council\nThey also provide shade for visitors during hot afternoons.\nQuestions 1–5\nComplete the table below.\nThe answer is gardens." },
      { page: 3, text: "Answers\n1. gardens" }]);
    expect(body.text).toBe("Urban gardens protect native insects and reduce pollution in nearby streets. They also provide shade for visitors during hot afternoons.");
    const sentences = readingBodySentences(body);
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toMatchObject({ pdfPage: 1, endPdfPage: 1, start: 0 });
    expect(sentences[1]).toMatchObject({ pdfPage: 2 });
    for (const sentence of sentences) expect(body.text.slice(sentence.start, sentence.end)).toBe(sentence.sentence);
  });
  it("preserves a cross-page sentence and its first/last page", () => {
    const body = extractReadingBody([{ page: 4, text: "The researchers measured water quality at" }, { page: 5, text: "several sites before publishing their findings." }]);
    expect(readingBodySentences(body)[0]).toMatchObject({ pdfPage: 4, endPdfPage: 5, sentence: "The researchers measured water quality at several sites before publishing their findings." });
  });
  it("rejects instructions and incomplete fragments, does not guess ambiguous lemmas", () => {
    expect(readingBodySentences(extractReadingBody([{ page: 1, text: "Write your answers in the boxes.\nIncomplete fragment" }]))).toEqual([]);
    const members = new Set(["study", "plan", "organise", "rely", "rate", "rat"]);
    expect(readingTargetLemma("studies", members)).toBe("study");
    expect(readingTargetLemma("planned", members)).toBe("plan");
    expect(readingTargetLemma("organising", members)).toBe("organise");
    expect(readingTargetLemma("rated", members)).toBeNull();
    expect(readingTargetLemma("reliable", members)).toBeNull();
  });
});
