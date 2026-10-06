import "server-only";

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { VocabularyWord } from "@/lib/domain";
import type { ReviewRating } from "@/lib/srs";
import { isVocabularyTypoCandidate, normaliseVocabularyAnswer, vocabularyInputSchema, type VocabularyEntry, type VocabularyInput, type VocabularyMetadata, type VocabularyReviewMode } from "@/lib/vocabulary";
import type { VocabularyDecisionReason, VocabularyReviewRecord } from "@/lib/vocabulary-session";
import { vocabularyRecallCue } from "@/lib/vocabulary-practice";
import { parseSchedulerState, vocabularyRetention, vocabularyScheduler, type ReviewHistoryEntry, type VocabularyReviewPreview } from "@/lib/vocabulary-scheduler";
import { getDatabase } from "./db";
import { listVocabulary } from "./store";
import { ensureVocabularySessionTables, readVocabularySession, requireVocabularySession, VocabularySessionConflict, writeVocabularySession } from "./vocabulary-session-store";

export function ensureVocabularyTables(database: Database.Database = getDatabase()) {
  ensureVocabularySessionTables(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary_metadata (
      word_id TEXT PRIMARY KEY REFERENCES vocabulary_words(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS vocabulary_scheduler_state (
      word_id TEXT PRIMARY KEY REFERENCES vocabulary_words(id) ON DELETE CASCADE,
      algorithm TEXT NOT NULL DEFAULT 'fsrs',
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vocabulary_review_details (
      review_id INTEGER PRIMARY KEY REFERENCES vocabulary_reviews(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      user_answer TEXT NOT NULL DEFAULT '',
      correct INTEGER,
      duration_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vocabulary_learning_state (
      word_id TEXT PRIMARY KEY REFERENCES vocabulary_words(id) ON DELETE CASCADE,
      review_version INTEGER NOT NULL DEFAULT 1, learning_started_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vocabulary_review_audit (
      review_id INTEGER PRIMARY KEY REFERENCES vocabulary_reviews(id) ON DELETE CASCADE,
      submission_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES vocabulary_sessions(id),
      word_version INTEGER NOT NULL, requested_rating TEXT NOT NULL, effective_rating TEXT NOT NULL,
      decision_reason TEXT NOT NULL, term_snapshot TEXT NOT NULL,
      confirmed_typo INTEGER NOT NULL DEFAULT 0, gave_up INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Only annotate legacy cards; never replay history or move their due dates at startup.
  database.prepare(`INSERT OR IGNORE INTO vocabulary_learning_state (word_id, review_version, learning_started_at)
    SELECT w.id, 1, CASE WHEN EXISTS (SELECT 1 FROM vocabulary_reviews r WHERE r.word_id = w.id)
      THEN (SELECT MIN(reviewed_at) FROM vocabulary_reviews r WHERE r.word_id = w.id)
      WHEN w.repetitions > 0 THEN w.created_at ELSE NULL END FROM vocabulary_words w`).run();
}

function metadata(input: VocabularyInput): VocabularyMetadata {
  return {
    lemma: input.lemma || input.term.toLocaleLowerCase("en"), ipa: input.ipa,
    sourceSentence: input.sourceSentence, sourceMaterial: input.sourceMaterial,
    collocations: input.collocations, synonyms: input.synonyms, antonyms: input.antonyms,
    wordFamily: input.wordFamily, notes: input.notes,
  };
}

function mergeMetadata(word: VocabularyWord, data?: string): VocabularyEntry {
  let saved: Partial<VocabularyMetadata> = {};
  try { saved = data ? JSON.parse(data) : {}; } catch { /* A damaged optional metadata row must not hide the card. */ }
  const safe = vocabularyInputSchema.safeParse({ ...word, ...saved });
  const parsed = safe.success ? safe.data : vocabularyInputSchema.parse(word);
  const database = getDatabase();
  const history = database.prepare("SELECT MIN(reviewed_at) AS first_at, COUNT(*) AS total FROM vocabulary_reviews WHERE word_id = ?").get(word.id) as { first_at: string | null; total: number };
  const learning = hasTable(database, "vocabulary_learning_state")
    ? database.prepare("SELECT review_version, learning_started_at FROM vocabulary_learning_state WHERE word_id = ?").get(word.id) as { review_version: number; learning_started_at: string | null } | undefined : undefined;
  const created = word.repetitions > 0 ? database.prepare("SELECT created_at FROM vocabulary_words WHERE id = ?").get(word.id) as { created_at: string } : undefined;
  return { ...word, ...metadata(parsed), scheduler: "fsrs", reviewVersion: learning?.review_version ?? 1,
    learningStartedAt: learning?.learning_started_at ?? history.first_at ?? created?.created_at ?? null,
    hasReviewHistory: history.total > 0 };
}

export function listVocabularyEntries(query = ""): VocabularyEntry[] {
  const database = getDatabase();
  ensureVocabularyTables(database);
  const rows = database.prepare("SELECT word_id, data_json FROM vocabulary_metadata").all() as Array<{ word_id: string; data_json: string }>;
  const extra = new Map(rows.map((row) => [row.word_id, row.data_json]));
  const words = listVocabulary().map((word) => mergeMetadata(word, extra.get(word.id)));
  const search = query.trim().toLocaleLowerCase("en");
  return search ? words.filter((word) => [word.term, word.lemma, word.meaningZh, word.definitionEn, ...word.tags].join(" ").toLocaleLowerCase("en").includes(search)) : words;
}

export function saveVocabularyEntry(input: VocabularyInput, editingId?: string, expectedVersion?: number) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    const duplicate = database.prepare("SELECT id FROM vocabulary_words WHERE lower(trim(term)) = lower(trim(?))").get(input.term) as { id: string } | undefined;
    if (duplicate && editingId && duplicate.id !== editingId) throw new Error("DUPLICATE_WORD");
    if (duplicate && !editingId) return { word: listVocabularyEntries().find((word) => word.id === duplicate.id)!, existing: true };
    if (editingId && !database.prepare("SELECT id FROM vocabulary_words WHERE id = ?").get(editingId)) return null;
    if (editingId && expectedVersion !== undefined) {
      const current = listVocabularyEntries().find((word) => word.id === editingId)!;
      if (current.reviewVersion !== expectedVersion) throw new VocabularyReviewConflict(current);
    }
    const id = editingId ?? randomUUID();
    const now = new Date().toISOString();
    const values = [input.term, input.pronunciation, input.partOfSpeech, input.meaningZh, input.definitionEn, input.example, JSON.stringify(input.tags)];
    if (editingId) {
      database.prepare(`UPDATE vocabulary_words SET term = ?, pronunciation = ?, part_of_speech = ?, meaning_zh = ?, definition_en = ?, example = ?, tags_json = ?, updated_at = ? WHERE id = ?`).run(...values, now, id);
      database.prepare("UPDATE vocabulary_learning_state SET review_version = review_version + 1 WHERE word_id = ?").run(id);
    } else {
      database.prepare(`INSERT INTO vocabulary_words (id, term, pronunciation, part_of_speech, meaning_zh, definition_en, example, tags_json, repetitions, interval_days, ease_factor, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 2.5, ?, ?, ?)`).run(id, ...values, now, now, now);
    }
    database.prepare(`INSERT INTO vocabulary_metadata (word_id, data_json) VALUES (?, ?) ON CONFLICT(word_id) DO UPDATE SET data_json = excluded.data_json`).run(id, JSON.stringify(metadata(input)));
    return { word: listVocabularyEntries().find((word) => word.id === id)!, existing: false };
  })();
}

function hasTable(database: Database.Database, name: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** Reading a legacy card must not migrate its due date or create scheduler rows. */
function readVocabularyReviewContext(database: Database.Database, id: string, now: Date) {
  const base = listVocabulary().find((item) => item.id === id);
  if (!base) return null;
  const extra = hasTable(database, "vocabulary_metadata")
    ? database.prepare("SELECT data_json FROM vocabulary_metadata WHERE word_id = ?").get(id) as { data_json: string } | undefined
    : undefined;
  const word = mergeMetadata(base, extra?.data_json);
  const previous = hasTable(database, "vocabulary_scheduler_state")
    ? database.prepare("SELECT algorithm, state_json FROM vocabulary_scheduler_state WHERE word_id = ?").get(id) as { algorithm: string; state_json: string } | undefined
    : undefined;
  const history = database.prepare("SELECT rating, reviewed_at AS reviewedAt FROM vocabulary_reviews WHERE word_id = ? ORDER BY reviewed_at, id").all(id) as ReviewHistoryEntry[];
  let state;
  try { state = previous?.algorithm === "fsrs" ? parseSchedulerState(previous.state_json) : vocabularyScheduler.migrate(history, now); }
  catch { state = vocabularyScheduler.migrate(history, now); }
  return { word, state };
}

export function previewVocabularyReview(id: string, now = new Date()): VocabularyReviewPreview | null {
  const context = readVocabularyReviewContext(getDatabase(), id, now);
  if (!context) return null;
  return {
    scheduler: "fsrs",
    retention: vocabularyRetention,
    generatedAt: now.toISOString(),
    currentDueAt: context.word.dueAt,
    wordVersion: context.word.reviewVersion,
    ratings: vocabularyScheduler.preview(context.state, now),
  };
}

export class VocabularyReviewConflict extends Error {
  constructor(readonly word: VocabularyEntry) {
    super("这张词卡已更新，请按最新到期时间继续复习。");
    this.name = "VocabularyReviewConflict";
  }
}

export interface VocabularyReviewInput {
  rating: ReviewRating; mode: VocabularyReviewMode; userAnswer: string; durationSeconds: number;
  expectedVersion: number; sessionId: string; expectedSessionRevision: number; submissionId: string;
  confirmedTypo: boolean; gaveUp: boolean;
}

export function readVocabularyReviewSubmission(submissionId: string, database = getDatabase()): VocabularyReviewRecord | null {
  const row = database.prepare(`SELECT a.*, r.word_id, r.reviewed_at, r.next_due_at,
    d.mode, d.user_answer, d.correct FROM vocabulary_review_audit a
    JOIN vocabulary_reviews r ON r.id = a.review_id JOIN vocabulary_review_details d ON d.review_id = r.id
    WHERE a.submission_id = ?`).get(submissionId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return { id: Number(row.review_id), submissionId: String(row.submission_id), sessionId: String(row.session_id),
    wordId: String(row.word_id), wordVersion: Number(row.word_version), mode: row.mode as VocabularyReviewMode,
    userAnswer: String(row.user_answer), correct: row.correct === null ? null : Boolean(row.correct), termSnapshot: String(row.term_snapshot),
    requestedRating: row.requested_rating as ReviewRating, effectiveRating: row.effective_rating as ReviewRating,
    decisionReason: row.decision_reason as VocabularyDecisionReason, confirmedTypo: Boolean(row.confirmed_typo),
    gaveUp: Boolean(row.gave_up), reviewedAt: String(row.reviewed_at), nextDueAt: String(row.next_due_at) };
}

export function learnVocabularyEntry(id: string, input: { expectedVersion: number; sessionId: string; expectedSessionRevision: number }, now = new Date()) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    const word = listVocabularyEntries().find((item) => item.id === id);
    if (!word) return null;
    // A lost introduction response can be retried after its session revision changed.
    if (word.learningStartedAt || word.hasReviewHistory || word.repetitions > 0) return { word, session: readVocabularySession(database) };
    if (input.expectedVersion !== word.reviewVersion) throw new VocabularyReviewConflict(word);
    const session = requireVocabularySession(database, input.sessionId, input.expectedSessionRevision);
    if (session.state.current?.wordId !== id || session.state.current.wordVersion !== word.reviewVersion || session.state.current.phase !== "learn") throw new VocabularySessionConflict("词卡已切换，请刷新本轮练习。");
    if (!vocabularyRecallCue(word).title) throw new VocabularySessionConflict("请先补充可用释义，再开始学习这个新词。");
    const dueAt = new Date(now.getTime() + 60_000).toISOString();
    database.prepare("UPDATE vocabulary_words SET due_at = ?, interval_days = 0, updated_at = ? WHERE id = ?").run(dueAt, now.toISOString(), id);
    database.prepare("UPDATE vocabulary_learning_state SET review_version = review_version + 1, learning_started_at = ? WHERE word_id = ?").run(now.toISOString(), id);
    const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state, current: null, learned: session.state.learned + 1 } }, now);
    return { word: { ...word, dueAt, intervalDays: 0, learningStartedAt: now.toISOString(), reviewVersion: word.reviewVersion + 1 }, session: updatedSession };
  })();
}

export function reviewVocabularyEntry(id: string, input: VocabularyReviewInput, now = new Date()) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    // Idempotency precedes every version/session check: a lost response is not a second answer.
    const prior = readVocabularyReviewSubmission(input.submissionId, database);
    if (prior) {
      if (prior.wordId !== id || prior.sessionId !== input.sessionId) throw new VocabularySessionConflict("提交编号已用于另一条复习记录，请刷新页面。");
      return { word: listVocabularyEntries().find((item) => item.id === id)!, session: readVocabularySession(database), review: prior };
    }
    const context = readVocabularyReviewContext(database, id, now);
    if (!context) return null;
    const { word, state } = context;
    if (input.expectedVersion !== word.reviewVersion) throw new VocabularyReviewConflict(word);
    const session = requireVocabularySession(database, input.sessionId, input.expectedSessionRevision);
    const draft = session.state.current;
    if (!draft || draft.wordId !== id || draft.wordVersion !== word.reviewVersion || draft.phase !== "revealed" || session.state.mode !== input.mode
      || draft.answer !== input.userAnswer || draft.gaveUp !== input.gaveUp || draft.confirmedTypo !== input.confirmedTypo) throw new VocabularySessionConflict("作答草稿已变化，请按最新卡片核对后再评分。");
    if (input.mode === "spelling" && !draft.audioPlayed) throw new VocabularySessionConflict("尚未成功播放本词发音，请先完成听音或暂缓此词。");
    if (!word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0) throw new VocabularySessionConflict("这个新词需要先学习，再进行回忆。");
    if (Date.parse(word.dueAt) > now.getTime()) throw new VocabularySessionConflict("这个词尚未到期，请按最新队列继续。");
    const correct = input.mode === "recognition" ? null
      : Boolean(input.userAnswer.trim()) && normaliseVocabularyAnswer(input.userAnswer) === normaliseVocabularyAnswer(word.term);
    const confirmedTypo = input.confirmedTypo && !input.gaveUp && correct === false && isVocabularyTypoCandidate(input.userAnswer, word.term);
    const decisionReason: VocabularyDecisionReason = input.gaveUp ? "gave_up" : confirmedTypo ? "confirmed_typo"
      : correct === false ? "incorrect_answer" : correct === null ? "self_assessed" : "correct_answer";
    const rating = input.gaveUp || (correct === false && !confirmedTypo) ? "again" : input.rating;
    const scheduled = vocabularyScheduler.schedule(state, rating, now);
    const nextDue = scheduled.due.toISOString();
    database.prepare("UPDATE vocabulary_words SET repetitions = ?, interval_days = ?, due_at = ?, updated_at = ? WHERE id = ?").run(scheduled.reps, scheduled.scheduled_days, nextDue, now.toISOString(), id);
    database.prepare("UPDATE vocabulary_learning_state SET review_version = review_version + 1 WHERE word_id = ?").run(id);
    const review = database.prepare("INSERT INTO vocabulary_reviews (word_id, rating, previous_due_at, next_due_at, reviewed_at) VALUES (?, ?, ?, ?, ?)").run(id, rating, word.dueAt, nextDue, now.toISOString());
    database.prepare("INSERT INTO vocabulary_review_details (review_id, mode, user_answer, correct, duration_seconds) VALUES (?, ?, ?, ?, ?)").run(review.lastInsertRowid, input.mode, input.userAnswer, correct === null ? null : Number(correct), input.durationSeconds);
    database.prepare(`INSERT INTO vocabulary_review_audit (review_id, submission_id, session_id, word_version, requested_rating, effective_rating, decision_reason, term_snapshot, confirmed_typo, gave_up)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(review.lastInsertRowid, input.submissionId, input.sessionId, word.reviewVersion, input.rating, rating, decisionReason, word.term, Number(confirmedTypo), Number(input.gaveUp));
    database.prepare(`INSERT INTO vocabulary_scheduler_state (word_id, algorithm, state_json, updated_at) VALUES (?, 'fsrs', ?, ?) ON CONFLICT(word_id) DO UPDATE SET algorithm = excluded.algorithm, state_json = excluded.state_json, updated_at = excluded.updated_at`).run(id, JSON.stringify(scheduled), now.toISOString());
    if (rating === "again" && !confirmedTypo) {
      const existing = database.prepare("SELECT id FROM review_items WHERE source_type = 'vocabulary' AND source_id = ? AND resolved = 0").get(id) as { id: number } | undefined;
      const prompt = `${word.term} · ${input.mode}${input.userAnswer ? ` · 你的答案：${input.userAnswer}` : ""}`;
      const answer = `${word.term} — ${word.meaningZh || word.definitionEn || "待补充释义"}${word.sourceSentence ? `\n${word.sourceSentence}` : ""}`;
      if (existing) database.prepare("UPDATE review_items SET mistake_count = mistake_count + 1, prompt = ?, answer = ?, reviewed_at = ? WHERE id = ?").run(prompt, answer, now.toISOString(), existing.id);
      else database.prepare("INSERT INTO review_items (source_type, source_id, skill, prompt, answer, resolved, created_at, category) VALUES ('vocabulary', ?, 'vocabulary', ?, ?, 0, ?, ?)").run(id, prompt, answer, now.toISOString(), input.mode === "spelling" ? "Spelling" : "Vocabulary");
    }
    const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state, current: null, reviewed: session.state.reviewed + 1, lastSubmissionId: input.submissionId } }, now);
    return { word: { ...word, repetitions: scheduled.reps, intervalDays: scheduled.scheduled_days, dueAt: nextDue, reviewVersion: word.reviewVersion + 1, hasReviewHistory: true },
      session: updatedSession, review: readVocabularyReviewSubmission(input.submissionId, database)! };
  })();
}
