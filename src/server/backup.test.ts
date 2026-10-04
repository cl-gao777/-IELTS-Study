import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null, file: "" }));
vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return { ...original, getDatabase: () => holder.database!, databasePath: () => holder.file };
});
import { migrate } from "./db";
import { createBackup, databaseBackup, restoreBackup, validateBackup } from "./backup";
import { saveVocabularyEntry, reviewVocabularyEntry } from "./vocabulary";
import { vocabularyInputSchema } from "../lib/vocabulary";

let directory: string;
let uploadDirectory: string;
let originalFile: string;
const mediaBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 255]);
const now = "2026-10-04T10:00:00.000Z";

function insert(table: string, values: Record<string, string | number | null>) {
  const columns = Object.keys(values);
  holder.database!.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(values));
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ielts-backup-test-"));
  holder.file = path.join(directory, "study.db");
  holder.database = new Database(holder.file);
  uploadDirectory = path.join(directory, "uploads");
  mkdirSync(uploadDirectory);
  vi.stubEnv("UPLOAD_DIR", uploadDirectory);
  migrate(holder.database);
  holder.database.exec(`
    ALTER TABLE review_items ADD COLUMN category TEXT NOT NULL DEFAULT '';
    ALTER TABLE review_items ADD COLUMN mistake_count INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE review_items ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT '';
    CREATE TABLE studio_preferences (id INTEGER PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE studio_migrations (id TEXT PRIMARY KEY);
    CREATE TABLE study_sessions (id TEXT PRIMARY KEY, study_date TEXT NOT NULL, area TEXT NOT NULL, duration_seconds INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);
  // Initialize every feature schema before filling its representative durable record.
  createBackup();
  insert("settings", { id: 1, display_name: "学习者", target_band: 6.5, daily_minutes: 60, notion_database_id: "", updated_at: now });
  insert("studio_preferences", { id: 1, value_json: '{"theme":"dark","dailyMinutes":60}' });
  insert("studio_migrations", { id: "initial-seed" });
  insert("study_sessions", { id: "session-1", study_date: "2026-10-04", area: "Reading", duration_seconds: 600, updated_at: now });
  insert("study_tasks", { id: "task-1", study_date: "2026-10-04", area: "Vocabulary", title: "Review", detail: "Recall words", estimated_minutes: 10, completed: 1, href: "/vocabulary", updated_at: now });
  const word = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "evidence", meaningZh: "证据", sourceSentence: "Evidence matters.", sourceMaterial: "Original sample", wordFamily: ["evident"] }))!.word;
  reviewVocabularyEntry(word.id, { rating: "again", mode: "spelling", userAnswer: "evidance", correct: false, durationSeconds: 9 }, new Date(now));
  insert("practice_sets", { id: "sample-listening", kind: "listening", title: "Original sample", subtitle: "test", instructions: "Listen", passage: "", transcript: "Evidence matters.", audio_url: "/api/materials/1/file", duration_minutes: 20, questions_json: "[]", created_at: now });
  insert("practice_attempts", { id: 1, set_id: "sample-listening", kind: "listening", raw_score: 0, total_questions: 1, band_score: 0, duration_seconds: 30, answers_json: '[{"questionId":"q1","correct":false}]', submitted_at: now });
  insert("coach_messages", { id: 1, role: "user", content: "Explain evidence", correction: "", provider: "", created_at: now });
  insert("writing_submissions", { id: 1, task_type: "task-2", prompt: "Discuss transport", essay: "Transport connects cities.", word_count: 3, overall_band: 6, criteria_json: "{}", strengths_json: "[]", improvements_json: "[]", rewrite: "", submitted_at: now });
  originalFile = path.join(uploadDirectory, "original.wav");
  writeFileSync(originalFile, mediaBytes);
  insert("source_materials", { id: 1, title: "My audio", kind: "listening", content: "Evidence matters.", source_url: "", file_name: "original.wav", mime_type: "audio/wav", file_path: originalFile, created_at: now });
  insert("mock_exams", { id: 1, status: "completed", reading_attempt_id: null, listening_attempt_id: 1, writing_submission_id: 1, overall_band: 6, started_at: now, submitted_at: now });
  insert("notion_sync_log", { id: 1, status: "disabled", message: "Local only", synced_at: now });
  insert("material_metadata", { material_id: 1, metadata_json: '{"tags":["Listening"]}' });
  insert("practice_annotations", { set_id: "sample-listening", annotations_json: "[]", updated_at: now });
  insert("practice_drafts", { set_id: "sample-listening", draft_json: '{"answers":{"q1":"evidance"}}', updated_at: now });
  insert("practice_mistake_reasons", { attempt_id: 1, question_id: "q1", reason: "Spelling", updated_at: now });
  insert("dictation_attempts", { id: 1, set_id: "sample-listening", expected: "Evidence matters.", submitted: "Evidance matters.", errors_json: "[]", start_seconds: 0, end_seconds: 5, created_at: now });
  insert("writing_drafts", { id: "draft-1", group_id: "group-1", version: 1, task_type: "task-2", category: "Opinion", prompt: "Discuss transport", image: "", essay: "Transport connects cities.", elapsed_seconds: 120, time_limit_minutes: 40, status: "draft", updated_at: now });
  insert("writing_feedback_details", { submission_id: 1, draft_id: "draft-1", feedback_json: "{}", provider: "test", created_at: now });
  writeFileSync(path.join(directory, "ai-provider.secret.json"), '{"apiKey":"test-secret-must-not-be-exported"}');
});

afterEach(() => {
  holder.database?.close(); holder.database = null;
  vi.unstubAllEnvs();
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Refusing cleanup outside temporary directory");
  rmSync(directory, { recursive: true, force: true });
});

describe("complete local backup and restore", () => {
  it("round-trips every table and attachment byte, preserves old files, and excludes provider secrets", () => {
    const backup = createBackup();
    const tables = holder.database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    expect(Object.keys(backup.data).sort()).toEqual(tables.map((table) => table.name));
    expect(Object.values(backup.data).every((rows) => rows.length > 0)).toBe(true);
    expect(backup.data.source_materials[0].file_path).toBe("upload:1");
    expect(JSON.stringify(backup)).not.toContain("test-secret-must-not-be-exported");
    holder.database!.prepare("UPDATE vocabulary_words SET meaning_zh = 'Changed after backup'").run();
    const result = restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(existsSync(result.safetyBackup)).toBe(true);
    expect(readFileSync(result.safetyBackup, "utf8")).toContain("Changed after backup");
    const restored = createBackup();
    expect(restored.data).toEqual(backup.data);
    expect(restored.files).toEqual(backup.files);
    const restoredPath = (holder.database!.prepare("SELECT file_path FROM source_materials WHERE id=1").get() as { file_path: string }).file_path;
    expect(path.dirname(restoredPath)).toBe(uploadDirectory);
    expect(restoredPath).not.toBe(originalFile);
    expect(readFileSync(restoredPath)).toEqual(mediaBytes);
    expect(readFileSync(originalFile)).toEqual(mediaBytes);
    expect(readFileSync(path.join(directory, "ai-provider.secret.json"), "utf8")).toContain("test-secret-must-not-be-exported");
  });

  it("rejects missing tables, missing columns, malformed JSON, and invalid file bytes before mutation", () => {
    const original = createBackup();
    const missingTable = structuredClone(original); delete missingTable.data.vocabulary_reviews;
    expect(() => restoreBackup(missingTable)).toThrow("缺少数据表");
    const missingColumn = structuredClone(original); delete missingColumn.data.vocabulary_words[0].meaning_zh;
    expect(() => restoreBackup(missingColumn)).toThrow("缺少字段");
    const malformed = structuredClone(original); malformed.data.vocabulary_metadata[0].data_json = "{";
    expect(() => restoreBackup(malformed)).toThrow("不是有效 JSON");
    const invalidFile = structuredClone(original); invalidFile.files[0].base64 = "data:not-base64";
    expect(() => restoreBackup(invalidFile)).toThrow("文件格式");
    expect(createBackup().data).toEqual(original.data);
  });

  it("rolls back a dangling foreign key and removes newly staged attachments", () => {
    const original = createBackup();
    const corrupted = structuredClone(original);
    corrupted.data.vocabulary_metadata[0].word_id = "does-not-exist";
    const filesBefore = readdirSync(uploadDirectory).sort();
    expect(() => restoreBackup(corrupted)).toThrow("关联关系损坏");
    expect(createBackup().data).toEqual(original.data);
    expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
    expect(holder.database!.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rolls back a SQL constraint error without erasing existing learning history", () => {
    const original = createBackup();
    const invalid = structuredClone(original); invalid.data.settings[0].display_name = null;
    expect(() => restoreBackup(invalid)).toThrow();
    expect(createBackup().data).toEqual(original.data);
    expect(holder.database!.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rejects unknown tables and path injection without touching outside files", () => {
    const original = createBackup();
    const unknown = structuredClone(original); unknown.data["settings; DROP TABLE settings"] = [];
    expect(() => restoreBackup(unknown)).toThrow("不兼容数据表");
    for (const unsafe of ["../../ai-provider.secret.json", path.join(directory, "ai-provider.secret.json"), "C:\\Windows\\file"]) {
      const injected = structuredClone(original); injected.data.source_materials[0].file_path = unsafe;
      expect(() => restoreBackup(injected)).toThrow("非法附件路径");
    }
    const filenameInjection = structuredClone(original); filenameInjection.data.source_materials[0].file_name = "../../outside.wav";
    expect(() => validateBackup(filenameInjection)).toThrow("文件名不能包含目录");
    expect(createBackup().data).toEqual(original.data);
    expect(readFileSync(path.join(directory, "ai-provider.secret.json"), "utf8")).toContain("test-secret-must-not-be-exported");
  });

  it("opens an async raw SQLite snapshot with all committed learning rows and valid foreign keys", async () => {
    const buffer = await databaseBackup();
    expect(buffer.subarray(0, 15).toString()).toBe("SQLite format 3");
    const restoredFile = path.join(directory, "snapshot-check.db");
    writeFileSync(restoredFile, buffer);
    const snapshot = new Database(restoredFile, { readonly: true });
    try {
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(snapshot.pragma("foreign_key_check")).toEqual([]);
      expect(snapshot.prepare("SELECT COUNT(*) AS count FROM vocabulary_reviews").get()).toEqual({ count: 1 });
      expect(snapshot.prepare("SELECT COUNT(*) AS count FROM writing_drafts").get()).toEqual({ count: 1 });
      expect(snapshot.prepare("SELECT COUNT(*) AS count FROM vocabulary_scheduler_state").get()).toEqual({ count: 1 });
    } finally { snapshot.close(); }
  });

  it("repairs missing current media using a healthy backup and first saves the unchanged raw database", () => {
    const healthy = createBackup();
    holder.database!.prepare("UPDATE vocabulary_words SET meaning_zh = 'Current value before restore'").run();
    unlinkSync(originalFile);
    const result = restoreBackup(healthy);
    expect(result.safetyBackupType).toBe("sqlite");
    expect(result.warning).toContain("不含附件");
    const safety = new Database(result.safetyBackup, { readonly: true });
    try {
      expect(safety.prepare("SELECT meaning_zh FROM vocabulary_words").get()).toEqual({ meaning_zh: "Current value before restore" });
      expect(safety.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { safety.close(); }
    expect(createBackup().data).toEqual(healthy.data);
    expect(createBackup().files).toEqual(healthy.files);
  });
});
