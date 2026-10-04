import { describe, expect, it } from "vitest";
import { normaliseVocabularyAnswer, vocabularyContextGap, vocabularyInputSchema } from "./vocabulary";

describe("context vocabulary practice", () => {
  it("hides a whole word without corrupting larger words", () => {
    expect(vocabularyContextGap("economic", "Economic growth differs from economical use of resources.")).toBe("______ growth differs from economical use of resources.");
    expect(vocabularyContextGap("in", "The industry grew.")).toBeNull();
    expect(vocabularyContextGap("rely on", "We rely on data; they also rely on evidence.")).toBe("We ______ data; they also ______ evidence.");
  });
  it("does not invent a sentence when the word is absent", () => {
    expect(vocabularyContextGap("economy", "Growth improved.")).toBeNull();
    expect(vocabularyContextGap("", "Text")).toBeNull();
  });
  it("allows a quick capture without fabricated definitions and keeps metadata", () => {
    const word = vocabularyInputSchema.parse({ term: "economy", sourceSentence: "The economy grew.", wordFamily: ["economic", "economist"] });
    expect(word.meaningZh).toBe("");
    expect(word.wordFamily).toEqual(["economic", "economist"]);
    expect(vocabularyInputSchema.safeParse({ term: " " }).success).toBe(false);
  });
  it("ignores case and repeated whitespace but preserves spelling differences", () => {
    expect(normaliseVocabularyAnswer("  Economic   growth ")).toBe("economic growth");
    expect(normaliseVocabularyAnswer("economy")).not.toBe(normaliseVocabularyAnswer("econmy"));
  });
});
