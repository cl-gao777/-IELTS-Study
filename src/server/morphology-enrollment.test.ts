import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import curriculum from "@/data/morphology-curriculum.json";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), getDatabase: () => holder.database! }));
import { migrate } from "./db";
import { getDataEpoch, rotateDataEpoch } from "./data-integrity";
import { registerMorphologyLessons } from "./morphology";
import { enrollMorphologyWord } from "./morphology-enrollment";
import { ensureVocabularyTables, saveVocabularyEntry } from "./vocabulary";
import { getVocabularyStudy, registerVocabularyCourse } from "./vocabulary-courses";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import { morphologyLessonSchema, type MorphologyLesson } from "@/lib/morphology";
import { selectVocabularyTargetCard } from "./vocabulary-target-selection";
import { normaliseVocabularyAnswer } from "@/lib/vocabulary";
import type { VocabularySession } from "@/lib/vocabulary-session";

let db: Database.Database, lesson: MorphologyLesson;
const now = new Date("2026-10-22T08:00:00Z");
beforeEach(() => {
  db = new Database(":memory:"); holder.database = db; db.pragma("foreign_keys = ON"); migrate(db); ensureVocabularyTables(db);
  getVocabularyStudy(now, db);
  lesson = morphologyLessonSchema.parse(structuredClone(curriculum.lessons.find(item => item.words.every(word => !word.illustrative))!));
  lesson.words[0].level = "B2"; lesson.words[0].levelSource = "Synthetic test level, not published content";
  registerMorphologyLessons([lesson], db);
  registerVocabularyCourse({ id: "original", title: "Original course", kind: "builtin", description: "fixture", version: 1 }, [], db);
  db.prepare("INSERT INTO vocabulary_study_preferences(id,active_course_id,focus,next_level) VALUES(1,'original','ielts-advanced','B2')").run();
});
afterEach(() => { db.close(); holder.database = null; });
const request = () => ({ dataEpoch: getDataEpoch(db), operationId: randomUUID(), lessonId: lesson.id, lessonVersion: lesson.version, wordId: lesson.words[0].id });
const personalRows = () => Object.fromEntries(["vocabulary_words", "vocabulary_metadata", "vocabulary_learning_state", "vocabulary_scheduler_state", "vocabulary_reviews"].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
function session(): VocabularySession { return { id: randomUUID(), revision: 1, status: "active", startedAt: now.toISOString(), updatedAt: now.toISOString(), state: { courseId: "original", mode: "context", current: null, skippedIds: [], learned: 0, reviewed: 0, supplementalReviewed: 0, lastSubmissionId: null } }; }

describe("explicit morphology sense enrollment", () => {
  it("keeps illustrative basic words outside personal learning even on an explicit enrollment request", () => {
    lesson.version++; lesson.words[0].illustrative = true; registerMorphologyLessons([lesson], db);
    expect(() => enrollMorphologyWord(request(), db)).toThrow("仅作构词示例");
    expect(db.prepare("SELECT COUNT(*) n FROM vocabulary_words").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM morphology_selected_targets").get()).toEqual({ n: 0 });
  });
  it("does not enroll on content registration; explicit retries create one unintroduced word/sense", () => {
    expect(db.prepare("SELECT COUNT(*) n FROM vocabulary_words").get()).toEqual({ n: 0 });
    const input = request(), first = enrollMorphologyWord(input, db);
    expect(enrollMorphologyWord(input, db)).toEqual(first);
    expect(enrollMorphologyWord({ ...input, operationId: randomUUID() }, db).status).toBe("existing");
    expect(db.prepare("SELECT COUNT(*) n FROM vocabulary_words").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM vocabulary_target_state WHERE introduced_at IS NOT NULL").get()).toEqual({ n: 0 });
    expect(getVocabularyStudy(now, db).activeCourseId).toBe("original");
    const card = selectVocabularyTargetCard(session(), now, db)!;
    expect(card).toMatchObject({ wordId: first.wordId, purpose: "learn-word", phase: "learn" });
    expect(card.target?.id).toBe(first.targetId);
  });
  it("keeps an existing personal word and FSRS untouched; the selected new use is introduced separately", () => {
    const w = saveVocabularyEntry(vocabularyInputSchema.parse({ term: lesson.words[0].term, meaningZh: "我的释义", notes: "我的笔记", example: "My own sentence." }))!.word;
    db.prepare("UPDATE vocabulary_words SET repetitions=4,due_at='2030-01-01T00:00:00Z' WHERE id=?").run(w.id);
    const before = personalRows(), result = enrollMorphologyWord(request(), db);
    expect(result.wordId).toBe(w.id); expect(personalRows()).toEqual(before);
    expect(selectVocabularyTargetCard(session(), now, db)).toMatchObject({ wordId: w.id, purpose: "learn-target" });
  });
  it("enrolls v3 context exercises with short word cues rather than full translations", () => {
    lesson.version = Math.max(3, lesson.version + 1);
    lesson.words[0].examples[0].meaningZh = "整句译文不得进入词汇核对前题面。";
    registerMorphologyLessons([lesson], db);
    enrollMorphologyWord(request(), db);
    const card = selectVocabularyTargetCard(session(), now, db)!;
    expect(card.target?.meaningZh).toBe(lesson.words[0].meaningZh);
    expect(JSON.stringify(card)).not.toContain("整句译文不得进入");
  });
  it("deduplicates the same sense across lessons without changing its first selected content", () => {
    const first = enrollMorphologyWord(request(), db), other = { ...lesson, id: "other-unit", rank: 200 };
    registerMorphologyLessons([other], db);
    const result = enrollMorphologyWord({ ...request(), lessonId: other.id }, db);
    expect(result).toMatchObject({ targetId: first.targetId, wordId: first.wordId, status: "existing" });
    expect(db.prepare("SELECT COUNT(*) n FROM morphology_selected_targets").get()).toEqual({ n: 1 });
  });
  it("respects pauses and advanced eligibility instead of silently resetting them", () => {
    const term = normaliseVocabularyAnswer(lesson.words[0].term);
    db.prepare("INSERT INTO vocabulary_term_dispositions VALUES(?,1,1,?)").run(term, now.toISOString());
    const result = enrollMorphologyWord(request(), db);
    expect(result.status).toBe("paused"); expect(selectVocabularyTargetCard(session(), now, db)).toBeNull();
    db.prepare("DELETE FROM vocabulary_term_dispositions").run();
    db.prepare("UPDATE vocabulary_study_preferences SET active_course_id=NULL").run();
    expect(selectVocabularyTargetCard(session(), now, db)).toBeNull();
  });
  it("rejects stale epochs, obsolete course versions and operation reuse for different words", () => {
    const input = request(); enrollMorphologyWord(input, db);
    expect(() => enrollMorphologyWord({ ...input, wordId: lesson.words[1].id }, db)).toThrow("操作编号");
    expect(() => enrollMorphologyWord({ ...request(), lessonVersion: 99 }, db)).toThrow("课程内容");
    const old = request(); rotateDataEpoch(db); expect(() => enrollMorphologyWord(old, db)).toThrow("数据已恢复");
  });
});
