import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { vocabularyCatalogEntrySchema } from "@/lib/vocabulary-course";
import type { VocabularyEntry } from "@/lib/vocabulary";
vi.mock("server-only", () => ({}));
import { withVocabularyReadScope, readVocabularyScoped, invalidateVocabularyReadScope, invalidateVocabularyMutableReads } from "./vocabulary-read-scope";
import { ensureVocabularyTargetTables, getVocabularyTargetCounts, readVocabularyTargetDefinitions, readVocabularyTargetState, isVocabularyTermPaused, advanceVocabularyConsolidation } from "./vocabulary-targets";

let database: Database.Database;
const at = new Date("2030-01-01T00:00:00.000Z");
function entry(index: number, target = true) {
  const term = `word${index}`, targetId = `sense:${index}`;
  const exercises = [`We discuss ${term} carefully.`, `They explain ${term} clearly.`].map((sentence, number) => ({
    id: `exercise:${index}:${number}`, version: 1, sentence, targetStart: sentence.indexOf(term), targetEnd: sentence.indexOf(term) + term.length,
    targetSurface: term, acceptedAnswers: [term], meaningZh: "示例", ...(target ? { targetId } : {}),
  }));
  return vocabularyCatalogEntrySchema.parse({ id: `entry:${index}`, rank: index + 1, term, courseIds: ["course"], partOfSpeech: "noun", meaningZh: "示例", definitionEn: "An example meaning.", exercises,
    targets: target ? [{ id: targetId, version: 1, partOfSpeech: "noun", meaningZh: "示例", definitionEn: "An example meaning.", level: index % 2 ? "C1" : "B2",
      memberships: [{ courseId: "course", version: 1, rank: index + 1, exerciseIds: exercises.map(exercise => exercise.id) }] }] : [] });
}
function insertEntry(index: number, target = true) {
  const value = entry(index, target);
  database.prepare("INSERT INTO vocabulary_catalog_entries VALUES (?,?)").run(value.id, JSON.stringify(value));
  return value;
}
beforeEach(() => {
  database = new Database(":memory:");
  database.exec("CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY); CREATE TABLE vocabulary_catalog_entries(id TEXT PRIMARY KEY,data_json TEXT NOT NULL);");
  ensureVocabularyTargetTables(database);
});
afterEach(() => { vi.restoreAllMocks(); database.close(); });

describe("request-local vocabulary reads", () => {
  it("shares nested synchronous reads but never carries content into a later request", () => {
    insertEntry(0); const load = vi.fn(() => 1);
    withVocabularyReadScope(database, () => {
      expect(readVocabularyScoped(database, "custom", load)).toBe(1);
      withVocabularyReadScope(database, () => expect(readVocabularyScoped(database, "custom", load)).toBe(1));
      expect(readVocabularyTargetDefinitions(database)).toHaveLength(1);
    });
    expect(load).toHaveBeenCalledTimes(1);
    insertEntry(1);
    withVocabularyReadScope(database, () => expect(readVocabularyTargetDefinitions(database)).toHaveLength(2));
    readVocabularyScoped(database, "custom", load); readVocabularyScoped(database, "custom", load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("isolates overlapping asynchronous requests on the same database", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = withVocabularyReadScope(database, async () => {
      expect(readVocabularyScoped(database, "request", () => "first")).toBe("first");
      await gate;
      expect(readVocabularyScoped(database, "request", () => "incorrect")).toBe("first");
    });
    await withVocabularyReadScope(database, async () => {
      await Promise.resolve();
      expect(readVocabularyScoped(database, "request", () => "second")).toBe("second"); release();
    });
    await first;
  });
  it("invalidates mutable indexes without parsing unchanged definitions again", () => {
    insertEntry(0);
    withVocabularyReadScope(database, () => {
      const definitions = readVocabularyTargetDefinitions(database);
      expect(readVocabularyTargetState("sense:0", "word0", database).paused).toBe(false);
      expect(isVocabularyTermPaused("word0", database)).toBe(false);
      database.prepare("INSERT INTO vocabulary_target_state(target_id,normalized_term,paused,updated_at) VALUES ('sense:0','word0',1,?)").run(at.toISOString());
      database.prepare("INSERT INTO vocabulary_term_dispositions VALUES ('word0',1,1,?)").run(at.toISOString());
      invalidateVocabularyMutableReads(database);
      expect(readVocabularyTargetState("sense:0", "word0", database).paused).toBe(true);
      expect(isVocabularyTermPaused(" WORD0 ", database)).toBe(true);
      expect(getVocabularyTargetCounts("ielts-advanced", at, database).eligibleTargets).toBe(0);
      expect(readVocabularyTargetDefinitions(database)).toBe(definitions);
    });
  });
  it("refreshes step state after consolidation and discards rolled-back reads when invalidated", () => {
    insertEntry(0); database.prepare("INSERT INTO vocabulary_words VALUES ('personal')").run();
    database.prepare("INSERT INTO vocabulary_target_state(target_id,word_id,normalized_term,version,introduced_at,step,due_at,updated_at) VALUES ('sense:0','personal','word0',1,?,1,?,?)")
      .run(at.toISOString(), at.toISOString(), at.toISOString());
    withVocabularyReadScope(database, () => {
      expect(readVocabularyTargetState("sense:0", "word0", database).step).toBe(1);
      expect(() => database.transaction(() => {
        advanceVocabularyConsolidation({targetId:"sense:0",version:1,step:1,dueAt:at.toISOString()}, {id:"personal",term:"word0"} as VocabularyEntry, true, "test-submission", at, database);
        expect(readVocabularyTargetState("sense:0", "word0", database).step).toBe(2);
        throw new Error("rollback fixture");
      })()).toThrow("rollback fixture");
      invalidateVocabularyReadScope(database);
      expect(readVocabularyTargetState("sense:0", "word0", database)).toMatchObject({step:1,version:1});
    });
  });
  it("counts 3934 entries and 1381 targets using three SELECTs and one parse per entry", () => {
    database.transaction(() => { for (let index=0; index<3934; index++) insertEntry(index,index<1381); })();
    const prepare = vi.spyOn(database,"prepare"), parse = vi.spyOn(vocabularyCatalogEntrySchema,"parse");
    withVocabularyReadScope(database, () => {
      expect(getVocabularyTargetCounts("ielts-advanced",at,database)).toMatchObject({eligibleTargets:1381,consolidationDue:0});
      expect(getVocabularyTargetCounts("ielts-advanced",at,database).eligibleTargets).toBe(1381);
      expect(readVocabularyTargetDefinitions(database)).toHaveLength(1381);
    });
    expect(prepare.mock.calls.filter(([sql])=>/^SELECT/i.test(sql))).toHaveLength(3);
    expect(parse).toHaveBeenCalledTimes(3934);
  });
});
