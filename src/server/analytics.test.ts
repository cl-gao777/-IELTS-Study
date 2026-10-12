import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Use the isolated test database."); } }));
import { getLearningAnalytics } from "./analytics";
import { evaluateVocabularyAssessment, type VocabularyAssessmentQuestionSnapshot } from "../lib/vocabulary-assessment";
import { vocabularyCatalogEntrySchema, vocabularyExerciseGap } from "../lib/vocabulary-course";
import { vocabularyTargetSchema } from "../lib/vocabulary-target";

let database: Database.Database;
const now = new Date("2026-10-04T03:00:00.000Z");
beforeEach(() => { database = new Database(":memory:"); });
afterEach(() => { database.close(); });

function assessmentQuestions(): VocabularyAssessmentQuestionSnapshot[] {
  return Array.from({ length: 30 }, (_, index) => {
    const term = `fixture${index}`, sentence = `We discussed ${term} today.`;
    const band = index >= 20 ? "nawl" as const : `ngsl-${Math.floor(index / 4) + 1}` as "ngsl-1" | "ngsl-2" | "ngsl-3" | "ngsl-4" | "ngsl-5";
    const exercise = { id: `question-${index}`, band, entryId: `entry-${index}`, courseId: index >= 20 ? "academic" : "general", sentence,
      targetStart: 13, targetEnd: 13 + term.length, targetSurface: term, acceptedAnswers: [term], meaningZh: "测试词", source: "Synthetic analytics fixture" };
    return { ...exercise, prompt: vocabularyExerciseGap({ ...exercise, version: 1, status: "published" }) };
  });
}

