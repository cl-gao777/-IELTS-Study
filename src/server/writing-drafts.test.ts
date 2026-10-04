import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WritingDraftInput } from "../lib/writing";
import { parseWritingFeedback } from "../lib/writing";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Tests must use the isolated database."); } }));

import { createWritingRevision, getWritingDraft, initializeWritingTables, listWritingDrafts, saveWritingDraft, saveWritingEvaluation } from "./writing-drafts";

let database: Database.Database;
let directory: string;
let file: string;
let draft: WritingDraftInput;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "ielts-writing-test-"));
  file = path.join(directory, "test.db");
  database = new Database(file);
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE writing_submissions (id INTEGER PRIMARY KEY, task_type TEXT, prompt TEXT, essay TEXT, word_count INTEGER, overall_band REAL, criteria_json TEXT, strengths_json TEXT, improvements_json TEXT, rewrite TEXT, submitted_at TEXT);
    CREATE TABLE review_items (id INTEGER PRIMARY KEY, source_type TEXT, source_id TEXT, skill TEXT, prompt TEXT, answer TEXT, resolved INTEGER, created_at TEXT, category TEXT);
  `);
  initializeWritingTables(database);
  const id = randomUUID();
  draft = { id, groupId: id, version: 1, taskType: "task-2", category: "Opinion", prompt: "Should cities invest in transport?", image: "", essay: "Cities should invest in public transport because it connects communities.", elapsedSeconds: 180, timeLimitMinutes: 40, status: "draft", updatedAt: "2026-10-04T10:00:00.000Z" };
});
afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

describe("durable writing drafts", () => {
  it("survives reopening SQLite with essay, timer, image, and status intact and no fake score", () => {
    draft.image = "data:image/png;base64,aGVsbG8=";
    saveWritingDraft(draft, database);
    database.close(); database = new Database(file);
    expect(getWritingDraft(draft.id, database)).toEqual(draft);
    expect(database.prepare("SELECT COUNT(*) AS count FROM writing_submissions").get()).toEqual({ count: 0 });
  });
  it("ignores a delayed autosave older than the saved version", () => {
    saveWritingDraft({ ...draft, essay: "Newer text", updatedAt: "2026-10-04T10:00:05.000Z" }, database);
    saveWritingDraft(draft, database);
    expect(getWritingDraft(draft.id, database)?.essay).toBe("Newer text");
  });
  it("creates independent, sequential rewrites without overwriting the original", () => {
    saveWritingDraft(draft, database);
    const second = createWritingRevision(draft.id, randomUUID(), database);
    saveWritingDraft({ ...second, essay: "Revised essay", updatedAt: "2026-10-05T10:00:00.000Z" }, database);
    const third = createWritingRevision(draft.id, randomUUID(), database);
    expect(second.version).toBe(2); expect(third.version).toBe(3);
    expect(second.elapsedSeconds).toBe(0);
    expect(getWritingDraft(draft.id, database)?.essay).toBe(draft.essay);
    expect(listWritingDrafts(database)).toHaveLength(3);
  });
  it("persists genuine structured feedback and deduplicated taxonomy errors together", () => {
    saveWritingDraft(draft, database);
    const error = { category: "Preposition", original: "attention on", correction: "attention to", explanation: "Use to." };
    const feedback = parseWritingFeedback(JSON.stringify({ overallBand: 6, overall: "Clear argument.", criteria: { taskResponse: 6, coherenceCohesion: 6, lexicalResource: 6, grammarAccuracy: 6 }, criterionFeedback: { taskResponse: "Clear", coherenceCohesion: "Clear", lexicalResource: "Clear", grammarAccuracy: "Prepositions" }, strongSentences: [], weakSentences: [], grammarErrors: [error], vocabularyProblems: [error], betterExpressions: [], rewrite: "Pay attention to this issue.", actionItems: ["Review prepositions."] }));
    const result = saveWritingEvaluation(draft, feedback, "test-provider", database);
    expect(getWritingDraft(draft.id, database)?.feedback).toEqual(result);
    expect(database.prepare("SELECT category, skill FROM review_items").all()).toEqual([{ category: "Preposition", skill: "writing" }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM writing_submissions").get()).toEqual({ count: 1 });
  });
});
