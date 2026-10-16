import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: (filename: Parameters<typeof actual.existsSync>[0]) => String(filename).endsWith("vocabulary-catalog.json") ? false : actual.existsSync(filename) };
});
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { vocabularyInputSchema, type VocabularyEntry, type VocabularyReviewMode } from "../lib/vocabulary";
import type { VocabularyCardDraft, VocabularySession } from "../lib/vocabulary-session";
import { ensureVocabularyTables, learnVocabularyEntry, listVocabularyEntries, previewVocabularyReview, reviewVocabularyEntry, saveVocabularyEntry, VocabularyReviewConflict, type VocabularyReviewInput } from "./vocabulary";
import { changeVocabularySession, getVocabularySession } from "./vocabulary-session";
import { readVocabularySession, refreshVocabularySessionRevisions, VocabularySessionConflict } from "./vocabulary-session-store";
import { GET, POST } from "../app/api/vocabulary/[id]/review/route";
import { GET as sessionGET, PUT as sessionPUT } from "../app/api/vocabulary/session/route";
import { PUT as studyPUT } from "../app/api/vocabulary/study/route";
import { vocabularyCatalogEntrySchema, vocabularyExerciseSchema, vocabularyExerciseGap, isVocabularyCatalogEntryLearnable } from "../lib/vocabulary-course";
import { ensureVocabularyCourseTables, getVocabularyCourses, getVocabularyStudy, listVocabularyCatalogEntries, materializeVocabularyCatalogEntry, registerVocabularyCourse, rememberVocabularyExercise, saveVocabularyStudy, selectVocabularyCourse, vocabularyExerciseForWord, VocabularyStudyConflict } from "./vocabulary-courses";
import { publishVocabularyCatalogReview } from "./vocabulary-catalog-review";

const now = new Date("2030-10-06T01:00:00.000Z");
const db = () => holder.database!;
function word(legacy = true, term = "economy", meaningZh = "经济") {
  const saved = saveVocabularyEntry(vocabularyInputSchema.parse({ term, meaningZh, sourceSentence: "The economy grew." }))!.word;
  if (legacy) db().prepare("UPDATE vocabulary_words SET repetitions = 1, due_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(saved.id);
  return listVocabularyEntries().find((item) => item.id === saved.id)!;
}
function start(mode: VocabularyReviewMode = "recall") { return changeVocabularySession({ action: "start", id: randomUUID(), mode }, now).session!; }
function checkpoint(session: VocabularySession, entry: VocabularyEntry, changes: Partial<VocabularyCardDraft> = {}, at = now) {
  return changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision, state: {
    mode: session.state.mode, skippedIds: session.state.skippedIds,
    current: { wordId: entry.id, wordVersion: entry.reviewVersion, phase: "revealed", answer: entry.term,
      supplemental: session.state.current?.supplemental ?? false, canSupplement: session.state.current?.canSupplement ?? false,
      gaveUp: false, confirmedTypo: false, audioPlayed: true, exercise: null, requestedRating: null, ratingSource: "automatic", startedAt: at.toISOString(), ...changes },
  } }, at).session!;
}
function reviewInput(session: VocabularySession, entry: VocabularyEntry, changes: Partial<VocabularyReviewInput> = {}): VocabularyReviewInput {
  return { rating: "good", mode: session.state.mode, userAnswer: session.state.current?.answer ?? "", durationSeconds: 10,
    expectedVersion: entry.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision, submissionId: randomUUID(),
    gaveUp: session.state.current?.gaveUp ?? false, confirmedTypo: session.state.current?.confirmedTypo ?? false, ...changes };
}
function catalogEntry(term = "economy", rank = 1) {
  const sentences = [`The local ${term} depends on tourism.`, `Investment can strengthen the ${term} over time.`];
  return vocabularyCatalogEntrySchema.parse({ id: `fixture:${term}`, term, rank, courseIds: ["fixture-course"], meaningZh: "经济", definitionEn: "A system of production and trade.", partOfSpeech: "noun",
    exercises: sentences.map((sentence, index) => ({ id: `${term}:${index}`, version: 1, sentence, targetStart: sentence.indexOf(term), targetEnd: sentence.indexOf(term) + term.length, targetSurface: term, acceptedAnswers: [term], meaningZh: "经济", source: "test fixture" })) });
}
function fixtureCourse(entries = [catalogEntry()]) {
  registerVocabularyCourse({ id: "fixture-course", title: "Fixture", description: "test", version: 1, kind: "user-import" }, entries);
  selectVocabularyCourse("fixture-course");
}
const next = (session: VocabularySession, at = now) => changeVocabularySession({ action: "next", id: session.id, expectedRevision: session.revision }, at).session!;

