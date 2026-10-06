import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Use the isolated test database."); } }));
import { getLearningAnalytics } from "./analytics";

let database: Database.Database;
const now = new Date("2026-10-04T03:00:00.000Z");
beforeEach(() => { database = new Database(":memory:"); });
afterEach(() => { database.close(); });

describe("analytics data sources", () => {
  it("returns truthful empty states before optional tables or history exist", () => {
    const result = getLearningAnalytics(database, now);
    expect(result.reading.accuracy).toBeNull(); expect(result.listening.accuracy).toBeNull();
    expect(result.writing).toEqual([]); expect(result.vocabulary.retention).toBeNull();
    expect(result.study.todayMinutes).toBe(0); expect(result.study.streak).toBe(0);
    expect(result.activity).toEqual([]);
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
    expect(stats.byMode.every((mode) => mode.sampleCount === 0 && mode.rawAccuracy === null)).toBe(true);
  });
});
