import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, existsSync: (filename: Parameters<typeof actual.existsSync>[0]) => String(filename).endsWith("vocabulary-catalog.json") ? false : actual.existsSync(filename) };
});
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { vocabularyCatalogEntrySchema, vocabularyExerciseSchema } from "@/lib/vocabulary-course";
import { registerVocabularyCourse, listVocabularyCatalogEntries } from "./vocabulary-courses";
import { publishVocabularyCatalogReview, queryVocabularyCatalogEntries } from "./vocabulary-catalog-review";
import { vocabularyTargetSchema } from "@/lib/vocabulary-target";

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
  it("edits the selected course sense and linked sentences without changing the basic meaning or another sense", () => {
    const term = "address", courseId = "advanced:test", otherCourse = "advanced:other";
    const sentences = ["We address the difficult problem today.", "They address several urgent concerns.", "Write the address on this envelope.", "This address is difficult to find."];
    const exercises = sentences.map((sentence, index) => vocabularyExerciseSchema.parse({ id: `sense:${index}`, version: 1,
      targetId: index < 2 ? "address:verb" : "address:noun", sentence, targetStart: sentence.indexOf(term), targetEnd: sentence.indexOf(term) + term.length,
      targetSurface: term, acceptedAnswers: [term], meaningZh: index < 2 ? "处理" : "地址", source: "Original test example" }));
    const targets = ["verb", "noun"].map((partOfSpeech, index) => vocabularyTargetSchema.parse({ id: `address:${partOfSpeech}`, version: 1,
      partOfSpeech, meaningZh: index ? "地址" : "处理", definitionEn: index ? "A place to send mail." : "To deal with an issue.", level: "B2",
      memberships: [{ courseId: index ? otherCourse : courseId, version: 1, rank: 1, exerciseIds: exercises.slice(index * 2, index * 2 + 2).map((exercise) => exercise.id) }] }));
    const original = vocabularyCatalogEntrySchema.parse({ id: "entry:address", term, courseIds: [courseId, otherCourse], rank: 1, meaningZh: "原个人基础义", definitionEn: "Basic sense", partOfSpeech: "noun", exercises, targets });
    registerVocabularyCourse({ id: courseId, title: "Advanced", description: "", kind: "user-import", version: 1 }, [original]);
    const projected = queryVocabularyCatalogEntries({ courseId, status: "published" }).entries[0];
    expect(projected).toMatchObject({ reviewTargetId: "address:verb", meaningZh: "处理", partOfSpeech: "verb" });
    expect(projected.exercises.map((exercise) => exercise.id)).toEqual(["sense:0", "sense:1"]);
    const saved = publishVocabularyCatalogReview({ entryId: original.id, expectedVersion: 1, courseId, targetId: "address:verb", expectedTargetVersion: 1,
      meaningZh: "着手解决", definitionEn: "To take action to solve a problem.", partOfSpeech: "verb", exercises: projected.exercises.map((exercise) => ({ ...exercise, meaningZh: "着手解决" })) });
    expect(saved.meaningZh).toBe(original.meaningZh);
    expect(saved.targets?.[0]).toMatchObject({ version: 2, meaningZh: "着手解决", memberships: [{ version: 2 }] });
    expect(saved.targets?.[1]).toEqual(targets[1]);
    expect(saved.exercises.filter((exercise) => exercise.targetId === "address:noun")).toEqual(exercises.slice(2));
    // Even a later authoritative package must retain explicit local reviews.
    const incoming = structuredClone(original); incoming.targets[0].version = 20; incoming.targets[0].memberships[0].version = 20;
    incoming.exercises.forEach((exercise) => { exercise.version = 20; });
    registerVocabularyCourse({ id: courseId, title: "Advanced", description: "", kind: "user-import", version: 20 }, [incoming], holder.database!, true);
    const reloaded = listVocabularyCatalogEntries(courseId).find((entry) => entry.id === original.id)!;
    expect(reloaded.targets?.[0].meaningZh).toBe("着手解决"); expect(reloaded.targets?.[0].version).toBe(2);
    expect(reloaded.exercises.find((exercise) => exercise.id === "sense:0")?.meaningZh).toBe("着手解决");
    expect(() => publishVocabularyCatalogReview({ entryId: original.id, expectedVersion: reloaded.version, courseId, targetId: "address:verb", expectedTargetVersion: 1,
      meaningZh: "old", definitionEn: "old", partOfSpeech: "verb", exercises: projected.exercises })).toThrow("用法已更新");
  });
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
