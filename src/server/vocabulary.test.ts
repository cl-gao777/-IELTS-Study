import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { vocabularyInputSchema, type VocabularyEntry, type VocabularyReviewMode } from "../lib/vocabulary";
import type { VocabularyCardDraft, VocabularySession } from "../lib/vocabulary-session";
import { ensureVocabularyTables, learnVocabularyEntry, listVocabularyEntries, previewVocabularyReview, reviewVocabularyEntry, saveVocabularyEntry, VocabularyReviewConflict, type VocabularyReviewInput } from "./vocabulary";
import { changeVocabularySession, getVocabularySession } from "./vocabulary-session";
import { refreshVocabularySessionRevisions, VocabularySessionConflict } from "./vocabulary-session-store";
import { GET, POST } from "../app/api/vocabulary/[id]/review/route";
import { GET as sessionGET, PUT as sessionPUT } from "../app/api/vocabulary/session/route";

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
      gaveUp: false, confirmedTypo: false, audioPlayed: true, startedAt: at.toISOString(), ...changes },
  } }, at).session!;
}
function reviewInput(session: VocabularySession, entry: VocabularyEntry, changes: Partial<VocabularyReviewInput> = {}): VocabularyReviewInput {
  return { rating: "good", mode: session.state.mode, userAnswer: session.state.current?.answer ?? "", durationSeconds: 10,
    expectedVersion: entry.reviewVersion, sessionId: session.id, expectedSessionRevision: session.revision, submissionId: randomUUID(),
    gaveUp: session.state.current?.gaveUp ?? false, confirmedTypo: session.state.current?.confirmedTypo ?? false, ...changes };
}

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
});