describe("analytics data sources", () => {
  it("returns truthful empty states before optional tables or history exist", () => {
    const result = getLearningAnalytics(database, now);
    expect(result.reading.accuracy).toBeNull(); expect(result.listening.accuracy).toBeNull();
    expect(result.writing).toEqual([]); expect(result.vocabulary.retention).toBeNull();
    expect(result.study.todayMinutes).toBe(0); expect(result.study.streak).toBe(0);
    expect(result.activity).toEqual([]);
    expect(result.vocabulary).toMatchObject({ firstLearningCount: 0, firstLearningUnknownCount: 0, scheduledGradeCount: 0,
      supplemental: { attemptCount: 0, sampleCount: 0, rawAccuracy: null }, assessment: { completedCount: 0, activeCount: 0, skippedQuestionCount: 0, lastResult: null } });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });
  it("derives actual recall, due cards, daily reviews and study time in Shanghai dates", () => {
    database.exec(`
      CREATE TABLE vocabulary_words (id TEXT, repetitions INTEGER, interval_days INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_reviews (id INTEGER, rating TEXT, reviewed_at TEXT);
      CREATE TABLE vocabulary_review_details (review_id INTEGER, correct INTEGER);
      CREATE TABLE study_sessions (id TEXT, study_date TEXT, duration_seconds INTEGER);
      INSERT INTO vocabulary_words VALUES ('known',5,25,'2026-10-10T00:00:00.000Z'),('learning',2,5,'2026-10-03T00:00:00.000Z'),('new',0,0,'2026-10-04T00:00:00.000Z');
      INSERT INTO vocabulary_reviews VALUES (1,'again','2026-10-03T17:00:00.000Z'),(2,'good','2026-10-04T01:00:00.000Z');
      INSERT INTO vocabulary_review_details VALUES (1,0),(2,1);
      INSERT INTO study_sessions VALUES ('one','2026-10-03',120),('two','2026-10-04',90),('three','2026-10-04',30);
    `);
    const result = getLearningAnalytics(database, now);
    expect(result.vocabulary).toMatchObject({ known: 1, learning: 1, new: 1, due: 2, reviews: 2, retention: 50, objectiveAccuracy: 50 });
    expect(result.vocabulary.reviewsByDay.at(-1)).toEqual({ date: "2026-10-04", count: 2 });
    expect(result.study).toMatchObject({ todayMinutes: 2, weekMinutes: 4, daysThisWeek: 2, streak: 2 });
  });
  it("does not plot legacy unverified or local-fallback writing bands", () => {
    database.exec(`CREATE TABLE writing_submissions(id INTEGER, overall_band REAL);
      CREATE TABLE writing_feedback_details(submission_id INTEGER, provider TEXT, feedback_json TEXT);
      INSERT INTO writing_submissions VALUES(1,6.5),(2,7);
      INSERT INTO writing_feedback_details VALUES(1,'local-fallback','{}');`);
    expect(getLearningAnalytics(database, now).writing).toEqual([]);
  });
  it("keeps raw accuracy separate from typo confirmation and subjective recognition", () => {
    database.exec(`
      CREATE TABLE vocabulary_reviews (id INTEGER, word_id TEXT, rating TEXT, reviewed_at TEXT);
      CREATE TABLE vocabulary_review_details (review_id INTEGER, mode TEXT, correct INTEGER);
      CREATE TABLE vocabulary_review_audit (review_id INTEGER, requested_rating TEXT, confirmed_typo INTEGER);
      INSERT INTO vocabulary_reviews VALUES
        (1,'one','good','2026-10-04T00:00:00.000Z'),
        (2,'two','again','2026-10-04T00:00:00.000Z'),
        (3,'three','good','2026-10-04T00:00:00.000Z'),
        (4,'four','hard','2026-10-04T00:00:00.000Z'),
        (5,'five','easy','2026-10-04T00:00:00.000Z'),
        (6,'six','again','2026-10-04T00:00:00.000Z'),
        (7,'seven','good','2026-10-04T00:00:00.000Z');
      INSERT INTO vocabulary_review_details VALUES
        (1,'spelling',0),(2,'spelling',0),(3,'spelling',1),
        (4,'recall',1),(5,'context',0),(6,'recognition',NULL),(7,'recognition',1);
      INSERT INTO vocabulary_review_audit VALUES
        (1,'good',1),(2,'easy',0),(3,'good',0),(4,'hard',0),(5,'easy',1),(6,'again',0);
    `);
    const stats = getLearningAnalytics(database, now).vocabulary;
    expect(stats.objectiveSampleCount).toBe(5);
    expect(stats.objectiveAccuracy).toBe(40);
    expect(stats.confirmedTypoCount).toBe(2);
    expect(stats.legacyAuditUnknownCount).toBe(1);
    expect(stats.retention).toBeCloseTo(6 / 7 * 100);
    expect(stats.byMode).toEqual([
      { mode: "recognition", reviewCount: 2, sampleCount: 0, correctCount: 0, rawAccuracy: null, confirmedTypoCount: 0 },
      { mode: "recall", reviewCount: 1, sampleCount: 1, correctCount: 1, rawAccuracy: 100, confirmedTypoCount: 0 },
      { mode: "spelling", reviewCount: 3, sampleCount: 3, correctCount: 1, rawAccuracy: expect.closeTo(100 / 3), confirmedTypoCount: 1 },
      { mode: "context", reviewCount: 1, sampleCount: 1, correctCount: 0, rawAccuracy: 0, confirmedTypoCount: 1 },
    ]);
  });
  it("classifies first learning and forgotten legacy cards without claiming skill mastery", () => {
    database.exec(`
      CREATE TABLE vocabulary_words (id TEXT, repetitions INTEGER, interval_days INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_learning_state (word_id TEXT, learning_started_at TEXT);
      CREATE TABLE vocabulary_reviews (id INTEGER, word_id TEXT, rating TEXT, reviewed_at TEXT);
      INSERT INTO vocabulary_words VALUES
        ('untouched',0,0,'2026-10-04T00:00:00.000Z'),
        ('introduced',0,0,'2026-10-04T03:01:00.000Z'),
        ('forgotten',0,0,'2026-10-04T00:00:00.000Z'),
        ('long-interval',4,30,'2026-11-04T00:00:00.000Z');
      INSERT INTO vocabulary_learning_state VALUES
        ('untouched',NULL),('introduced','2026-10-04T03:00:00.000Z');
      INSERT INTO vocabulary_reviews VALUES (1,'forgotten','again','2026-10-04T01:00:00.000Z');
    `);
    const stats = getLearningAnalytics(database, now).vocabulary;
    expect(stats).toMatchObject({ total: 4, new: 1, learning: 2, known: 1 });
    expect(stats).toMatchObject({ firstLearningCount: 1, firstLearningUnknownCount: 2, scheduledGradeCount: 1 });
    expect(stats.byMode.every((mode) => mode.sampleCount === 0 && mode.rawAccuracy === null)).toBe(true);
  });
  it("keeps auxiliary raw answers and course assessments out of scheduled grading accuracy without mutating history", () => {
    database.exec(`
      CREATE TABLE vocabulary_words (id TEXT, repetitions INTEGER, interval_days INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_learning_state (word_id TEXT, learning_started_at TEXT);
      CREATE TABLE vocabulary_scheduler_state (word_id TEXT, card_json TEXT);
      CREATE TABLE vocabulary_reviews (id INTEGER, word_id TEXT, rating TEXT, reviewed_at TEXT);
      CREATE TABLE vocabulary_review_details (review_id INTEGER, mode TEXT, correct INTEGER);
      CREATE TABLE vocabulary_supplemental_attempts (id INTEGER, word_id TEXT, mode TEXT, correct INTEGER, confirmed_typo INTEGER, reviewed_at TEXT);
      CREATE TABLE vocabulary_assessments (id TEXT, status TEXT, questions_json TEXT, draft_json TEXT, result_json TEXT, submitted_at TEXT);
      CREATE TABLE vocabulary_courses (id TEXT, title TEXT);
      INSERT INTO vocabulary_words VALUES ('one',1,1,'2026-10-05T00:00:00.000Z'),('legacy',0,0,'2026-10-04T00:00:00.000Z');
      INSERT INTO vocabulary_learning_state VALUES ('one','2026-10-03T00:00:00.000Z'),('legacy',NULL);
      INSERT INTO vocabulary_scheduler_state VALUES ('one','{"stability":1.2}');
      INSERT INTO vocabulary_reviews VALUES (1,'one','good','2026-10-04T00:00:00.000Z'),(2,'legacy','again','2026-10-04T01:00:00.000Z');
      INSERT INTO vocabulary_review_details VALUES (1,'context',1),(2,'recall',0),(999,'context',1);
      INSERT INTO vocabulary_supplemental_attempts VALUES (1,'one','context',1,0,'2026-10-04T01:00:00.000Z'),(2,'one','context',0,1,'2026-10-04T02:00:00.000Z'),(3,'one','context',1,0,'2026-10-04T02:30:00.000Z');
      INSERT INTO vocabulary_courses VALUES ('general','基础课程'),('academic','学术课程');
    `);
    const questions = assessmentQuestions();
    const saveAssessment = database.prepare("INSERT INTO vocabulary_assessments VALUES (?,?,?,?,?,?)");
    for (const [id, timestamp, failed] of [["older", "2026-10-03T02:00:00.000Z", [0]], ["latest", "2026-10-04T02:00:00.000Z", [4, 5]]] as const) {
      const answers = Object.fromEntries(questions.map((question, index) => [question.id, (failed as readonly number[]).includes(index) ? index === failed[0] ? "" : "wrong" : question.targetSurface]));
      const result = evaluateVocabularyAssessment(questions, answers, new Date(timestamp));
      saveAssessment.run(id, "completed", JSON.stringify(questions), JSON.stringify({ answers, currentIndex: 30 }), JSON.stringify(result), timestamp);
    }
    saveAssessment.run("unfinished", "active", JSON.stringify(questions), JSON.stringify({ answers: {}, currentIndex: 0 }), null, null);
    saveAssessment.run("old-unknown", "completed", "[]", "{}", "{}", "2026-10-04T02:40:00.000Z");
    const original = database.serialize();
    const stats = getLearningAnalytics(database, now).vocabulary;
    expect(stats).toMatchObject({ firstLearningCount: 1, firstLearningUnknownCount: 1, scheduledGradeCount: 2, reviews: 2, objectiveSampleCount: 2, objectiveAccuracy: 50,
      supplemental: { attemptCount: 3, sampleCount: 3, correctCount: 2, rawAccuracy: expect.closeTo(200 / 3), confirmedTypoCount: 1 },
      assessment: { completedCount: 3, activeCount: 1, resultUnknownCount: 1, skippedQuestionCount: 2,
        lastResult: { id: "latest", correct: 28, answered: 29, skipped: 1, recommendedCourseId: "general", recommendedCourseTitle: "基础课程", recommendedStartRank: 501 } } });
    expect(stats.byMode.find((mode) => mode.mode === "context")).toMatchObject({ reviewCount: 1, sampleCount: 1, rawAccuracy: 100 });
    expect(database.serialize().equals(original)).toBe(true);
  });
  it("does not manufacture learning or scheduled samples from auxiliary-only history", () => {
    database.exec(`CREATE TABLE vocabulary_words (id TEXT, repetitions INTEGER, interval_days INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_supplemental_attempts (id INTEGER, word_id TEXT, correct INTEGER, confirmed_typo INTEGER, reviewed_at TEXT);
      INSERT INTO vocabulary_words VALUES ('one',0,0,'2026-10-04T00:00:00.000Z');
      INSERT INTO vocabulary_supplemental_attempts VALUES (1,'one',0,1,'2026-10-04T00:00:00.000Z');`);
    const stats = getLearningAnalytics(database, now).vocabulary;
    expect(stats).toMatchObject({ firstLearningCount: 0, firstLearningUnknownCount: 0, new: 1, scheduledGradeCount: 0, objectiveAccuracy: null,
      supplemental: { attemptCount: 1, correctCount: 0, rawAccuracy: 0, confirmedTypoCount: 1 } });
  });
  it("separates minute consolidation, merged grades and self-reported known targets without mutating or manufacturing mastery", () => {
    database.exec(`CREATE TABLE vocabulary_words (id TEXT, repetitions INTEGER, interval_days INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_reviews (id INTEGER, word_id TEXT, rating TEXT, reviewed_at TEXT);
      CREATE TABLE vocabulary_review_details (review_id INTEGER, mode TEXT, correct INTEGER);
      CREATE TABLE vocabulary_review_context (review_id INTEGER, exercise_json TEXT);
      CREATE TABLE vocabulary_supplemental_attempts (id INTEGER, correct INTEGER, confirmed_typo INTEGER, reviewed_at TEXT, exercise_json TEXT);
      CREATE TABLE vocabulary_catalog_entries (id TEXT, normalized_term TEXT, data_json TEXT);
      CREATE TABLE vocabulary_target_state (target_id TEXT, word_id TEXT, normalized_term TEXT, introduced_at TEXT, paused INTEGER, step INTEGER, due_at TEXT);
      CREATE TABLE vocabulary_term_dispositions (normalized_term TEXT, paused INTEGER);
      CREATE TABLE vocabulary_target_operations (operation_id TEXT, action TEXT);
      CREATE TABLE vocabulary_study_preferences (id INTEGER, focus TEXT);
      INSERT INTO vocabulary_words VALUES ('one',0,0,'2026-10-04T00:00:00.000Z');
      INSERT INTO vocabulary_reviews VALUES (1,'one','again','2026-10-04T00:00:00.000Z'),(2,'one','good','2026-10-04T01:00:00.000Z');
      INSERT INTO vocabulary_review_details VALUES (1,'context',0),(2,'context',1);
      INSERT INTO vocabulary_target_state VALUES ('research','one','evidence','2026-10-04T00:00:00.000Z',0,1,'2026-10-04T00:01:00.000Z'),('law',NULL,'evidence',NULL,1,0,NULL);
      INSERT INTO vocabulary_term_dispositions VALUES ('other',1),('evidence',0);
      INSERT INTO vocabulary_target_operations VALUES ('first','know-target'),('second','resume-target'),('third','know-target'),('fourth','pause-term');
      INSERT INTO vocabulary_study_preferences VALUES (1,'ielts-advanced');`);
    const target = vocabularyTargetSchema.parse({ id: "research", version: 1, partOfSpeech: "noun", meaningZh: "研究证据",
      definitionEn: "Facts supporting a conclusion.", level: "B2", memberships: [{ courseId: "advanced", version: 1, rank: 1, exerciseIds: ["one", "two"] }] });
    const { memberships: _memberships, ...content } = target; void _memberships;
    const sentence = "We checked evidence carefully.", start = sentence.indexOf("evidence");
    const base = { id: "one", status: "published" as const, version: 1, sentence, targetStart: start, targetEnd: start + 8,
      targetSurface: "evidence", acceptedAnswers: ["evidence"], meaningZh: "证据", source: "Synthetic example", targetId: target.id,
      entryId: "entry", courseId: "advanced", target: { ...content, entryId: "entry", term: "evidence", normalizedTerm: "evidence", courseId: "advanced", membershipVersion: 1 } };
    const event = { targetId: "research", version: 1, step: 1 as const, dueAt: "2026-10-04T00:01:00.000Z" };
    const consolidation = { ...base, purpose: "consolidation", consolidation: event };
    const extra = { ...base, purpose: "supplemental" };
    const merged = { ...base, purpose: "merged", consolidation: event };
    const entry = vocabularyCatalogEntrySchema.parse({ term: "evidence", id: "entry", rank: 1, courseIds: ["advanced"], meaningZh: "证据", definitionEn: "Facts.", partOfSpeech: "noun",
      targets: [target, { ...target, id: "law" }], exercises: [base, { ...base, id: "two" }] });
    database.prepare("INSERT INTO vocabulary_catalog_entries VALUES (?,?,?)").run(entry.id, "evidence", JSON.stringify(entry));
    database.prepare("INSERT INTO vocabulary_review_context VALUES (?,?)").run(2, JSON.stringify(merged));
    const saveAux = database.prepare("INSERT INTO vocabulary_supplemental_attempts VALUES (?,?,?,?,?)");
    saveAux.run(1, 1, 0, "2026-10-04T02:00:00.000Z", JSON.stringify(consolidation));
    saveAux.run(2, 0, 1, "2026-10-04T02:01:00.000Z", JSON.stringify(consolidation));
    saveAux.run(3, 1, 0, "2026-10-04T02:02:00.000Z", JSON.stringify(extra));
    const before = database.serialize(), stats = getLearningAnalytics(database, now).vocabulary;
    expect(stats).toMatchObject({ firstLearningCount: 0, firstLearningUnknownCount: 1, known: 0, scheduledGradeCount: 2,
      objectiveAccuracy: 50, objectiveSampleCount: 2,
      supplemental: { attemptCount: 3, rawAccuracy: expect.closeTo(200 / 3), unknownPurposeCount: 0, mergedScheduledGradeCount: 1,
        consolidation: { attemptCount: 2, correctCount: 1, rawAccuracy: 50, confirmedTypoCount: 1 },
        extraSentence: { attemptCount: 1, correctCount: 1, rawAccuracy: 100 } },
      targets: { focus: "ielts-advanced", catalogTargetCount: 2, introducedTargetCount: 1, selfReportedKnownTargetCount: 1,
        selfReportedKnownActionCount: 2, pausedTermCount: 1, consolidationPendingCount: 1, consolidationDueCount: 1 } });
    expect(stats.byMode.find((mode) => mode.mode === "context")).toMatchObject({ reviewCount: 2, sampleCount: 2, rawAccuracy: 50 });
    expect(database.serialize().equals(before)).toBe(true);
    database.prepare("UPDATE vocabulary_term_dispositions SET paused=1 WHERE normalized_term='evidence'").run();
    expect(getLearningAnalytics(database, now).vocabulary.targets.consolidationDueCount).toBe(0);
    database.prepare("UPDATE vocabulary_term_dispositions SET paused=0 WHERE normalized_term='evidence'").run();
    database.prepare("UPDATE vocabulary_target_state SET word_id=NULL WHERE target_id='research'").run();
    expect(getLearningAnalytics(database, now).vocabulary.targets).toMatchObject({ introducedTargetCount: 1,
      consolidationPendingCount: 0, consolidationDueCount: 0 });
    expect(getLearningAnalytics(database, now).vocabulary).toMatchObject({ scheduledGradeCount: 2, objectiveAccuracy: 50 });
    database.prepare("UPDATE vocabulary_target_state SET word_id='one' WHERE target_id='research'").run();
    entry.targets[0].status = "draft";
    database.prepare("UPDATE vocabulary_catalog_entries SET data_json=? WHERE id=?").run(JSON.stringify(entry), entry.id);
    expect(getLearningAnalytics(database, now).vocabulary).toMatchObject({ scheduledGradeCount: 2, objectiveAccuracy: 50,
      supplemental: { attemptCount: 3 }, targets: { introducedTargetCount: 1, consolidationPendingCount: 0, consolidationDueCount: 0 } });
  });
});
