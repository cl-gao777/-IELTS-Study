import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isVocabularyCatalogEntryLearnable, vocabularyCatalogSchema, vocabularyExerciseGap } from "@/lib/vocabulary-course";

const data = path.join(import.meta.dirname, "..", "data");
describe("complete public IELTS preparation learning pack", () => {
  it("matches exact source members and retains source licence/file hashes", () => {
    const bytes = readFileSync(path.join(data, "vocabulary-catalog.json"));
    const catalog = vocabularyCatalogSchema.parse(JSON.parse(bytes.toString("utf8")));
    const manifest = JSON.parse(readFileSync(path.join(data, "vocabulary-source-manifest.json"), "utf8"));
    const canonical = JSON.parse(readFileSync(path.join(data, "vocabulary-sources", "canonical.json"), "utf8"));
    expect(manifest.complete).toBe(true); expect(manifest.license).toBe("CC-BY-SA-4.0");
    expect(manifest.catalogSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(catalog.entries).toHaveLength(3766);
    expect(new Set(catalog.entries.map((entry) => entry.term)).size).toBe(3766);
    expect(catalog.entries.map((entry) => entry.term).sort()).toEqual(canonical.entries.map((entry: { term: string }) => entry.term).sort());
    expect(catalog.entries.filter((entry) => entry.courseIds.includes("general"))).toHaveLength(2809);
    expect(catalog.entries.filter((entry) => entry.courseIds.includes("academic"))).toHaveLength(957);
    for (const source of manifest.sources) {
      const filename = source.id + new URL(source.url).pathname.slice(new URL(source.url).pathname.lastIndexOf("."));
      expect(createHash("sha256").update(readFileSync(path.join(data, "vocabulary-sources", filename))).digest("hex")).toBe(source.sha256);
    }
  });
  it("publishes only complete meanings/POS and two distinct valid context snapshots, with no answers leaking", () => {
    const catalog = vocabularyCatalogSchema.parse(JSON.parse(readFileSync(path.join(data, "vocabulary-catalog.json"), "utf8")));
    for (const entry of catalog.entries) {
      expect(isVocabularyCatalogEntryLearnable(entry), entry.term).toBe(true);
      expect(entry.exercises).toHaveLength(2);
      for (const exercise of entry.exercises) {
        expect(exercise.source).toContain("原创学习例句");
        expect(exercise.meaningZh.trim()).not.toBe("");
        const gap = vocabularyExerciseGap(exercise);
        for (const answer of exercise.acceptedAnswers) {
          const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          expect(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i").test(gap), `${entry.term}: ${gap}`).toBe(false);
        }
      }
    }
  });
});
