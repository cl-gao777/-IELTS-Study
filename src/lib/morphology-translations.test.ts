import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { translationIndex, resolveTranslation, assertTranslationCoverage } = createRequire(import.meta.url)("../../scripts/morphology-translations.cjs");
const entry = { exampleId: "example", sentence: "They transport goods.", translationZh: "他们运输货物。" };
describe("offline morphology translation binding", () => {
  it("requires exact IDs and exact English instead of falling back to a word gloss", () => {
    const index = translationIndex([entry]);
    expect(resolveTranslation(index, entry.exampleId, entry.sentence, "运输")).toBe(entry.translationZh);
    expect(() => resolveTranslation(index, "missing", entry.sentence, "运输")).toThrow("Missing");
    expect(() => resolveTranslation(index, entry.exampleId, "They do not transport goods.", "运输")).toThrow("mismatch");
    expect(() => resolveTranslation(index, entry.exampleId, entry.sentence, entry.translationZh)).toThrow("gloss");
  });
  it("rejects duplicates, missing/extra entries and incomplete translations", () => {
    expect(() => translationIndex([entry, entry])).toThrow("Duplicate");
    expect(() => translationIndex([{ ...entry, translationZh: "运输" }])).toThrow("Invalid");
    expect(() => assertTranslationCoverage(translationIndex([entry]), new Set())).toThrow("inventory");
    expect(() => assertTranslationCoverage(translationIndex([]), new Set([entry.exampleId]))).toThrow("inventory");
    expect(() => assertTranslationCoverage(translationIndex([entry]), new Set([entry.exampleId]))).not.toThrow();
  });
});
