import "server-only";

import type Database from "better-sqlite3";
import type { WritingDraft, WritingDraftInput, WritingFeedback, WritingFeedbackRecord } from "../lib/writing";
import { countWritingWords } from "../lib/writing";
import { getDatabase } from "./db";

export function initializeWritingTables(database: Database.Database = getDatabase()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS writing_drafts (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, version INTEGER NOT NULL,
      task_type TEXT NOT NULL, category TEXT NOT NULL, prompt TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '', essay TEXT NOT NULL DEFAULT '',
      elapsed_seconds INTEGER NOT NULL DEFAULT 0, time_limit_minutes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL,
      UNIQUE(group_id, version)
    );
    CREATE TABLE IF NOT EXISTS writing_feedback_details (
      submission_id INTEGER PRIMARY KEY REFERENCES writing_submissions(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES writing_drafts(id) ON DELETE CASCADE,
      feedback_json TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_writing_drafts_updated ON writing_drafts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_writing_feedback_draft ON writing_feedback_details(draft_id);
  `);
  return database;
}

type Row = Record<string, unknown>;
function fromRow(row: Row, database: Database.Database): WritingDraft {
  const evaluated = database.prepare(`SELECT f.*, s.essay FROM writing_feedback_details f
    JOIN writing_submissions s ON s.id = f.submission_id WHERE f.draft_id = ?
    ORDER BY f.submission_id DESC LIMIT 1`).get(row.id) as Row | undefined;
  return {
    id: String(row.id), groupId: String(row.group_id), version: Number(row.version),
    taskType: row.task_type as WritingDraft["taskType"], category: String(row.category),
    prompt: String(row.prompt), image: String(row.image), essay: String(row.essay),
    elapsedSeconds: Number(row.elapsed_seconds), timeLimitMinutes: Number(row.time_limit_minutes),
    status: row.status as WritingDraft["status"], updatedAt: String(row.updated_at),
    ...(evaluated ? { feedback: {
      ...JSON.parse(String(evaluated.feedback_json)), submissionId: Number(evaluated.submission_id),
      provider: String(evaluated.provider), evaluatedAt: String(evaluated.created_at), evaluatedEssay: String(evaluated.essay),
    } as WritingFeedbackRecord } : {}),
  };
}

export function listWritingDrafts(database: Database.Database = getDatabase()) {
  initializeWritingTables(database);
  return (database.prepare("SELECT * FROM writing_drafts ORDER BY updated_at DESC").all() as Row[])
    .map((row) => fromRow(row, database));
}

export function getWritingDraft(id: string, database: Database.Database = getDatabase()) {
  initializeWritingTables(database);
  const row = database.prepare("SELECT * FROM writing_drafts WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row, database) : null;
}

export function saveWritingDraft(input: WritingDraftInput, database: Database.Database = getDatabase()) {
  initializeWritingTables(database);
  database.prepare(`INSERT INTO writing_drafts
    (id, group_id, version, task_type, category, prompt, image, essay, elapsed_seconds, time_limit_minutes, status, updated_at)
    VALUES (@id, @groupId, @version, @taskType, @category, @prompt, @image, @essay, @elapsedSeconds, @timeLimitMinutes, @status, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      task_type = excluded.task_type, category = excluded.category, prompt = excluded.prompt,
      image = excluded.image, essay = excluded.essay, elapsed_seconds = excluded.elapsed_seconds,
      time_limit_minutes = excluded.time_limit_minutes, status = excluded.status, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= writing_drafts.updated_at`).run(input);
  return getWritingDraft(input.id, database)!;
}

export function createWritingRevision(sourceId: string, id: string, database: Database.Database = getDatabase()) {
  initializeWritingTables(database);
  return database.transaction(() => {
    const source = getWritingDraft(sourceId, database);
    if (!source) throw new Error("Draft not found.");
    const latest = database.prepare("SELECT MAX(version) AS version FROM writing_drafts WHERE group_id = ?")
      .get(source.groupId) as { version: number };
    return saveWritingDraft({
      ...source, id, version: latest.version + 1, elapsedSeconds: 0, status: "draft", updatedAt: new Date().toISOString(),
    }, database);
  })();
}

export function saveWritingEvaluation(draft: WritingDraftInput, feedback: WritingFeedback, provider: string, database: Database.Database = getDatabase()) {
  initializeWritingTables(database);
  return database.transaction(() => {
    const now = new Date().toISOString();
    const result = database.prepare(`INSERT INTO writing_submissions
      (task_type, prompt, essay, word_count, overall_band, criteria_json, strengths_json, improvements_json, rewrite, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      draft.taskType, draft.prompt, draft.essay, countWritingWords(draft.essay), feedback.overallBand,
      JSON.stringify(feedback.criteria), JSON.stringify(feedback.strongSentences), JSON.stringify(feedback.actionItems), feedback.rewrite, now,
    );
    const submissionId = Number(result.lastInsertRowid);
    database.prepare(`INSERT INTO writing_feedback_details (submission_id, draft_id, feedback_json, provider, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(submissionId, draft.id, JSON.stringify(feedback), provider, now);
    const columns = new Set((database.prepare("PRAGMA table_info(review_items)").all() as { name: string }[]).map((c) => c.name));
    const withCategory = columns.has("category");
    const insertError = database.prepare(`INSERT INTO review_items
      (source_type, source_id, skill, prompt, answer, resolved, created_at${withCategory ? ", category" : ""})
      VALUES ('writing', ?, 'writing', ?, ?, 0, ?${withCategory ? ", ?" : ""})`);
    const uniqueErrors = new Map([...feedback.grammarErrors, ...feedback.vocabularyProblems]
      .map((error) => [`${error.category}:${error.original}`, error]));
    for (const error of uniqueErrors.values()) {
      const values = [String(submissionId), `${error.category}: ${error.original}`, `${error.correction}\n${error.explanation}`, now];
      if (withCategory) values.push(error.category);
      insertError.run(...values);
    }
    return { ...feedback, submissionId, provider, evaluatedAt: now, evaluatedEssay: draft.essay } satisfies WritingFeedbackRecord;
  })();
}
