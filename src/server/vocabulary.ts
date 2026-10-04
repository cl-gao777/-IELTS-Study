import "server-only";

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { VocabularyWord } from "@/lib/domain";
import type { ReviewRating } from "@/lib/srs";
import { vocabularyInputSchema, type VocabularyEntry, type VocabularyInput, type VocabularyMetadata, type VocabularyReviewMode } from "@/lib/vocabulary";
import { parseSchedulerState, vocabularyScheduler, type ReviewHistoryEntry } from "@/lib/vocabulary-scheduler";
import { getDatabase } from "./db";
import { listVocabulary } from "./store";

export function ensureVocabularyTables(database: Database.Database = getDatabase()) {
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
  `);
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
  return { ...word, ...metadata(parsed), scheduler: "fsrs" };
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

export function saveVocabularyEntry(input: VocabularyInput, editingId?: string) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    const duplicate = database.prepare("SELECT id FROM vocabulary_words WHERE lower(trim(term)) = lower(trim(?))").get(input.term) as { id: string } | undefined;
    if (duplicate && editingId && duplicate.id !== editingId) throw new Error("DUPLICATE_WORD");
    if (duplicate && !editingId) return { word: listVocabularyEntries().find((word) => word.id === duplicate.id)!, existing: true };
    if (editingId && !database.prepare("SELECT id FROM vocabulary_words WHERE id = ?").get(editingId)) return null;
    const id = editingId ?? randomUUID();
    const now = new Date().toISOString();
    const values = [input.term, input.pronunciation, input.partOfSpeech, input.meaningZh, input.definitionEn, input.example, JSON.stringify(input.tags)];
    if (editingId) {
      database.prepare(`UPDATE vocabulary_words SET term = ?, pronunciation = ?, part_of_speech = ?, meaning_zh = ?, definition_en = ?, example = ?, tags_json = ?, updated_at = ? WHERE id = ?`).run(...values, now, id);
    } else {
      database.prepare(`INSERT INTO vocabulary_words (id, term, pronunciation, part_of_speech, meaning_zh, definition_en, example, tags_json, repetitions, interval_days, ease_factor, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 2.5, ?, ?, ?)`).run(id, ...values, now, now, now);
    }
    database.prepare(`INSERT INTO vocabulary_metadata (word_id, data_json) VALUES (?, ?) ON CONFLICT(word_id) DO UPDATE SET data_json = excluded.data_json`).run(id, JSON.stringify(metadata(input)));
    return { word: listVocabularyEntries().find((word) => word.id === id)!, existing: false };
  })();
}

export function reviewVocabularyEntry(id: string, input: {
  rating: ReviewRating;
  mode: VocabularyReviewMode;
  userAnswer: string;
  correct: boolean | null;
  durationSeconds: number;
}, now = new Date()) {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    const word = listVocabularyEntries().find((item) => item.id === id);
    if (!word) return null;
    const previous = database.prepare("SELECT state_json FROM vocabulary_scheduler_state WHERE word_id = ?").get(id) as { state_json: string } | undefined;
    const history = database.prepare("SELECT rating, reviewed_at AS reviewedAt FROM vocabulary_reviews WHERE word_id = ? ORDER BY reviewed_at, id").all(id) as ReviewHistoryEntry[];
    let state;
    try { state = previous ? parseSchedulerState(previous.state_json) : vocabularyScheduler.migrate(history, now); }
    catch { state = vocabularyScheduler.migrate(history, now); }
    const scheduled = vocabularyScheduler.schedule(state, input.rating, now);
    const nextDue = scheduled.due.toISOString();
    database.prepare("UPDATE vocabulary_words SET repetitions = ?, interval_days = ?, due_at = ?, updated_at = ? WHERE id = ?").run(scheduled.reps, scheduled.scheduled_days, nextDue, now.toISOString(), id);
    const review = database.prepare("INSERT INTO vocabulary_reviews (word_id, rating, previous_due_at, next_due_at, reviewed_at) VALUES (?, ?, ?, ?, ?)").run(id, input.rating, word.dueAt, nextDue, now.toISOString());
    database.prepare("INSERT INTO vocabulary_review_details (review_id, mode, user_answer, correct, duration_seconds) VALUES (?, ?, ?, ?, ?)").run(review.lastInsertRowid, input.mode, input.userAnswer, input.correct === null ? null : Number(input.correct), input.durationSeconds);
    database.prepare(`INSERT INTO vocabulary_scheduler_state (word_id, algorithm, state_json, updated_at) VALUES (?, 'fsrs', ?, ?) ON CONFLICT(word_id) DO UPDATE SET algorithm = excluded.algorithm, state_json = excluded.state_json, updated_at = excluded.updated_at`).run(id, JSON.stringify(scheduled), now.toISOString());
    if (input.rating === "again") {
      const existing = database.prepare("SELECT id FROM review_items WHERE source_type = 'vocabulary' AND source_id = ? AND resolved = 0").get(id) as { id: number } | undefined;
      const prompt = `${word.term} · ${input.mode}${input.userAnswer ? ` · 你的答案：${input.userAnswer}` : ""}`;
      const answer = `${word.term} — ${word.meaningZh || word.definitionEn || "待补充释义"}${word.sourceSentence ? `\n${word.sourceSentence}` : ""}`;
      if (existing) database.prepare("UPDATE review_items SET mistake_count = mistake_count + 1, prompt = ?, answer = ?, reviewed_at = ? WHERE id = ?").run(prompt, answer, now.toISOString(), existing.id);
      else database.prepare("INSERT INTO review_items (source_type, source_id, skill, prompt, answer, resolved, created_at, category) VALUES ('vocabulary', ?, 'vocabulary', ?, ?, 0, ?, ?)").run(id, prompt, answer, now.toISOString(), input.mode === "spelling" ? "Spelling" : "Vocabulary");
    }
    return { ...word, repetitions: scheduled.reps, intervalDays: scheduled.scheduled_days, dueAt: nextDue };
  })();
}
