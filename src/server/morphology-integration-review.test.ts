import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import curriculum from "@/data/morphology-curriculum.json";
import { morphologyLessonSchema, type MorphologyLesson } from "@/lib/morphology";
import { normaliseVocabularyAnswer, vocabularyInputSchema } from "@/lib/vocabulary";
import type { VocabularySession } from "@/lib/vocabulary-session";

vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), getDatabase: () => holder.database! }));
import { migrate } from "./db";
import { getDataEpoch } from "./data-integrity";
import { registerMorphologyLessons } from "./morphology";
import { enrollMorphologyWord } from "./morphology-enrollment";
import { ensureVocabularyTables, listVocabularyEntries, saveVocabularyEntry } from "./vocabulary";
import { getVocabularyStudy, registerVocabularyCourse } from "./vocabulary-courses";
import { selectVocabularyTargetCard } from "./vocabulary-target-selection";

let db: Database.Database, lesson: MorphologyLesson;
const now = new Date("2026-10-22T08:00:00Z");
beforeEach(() => {
  db = new Database(":memory:"); holder.database = db; db.pragma("foreign_keys=ON"); migrate(db); ensureVocabularyTables(db); getVocabularyStudy(now, db);
  lesson = morphologyLessonSchema.parse(structuredClone(curriculum.lessons.find(item => item.words.every(word => !word.illustrative))!));
  lesson.words[0].level = "B2"; lesson.words[0].levelSource = "Synthetic review fixture";
  registerMorphologyLessons([lesson], db);
  registerVocabularyCourse({ id: "original", title: "Original", kind: "builtin", description: "review fixture", version: 1 }, [], db);
  db.prepare("INSERT INTO vocabulary_study_preferences(id,active_course_id,focus,next_level) VALUES(1,'original','ielts-advanced','B2')").run();
});
afterEach(() => { db.close(); holder.database = null; });
const request = () => ({ dataEpoch: getDataEpoch(db), operationId: randomUUID(), lessonId: lesson.id, lessonVersion: lesson.version, wordId: lesson.words[0].id });
const session = (): VocabularySession => ({ id: randomUUID(), revision: 1, status: "active", startedAt: now.toISOString(), updatedAt: now.toISOString(),
  state: { mode: "context", courseId: "original", current: null, skippedIds: [], reviewed: 0, learned: 0, supplementalReviewed: 0, lastSubmissionId: null } });

describe("independent morphology integration review", () => {
  it("can learn the explicitly re-enrolled original term after its old personal word was renamed", () => {
    const original = enrollMorphologyWord(request(), db);
    db.prepare("UPDATE vocabulary_words SET repetitions=4,due_at='2030-01-01T00:00:00Z' WHERE id=?").run(original.wordId);
    db.prepare("INSERT INTO vocabulary_target_state(target_id,word_id,normalized_term,version,paused,introduced_at,step,due_at,last_submission_id,updated_at) VALUES(?,?,?,1,0,?,3,NULL,NULL,?)")
      .run(original.targetId, original.wordId, normaliseVocabularyAnswer(lesson.words[0].term), now.toISOString(), now.toISOString());
    const previous = listVocabularyEntries().find(word => word.id === original.wordId)!;
    saveVocabularyEntry(vocabularyInputSchema.parse({ term: "renamed-review-fixture", meaningZh: "原词改名后继承原计划" }), previous.id, previous.reviewVersion);
    const renamedPlan = db.prepare("SELECT repetitions,due_at FROM vocabulary_words WHERE id=?").get(original.wordId);

    const rejoined = enrollMorphologyWord(request(), db);
    expect(rejoined.wordId).not.toBe(original.wordId);
    expect(db.prepare("SELECT repetitions,due_at FROM vocabulary_words WHERE id=?").get(original.wordId)).toEqual(renamedPlan);
    expect(selectVocabularyTargetCard(session(), now, db)).toMatchObject({ wordId: rejoined.wordId, phase: "learn", purpose: "learn-word" });
  });
  it("keeps the original sense paused when re-enrollment creates a new personal identity", () => {
    const original = enrollMorphologyWord(request(), db);
    db.prepare("UPDATE vocabulary_words SET repetitions=4,due_at='2030-01-01T00:00:00Z' WHERE id=?").run(original.wordId);
    db.prepare("INSERT INTO vocabulary_target_state(target_id,word_id,normalized_term,version,paused,introduced_at,step,due_at,last_submission_id,updated_at) VALUES(?,?,?,1,1,?,2,?,NULL,?)")
      .run(original.targetId, original.wordId, normaliseVocabularyAnswer(lesson.words[0].term), now.toISOString(), now.toISOString(), now.toISOString());
    const previous = listVocabularyEntries().find(word => word.id === original.wordId)!;
    saveVocabularyEntry(vocabularyInputSchema.parse({ term: "paused-renamed-review-fixture", meaningZh: "原计划仍保留" }), previous.id, previous.reviewVersion);
    const renamedPlan = db.prepare("SELECT repetitions,due_at FROM vocabulary_words WHERE id=?").get(original.wordId);

    const rejoined = enrollMorphologyWord(request(), db);
    expect(rejoined).toMatchObject({ status: "paused", targetId: original.targetId }); expect(rejoined.wordId).not.toBe(original.wordId);
    expect(db.prepare("SELECT word_id,paused,introduced_at,step,due_at FROM vocabulary_target_state WHERE target_id=?").get(original.targetId))
      .toMatchObject({ word_id: rejoined.wordId, paused: 1, introduced_at: null, step: 0, due_at: null });
    expect(selectVocabularyTargetCard(session(), now, db)).toBeNull();
    expect(db.prepare("SELECT repetitions,due_at FROM vocabulary_words WHERE id=?").get(original.wordId)).toEqual(renamedPlan);
  });
});
