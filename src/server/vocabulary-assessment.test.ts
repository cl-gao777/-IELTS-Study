import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Tests require an isolated database"); } }));
import { vocabularyCatalogEntrySchema } from "../lib/vocabulary-course";
import { evaluateVocabularyAssessment } from "../lib/vocabulary-assessment";
import { buildVocabularyAssessmentQuestions, checkpointVocabularyAssessment, readVocabularyAssessment, startVocabularyAssessment, submitVocabularyAssessment } from "./vocabulary-assessment";

export function assessmentEntries() {
  return Array.from({ length: 30 }, (_, index) => {
    const term = `fixture${index}`, sentence = `We recorded ${term} today.`;
    return vocabularyCatalogEntrySchema.parse({ id: `fixture-${index}`, term, meaningZh: "测试词", definitionEn: "A synthetic test word.", partOfSpeech: "noun", courseIds: [index < 20 ? "general" : "academic"], rank: index < 20 ? Math.floor(index / 4) * 500 + index % 4 + 1 : index - 19,
      exercises: [sentence, `We recorded ${term} yesterday.`].map((text, n) => ({ id: `ex-${index}-${n}`, version: 1, sentence: text, targetStart: 12, targetEnd: 12 + term.length, targetSurface: term, acceptedAnswers: [term], meaningZh: "测试词", source: "Synthetic regression fixture" })) });
  });
}
let database: Database.Database;
beforeEach(() => { database = new Database(":memory:"); database.exec("CREATE TABLE old_progress(id TEXT PRIMARY KEY,due TEXT);INSERT INTO old_progress VALUES ('old','2026-01-01');"); });
afterEach(() => database.close());
describe("independent vocabulary placement assessment", () => {
  it("excludes draft entries and unreviewed contexts", () => {
    const entries = assessmentEntries(); entries[0].status = "draft";
    expect(() => buildVocabularyAssessmentQuestions(entries)).toThrow("不足");
    entries[0].status = "published"; entries[0].exercises[0].status = "draft";
    expect(() => buildVocabularyAssessmentQuestions(entries)).toThrow("不足");
  });
  it("fixes 30 assignments, hides answers, and resumes the same persisted test", () => {
    const first = startVocabularyAssessment(assessmentEntries(), database);
    expect(first.questions).toHaveLength(30);
    expect(first.questions.filter((question) => question.band === "nawl")).toHaveLength(10);
    expect(first.questions.every((question) => !Object.hasOwn(question, "acceptedAnswers") && !Object.hasOwn(question, "sentence") && !Object.hasOwn(question, "entryId"))).toBe(true);
    expect(startVocabularyAssessment([], database)).toEqual(first);
    expect(readVocabularyAssessment(database)).toEqual(first);
    expect(database.prepare("SELECT * FROM old_progress").all()).toEqual([{ id: "old", due: "2026-01-01" }]);
  });
  it("persists unfinished input with a revision and refuses stale tabs or premature submit", () => {
    const initial = startVocabularyAssessment(assessmentEntries(), database);
    const next = checkpointVocabularyAssessment(initial.id, 1, { answers: { [initial.questions[0].id]: "draft" }, currentIndex: 1 }, database);
    expect(next.revision).toBe(2); expect(next.result).toBeNull();
    expect(() => checkpointVocabularyAssessment(initial.id, 1, next.draft, database)).toThrow("其他页面");
    expect(() => submitVocabularyAssessment(initial.id, 2, database)).toThrow("全部 30");
    expect(readVocabularyAssessment(database)).toEqual(next);
    expect(() => checkpointVocabularyAssessment(initial.id, 2, { answers: { wrong: "x" }, currentIndex: 0 }, database)).toThrow("未知题号");
  });
  it("resumes the active assessment even when restored SQL row order puts old results last", () => {
    const initial = startVocabularyAssessment(assessmentEntries(), database, new Date("2026-01-01"));
    const saved = checkpointVocabularyAssessment(initial.id, 1, { answers: Object.fromEntries(initial.questions.map((question) => [question.id, ""])), currentIndex: 30 }, database);
    submitVocabularyAssessment(initial.id, saved.revision, database);
    const historical = database.prepare("SELECT * FROM vocabulary_assessments WHERE id=?").get(initial.id) as Record<string, string | number | null>;
    const active = startVocabularyAssessment(assessmentEntries(), database, new Date("2026-01-02"));
    database.prepare("DELETE FROM vocabulary_assessments WHERE id=?").run(initial.id);
    const columns = Object.keys(historical);
    database.prepare(`INSERT INTO vocabulary_assessments (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(historical));
    expect(readVocabularyAssessment(database)?.id).toBe(active.id);
    expect(startVocabularyAssessment([], database).id).toBe(active.id);
  });
  it("treats explicit skips as unanswered knowledge and recommends the first weak band only", () => {
    const questions = buildVocabularyAssessmentQuestions(assessmentEntries(), () => 0.5);
    const answers = Object.fromEntries(questions.map((question) => [question.id, question.band === "ngsl-3" ? "" : question.targetSurface.toUpperCase()]));
    const result = evaluateVocabularyAssessment(questions, answers);
    expect(result).toMatchObject({ correct: 26, skipped: 4, recommendedCourseId: "general", recommendedStartRank: 1001, startBand: "ngsl-3" });
    expect(evaluateVocabularyAssessment(questions, Object.fromEntries(questions.map((question) => [question.id, question.targetSurface])))).toMatchObject({ correct: 30, recommendedCourseId: "academic", recommendedStartRank: 1 });
  });
  it("submits once without writing cards, FSRS, grades or course preferences", () => {
    const initial = startVocabularyAssessment(assessmentEntries(), database);
    const draft = { answers: Object.fromEntries(initial.questions.map((question) => [question.id, ""])), currentIndex: 30 };
    const saved = checkpointVocabularyAssessment(initial.id, 1, draft, database);
    const result = submitVocabularyAssessment(initial.id, saved.revision, database);
    expect(result).toMatchObject({ status: "completed", result: { correct: 0, skipped: 30, recommendedStartRank: 1 } });
    expect(submitVocabularyAssessment(initial.id, saved.revision, database)).toEqual(result);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual([{ name: "old_progress" }, { name: "vocabulary_assessments" }]);
  });
});
