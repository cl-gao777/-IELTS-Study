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
import { ensureVocabularyCourseTables, isVocabularyExerciseCurrent, rememberVocabularyExercise, rematchVocabularyCatalogWord, supplementalVocabularyExerciseForWord, loadPrivateVocabularyCatalog } from "./vocabulary-courses";
import { getVocabularyStudy, requireVocabularyStudyVersion } from "./vocabulary-courses";
import { isVocabularyTargetCardCurrent, isVocabularyTermPaused, readVocabularyTargetState, recordVocabularyTargetOperation, advanceVocabularyConsolidation, hasActiveVocabularyConsolidation } from "./vocabulary-targets";
import { vocabularyTargetLearnOperationSchema, type VocabularyCardPurpose } from "@/lib/vocabulary-target";
import { vocabularyExerciseSnapshotSchema, type VocabularyRatingSource } from "@/lib/vocabulary-course";

export function ensureVocabularyTables(database: Database.Database = getDatabase()) {
  ensureVocabularySessionTables(database);
  ensureVocabularyCourseTables(database);
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
    CREATE TABLE IF NOT EXISTS vocabulary_supplemental_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL REFERENCES vocabulary_sessions(id), word_id TEXT NOT NULL REFERENCES vocabulary_words(id),
      word_version INTEGER NOT NULL, mode TEXT NOT NULL, user_answer TEXT NOT NULL, correct INTEGER NOT NULL,
      term_snapshot TEXT NOT NULL, requested_rating TEXT NOT NULL, effective_rating TEXT NOT NULL,
      decision_reason TEXT NOT NULL, confirmed_typo INTEGER NOT NULL DEFAULT 0, gave_up INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0, reviewed_at TEXT NOT NULL, next_due_at TEXT NOT NULL,
      rating_source TEXT NOT NULL, exercise_json TEXT NOT NULL, course_id TEXT
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

type VocabularyHistory = { first_at: string | null; total: number };
type VocabularyLearning = { review_version: number; learning_started_at: string | null };
function mergeMetadata(word: VocabularyWord, data?: string, loaded?: { history: VocabularyHistory; learning?: VocabularyLearning; createdAt?: string }): VocabularyEntry {
  let saved: Partial<VocabularyMetadata> = {};
  try { saved = data ? JSON.parse(data) : {}; } catch { /* A damaged optional metadata row must not hide the card. */ }
  const safe = vocabularyInputSchema.safeParse({ ...word, ...saved });
  const parsed = safe.success ? safe.data : vocabularyInputSchema.parse(word);
  const database = getDatabase();
  const history = loaded?.history ?? database.prepare("SELECT MIN(reviewed_at) AS first_at, COUNT(*) AS total FROM vocabulary_reviews WHERE word_id = ?").get(word.id) as VocabularyHistory;
  const learning = loaded ? loaded.learning : hasTable(database, "vocabulary_learning_state")
    ? database.prepare("SELECT review_version, learning_started_at FROM vocabulary_learning_state WHERE word_id = ?").get(word.id) as { review_version: number; learning_started_at: string | null } | undefined : undefined;
  const createdAt = loaded ? loaded.createdAt : word.repetitions > 0 ? (database.prepare("SELECT created_at FROM vocabulary_words WHERE id = ?").get(word.id) as { created_at: string }).created_at : undefined;
  return { ...word, ...metadata(parsed), scheduler: "fsrs", reviewVersion: learning?.review_version ?? 1,
    learningStartedAt: learning?.learning_started_at ?? history.first_at ?? createdAt ?? null,
    hasReviewHistory: history.total > 0 };
}

export function listVocabularyEntries(query = ""): VocabularyEntry[] {
  const database = getDatabase();
  ensureVocabularyTables(database);
  const rows = database.prepare("SELECT word_id, data_json FROM vocabulary_metadata").all() as Array<{ word_id: string; data_json: string }>;
  const extra = new Map(rows.map((row) => [row.word_id, row.data_json]));
  const histories = new Map((database.prepare("SELECT word_id,MIN(reviewed_at) AS first_at,COUNT(*) AS total FROM vocabulary_reviews GROUP BY word_id").all() as (VocabularyHistory & {word_id:string})[]).map(row=>[row.word_id,row]));
  const learning = new Map((database.prepare("SELECT word_id,review_version,learning_started_at FROM vocabulary_learning_state").all() as (VocabularyLearning & {word_id:string})[]).map(row=>[row.word_id,row]));
  const created = new Map((database.prepare("SELECT id,created_at FROM vocabulary_words WHERE repetitions>0").all() as {id:string;created_at:string}[]).map(row=>[row.id,row.created_at]));
  const words = listVocabulary().map((word) => mergeMetadata(word, extra.get(word.id), {
    history: histories.get(word.id) ?? {first_at:null,total:0}, learning:learning.get(word.id), createdAt:created.get(word.id),
  }));
  const search = query.trim().toLocaleLowerCase("en");
  return search ? words.filter((word) => [word.term, word.lemma, word.meaningZh, word.definitionEn, ...word.tags].join(" ").toLocaleLowerCase("en").includes(search)) : words;
}

export function saveVocabularyEntry(input: VocabularyInput, editingId?: string, expectedVersion?: number) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    const duplicate = (database.prepare("SELECT id,term FROM vocabulary_words").all() as { id: string; term: string }[])
      .find((word) => normaliseVocabularyAnswer(word.term) === normaliseVocabularyAnswer(input.term));
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
      const before = database.prepare("SELECT term FROM vocabulary_words WHERE id=?").get(id) as { term: string };
      if (normaliseVocabularyAnswer(before.term) !== normaliseVocabularyAnswer(input.term)) {
        rematchVocabularyCatalogWord(id, input.term, database);
      }
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

export function previewVocabularyReview(id: string, now = new Date(), binding?: VocabularyTargetReviewBinding & { sessionId?: string; expectedSessionRevision?: number }): VocabularyReviewPreview | null {
  const database = getDatabase();
  if (hasTable(database, "vocabulary_sessions")) loadPrivateVocabularyCatalog(database);
  const context = readVocabularyReviewContext(database, id, now);
  if (!context) return null;
  if (hasTable(database, "vocabulary_target_state")) {
    if (isVocabularyTermPaused(context.word.term, database)) throw new VocabularySessionConflict("这个词已暂停，请同步当前队列。");
    const session = hasTable(database, "vocabulary_sessions") ? readVocabularySession(database) : null;
    const card = session?.state.current?.wordId === id ? session.state.current : null;
    if (getVocabularyStudy(now, database).focus === "ielts-advanced" && !card?.target) throw new VocabularySessionConflict("请由进阶队列选择已审核用法后继续。");
    if (card?.target) {
      if (session!.status !== "active" || session!.id !== binding?.sessionId || session!.revision !== binding?.expectedSessionRevision || !isVocabularyTargetCardCurrent(card, context.word, database))
        throw new VocabularySessionConflict("用法或练习状态已变化，请同步后继续。");
      assertVocabularyTargetReviewBinding(card, binding);
      if (card.supplemental || card.phase === "learn") throw new VocabularySessionConflict("这张卡不进行正式复习评分。");
    }
  }
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
  ratingSource?: VocabularyRatingSource;
  continueWithPractice?: boolean;
  targetId?: string; targetVersion?: number; expectedStateVersion?: number; purpose?: VocabularyCardPurpose;
  restoreVersion?: number; policyVersion?: number; exerciseId?: string; exerciseVersion?: number; membershipVersion?: number;
}
type VocabularyTargetReviewBinding = Pick<VocabularyReviewInput, "targetId" | "targetVersion" | "expectedStateVersion" | "purpose" | "restoreVersion" | "policyVersion" | "exerciseId" | "exerciseVersion" | "membershipVersion">;
function assertVocabularyTargetReviewBinding(card: NonNullable<NonNullable<ReturnType<typeof readVocabularySession>>["state"]["current"]>, input?: VocabularyTargetReviewBinding) {
  if (!card.target) return;
  if (!input || input.targetId !== card.target.id || input.targetVersion !== card.target.version || input.expectedStateVersion !== card.targetStateVersion
    || input.purpose !== card.purpose || input.restoreVersion !== card.restoreVersion || input.policyVersion !== card.policyVersion
    || input.exerciseId !== card.exercise?.id || input.exerciseVersion !== card.exercise?.version || input.membershipVersion !== card.target.membershipVersion)
    throw new VocabularySessionConflict("练习协议或用法版本已更新，请刷新后按原题继续。");
}

export function readVocabularyReviewSubmission(submissionId: string, database = getDatabase()): VocabularyReviewRecord | null {
  const row = database.prepare(`SELECT a.*, r.word_id, r.reviewed_at, r.next_due_at,
    d.mode, d.user_answer, d.correct, c.rating_source, c.exercise_json, c.course_id FROM vocabulary_review_audit a
    JOIN vocabulary_reviews r ON r.id = a.review_id JOIN vocabulary_review_details d ON d.review_id = r.id
    LEFT JOIN vocabulary_review_context c ON c.review_id=r.id
    WHERE a.submission_id = ?`).get(submissionId) as Record<string, string | number | null> | undefined;
  if (!row) return readVocabularySupplementalSubmission(submissionId, database);
  return { id: Number(row.review_id), submissionId: String(row.submission_id), sessionId: String(row.session_id),
    wordId: String(row.word_id), wordVersion: Number(row.word_version), mode: row.mode as VocabularyReviewMode,
    userAnswer: String(row.user_answer), correct: row.correct === null ? null : Boolean(row.correct), termSnapshot: String(row.term_snapshot),
    requestedRating: row.requested_rating as ReviewRating, effectiveRating: row.effective_rating as ReviewRating,
    decisionReason: row.decision_reason as VocabularyDecisionReason, confirmedTypo: Boolean(row.confirmed_typo),
    gaveUp: Boolean(row.gave_up), reviewedAt: String(row.reviewed_at), nextDueAt: String(row.next_due_at),
    ratingSource: row.rating_source as VocabularyRatingSource | null,
    exercise: row.exercise_json && row.exercise_json !== "{}" ? vocabularyExerciseSnapshotSchema.parse(JSON.parse(String(row.exercise_json))) : null,
    courseId: row.course_id === null ? null : String(row.course_id), supplemental: false };
}

function readVocabularySupplementalSubmission(submissionId: string, database: Database.Database): VocabularyReviewRecord | null {
  if (!hasTable(database, "vocabulary_supplemental_attempts")) return null;
  const row = database.prepare("SELECT * FROM vocabulary_supplemental_attempts WHERE submission_id=?").get(submissionId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return { id: Number(row.id), submissionId: String(row.submission_id), sessionId: String(row.session_id),
    wordId: String(row.word_id), wordVersion: Number(row.word_version), mode: row.mode as VocabularyReviewMode,
    userAnswer: String(row.user_answer), correct: Boolean(row.correct), termSnapshot: String(row.term_snapshot),
    requestedRating: row.requested_rating as ReviewRating, effectiveRating: row.effective_rating as ReviewRating,
    decisionReason: row.decision_reason as VocabularyDecisionReason, confirmedTypo: Boolean(row.confirmed_typo), gaveUp: Boolean(row.gave_up),
    reviewedAt: String(row.reviewed_at), nextDueAt: String(row.next_due_at), ratingSource: row.rating_source as VocabularyRatingSource,
    exercise: vocabularyExerciseSnapshotSchema.parse(JSON.parse(String(row.exercise_json))),
    courseId: row.course_id === null ? null : String(row.course_id), supplemental: true };
}

export function learnVocabularyEntry(id: string, input: { expectedVersion: number; sessionId: string; expectedSessionRevision: number; operationId?: string; restoreVersion?: number; targetId?: string; targetVersion?: number; expectedStateVersion?: number }, now = new Date()) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  loadPrivateVocabularyCatalog(database);
  return database.transaction(() => {
    const word = listVocabularyEntries().find((item) => item.id === id);
    if (!word) return null;
    if (!input.operationId && readVocabularySession(database)?.state.current?.target) throw new VocabularySessionConflict("用法学习协议已更新，请刷新后重试。");
    if (input.operationId) {
      const operation = vocabularyTargetLearnOperationSchema.parse({ ...input, wordId: id });
      requireVocabularyStudyVersion(operation.restoreVersion, now, database);
      if (!recordVocabularyTargetOperation(operation.operationId, "introduce-target", operation, now, database)) return { word, session: readVocabularySession(database) };
    }
    // A lost introduction response can be retried after its session revision changed.
    if (!input.operationId && (word.learningStartedAt || word.hasReviewHistory || word.repetitions > 0)) return { word, session: readVocabularySession(database) };
    if (input.expectedVersion !== word.reviewVersion) throw new VocabularyReviewConflict(word);
    const session = requireVocabularySession(database, input.sessionId, input.expectedSessionRevision);
    if (session.state.current?.wordId !== id || session.state.current.wordVersion !== word.reviewVersion || session.state.current.phase !== "learn") throw new VocabularySessionConflict("词卡已切换，请刷新本轮练习。");
    const card = session.state.current;
    if (!isVocabularyTargetCardCurrent(card, word, database)) throw new VocabularySessionConflict("用法或暂停状态已变化，请同步后继续。");
    if (card.target) {
      if (!input.operationId || input.targetId !== card.target.id || input.targetVersion !== card.target.version || input.expectedStateVersion !== card.targetStateVersion)
        throw new VocabularySessionConflict("用法学习协议已更新，请刷新后重试。");
      const state = readVocabularyTargetState(card.target.id, card.target.normalizedTerm, database);
      if (state.introducedAt || state.version !== card.targetStateVersion) throw new VocabularySessionConflict("这个用法已在其他页面学习，请同步。");
      const auxiliary = card.purpose === "learn-target";
      if (auxiliary && hasActiveVocabularyConsolidation(id, database))
        throw new VocabularySessionConflict("请先完成这个词当前用法的巩固。");
      database.prepare(`INSERT INTO vocabulary_target_state(target_id,word_id,normalized_term,version,paused,introduced_at,step,due_at,updated_at) VALUES(?,?,?,1,0,?,?,?,?)
        ON CONFLICT(target_id) DO UPDATE SET word_id=excluded.word_id,introduced_at=excluded.introduced_at,step=excluded.step,due_at=excluded.due_at,version=version+1,updated_at=excluded.updated_at`)
        .run(card.target.id, id, card.target.normalizedTerm, now.toISOString(), auxiliary ? 1 : 0, auxiliary ? new Date(now.getTime() + 60_000).toISOString() : null, now.toISOString());
      if (card.target.level === "B2" || card.target.level === "C1") database.prepare("UPDATE vocabulary_study_preferences SET next_level=? WHERE id=1").run(card.target.level === "B2" ? "C1" : "B2");
      if (auxiliary) {
        rememberVocabularyExercise(id, card.exercise, database);
        const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state, current: null, learned: session.state.learned + 1 } }, now);
        return { word, session: updatedSession };
      }
    }
    if (session.state.current.exercise?.status === "draft") throw new VocabularySessionConflict("这道题面尚待确认，请先审核课程资料。");
    if (!isVocabularyExerciseCurrent(session.state.current.exercise, database)) throw new VocabularySessionConflict("题目已修改或下架，原卡尚未入账；请同步最新题卡。");
    if (!card.target && !vocabularyRecallCue(word).title) throw new VocabularySessionConflict("请先补充可用释义，再开始学习这个新词。");
    const dueAt = new Date(now.getTime() + 60_000).toISOString();
    database.prepare("UPDATE vocabulary_words SET due_at = ?, interval_days = 0, updated_at = ? WHERE id = ?").run(dueAt, now.toISOString(), id);
    database.prepare("UPDATE vocabulary_learning_state SET review_version = review_version + 1, learning_started_at = ? WHERE word_id = ?").run(now.toISOString(), id);
    rememberVocabularyExercise(id, session.state.current.exercise, database);
    const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state, current: null, learned: session.state.learned + 1 } }, now);
    return { word: { ...word, dueAt, intervalDays: 0, learningStartedAt: now.toISOString(), reviewVersion: word.reviewVersion + 1 }, session: updatedSession };
  })();
}

