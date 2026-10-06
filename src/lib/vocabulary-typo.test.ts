import { describe, expect, it } from "vitest";
import { isVocabularyTypoCandidate } from "./vocabulary";
describe("explicit typo eligibility", () => {
  it.each(["econmy", "econoomy", "econpmy", "ecoonmy", " economYx "])("accepts one edit or adjacent swap: %s", (answer) => { expect(isVocabularyTypoCandidate(answer, "economy")).toBe(true); });
  it.each(["", "  ", "economy", " ECONOMY ", "ecnom", "ecooomyx", "financial"])("rejects empty, equal or unrelated answers: %s", (answer) => { expect(isVocabularyTypoCandidate(answer, "economy")).toBe(false); });
  it("normalizes apostrophes and whitespace before deciding eligibility", () => {
    expect(isVocabularyTypoCandidate("it’s   useful", "it's useful")).toBe(false);
    expect(isVocabularyTypoCandidate("it’s usefl", "it's useful")).toBe(true);
  });
});