describe("durable vocabulary sessions and reviews", () => {
  let directory: string;
  let filename: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ielts-vocabulary-test-")); filename = path.join(directory, "vocabulary.db");
    holder.database = new Database(filename);
    db().exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE vocabulary_words (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, pronunciation TEXT NOT NULL, part_of_speech TEXT NOT NULL, meaning_zh TEXT NOT NULL, definition_en TEXT NOT NULL, example TEXT NOT NULL, tags_json TEXT NOT NULL, repetitions INTEGER NOT NULL DEFAULT 0, interval_days INTEGER NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5, due_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE vocabulary_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, word_id TEXT NOT NULL REFERENCES vocabulary_words(id), rating TEXT NOT NULL, previous_due_at TEXT NOT NULL, next_due_at TEXT NOT NULL, reviewed_at TEXT NOT NULL);
      CREATE TABLE review_items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL, skill TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', mistake_count INTEGER NOT NULL DEFAULT 1, reviewed_at TEXT NOT NULL DEFAULT '');`);
    ensureVocabularyTables();
  });
  afterEach(() => { holder.database?.close(); holder.database = null; rmSync(directory, { recursive: true, force: true }); });

  it("deduplicates captures and preserves metadata/progress across restart while incrementing edit version", () => {
    const entry = word();
    expect(saveVocabularyEntry(vocabularyInputSchema.parse({ term: "ECONOMY" }))!.word.meaningZh).toBe("经济");
    const edited = saveVocabularyEntry(vocabularyInputSchema.parse({ ...entry, meaningZh: "经济体系", wordFamily: ["economic"] }), entry.id, entry.reviewVersion)!.word;
    expect(edited.dueAt).toBe(entry.dueAt); expect(edited.reviewVersion).toBe(entry.reviewVersion + 1);
    holder.database!.close(); holder.database = new Database(filename);
    expect(listVocabularyEntries()[0]).toMatchObject({ meaningZh: "经济体系", wordFamily: ["economic"], dueAt: entry.dueAt, reviewVersion: edited.reviewVersion });
  });
  it("introduces a new word once, without a fake grade, then allows its due recall", () => {
    const entry = word(false); const session = checkpoint(start(), entry, { phase: "learn", answer: "" });
    const input = { expectedVersion: entry.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision };
    const learned = learnVocabularyEntry(entry.id, input, now)!;
    expect(learned.word).toMatchObject({ dueAt: "2030-10-06T01:01:00.000Z", repetitions: 0, hasReviewHistory: false, reviewVersion: entry.reviewVersion + 1 });
    expect(learned.session!.state).toMatchObject({ current: null, reviewed: 0, learned: 1 });
    expect(db().prepare("SELECT count(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 0 });
    expect(db().prepare("SELECT count(*) AS total FROM vocabulary_scheduler_state").get()).toEqual({ total: 0 });
    const bytes = db().serialize();
    expect(learnVocabularyEntry(entry.id, input, new Date(now.getTime() + 1000))!.word.dueAt).toBe(learned.word.dueAt);
    expect(db().serialize()).toEqual(bytes);
    expect(() => checkpoint(learned.session!, learned.word)).toThrow("尚未到期");
    const at = new Date(learned.word.dueAt); const next = checkpoint(learned.session!, learned.word, {}, at);
    const reviewed = reviewVocabularyEntry(entry.id, reviewInput(next, learned.word), at)!;
    expect(reviewed.word.repetitions).toBe(1); expect(reviewed.session!.state).toMatchObject({ reviewed: 1, learned: 1 });
  });
  it("does not introduce words without usable meaning or misclassify zero-repetition legacy history", () => {
    const entry = word(false, "obscure", ""); const session = checkpoint(start(), entry, { phase: "learn", answer: "" });
    const before = db().serialize();
    expect(() => learnVocabularyEntry(entry.id, { expectedVersion: entry.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision }, now)).toThrow("释义");
    expect(db().serialize()).toEqual(before);
    db().prepare("INSERT INTO vocabulary_reviews(word_id,rating,previous_due_at,next_due_at,reviewed_at) VALUES (?, 'good', ?, ?, '2025-01-01T00:00:00.000Z')").run(entry.id, entry.dueAt, entry.dueAt);
    expect(listVocabularyEntries()[0]).toMatchObject({ hasReviewHistory: true, learningStartedAt: "2025-01-01T00:00:00.000Z", repetitions: 0, dueAt: entry.dueAt });
  });
  it("previews without writes, matches actual FSRS submission, and preserves legacy dates", () => {
    const entry = word(); const session = checkpoint(start(), entry);
    const before = db().serialize(); const preview = previewVocabularyReview(entry.id, now)!;
    expect(preview).toMatchObject({ wordVersion: entry.reviewVersion, retention: 0.9, currentDueAt: entry.dueAt });
    expect(db().serialize()).toEqual(before);
    const reviewed = reviewVocabularyEntry(entry.id, reviewInput(session, entry), now)!;
    expect(reviewed.word.dueAt).toBe(preview.ratings.good.dueAt);
    expect(reviewed.review).toMatchObject({ correct: true, effectiveRating: "good", requestedRating: "good", termSnapshot: "economy" });
    expect(reviewed.session!.state).toMatchObject({ current: null, reviewed: 1, lastSubmissionId: reviewed.review.submissionId });
  });
  it("does not create optional tables or move legacy due dates on preview", () => {
    const entry = word(); db().prepare("UPDATE vocabulary_words SET due_at = '2040-01-01T00:00:00.000Z' WHERE id = ?").run(entry.id);
    db().exec("DROP TABLE vocabulary_review_audit; DROP TABLE vocabulary_learning_state; DROP TABLE vocabulary_scheduler_state; DROP TABLE vocabulary_metadata; DROP TABLE vocabulary_review_details; DROP TABLE vocabulary_sessions;");
    const before = db().serialize(); expect(previewVocabularyReview(entry.id, now)!.currentDueAt).toBe("2040-01-01T00:00:00.000Z"); expect(db().serialize()).toEqual(before);
  });
  it.each(["recall", "spelling", "context"] as const)("keeps original %s typo wrong while accepting explicit memory assessment", (mode) => {
    const entry = word(); const session = checkpoint(start(mode), entry, { answer: "econmy", confirmedTypo: true });
    const result = reviewVocabularyEntry(entry.id, reviewInput(session, entry, { rating: "easy" }), now)!;
    expect(result.review).toMatchObject({ userAnswer: "econmy", correct: false, confirmedTypo: true, requestedRating: "easy", effectiveRating: "easy", decisionReason: "confirmed_typo", termSnapshot: "economy" });
    expect(db().prepare("SELECT correct,user_answer FROM vocabulary_review_details").get()).toEqual({ correct: 0, user_answer: "econmy" });
    expect(db().prepare("SELECT count(*) AS total FROM review_items").get()).toEqual({ total: 0 });
    saveVocabularyEntry(vocabularyInputSchema.parse({ term: "economies", meaningZh: "经济" }), entry.id);
    expect(getVocabularySession(result.review.submissionId).submission!.termSnapshot).toBe("economy");
  });
  it.each([
    { answer: "econmy", confirmedTypo: false, gaveUp: false }, { answer: "", confirmedTypo: true, gaveUp: false },
    { answer: "unrelated", confirmedTypo: true, gaveUp: false }, { answer: "economy", confirmedTypo: true, gaveUp: true },
  ])("forces Again for failure/invalid override $answer while retaining requested Easy", ({ answer, confirmedTypo, gaveUp }) => {
    const entry = word(); const session = checkpoint(start(), entry, { answer, confirmedTypo, gaveUp });
    const result = reviewVocabularyEntry(entry.id, reviewInput(session, entry, { rating: "easy" }), now)!;
    expect(result.review.effectiveRating).toBe("again"); expect(result.review.requestedRating).toBe("easy"); expect(result.review.confirmedTypo).toBe(false);
    expect(db().prepare("SELECT mistake_count FROM review_items").get()).toEqual({ mistake_count: 1 });
  });
  it("keeps confirmed-typo Again as FSRS reinforcement without creating a forgetting Review Item", () => {
    const entry = word(); const session = checkpoint(start("spelling"), entry, { answer: "econmy", confirmedTypo: true });
    const preview = previewVocabularyReview(entry.id, now)!;
    const result = reviewVocabularyEntry(entry.id, reviewInput(session, entry, { rating: "again" }), now)!;
    expect(result.review).toMatchObject({ userAnswer: "econmy", correct: false, requestedRating: "again", effectiveRating: "again", decisionReason: "confirmed_typo", confirmedTypo: true });
    expect(result.word.dueAt).toBe(preview.ratings.again.dueAt);
    expect(db().prepare("SELECT rating FROM vocabulary_reviews").get()).toEqual({ rating: "again" });
    expect(db().prepare("SELECT correct, user_answer FROM vocabulary_review_details").get()).toEqual({ correct: 0, user_answer: "econmy" });
    expect(db().prepare("SELECT count(*) AS total FROM review_items").get()).toEqual({ total: 0 });
  });
  it("requires successful spelling playback, including for give-up", () => {
    const entry = word(); const session = checkpoint(start("spelling"), entry, { answer: "", gaveUp: true, audioPlayed: false }); const before = db().serialize();
    expect(() => reviewVocabularyEntry(entry.id, reviewInput(session, entry), now)).toThrow("播放"); expect(db().serialize()).toEqual(before);
  });
  it("retains recognition self-assessment without inventing objective correctness", () => {
    const entry = word(); const session = checkpoint(start("recognition"), entry, { answer: "" });
    expect(reviewVocabularyEntry(entry.id, reviewInput(session, entry, { rating: "easy" }), now)!.review).toMatchObject({ correct: null, effectiveRating: "easy", decisionReason: "self_assessed" });
  });
  it("returns a lost-response submission without double counts, even after later edits", () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "econmy" }); const input = reviewInput(session, entry, { rating: "again" });
    const first = reviewVocabularyEntry(entry.id, input, now)!;
    saveVocabularyEntry(vocabularyInputSchema.parse({ term: "economy", meaningZh: "经济体系" }), entry.id);
    const before = db().serialize(); const duplicate = reviewVocabularyEntry(entry.id, input, new Date(now.getTime() + 60000))!;
    expect(duplicate.review).toEqual(first.review); expect(duplicate.word.meaningZh).toBe("经济体系"); expect(duplicate.session!.state.reviewed).toBe(1);
    expect(db().serialize()).toEqual(before); expect(getVocabularySession(input.submissionId).submission).toEqual(first.review);
  });
  it("rejects stale word edits or session revisions without recording a grade", () => {
    const entry = word(); const session = checkpoint(start(), entry); const input = reviewInput(session, entry);
    const newer = changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision, state: { mode: "recall", current: session.state.current, skippedIds: ["another-word"] } }, now).session!;
    expect(() => reviewVocabularyEntry(entry.id, input, now)).toThrow(VocabularySessionConflict);
    saveVocabularyEntry(vocabularyInputSchema.parse({ term: "economy", meaningZh: "经济体系" }), entry.id);
    expect(() => reviewVocabularyEntry(entry.id, { ...input, expectedSessionRevision: newer.revision }, now)).toThrow(VocabularyReviewConflict);
    expect(db().prepare("SELECT count(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 0 });
  });
  it("rolls back schedule, audit, session counts and mistakes together on a write failure", () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "wrong" });
    db().exec("CREATE TRIGGER fail_audit BEFORE INSERT ON vocabulary_review_audit BEGIN SELECT RAISE(ABORT, 'injected failure'); END;"); const before = db().serialize();
    expect(() => reviewVocabularyEntry(entry.id, reviewInput(session, entry), now)).toThrow("injected failure"); expect(db().serialize()).toEqual(before);
  });
  it("persists revealed drafts and makes end/start retries idempotent without reviving ended sessions", () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "econmy" });
    holder.database!.close(); holder.database = new Database(filename); expect(getVocabularySession().session).toEqual(session);
    const ended = changeVocabularySession({ action: "end", id: session.id, expectedRevision: session.revision }, now).session!;
    expect(ended).toMatchObject({ status: "ended", state: { current: null } }); const before = db().serialize();
    expect(changeVocabularySession({ action: "end", id: session.id, expectedRevision: session.revision }, now).session).toEqual(ended);
    expect(changeVocabularySession({ action: "start", id: session.id, mode: "recall" }, now).session).toEqual(ended); expect(db().serialize()).toEqual(before);
    expect(() => reviewVocabularyEntry(entry.id, reviewInput(session, entry), now)).toThrow(VocabularySessionConflict); expect(start().id).not.toBe(ended.id);
  });
  it("refreshes restore revisions above both histories while retaining the active revealed draft", () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "econmy" });
    refreshVocabularySessionRevisions(db(), new Map([[session.id, session.revision + 50]]), now); const restored = getVocabularySession().session!;
    expect(restored.state).toEqual(session.state); expect(restored.status).toBe("active"); expect(restored.revision).toBe(session.revision + 52);
    expect(() => reviewVocabularyEntry(entry.id, reviewInput(session, entry), now)).toThrow(VocabularySessionConflict);
  });
  it("serves no-store preview, rejects old protocols and stale checkpoints, and resolves unknown submission", async () => {
    const entry = word(); const session = checkpoint(start(), entry); const context = { params: Promise.resolve({ id: entry.id }) };
    expect((await GET(new Request("http://localhost/review"), context)).headers.get("Cache-Control")).toBe("no-store");
    const old = await POST(new Request("http://localhost/review", { method: "POST", body: JSON.stringify({ rating: "easy", mode: "recall", userAnswer: "economy" }) }), context);
    expect(old.status).toBe(400); expect((await old.json()).error).toContain("刷新");
    const stale = await sessionPUT(new Request("http://localhost/session", { method: "PUT", body: JSON.stringify({ action: "end", id: session.id, expectedRevision: session.revision - 1 }) }));
    expect(stale.status).toBe(409); expect((await stale.json()).session.revision).toBe(session.revision);
    const response = await sessionGET(new Request(`http://localhost/session?submissionId=${randomUUID()}`)); expect((await response.json()).submission).toBeNull();
    expect(db().prepare("SELECT count(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 0 });
  });
  it("returns one durable audit record for an actual HTTP retry and exposes it for recovery", async () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "econmy", confirmedTypo: true });
    const input = reviewInput(session, entry, { rating: "good" }); const context = { params: Promise.resolve({ id: entry.id }) };
    const post = () => POST(new Request("http://localhost/review", { method: "POST", body: JSON.stringify(input) }), context);
    const first = await post(); expect(first.status).toBe(200); const original = await first.json();
    const second = await post(); expect(second.status).toBe(200); expect((await second.json()).review).toEqual(original.review);
    const recovery = await sessionGET(new Request(`http://localhost/session?submissionId=${input.submissionId}`));
    const restored = await recovery.json(); expect(restored.submission).toEqual(original.review); expect(restored.session.state.reviewed).toBe(1);
    expect(db().prepare("SELECT count(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 1 });
  });
  it("does not overwrite revealed original answers and requires mode switches to skip the exposed word", () => {
    const entry = word(); const session = checkpoint(start(), entry, { answer: "econmy" });
    expect(() => checkpoint(session, entry, { answer: "economy" })).toThrow("原始答案");
    expect(() => changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision,
      state: { mode: "recognition", current: null, skippedIds: [] } }, now)).toThrow("暂缓原词");
    const changed = changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision,
      state: { mode: "recognition", current: null, skippedIds: [entry.id] } }, now).session!;
    expect(changed.state).toMatchObject({ current: null, mode: "recognition", skippedIds: [entry.id], reviewed: 0 });
  });
  it("rejects checkpoint counters supplied by clients instead of trusting claimed progress", async () => {
    const session = start();
    const reply = await sessionPUT(new Request("http://localhost/session", { method: "PUT", body: JSON.stringify({
      action: "checkpoint", id: session.id, expectedRevision: session.revision,
      state: { mode: "recall", current: null, skippedIds: [], reviewed: 999 },
    }) }));
    expect(reply.status).toBe(400); expect(getVocabularySession().session).toEqual(session);
  });
  it("keeps catalog registration separate, shares an existing personal word, and detaches only on renaming", () => {
    const entry = word(); const original = saveVocabularyEntry(vocabularyInputSchema.parse({ ...entry, notes: "personal note", meaningZh: "我的释义" }), entry.id)!.word;
    fixtureCourse(); const catalog = listVocabularyCatalogEntries("fixture-course")[0];
    expect(listVocabularyEntries()).toHaveLength(1);
    const linked = materializeVocabularyCatalogEntry(catalog)!;
    expect(linked).toMatchObject({ id: original.id, notes: "personal note", meaningZh: "我的释义", dueAt: original.dueAt, reviewVersion: original.reviewVersion });
    registerVocabularyCourse({ id: "second-course", title: "Second", description: "", kind: "user-import", version: 1 }, [{ term: "ECONOMY", meaningZh: "must not replace" }]);
    expect(listVocabularyCatalogEntries("second-course")[0].id).toBe(catalog.id);
    expect(getVocabularyCourses({ query: "Second" }).courses[0].learned).toBe(1);
    const renamed = saveVocabularyEntry(vocabularyInputSchema.parse({ ...original, term: "economic" }), original.id)!.word;
    expect(renamed.dueAt).toBe(original.dueAt);
    expect(materializeVocabularyCatalogEntry(catalog)).toBeNull();
    expect(listVocabularyEntries()).toHaveLength(1);
  });
  it("keeps unchanged intro and first review snapshots across course metadata updates and grades the inflected surface", () => {
    const entry = catalogEntry(); const sentence = "Several economies recovered after the recession.";
    entry.exercises[0] = vocabularyExerciseSchema.parse({ ...entry.exercises[0], sentence, targetStart: 8, targetEnd: 17, targetSurface: "economies", acceptedAnswers: ["economies"] });
    fixtureCourse([entry]); const selected = next(start("context")); const draft = selected.state.current!;
    const originalExercise = draft.exercise;
    expect(next(selected).state.current).toEqual(draft);
    const learned = learnVocabularyEntry(draft.wordId, { expectedVersion: draft.wordVersion, sessionId: selected.id, expectedSessionRevision: selected.revision }, now)!;
    registerVocabularyCourse({ id: "fixture-course", title: "Fixture", description: "changed", version: 2, kind: "user-import" }, [entry], db(), true);
    const due = new Date(learned.word.dueAt); const recalled = next(learned.session!, due);
    expect(recalled.state.current!.exercise).toEqual(originalExercise);
    const revealed = checkpoint(recalled, learned.word, { exercise: recalled.state.current!.exercise, answer: "economies", requestedRating: "good", ratingSource: "automatic" }, due);
    const result = reviewVocabularyEntry(learned.word.id, reviewInput(revealed, learned.word, { ratingSource: "automatic" }), due)!;
    expect(result.review).toMatchObject({ correct: true, effectiveRating: "good", ratingSource: "automatic", termSnapshot: "economy", exercise: originalExercise });
    const retry = reviewVocabularyEntry(learned.word.id, reviewInput(revealed, learned.word, { ratingSource: "automatic", submissionId: result.review.submissionId }), due)!;
    expect(retry.session!.state.reviewed).toBe(1);
  });
  it("rejects an old published card after editing instead of judging its answer against the replacement", async () => {
    const personal = word(); const entry = catalogEntry(); fixtureCourse([entry]); materializeVocabularyCatalogEntry(entry);
    const session = next(start("context")); const original = session.state.current!.exercise!;
    const revealed = checkpoint(session, personal, { exercise: original, answer: "economy" });
    const sentence = "Several economies recovered after the recession.";
    const changed = publishVocabularyCatalogReview({ entryId: entry.id, expectedVersion: 1, meaningZh: entry.meaningZh,
      definitionEn: entry.definitionEn, partOfSpeech: entry.partOfSpeech, exercises: [vocabularyExerciseSchema.parse({
        ...entry.exercises[0], sentence, targetStart: 8, targetEnd: 17, targetSurface: "economies", acceptedAnswers: ["economies"],
      }), entry.exercises[1]] });
    expect(changed.exercises[0]).toMatchObject({ version: 2, acceptedAnswers: ["economies"] });
    const before = db().serialize(); const input = reviewInput(revealed, personal);
    expect(() => reviewVocabularyEntry(personal.id, input, now)).toThrow("题目已修改");
    expect(db().serialize()).toEqual(before);
    const response = await POST(new Request("http://localhost/review", { method: "POST", body: JSON.stringify(input) }), { params: Promise.resolve({ id: personal.id }) });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.session).toMatchObject({ revision: revealed.revision + 2, state: { current: null, reviewed: 0 } });
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 0 });
    expect(listVocabularyEntries().find((item) => item.id === personal.id)!.dueAt).toBe(personal.dueAt);
    const current = next(payload.session);
    expect(current.state.current!.exercise).toMatchObject({ id: original.id, version: 2, acceptedAnswers: ["economies"] });
    const fresh = checkpoint(current, personal, { exercise: current.state.current!.exercise, answer: "economies" });
    expect(reviewVocabularyEntry(personal.id, reviewInput(fresh, personal), now)!.review).toMatchObject({ correct: true, effectiveRating: "good", exercise: { version: 2 } });
  });
  it("refuses a restored draft exercise without changing a schedule or history", () => {
    const personal = word(); const entry = catalogEntry(); fixtureCourse([entry]); materializeVocabularyCatalogEntry(entry);
    const selected = next(start("context"));
    const revealed = checkpoint(selected, personal, { exercise: selected.state.current!.exercise });
    const state = { ...revealed.state, current: { ...revealed.state.current!, exercise: { ...revealed.state.current!.exercise!, status: "draft" } } };
    db().prepare("UPDATE vocabulary_sessions SET state_json=? WHERE id=?").run(JSON.stringify(state), revealed.id);
    const before = db().serialize();
    expect(() => reviewVocabularyEntry(personal.id, reviewInput(revealed, personal), now)).toThrow("尚待确认");
    expect(db().serialize()).toEqual(before);
  });
  it.each(["missing", "withdrawn", "removed exercise"])("synchronizes a %s catalog card without grading its old answer", (change) => {
    const personal = word(); const entry = catalogEntry(); fixtureCourse([entry]); materializeVocabularyCatalogEntry(entry);
    const selected = next(start("context"));
    const revealed = checkpoint(selected, personal, { exercise: selected.state.current!.exercise });
    if (change === "missing") db().prepare("DELETE FROM vocabulary_catalog_entries WHERE id=?").run(entry.id);
    else {
      const updated = change === "withdrawn" ? { ...entry, status: "draft" } : { ...entry, exercises: entry.exercises.slice(1) };
      db().prepare("UPDATE vocabulary_catalog_entries SET data_json=? WHERE id=?").run(JSON.stringify(updated), entry.id);
    }
    expect(() => reviewVocabularyEntry(personal.id, reviewInput(revealed, personal), now)).toThrow("题目已修改或下架");
    const refreshed = getVocabularySession();
    expect(refreshed).toMatchObject({ error: expect.stringContaining("尚未评分"), session: { revision: revealed.revision + 2, state: { current: null, reviewed: 0 } } });
    expect(getVocabularySession().session!.revision).toBe(refreshed.session!.revision);
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 0 });
  });
  it("invalidates an edited introduction and increments exercise versions for bundled content changes", () => {
    const entry = catalogEntry(); fixtureCourse([entry]); const selected = next(start("context"));
    const draft = selected.state.current!; const originalWord = listVocabularyEntries()[0];
    const sentence = "The economy is recovering steadily.";
    const replacement = { ...entry, exercises: [vocabularyExerciseSchema.parse({ ...entry.exercises[0], sentence, targetStart: 4, targetEnd: 11 }), entry.exercises[1]] };
    registerVocabularyCourse({ id: "fixture-course", title: "Fixture", description: "test", version: 2, kind: "user-import" }, [replacement], db(), true);
    expect(listVocabularyCatalogEntries()[0].exercises[0].version).toBe(2);
    const before = db().serialize();
    expect(() => learnVocabularyEntry(draft.wordId, { expectedVersion: draft.wordVersion, sessionId: selected.id, expectedSessionRevision: selected.revision }, now)).toThrow("题目已修改");
    expect(db().serialize()).toEqual(before);
    expect(listVocabularyEntries()[0]).toEqual(originalWord);
    const fresh = next(getVocabularySession().session!);
    expect(fresh.state.current!.exercise).toMatchObject({ id: draft.exercise!.id, version: 2, sentence });
    const learned = learnVocabularyEntry(draft.wordId, { expectedVersion: draft.wordVersion, sessionId: fresh.id, expectedSessionRevision: fresh.revision }, now)!;
    const withdrawn = listVocabularyCatalogEntries()[0]; withdrawn.exercises[0].status = "draft";
    db().prepare("UPDATE vocabulary_catalog_entries SET data_json=? WHERE id=?").run(JSON.stringify(withdrawn), entry.id);
    const recalled = next(learned.session!, new Date(learned.word.dueAt));
    expect(recalled.state.current!.exercise!.id).toBe(entry.exercises[1].id);
  });
  it("skips draft or incomplete entries, respects startRank and null pause, and still picks global due words", () => {
    const draft = { ...catalogEntry("finance", 2), status: "draft" as const };
    const incomplete = { ...catalogEntry("investment", 3), definitionEn: "" };
    fixtureCourse([catalogEntry(), draft, incomplete, catalogEntry("growth", 501)]);
    const summary = getVocabularyCourses({ query: "Fixture" }).courses[0];
    expect(summary).toMatchObject({ total: 4, ready: 2, pending: 2 });
    expect(isVocabularyCatalogEntryLearnable(draft)).toBe(false);
    selectVocabularyCourse("fixture-course", 501); let session = next(start("context"));
    expect(listVocabularyEntries().find((item) => item.id === session.state.current!.wordId)!.term).toBe("growth");
    session = changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision, state: { mode: "context", current: null, skippedIds: [session.state.current!.wordId] } }, now).session!;
    selectVocabularyCourse(null); expect(getVocabularySession().session!.status).toBe("ended"); session = next(start("context")); expect(session.state.current).toBeNull();
    const due = word(true, "priority");
    expect(next(session).state.current!.wordId).toBe(due.id);
  });
  it("never selects draft exercises and rejects a client replacement of the selected answer snapshot", () => {
    const entry = catalogEntry(); entry.exercises.unshift({ ...entry.exercises[0], id: "draft", status: "draft" });
    fixtureCourse([entry]); const session = next(start("context")); const draft = session.state.current!;
    expect(draft.exercise!.id).not.toBe("draft");
    const forged = { ...draft, exercise: { ...draft.exercise!, acceptedAnswers: [draft.exercise!.targetSurface, "anything"] } };
    expect(() => changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision,
      state: { mode: "context", current: forged, skippedIds: [] } }, now)).toThrow("题面版本");
  });
  it("masks all accepted spellings without hiding unrelated substrings", () => {
    const sentence = "The color matches the colour of the colorful cover.";
    const exercise = vocabularyExerciseSchema.parse({ id: "variants", version: 1, sentence, targetStart: 4, targetEnd: 9, targetSurface: "color", acceptedAnswers: ["color", "colour"] });
    expect(vocabularyExerciseGap(exercise)).toBe("The ______ matches the ______ of the colorful cover.");
  });
  it("credits each offline heartbeat once even when paused or retried on a different day", () => {
    const heartbeat = { id: randomUUID(), seconds: 13 };
    expect(getVocabularyStudy(now).dailyGoalSeconds).toBe(900);
    expect(saveVocabularyStudy({ paused: true, dailyGoalSeconds: 1200, heartbeat }, now)).toMatchObject({ todaySeconds: 13, paused: true, dailyGoalSeconds: 1200 });
    expect(saveVocabularyStudy({ heartbeat }, new Date(now.getTime() + 60000)).todaySeconds).toBe(13);
    expect(saveVocabularyStudy({ heartbeat }, new Date(now.getTime() + 86400000)).todaySeconds).toBe(0);
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_study_heartbeats").get()).toEqual({ total: 1 });
  });
  it("credits cumulative segments by their positive delta, including acknowledgements lost between tabs", () => {
    const id = randomUUID();
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 5, cumulative: true } }, now).todaySeconds).toBe(5);
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 5, cumulative: true } }, now).todaySeconds).toBe(5);
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 9, cumulative: true } }, now).todaySeconds).toBe(9);
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 3, cumulative: true } }, now).todaySeconds).toBe(9);
    expect(db().prepare("SELECT seconds FROM vocabulary_study_time_segments WHERE id=?").get(id)).toEqual({ seconds: 9 });
  });
  it("does not credit an old heartbeat again when seeding the new cumulative segment ledger", () => {
    const id = randomUUID(); ensureVocabularyCourseTables();
    saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 5 } }, now);
    db().prepare("DELETE FROM vocabulary_study_time_segments WHERE id=?").run(id);
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 5, cumulative: true } }, now).todaySeconds).toBe(5);
    expect(saveVocabularyStudy({ restoreVersion: 1, heartbeat: { id, seconds: 8, cumulative: true } }, now).todaySeconds).toBe(8);
  });
  it("adds the restore token to existing study preferences without changing goals or time", () => {
    db().exec(`DROP TABLE vocabulary_study_preferences;
      CREATE TABLE vocabulary_study_preferences (id INTEGER PRIMARY KEY CHECK(id=1), active_course_id TEXT,
        daily_goal_seconds INTEGER NOT NULL DEFAULT 900, paused INTEGER NOT NULL DEFAULT 0, start_rank INTEGER NOT NULL DEFAULT 1);
      INSERT INTO vocabulary_study_preferences VALUES(1,NULL,1200,1,501);`);
    ensureVocabularyCourseTables(); ensureVocabularyCourseTables();
    expect(getVocabularyStudy(now)).toEqual({ activeCourseId: null, activeCourseTitle: null, dailyGoalSeconds: 1200, paused: true, startRank: 501, todaySeconds: 0, restoreVersion: 1, focus: "general", policyVersion: 1, nextLevel: "B2" });
  });
  it("rejects every stale study write before changing either settings or the heartbeat ledger", () => {
    const heartbeat = { id: randomUUID(), seconds: 13 };
    saveVocabularyStudy({ restoreVersion: 1, dailyGoalSeconds: 1200, paused: true }, now);
    db().prepare("UPDATE vocabulary_study_preferences SET restore_version=3 WHERE id=1").run();
    const before = db().serialize();
    for (const changes of [{ heartbeat }, { paused: false }, { dailyGoalSeconds: 600 }, { heartbeat, paused: false, dailyGoalSeconds: 600 }]) {
      expect(() => saveVocabularyStudy({ restoreVersion: 1, ...changes }, now)).toThrow(VocabularyStudyConflict);
      expect(db().serialize()).toEqual(before);
    }
    expect(saveVocabularyStudy({ restoreVersion: 3, heartbeat }, now)).toMatchObject({ restoreVersion: 3, todaySeconds: 13, paused: true, dailyGoalSeconds: 1200 });
    expect(saveVocabularyStudy({ restoreVersion: 3, heartbeat }, now).todaySeconds).toBe(13);
  });
  it("requires the study token over HTTP and returns fresh state on restore conflicts", async () => {
    const request = (body: unknown) => new Request("http://localhost/api/vocabulary/study", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    const before = db().serialize();
    expect((await studyPUT(request({ paused: true }))).status).toBe(400);
    expect(db().serialize()).toEqual(before);
    saveVocabularyStudy({ restoreVersion: 1, paused: true }, now);
    db().prepare("UPDATE vocabulary_study_preferences SET restore_version=3 WHERE id=1").run();
    const response = await studyPUT(request({ restoreVersion: 1, paused: false }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String), study: { restoreVersion: 3, paused: true } });
    expect((await studyPUT(request({ restoreVersion: 3, paused: false }))).status).toBe(200);
    expect(getVocabularyStudy(now).paused).toBe(false);
  });
  it("blocks obsolete course selections and new rounds while keeping start retries idempotent", async () => {
    fixtureCourse();
    const session = start();
    const ended = changeVocabularySession({ action: "end", id: session.id, expectedRevision: session.revision }, now).session!;
    db().prepare("UPDATE vocabulary_study_preferences SET restore_version=3 WHERE id=1").run();
    const before = db().serialize();
    expect(() => selectVocabularyCourse(null, 1, db(), 1)).toThrow(VocabularyStudyConflict);
    expect(() => changeVocabularySession({ action: "start", id: randomUUID(), mode: "context", courseId: null, restoreVersion: 1 }, now)).toThrow(VocabularyStudyConflict);
    expect(db().serialize()).toEqual(before);
    expect(changeVocabularySession({ action: "start", id: ended.id, mode: "context", restoreVersion: 1 }, now).session).toEqual(ended);
    expect(db().serialize()).toEqual(before);
    const request = (restoreVersion?: number) => new Request("http://localhost/api/vocabulary/session", { method: "PUT", body: JSON.stringify({ action: "start", id: randomUUID(), mode: "context", restoreVersion }) });
    expect((await sessionPUT(request())).status).toBe(400);
    const stale = await sessionPUT(request(1));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ study: { restoreVersion: 3 }, session: { id: ended.id, status: "ended" } });
    expect((await sessionPUT(request(3))).status).toBe(200);
  });
  it("makes repeated registrations idempotent and changes content versions only when content changes", () => {
    const course = { id: "fixture-course", title: "Fixture", description: "", kind: "user-import" as const, version: 1 };
    const entry = catalogEntry(); registerVocabularyCourse(course, [entry]);
    const before = db().serialize(); registerVocabularyCourse(course, [entry], db(), true);
    expect(db().serialize()).toEqual(before);
    registerVocabularyCourse({ ...course, id: "reading:test:new-passage" }, [entry], db(), true);
    let current = listVocabularyCatalogEntries("fixture-course")[0];
    expect(current.version).toBe(1); expect(current.courseIds).toContain("reading:test:new-passage");
    registerVocabularyCourse(course, [{ ...current, meaningZh: "经济体系" }], db(), true);
    current = listVocabularyCatalogEntries("fixture-course")[0]; expect(current.version).toBe(2);
    const unchanged = db().serialize(); registerVocabularyCourse(course, [current], db(), true);
    expect(db().serialize()).toEqual(unchanged);
  });
  it("preserves locally reviewed reading sentences when the same source is extracted again", () => {
    const entry = catalogEntry(); const sentence = entry.exercises[0].sentence;
    const sourceReference = { materialId: "1", fileSha256: "a".repeat(64), passageId: "passage-1", pdfPage: 1, start: 0, end: sentence.length, quote: sentence };
    entry.exercises[0] = { ...entry.exercises[0], version: 2, source: "原句已核对", sourceReference };
    const course = { id: "fixture-course", title: "Fixture", description: "", kind: "user-import" as const, version: 1 };
    registerVocabularyCourse(course, [entry]); const before = db().serialize();
    const extracted = { ...entry, exercises: [{ ...entry.exercises[0], status: "draft" as const, version: 1, source: "原句待核对" }, entry.exercises[1]] };
    registerVocabularyCourse(course, [extracted], db(), true);
    expect(listVocabularyCatalogEntries("fixture-course")[0]).toEqual(entry);
    expect(db().serialize()).toEqual(before);
  });
  it("rotates through every published context rather than alternating only the first two", () => {
    const entry = catalogEntry(); const sentence = "The economy slowed during the drought.";
    entry.exercises.push(vocabularyExerciseSchema.parse({ id: "third", version: 1, sentence, targetStart: 4, targetEnd: 11, targetSurface: "economy", acceptedAnswers: ["economy"] }));
    fixtureCourse([entry]); const personal = word(); materializeVocabularyCatalogEntry(entry);
    db().prepare("INSERT INTO vocabulary_reviews(word_id,rating,previous_due_at,next_due_at,reviewed_at) VALUES(?,'good',?,?,?)").run(personal.id, personal.dueAt, personal.dueAt, now.toISOString());
    const reviewed = listVocabularyEntries()[0]; const seen: string[] = [];
    for (let index = 0; index < 4; index++) {
      const exercise = vocabularyExerciseForWord(reviewed, "fixture-course")!;
      seen.push(exercise.id); rememberVocabularyExercise(reviewed.id, exercise);
    }
    expect(seen).toEqual([entry.exercises[0].id, entry.exercises[1].id, "third", entry.exercises[0].id]);
  });
  it("honours explicit start selection and pauses personal new cards without losing them", () => {
    fixtureCourse(); selectVocabularyCourse("fixture-course", 501);
    const capture = word(false, "personal-capture");
    const session = changeVocabularySession({ action: "start", id: randomUUID(), mode: "context", courseId: null }, now).session!;
    expect(getVocabularyStudy(now).activeCourseId).toBeNull();
    expect(next(session).state.current).toBeNull();
    expect(listVocabularyEntries().find((item) => item.id === capture.id)!.learningStartedAt).toBeNull();
    const old = word(); expect(next(session).state.current!.wordId).toBe(old.id);
  });

  it("grades a scheduled context once, records its alternate separately and recovers both submission IDs", () => {
    fixtureCourse(); const entry = word(); materializeVocabularyCatalogEntry(listVocabularyCatalogEntries()[0]);
    const selected = next(start("context"));
    expect(selected.state.current).toMatchObject({ supplemental: false, canSupplement: true });
    const revealed = checkpoint(selected, entry, { exercise: selected.state.current!.exercise, answer: "econmy", confirmedTypo: true });
    const primaryInput = reviewInput(revealed, entry, { continueWithPractice: true });
    const scheduled = reviewVocabularyEntry(entry.id, primaryInput, now)!;
    expect(scheduled.review).toMatchObject({ supplemental: false, correct: false, confirmedTypo: true, effectiveRating: "good" });
    expect(scheduled.session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 0,
      current: { wordId: entry.id, wordVersion: scheduled.word.reviewVersion, phase: "front", supplemental: true, canSupplement: false } });
    expect(scheduled.session!.state.current!.exercise!.id).not.toBe(revealed.state.current!.exercise!.id);
    const protectedTables = ["vocabulary_words", "vocabulary_learning_state", "vocabulary_scheduler_state", "vocabulary_reviews",
      "vocabulary_review_details", "vocabulary_review_audit", "vocabulary_review_context", "review_items", "vocabulary_word_context"];
    const rows = () => protectedTables.map((name) => db().prepare(`SELECT * FROM ${name}`).all());
    const protectedRows = rows();
    const at = new Date(now.getTime() + 1000);
    const auxiliary = checkpoint(scheduled.session!, scheduled.word, { exercise: scheduled.session!.state.current!.exercise,
      answer: "unrelated", confirmedTypo: true }, at);
    const auxiliaryInput = reviewInput(auxiliary, scheduled.word, { rating: "easy" });
    const completed = reviewVocabularyEntry(entry.id, auxiliaryInput, at)!;
    expect(completed.review).toMatchObject({ supplemental: true, userAnswer: "unrelated", correct: false, confirmedTypo: false,
      effectiveRating: "again", requestedRating: "easy", decisionReason: "incorrect_answer", termSnapshot: "economy", nextDueAt: scheduled.word.dueAt });
    expect(completed.word).toEqual(scheduled.word);
    expect(completed.session!.state).toMatchObject({ current: null, reviewed: 1, supplementalReviewed: 1, lastSubmissionId: auxiliaryInput.submissionId });
    expect(rows()).toEqual(protectedRows);
    expect(getVocabularySession(primaryInput.submissionId).submission).toEqual(scheduled.review);
    expect(getVocabularySession(auxiliaryInput.submissionId).submission).toEqual(completed.review);
    const before = db().serialize();
    expect(reviewVocabularyEntry(entry.id, auxiliaryInput, new Date(at.getTime() + 1000))!.review).toEqual(completed.review);
    expect(db().serialize()).toEqual(before);
    expect(() => reviewVocabularyEntry(entry.id, { ...auxiliaryInput, submissionId: randomUUID() }, at)).toThrow(VocabularySessionConflict);
  });

  it("retains the raw auxiliary typo and its standard after a later edit without a forgetting record", async () => {
    fixtureCourse(); const entry = word(); materializeVocabularyCatalogEntry(listVocabularyCatalogEntries()[0]);
    const selected = next(start("context")); const revealed = checkpoint(selected, entry, { exercise: selected.state.current!.exercise });
    const scheduled = reviewVocabularyEntry(entry.id, reviewInput(revealed, entry, { continueWithPractice: true }), now)!;
    const at = new Date(now.getTime() + 1000);
    const auxiliary = checkpoint(scheduled.session!, scheduled.word, { exercise: scheduled.session!.state.current!.exercise,
      answer: "econmy", confirmedTypo: true }, at);
    const input = reviewInput(auxiliary, scheduled.word, { rating: "easy" });
    const context = { params: Promise.resolve({ id: entry.id }) };
    const first = await POST(new Request("http://localhost/review", { method: "POST", body: JSON.stringify(input) }), context);
    expect(first.status).toBe(200); const result = await first.json();
    expect(result.review).toMatchObject({ supplemental: true, correct: false, confirmedTypo: true, decisionReason: "confirmed_typo", effectiveRating: "easy" });
    saveVocabularyEntry(vocabularyInputSchema.parse({ ...scheduled.word, term: "economic" }), entry.id);
    const retry = await POST(new Request("http://localhost/review", { method: "POST", body: JSON.stringify(input) }), context);
    expect(retry.status).toBe(200); expect((await retry.json()).review).toEqual(result.review);
    const recovered = await sessionGET(new Request(`http://localhost/session?submissionId=${input.submissionId}`));
    expect((await recovered.json()).submission).toEqual(result.review);
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 1 });
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_supplemental_attempts").get()).toEqual({ total: 1 });
    expect(db().prepare("SELECT COUNT(*) AS total FROM review_items").get()).toEqual({ total: 0 });
  });

  it("rejects forged auxiliary checkpoints and cannot ask for extra practice in another mode", () => {
    const entry = word(); const session = checkpoint(start(), entry);
    const before = db().serialize();
    for (const changes of [{ supplemental: true }, { canSupplement: true }]) {
      expect(() => changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision,
        state: { mode: session.state.mode, skippedIds: [], current: { ...session.state.current!, ...changes } } }, now)).toThrow("服务端");
      expect(db().serialize()).toEqual(before);
    }
    expect(() => reviewVocabularyEntry(entry.id, reviewInput(session, entry, { continueWithPractice: true }), now)).toThrow("另一道");
    expect(db().serialize()).toEqual(before);
  });

  it("defers an auxiliary card on a mode switch without a second FSRS grade", () => {
    fixtureCourse(); const entry = word(); materializeVocabularyCatalogEntry(listVocabularyCatalogEntries()[0]);
    const selected = next(start("context")); const revealed = checkpoint(selected, entry, { exercise: selected.state.current!.exercise });
    const scheduled = reviewVocabularyEntry(entry.id, reviewInput(revealed, entry, { continueWithPractice: true }), now)!;
    const state = scheduled.session!.state;
    expect(() => changeVocabularySession({ action: "checkpoint", id: scheduled.session!.id, expectedRevision: scheduled.session!.revision,
      state: { mode: "recall", current: null, skippedIds: [] } }, now)).toThrow("暂缓");
    const switched = changeVocabularySession({ action: "checkpoint", id: scheduled.session!.id, expectedRevision: scheduled.session!.revision,
      state: { mode: "recall", current: null, skippedIds: [...state.skippedIds, entry.id] } }, now).session!;
    expect(switched.state).toMatchObject({ reviewed: 1, supplementalReviewed: 0, current: null });
    expect(next(switched).state.current).toBeNull();
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_reviews").get()).toEqual({ total: 1 });
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_supplemental_attempts").get()).toEqual({ total: 0 });
    expect(listVocabularyEntries().find((item) => item.id === entry.id)).toEqual(scheduled.word);
  });

  it("rejects stale auxiliary exercises and rolls back a failed auxiliary ledger insert", () => {
    const catalog = catalogEntry(); fixtureCourse([catalog]); const entry = word(); materializeVocabularyCatalogEntry(catalog);
    const selected = next(start("context")); const revealed = checkpoint(selected, entry, { exercise: selected.state.current!.exercise });
    const scheduled = reviewVocabularyEntry(entry.id, reviewInput(revealed, entry, { continueWithPractice: true }), now)!;
    const auxiliary = checkpoint(scheduled.session!, scheduled.word, { exercise: scheduled.session!.state.current!.exercise });
    db().exec("CREATE TRIGGER fail_auxiliary BEFORE INSERT ON vocabulary_supplemental_attempts BEGIN SELECT RAISE(ABORT, 'auxiliary failure'); END;");
    const before = db().serialize(); const input = reviewInput(auxiliary, scheduled.word);
    expect(() => reviewVocabularyEntry(entry.id, input, now)).toThrow("auxiliary failure");
    expect(db().serialize()).toEqual(before);
    db().exec("DROP TRIGGER fail_auxiliary");
    const withdrawn = { ...catalog, exercises: catalog.exercises.map((exercise) => exercise.id === auxiliary.state.current!.exercise!.id
      ? { ...exercise, status: "draft" } : exercise) };
    db().prepare("UPDATE vocabulary_catalog_entries SET data_json=? WHERE id=?").run(JSON.stringify(withdrawn), catalog.id);
    const changed = db().serialize();
    expect(() => reviewVocabularyEntry(entry.id, input, now)).toThrow("题目已修改"); expect(db().serialize()).toEqual(changed);
    expect(getVocabularySession().session!.state).toMatchObject({ current: null, reviewed: 1, supplementalReviewed: 0 });
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_supplemental_attempts").get()).toEqual({ total: 0 });
  });

  it("selects the active session regardless of snapshot insertion order or newer ended timestamps", () => {
    const entry = word(); const active = checkpoint(start(), entry, { answer: "econmy" });
    const ended: VocabularySession = { ...active, id: randomUUID(), status: "ended", revision: 9,
      state: { ...active.state, current: null }, startedAt: "2031-01-01T00:00:00.000Z", updatedAt: "2031-01-01T00:00:00.000Z" };
    const insert = (session: VocabularySession) => db().prepare("INSERT INTO vocabulary_sessions(id,revision,status,state_json,started_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(session.id, session.revision, session.status, JSON.stringify(session.state), session.startedAt, session.updatedAt);
    insert(ended); expect(getVocabularySession().session).toEqual(active);
    db().prepare("DELETE FROM vocabulary_sessions").run(); insert(ended); insert(active);
    expect(readVocabularySession(db())).toEqual(active);
    expect(changeVocabularySession({ action: "checkpoint", id: active.id, expectedRevision: active.revision,
      state: { mode: active.state.mode, current: active.state.current, skippedIds: ["deferred"] } }, now).session!.id).toBe(active.id);
  });

  it("rematches a renamed word to its new catalog surface while preserving its schedule and old audit", () => {
    fixtureCourse([catalogEntry(), catalogEntry("growth", 2)]); const entry = word();
    materializeVocabularyCatalogEntry(listVocabularyCatalogEntries().find((item) => item.term === "economy")!);
    const selected = next(start("context")); const revealed = checkpoint(selected, entry, { exercise: selected.state.current!.exercise });
    const scheduled = reviewVocabularyEntry(entry.id, reviewInput(revealed, entry), now)!;
    const scheduler = db().prepare("SELECT * FROM vocabulary_scheduler_state").all();
    const pending = changeVocabularySession({ action: "checkpoint", id: scheduled.session!.id, expectedRevision: scheduled.session!.revision,
      state: { mode: "context", current: null, skippedIds: [] } }, now).session!;
    const due = new Date(scheduled.word.dueAt); const oldCard = next(pending, due);
    const renamed = saveVocabularyEntry(vocabularyInputSchema.parse({ ...scheduled.word, term: "GROWTH", notes: "personal note" }), entry.id, scheduled.word.reviewVersion)!.word;
    expect(renamed).toMatchObject({ id: entry.id, dueAt: scheduled.word.dueAt, repetitions: scheduled.word.repetitions,
      intervalDays: scheduled.word.intervalDays, reviewVersion: scheduled.word.reviewVersion + 1, notes: "personal note" });
    expect(db().prepare("SELECT * FROM vocabulary_scheduler_state").all()).toEqual(scheduler);
    expect(db().prepare("SELECT entry_id,word_id,detached FROM vocabulary_catalog_links ORDER BY entry_id").all()).toEqual([
      { entry_id: "fixture:economy", word_id: entry.id, detached: 1 }, { entry_id: "fixture:growth", word_id: entry.id, detached: 0 },
    ]);
    expect(db().prepare("SELECT COUNT(*) AS total FROM vocabulary_word_context WHERE word_id=?").get(entry.id)).toEqual({ total: 0 });
    expect(getVocabularySession().session).toMatchObject({ revision: oldCard.revision + 2, state: { current: null, reviewed: 1 } });
    expect(vocabularyExerciseForWord(renamed, "fixture-course")).toMatchObject({ entryId: "fixture:growth", targetSurface: "growth" });
    expect(getVocabularySession(scheduled.review.submissionId).submission!.termSnapshot).toBe("economy");
    expect(listVocabularyEntries()).toHaveLength(1);
  });

  it("never merges personal schedules on normalized duplicate edits or steals an attached catalog link", () => {
    fixtureCourse([catalogEntry(), catalogEntry("growth", 2)]); const entry = word(); const other = word(true, "growth");
    materializeVocabularyCatalogEntry(listVocabularyCatalogEntries().find((item) => item.term === "economy")!);
    materializeVocabularyCatalogEntry(listVocabularyCatalogEntries().find((item) => item.term === "growth")!);
    const before = db().serialize();
    expect(() => saveVocabularyEntry(vocabularyInputSchema.parse({ ...entry, term: " GROWTH " }), entry.id)).toThrow("DUPLICATE_WORD");
    expect(db().serialize()).toEqual(before);
    // Even inconsistent imported linkage cannot transfer another word's ownership.
    db().prepare("UPDATE vocabulary_words SET term='another' WHERE id=?").run(other.id);
    const renamed = saveVocabularyEntry(vocabularyInputSchema.parse({ ...entry, term: "growth" }), entry.id)!.word;
    expect(renamed.id).toBe(entry.id);
    expect(db().prepare("SELECT word_id,detached FROM vocabulary_catalog_links WHERE entry_id='fixture:growth'").get()).toEqual({ word_id: other.id, detached: 0 });
    expect(listVocabularyEntries().find((item) => item.id === other.id)!.dueAt).toBe(other.dueAt);
    expect(listVocabularyEntries()).toHaveLength(2);
  });

  it("detects duplicate personal surfaces using the answer normalization rather than SQLite casing only", () => {
    const entry = word(); const other = word(true, "can't wait"); const before = db().serialize();
    expect(() => saveVocabularyEntry(vocabularyInputSchema.parse({ ...entry, term: "Can’t   wait" }), entry.id)).toThrow("DUPLICATE_WORD");
    expect(db().serialize()).toEqual(before);
    expect(saveVocabularyEntry(vocabularyInputSchema.parse({ term: "CAN'T    WAIT" }))!.word.id).toBe(other.id);
    expect(listVocabularyEntries()).toHaveLength(2);
  });
});