export function reviewVocabularyEntry(id: string, input: VocabularyReviewInput, now = new Date()) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  loadPrivateVocabularyCatalog(database);
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
    if (!isVocabularyTargetCardCurrent(draft, word, database)) throw new VocabularySessionConflict("用法或暂停状态已变化，请同步后继续。");
    assertVocabularyTargetReviewBinding(draft, input);
    if (draft.consolidation && (input.mode !== "context" || Date.parse(draft.consolidation.dueAt) > now.getTime())) throw new VocabularySessionConflict("当前用法尚未到巩固时间。");
    if (draft.exercise?.status === "draft") throw new VocabularySessionConflict("这道题面尚待确认，请先审核课程资料。");
    if (!isVocabularyExerciseCurrent(draft.exercise, database)) throw new VocabularySessionConflict("题目已修改或下架，原答案尚未评分；请同步最新题卡。");
    if (draft.requestedRating !== null && (draft.requestedRating !== input.rating || draft.ratingSource !== (input.ratingSource ?? "self")))
      throw new VocabularySessionConflict("难度选择已变化，请保存当前选择后继续。");
    if (input.mode === "spelling" && !draft.audioPlayed) throw new VocabularySessionConflict("尚未成功播放本词发音，请先完成听音或暂缓此词。");
    if (!word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0) throw new VocabularySessionConflict("这个新词需要先学习，再进行回忆。");
    if (draft.supplemental && (input.mode !== "context" || !draft.exercise || draft.canSupplement || input.continueWithPractice))
      throw new VocabularySessionConflict("追加练习状态不正确，请同步当前题卡。");
    if (!draft.supplemental && Date.parse(word.dueAt) > now.getTime()) throw new VocabularySessionConflict("这个词尚未到期，请按最新队列继续。");
    const additionalExercise = !draft.supplemental && input.continueWithPractice && input.mode === "context"
      ? supplementalVocabularyExerciseForWord(word, draft.exercise, session.state.courseId, database) : null;
    if (input.continueWithPractice && (!draft.canSupplement || !additionalExercise))
      throw new VocabularySessionConflict("没有另一道可用语境题，请同步后保存本次复习。");
    const acceptedAnswers = input.mode === "context" && draft.exercise ? draft.exercise.acceptedAnswers : [word.term, ...(draft.target?.headwordAnswers ?? [])];
    const correct = input.mode === "recognition" ? null
      : Boolean(input.userAnswer.trim()) && acceptedAnswers.some((answer) => normaliseVocabularyAnswer(input.userAnswer) === normaliseVocabularyAnswer(answer));
    const confirmedTypo = input.confirmedTypo && !input.gaveUp && correct === false && acceptedAnswers.some((answer) => isVocabularyTypoCandidate(input.userAnswer, answer));
    const decisionReason: VocabularyDecisionReason = input.gaveUp ? "gave_up" : confirmedTypo ? "confirmed_typo"
      : correct === false ? "incorrect_answer" : correct === null ? "self_assessed" : "correct_answer";
    const rating = input.gaveUp || (correct === false && !confirmedTypo) ? "again" : input.rating;
    if (draft.supplemental) {
      // This is a separate Practice Attempt, not a second scheduled Review Item.
      database.prepare(`INSERT INTO vocabulary_supplemental_attempts(submission_id,session_id,word_id,word_version,mode,user_answer,correct,
        term_snapshot,requested_rating,effective_rating,decision_reason,confirmed_typo,gave_up,duration_seconds,reviewed_at,next_due_at,
        rating_source,exercise_json,course_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(input.submissionId, input.sessionId, id, word.reviewVersion, input.mode, input.userAnswer, Number(correct), word.term,
          input.rating, rating, decisionReason, Number(confirmedTypo), Number(input.gaveUp), input.durationSeconds,
          now.toISOString(), word.dueAt, input.ratingSource ?? "self", JSON.stringify(draft.exercise), draft.exercise!.courseId ?? session.state.courseId ?? null);
      if (draft.consolidation) {
        advanceVocabularyConsolidation(draft.consolidation, word, correct === true || confirmedTypo, input.submissionId, now, database);
        rememberVocabularyExercise(id, draft.exercise, database);
      }
      const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state, current: null,
        supplementalReviewed: (session.state.supplementalReviewed ?? 0) + 1, lastSubmissionId: input.submissionId } }, now);
      return { word, session: updatedSession, review: readVocabularyReviewSubmission(input.submissionId, database)! };
    }
    const scheduled = vocabularyScheduler.schedule(state, rating, now);
    const nextDue = scheduled.due.toISOString();
    database.prepare("UPDATE vocabulary_words SET repetitions = ?, interval_days = ?, due_at = ?, updated_at = ? WHERE id = ?").run(scheduled.reps, scheduled.scheduled_days, nextDue, now.toISOString(), id);
    database.prepare("UPDATE vocabulary_learning_state SET review_version = review_version + 1 WHERE word_id = ?").run(id);
    const review = database.prepare("INSERT INTO vocabulary_reviews (word_id, rating, previous_due_at, next_due_at, reviewed_at) VALUES (?, ?, ?, ?, ?)").run(id, rating, word.dueAt, nextDue, now.toISOString());
    database.prepare("INSERT INTO vocabulary_review_details (review_id, mode, user_answer, correct, duration_seconds) VALUES (?, ?, ?, ?, ?)").run(review.lastInsertRowid, input.mode, input.userAnswer, correct === null ? null : Number(correct), input.durationSeconds);
    database.prepare(`INSERT INTO vocabulary_review_audit (review_id, submission_id, session_id, word_version, requested_rating, effective_rating, decision_reason, term_snapshot, confirmed_typo, gave_up)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(review.lastInsertRowid, input.submissionId, input.sessionId, word.reviewVersion, input.rating, rating, decisionReason, word.term, Number(confirmedTypo), Number(input.gaveUp));
    database.prepare("INSERT INTO vocabulary_review_context(review_id,rating_source,exercise_json,course_id) VALUES(?,?,?,?)")
      .run(review.lastInsertRowid, input.ratingSource ?? "self", JSON.stringify(draft.exercise ?? {}), draft.exercise?.courseId ?? session.state.courseId ?? null);
    rememberVocabularyExercise(id, draft.exercise, database);
    database.prepare(`INSERT INTO vocabulary_scheduler_state (word_id, algorithm, state_json, updated_at) VALUES (?, 'fsrs', ?, ?) ON CONFLICT(word_id) DO UPDATE SET algorithm = excluded.algorithm, state_json = excluded.state_json, updated_at = excluded.updated_at`).run(id, JSON.stringify(scheduled), now.toISOString());
    if (draft.consolidation) advanceVocabularyConsolidation(draft.consolidation, word, correct === true || confirmedTypo, input.submissionId, now, database);
    if (rating === "again" && !confirmedTypo) {
      const existing = database.prepare("SELECT id FROM review_items WHERE source_type = 'vocabulary' AND source_id = ? AND resolved = 0").get(id) as { id: number } | undefined;
      const prompt = `${word.term} · ${input.mode}${input.userAnswer ? ` · 你的答案：${input.userAnswer}` : ""}`;
      const answer = `${word.term} — ${draft.target?.meaningZh || word.meaningZh || word.definitionEn || "待补充释义"}${draft.target ? `\n${draft.target.definitionEn}\n${draft.exercise?.sentence ?? ""}` : word.sourceSentence ? `\n${word.sourceSentence}` : ""}`;
      if (existing) database.prepare("UPDATE review_items SET mistake_count = mistake_count + 1, prompt = ?, answer = ?, reviewed_at = ? WHERE id = ?").run(prompt, answer, now.toISOString(), existing.id);
      else database.prepare("INSERT INTO review_items (source_type, source_id, skill, prompt, answer, resolved, created_at, category) VALUES ('vocabulary', ?, 'vocabulary', ?, ?, 0, ?, ?)").run(id, prompt, answer, now.toISOString(), input.mode === "spelling" ? "Spelling" : "Vocabulary");
    }
    const updatedWord = listVocabularyEntries().find((item) => item.id === id)!;
    const updatedSession = writeVocabularySession(database, { ...session, state: { ...session.state,
      current: additionalExercise ? { wordId: id, wordVersion: updatedWord.reviewVersion, phase: "front", answer: "",
        gaveUp: false, confirmedTypo: false, audioPlayed: false, requestedRating: null, ratingSource: "automatic", exercise: additionalExercise,
        ...(additionalExercise.target ? { target: additionalExercise.target, purpose: "supplemental" as const,
          targetStateVersion: readVocabularyTargetState(additionalExercise.target.id, additionalExercise.target.normalizedTerm, database).version,
          restoreVersion: draft.restoreVersion, policyVersion: draft.policyVersion } : {}),
        supplemental: true, canSupplement: false, startedAt: now.toISOString() } : null,
      reviewed: session.state.reviewed + 1, lastSubmissionId: input.submissionId } }, now);
    return { word: updatedWord,
      session: updatedSession, review: readVocabularyReviewSubmission(input.submissionId, database)! };
  })();
}
