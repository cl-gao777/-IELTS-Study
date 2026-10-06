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
import { saveVocabularyEntry, reviewVocabularyEntry, listVocabularyEntries } from "./vocabulary";
import { vocabularyInputSchema } from "../lib/vocabulary";
import { readVocabularySession, requireVocabularySession } from "./vocabulary-session-store";
import { canRecoverVocabularyDraft, type VocabularyRecovery } from "../lib/vocabulary-recovery";

let directory: string;
let uploadDirectory: string;
let originalFile: string;
const mediaBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 255]);
const now = "2026-10-04T10:00:00.000Z";
const sessionId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
function sessionState(wordId: string, phase: "front" | "revealed" = "front") {
  return { mode: "spelling", current: { wordId, wordVersion: 1, phase, answer: "evidance", gaveUp: false, confirmedTypo: false, audioPlayed: true, startedAt: now }, skippedIds: [], reviewed: 0, learned: 1, lastSubmissionId: null };
}
function addSession(wordId: string, phase: "front" | "revealed" = "front") {
  insert("vocabulary_sessions", { id: sessionId, revision: 1, status: "active", state_json: JSON.stringify(sessionState(wordId, phase)), started_at: now, updated_at: now });
}

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
  holder.database.prepare("UPDATE vocabulary_learning_state SET learning_started_at=? WHERE word_id=?").run(now, word.id);
  holder.database.prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(now, word.id);
  addSession(word.id, "revealed");
  reviewVocabularyEntry(word.id, { rating: "again", mode: "spelling", userAnswer: "evidance", durationSeconds: 9, expectedVersion: 1, sessionId, expectedSessionRevision: 1, submissionId, confirmedTypo: false, gaveUp: false }, new Date(now));
  // The common fixture is a legacy review: no historical answer snapshot is invented.
  holder.database.exec("DELETE FROM vocabulary_review_audit; DELETE FROM vocabulary_sessions;");
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
  it("migrates only the known v1 vocabulary additions without changing raw history or FSRS state", () => {
    const original = createBackup();
    const legacy = { ...structuredClone(original), version: 1 };
    for (const table of ["vocabulary_learning_state", "vocabulary_sessions", "vocabulary_review_audit"]) delete legacy.data[table];
    const frozenInput = JSON.stringify(legacy);
    expect(validateBackup(legacy).version).toBe(2);
    expect(JSON.stringify(legacy)).toBe(frozenInput);
    restoreBackup(legacy);
    const restored = createBackup();
    expect(restored.version).toBe(2);
    for (const table of ["vocabulary_words", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_scheduler_state"]) expect(restored.data[table]).toEqual(original.data[table]);
    expect(restored.data.vocabulary_learning_state[0].learning_started_at).toBe(now);
    expect(restored.data.vocabulary_review_audit).toEqual([]);
    expect(restored.data.vocabulary_sessions).toEqual([]);
    for (const table of ["vocabulary_reviews", "vocabulary_metadata", "vocabulary_review_details"]) {
      const invalid = structuredClone(legacy); delete invalid.data[table];
      expect(() => validateBackup(invalid)).toThrow("缺少数据表");
    }
    const missingColumn = structuredClone(legacy); delete missingColumn.data.vocabulary_words[0].meaning_zh;
    expect(() => validateBackup(missingColumn)).toThrow("缺少字段");
  });

  it("keeps active/current/skipped/counters and audit snapshots, but invalidates old revisions on v2 restore", () => {
    const word = createBackup().data.vocabulary_words[0];
    addSession(String(word.id));
    const state = { ...sessionState(String(word.id), "revealed"), reviewed: 3, learned: 2, skippedIds: ["skipped-legacy-card"], lastSubmissionId: submissionId };
    state.current.wordVersion = Number(createBackup().data.vocabulary_learning_state[0].review_version);
    holder.database!.prepare("UPDATE vocabulary_sessions SET revision=5,state_json=?").run(JSON.stringify(state));
    insert("vocabulary_review_audit", { review_id: 1, submission_id: submissionId, session_id: sessionId, word_version: 1, requested_rating: "again", effective_rating: "again", decision_reason: "confirmed_typo", term_snapshot: "original-standard-answer", confirmed_typo: 1, gave_up: 0 });
    const original = createBackup();
    holder.database!.prepare("UPDATE vocabulary_sessions SET revision=12").run();
    holder.database!.prepare("UPDATE vocabulary_words SET term='edited-after-review'").run();
    restoreBackup(original);
    const restored = createBackup();
    expect(restored.data.vocabulary_review_audit).toEqual(original.data.vocabulary_review_audit);
    expect(restored.data.vocabulary_review_details).toEqual(original.data.vocabulary_review_details);
    expect(readVocabularySession(holder.database!)).toMatchObject({ id: sessionId, revision: 14, status: "active", state });
    expect(() => requireVocabularySession(holder.database!, sessionId, 5)).toThrow();
    expect(() => requireVocabularySession(holder.database!, sessionId, 12)).toThrow();
    expect(requireVocabularySession(holder.database!, sessionId, 14).state.current?.answer).toBe("evidance");
    restoreBackup(original);
    expect(readVocabularySession(holder.database!)?.revision).toBe(16);
    const resumed = reviewVocabularyEntry(String(word.id), {
      rating: "good", mode: "spelling", userAnswer: "evidance", durationSeconds: 9,
      expectedVersion: state.current.wordVersion, sessionId, expectedSessionRevision: 16,
      submissionId: "33333333-3333-4333-8333-333333333333", confirmedTypo: false, gaveUp: false,
    }, new Date("2026-10-04T10:02:00.000Z"));
    expect(resumed?.review).toMatchObject({ termSnapshot: "evidence", correct: false, effectiveRating: "again" });
    expect(resumed?.session?.state).toMatchObject({ current: null, reviewed: 4, learned: 2 });
  });

  it("distinguishes restored revisions from a lost checkpoint acknowledgement before overlaying a draft", () => {
    const word = listVocabularyEntries()[0];
    addSession(word.id);
    const state = sessionState(word.id); state.current.wordVersion = word.reviewVersion;
    holder.database!.prepare("UPDATE vocabulary_sessions SET revision=5,state_json=?").run(JSON.stringify(state));
    const checkpoint = readVocabularySession(holder.database!)!;
    const recovery: VocabularyRecovery = { format: 2, view: "review", dirty: true, pending: null, startAttempt: null,
      session: { ...checkpoint, state: { ...checkpoint.state, current: { ...checkpoint.state.current!, answer: "pre-restore unsaved typing" } } },
      attempted: { revision: 5, state: { mode: checkpoint.state.mode, current: checkpoint.state.current, skippedIds: checkpoint.state.skippedIds } },
    };
    const words = listVocabularyEntries();
    // A genuine single checkpoint acknowledgement can preserve subsequent local typing.
    expect(canRecoverVocabularyDraft(recovery, { ...checkpoint, revision: 6 }, words)).toBe(true);
    restoreBackup(createBackup());
    const restored = readVocabularySession(holder.database!)!;
    expect(restored.revision).toBe(7);
    expect(restored.state).toEqual(checkpoint.state);
    expect(canRecoverVocabularyDraft(recovery, restored, words)).toBe(false);
  });

  it("requires complete v2 fields and rejects malformed new vocabulary data before replacement", () => {
    const original = createBackup();
    for (const table of ["vocabulary_learning_state", "vocabulary_sessions", "vocabulary_review_audit"]) {
      const missing = structuredClone(original); delete missing.data[table];
      expect(() => validateBackup(missing)).toThrow("缺少数据表");
    }
    const oldField = structuredClone(original); delete oldField.data.practice_sets[0].resource_json;
    expect(() => validateBackup(oldField)).toThrow("缺少字段");
    const invalidVersion = structuredClone(original); invalidVersion.data.vocabulary_learning_state[0].review_version = 0;
    expect(() => validateBackup(invalidVersion)).toThrow("学习状态");
    addSession(String(original.data.vocabulary_words[0].id));
    const invalidSession = createBackup(); invalidSession.data.vocabulary_sessions[0].state_json = '{"mode":"recall"}';
    expect(() => validateBackup(invalidSession)).toThrow("会话状态");
    const malformed = createBackup(); malformed.data.vocabulary_sessions[0].revision = 1.1;
    expect(() => validateBackup(malformed)).toThrow("会话状态");
    malformed.data.vocabulary_sessions[0].revision = Number.MAX_SAFE_INTEGER - 1;
    expect(() => validateBackup(malformed)).toThrow("会话状态");
    const missingAudio = createBackup();
    const draft = JSON.parse(String(missingAudio.data.vocabulary_sessions[0].state_json));
    delete draft.current.audioPlayed;
    missingAudio.data.vocabulary_sessions[0].state_json = JSON.stringify(draft);
    expect(() => validateBackup(missingAudio)).toThrow("会话状态");
    expect(() => validateBackup({ ...original, arbitrary: true })).toThrow("完整 JSON");
  });

  it("rolls back restored vocabulary revisions and all staged media when a new-table FK is broken", () => {
    const wordId = String(createBackup().data.vocabulary_words[0].id);
    addSession(wordId);
    const original = createBackup();
    const invalid = structuredClone(original); invalid.data.vocabulary_learning_state[0].word_id = "missing-word";
    const filesBefore = readdirSync(uploadDirectory).sort();
    expect(() => restoreBackup(invalid)).toThrow("关联关系损坏");
    expect(createBackup().data).toEqual(original.data);
    expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
  });

  it("restores a full-recording-sized attachment without exhausting the regex stack", () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
    writeFileSync(originalFile, bytes);
    const backup = createBackup();
    restoreBackup(backup);
    const restored = holder.database!.prepare("SELECT file_path FROM source_materials WHERE id=1").get() as { file_path: string };
    expect(readFileSync(restored.file_path).equals(bytes)).toBe(true);
    for (const invalid of ["A===", "====", "AAAA=AAA", "AA_A", "AAA"]) {
      const broken = structuredClone(backup); broken.files[0].base64 = invalid;
      expect(() => validateBackup(broken)).toThrow("文件格式");
    }
  });

  it("upgrades the known pre-resource v1 field without losing prior attempts", () => {
    const older = { ...createBackup(), version: 1 };
    delete older.data.practice_sets[0].resource_json;
    restoreBackup(older);
    const restored = createBackup();
    expect(restored.data.practice_sets[0].resource_json).toBe("{}");
    expect(restored.data.practice_attempts).toEqual(older.data.practice_attempts);
  });

  it("round-trips official document references and rejects missing referenced files", () => {
    const resource = {
      provider: "IELTS Partners", classification: "official-practice", sourceUrl: "https://ielts.org/test", licenseUrl: "https://ielts.org/legal", copyright: "IELTS Partners", verifiedAt: "2026-10-04", notes: "",
      questionDocuments: [{ label: "Original paper", url: "/api/uploads/1", sourceUrl: "https://ielts.org/test.pdf", page: 2 }], answerDocuments: [], audioTracks: [], transcriptDocuments: [],
    };
    holder.database!.prepare("UPDATE practice_sets SET resource_json=?").run(JSON.stringify(resource));
    const original = createBackup();
    restoreBackup(original);
    expect(JSON.parse(String(createBackup().data.practice_sets[0].resource_json))).toEqual(resource);
    const broken = structuredClone(original);
    broken.data.practice_sets[0].resource_json = JSON.stringify({ ...resource, questionDocuments: [{ ...resource.questionDocuments[0], url: "/api/uploads/999" }] });
    expect(() => validateBackup(broken)).toThrow("缺少关联");
    broken.data.practice_sets[0].resource_json = "null";
    expect(() => validateBackup(broken)).toThrow("资源信息格式无效");
  });

  it("round-trips every table and attachment byte, preserves old files, and excludes provider secrets", () => {
    const backup = createBackup();
    const tables = holder.database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    expect(Object.keys(backup.data).sort()).toEqual(tables.map((table) => table.name));
    expect(Object.entries(backup.data).filter(([table]) => !["vocabulary_sessions", "vocabulary_review_audit"].includes(table)).every(([, rows]) => rows.length > 0)).toBe(true);
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

  it("round-trips Passage ranges and rejects a filtered backup that loses original question references", () => {
    const resource = {
      provider: "个人阅读资料", classification: "user-supplied", copyright: "Synthetic fixture", verifiedAt: now,
      questionDocuments: [{ label: "原文与题目", url: "/api/uploads/1", page: 1 }],
      answerDocuments: [{ label: "参考答案", url: "/api/uploads/1", page: 3 }],
      readingPassages: [{ id: "passage-1", label: "Passage 1", documents: [{ label: "原文与题目", url: "/api/uploads/1", page: 1, endPage: 2 }], questionIds: ["q2"] }],
    };
    holder.database!.prepare("UPDATE practice_sets SET kind='reading', questions_json=?, resource_json=?").run(JSON.stringify([{ id: "q2", kind: "short-answer", prompt: "Synthetic", answers: ["sample"] }]), JSON.stringify(resource));
    const original = createBackup(); restoreBackup(original);
    expect(JSON.parse(String(createBackup().data.practice_sets[0].resource_json))).toEqual(resource);
    const broken = structuredClone(original);
    broken.data.practice_sets[0].resource_json = JSON.stringify({ ...resource, readingPassages: [{ ...resource.readingPassages[0], questionIds: ["q1"] }] });
    expect(() => restoreBackup(broken)).toThrow("不存在的题目");
    expect(createBackup().data).toEqual(original.data);
    broken.data.practice_sets[0].resource_json = JSON.stringify({ ...resource, readingPassages: [{ ...resource.readingPassages[0], documents: [{ ...resource.readingPassages[0].documents[0], url: "/api/uploads/999" }] }] });
    expect(() => restoreBackup(broken)).toThrow("资源信息格式无效");
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
