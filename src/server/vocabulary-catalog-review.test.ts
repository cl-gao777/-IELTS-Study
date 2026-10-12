import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { vocabularyCatalogEntrySchema, vocabularyExerciseSchema } from "@/lib/vocabulary-course";
import { registerVocabularyCourse, listVocabularyCatalogEntries } from "./vocabulary-courses";
import { publishVocabularyCatalogReview, queryVocabularyCatalogEntries } from "./vocabulary-catalog-review";

beforeEach(() => { holder.database = new Database(":memory:"); });
afterEach(() => holder.database?.close());
function fixture() {
  const reference = { materialId: "1", fileSha256: "a".repeat(64), passageId: "passage-1", pdfPage: 1, start: 0, end: 34, quote: "We protect this fragile ecosystem." };
  const sentences = [reference.quote, "Pollution can damage an ecosystem."];
  const exercises = sentences.map((sentence, index) => vocabularyExerciseSchema.parse({ id: `private:${index}`, version: 1, status: "draft", sentence,
    targetStart: sentence.indexOf("ecosystem"), targetEnd: sentence.indexOf("ecosystem") + 9, targetSurface: "ecosystem", acceptedAnswers: ["ecosystem"], meaningZh: "生态系统", source: "原文（原句待核对）", ...(index === 0 ? { sourceReference: reference } : {}) }));
  const entry = vocabularyCatalogEntrySchema.parse({ id: "private:ecosystem", term: "ecosystem", rank: 1, courseIds: ["reading:test:passage-1"], status: "draft", exercises });
  registerVocabularyCourse({ id: entry.courseIds[0], title: "原创阅读测试", description: "", kind: "user-import", version: 1 }, [entry], holder.database!);
  return entry;
}
describe("catalog review publishing", () => {
  it("requires two checked contexts and uses an entry version without creating personal progress", () => {
    const entry = fixture();
    const input = { entryId: entry.id, expectedVersion: entry.version, meaningZh: "生态系统", definitionEn: "Living organisms and their physical environment.", partOfSpeech: "noun", exercises: entry.exercises };
    expect(() => publishVocabularyCatalogReview(input)).toThrow("至少两个");
    const saved = publishVocabularyCatalogReview({ ...input, exercises: input.exercises.map((exercise) => ({ ...exercise, status: "published" })) });
    expect(saved.version).toBe(2); expect(saved.exercises[0].version).toBe(2); expect(saved.exercises[0].sourceReference).toEqual(entry.exercises[0].sourceReference);
    expect(() => publishVocabularyCatalogReview(input)).toThrow("其他页面");
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM vocabulary_catalog_links").get()).toEqual({ n: 0 });
  });
  it("removes original provenance after changing a sentence and filters pending content", () => {
    const entry = fixture();
    expect(queryVocabularyCatalogEntries({ courseId: entry.courseIds[0], status: "draft" }).total).toBe(1);
    const sentence = "A healthy ecosystem supports many different species.";
    const saved = publishVocabularyCatalogReview({ entryId: entry.id, expectedVersion: 1, meaningZh: "生态系统", definitionEn: "A community interacting with its environment.", partOfSpeech: "noun",
      exercises: entry.exercises.map((exercise, index) => index ? { ...exercise, status: "published" } : { ...exercise, status: "published", sentence, targetStart: 10, targetEnd: 19 }) });
    expect(saved.exercises[0].sourceReference).toBeUndefined();
    expect(saved.exercises[0].source).toContain("用户编辑");
    expect(listVocabularyCatalogEntries(entry.courseIds[0])[0].exercises).toEqual(saved.exercises);
    expect(queryVocabularyCatalogEntries({ courseId: entry.courseIds[0], status: "draft" }).total).toBe(0);
  });
});
