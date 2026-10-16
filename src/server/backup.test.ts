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
import { V3_VOCABULARY_TABLES } from "./backup-vocabulary-courses";
import { V4_VOCABULARY_TABLES } from "./backup-vocabulary-targets";
import { V5_DURABILITY_TABLES } from "./backup-durability";
import { getDataEpoch, assertDataEpoch } from "./data-integrity";
import { beginSubmission, submissionHash } from "./submissions";
import { initialMockState } from "../lib/mock-exam";
import { registerVocabularyCourse, listVocabularyCatalogEntries, getVocabularyStudy, saveVocabularyStudy, vocabularyExerciseForWord, VocabularyStudyConflict } from "./vocabulary-courses";
import { createVocabularyImportPreview, confirmVocabularyImport } from "./vocabulary-import";
import { startVocabularyAssessment, checkpointVocabularyAssessment, readVocabularyAssessment, submitVocabularyAssessment } from "./vocabulary-assessment";
import { createHash } from "node:crypto";
import type { VocabularyExerciseSnapshot } from "../lib/vocabulary-course";
import { vocabularyTargetSchema, type VocabularyTargetSnapshot } from "../lib/vocabulary-target";

let directory: string;
let uploadDirectory: string;
let originalFile: string;
const mediaBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 1, 2, 3, 255]);
const now = "2026-10-04T10:00:00.000Z";
const sessionId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const restoredDefaultStudy = { id: 1, active_course_id: null, daily_goal_seconds: 900, paused: 0, start_rank: 1, restore_version: 3,
  focus: "general", next_level: "B2", policy_version: 1, private_catalog_key: null };
function sessionState(wordId: string, phase: "front" | "revealed" = "front") {
  return { mode: "spelling", courseId: null, current: { wordId, wordVersion: 1, phase, answer: "evidance", gaveUp: false, confirmedTypo: false, audioPlayed: true, exercise: null, requestedRating: null, ratingSource: "automatic", supplemental: false, canSupplement: false, startedAt: now }, skippedIds: [], reviewed: 0, learned: 1, supplementalReviewed: 0, lastSubmissionId: null };
}
function addSession(wordId: string, phase: "front" | "revealed" = "front") {
  insert("vocabulary_sessions", { id: sessionId, revision: 1, status: "active", state_json: JSON.stringify(sessionState(wordId, phase)), started_at: now, updated_at: now });
}

function insert(table: string, values: Record<string, string | number | null>) {
  const columns = Object.keys(values);
  holder.database!.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(values));
}
function addSupplementalFixture(wordId: string, exercise: VocabularyExerciseSnapshot, overrides: Record<string, string | number | null> = {}) {
  insert("vocabulary_supplemental_attempts", { id: 1, submission_id: "44444444-4444-4444-8444-444444444444", session_id: sessionId, word_id: wordId,
    word_version: 1, mode: "context", user_answer: exercise.targetSurface, correct: 1, term_snapshot: "evidence", requested_rating: "good", effective_rating: "good",
    decision_reason: "correct_answer", confirmed_typo: 0, gave_up: 0, duration_seconds: 5, reviewed_at: now, next_due_at: now, rating_source: "automatic",
    exercise_json: JSON.stringify(exercise), course_id: exercise.courseId, ...overrides });
}
function addCourseFixtures() {
  for (const id of ["general", "academic"]) registerVocabularyCourse({ id, title: id, description: "Synthetic fixture", kind: "builtin", version: 1 }, Array.from({ length: id === "general" ? 20 : 10 }, (_, index) => {
    const term = `${id}${index}`;
    return { term, id: `${id}-${index}`, rank: id === "general" ? Math.floor(index / 4) * 500 + index % 4 + 1 : index + 1, meaningZh: "测试词", definitionEn: "Synthetic fixture word.", partOfSpeech: "noun",
      exercises: ["today", "yesterday"].map((time, n) => ({ id: `${id}-${index}-${n}`, version: 1, status: "published" as const, sentence: `We recorded ${term} ${time}.`, targetStart: 12, targetEnd: 12 + term.length, targetSurface: term, acceptedAnswers: [term], meaningZh: "测试词", source: "Synthetic fixture" })) };
  }), holder.database!);
}

function addAdvancedFixtures() {
  const database = holder.database!, word = listVocabularyEntries()[0];
  const pdfBytes = Buffer.from("%PDF-1.7\nSynthetic private vocabulary PDF\n%%EOF");
  const pdfPath = path.join(uploadDirectory, "private-vocabulary.pdf"); writeFileSync(pdfPath, pdfBytes);
  insert("source_materials", { id: 2, title: "Private vocabulary source", kind: "vocabulary", content: "Synthetic source entry",
    source_url: "", file_name: "private-vocabulary.pdf", mime_type: "application/pdf", file_path: pdfPath, created_at: now });
  const courseId = "advanced-fixture", entryId = "entry-evidence", targetId = "evidence-research";
  const targets = [targetId, "evidence-law"].map((id) => vocabularyTargetSchema.parse({ id, version: 1,
    partOfSpeech: "noun", meaningZh: id === targetId ? "研究证据" : "法律证据", definitionEn: "Facts that support a conclusion.", level: "B2",
    levelEvidence: [{ source: "Synthetic editorial fixture", scope: "editorial", level: "B2", note: "Test data, not a CEFR assertion." }],
    sourcePdf: { attachmentUrl: "/api/uploads/2", fileSha256: createHash("sha256").update(pdfBytes).digest("hex"), pdfPage: 1, quote: "evidence n. 证据" },
    memberships: [{ courseId, version: 1, rank: 1, exerciseIds: [`${id}-1`, `${id}-2`] }] }));
  registerVocabularyCourse({ id: courseId, title: "Advanced fixture", description: "Synthetic targets", kind: "builtin", version: 1 }, [{
    id: entryId, term: "evidence", meaningZh: "证据", definitionEn: "Facts supporting a conclusion.", partOfSpeech: "noun", rank: 1, targets,
    exercises: targets.flatMap((target) => ["The study collected evidence carefully.", "They compared evidence from two investigations."].map((sentence, index) => ({
      id: `${target.id}-${index + 1}`, version: 1, status: "published" as const, sentence, targetStart: sentence.indexOf("evidence"),
      targetEnd: sentence.indexOf("evidence") + 8, targetSurface: "evidence", acceptedAnswers: ["evidence"],
      meaningZh: target.meaningZh, source: "Synthetic original learning example", targetId: target.id }))) }], database);
  const entry = listVocabularyCatalogEntries(courseId, database)[0], { memberships: _memberships, ...content } = targets[0]; void _memberships;
  const target: VocabularyTargetSnapshot = { ...content, entryId, term: "evidence", normalizedTerm: "evidence", courseId, membershipVersion: 1 };
  const firstEvent = { targetId, version: 1, step: 1 as const, dueAt: now };
  const gradedExercise = { ...entry.exercises[0], entryId, courseId, target, purpose: "consolidation" as const, consolidation: firstEvent };
  addSession(word.id); addSupplementalFixture(word.id, gradedExercise);
  const dueAt = new Date(Date.parse(now) + 600_000).toISOString();
  insert("vocabulary_target_state", { target_id: targetId, word_id: word.id, normalized_term: "evidence", version: 2,
    paused: 0, introduced_at: new Date(Date.parse(now) - 60_000).toISOString(), step: 2, due_at: dueAt,
    last_submission_id: "44444444-4444-4444-8444-444444444444", updated_at: now });
  insert("vocabulary_target_state", { target_id: targets[1].id, word_id: null, normalized_term: "evidence", version: 1,
    paused: 1, introduced_at: null, step: 0, due_at: null, last_submission_id: null, updated_at: now });
  insert("vocabulary_term_dispositions", { normalized_term: "unrelated", paused: 1, version: 1, updated_at: now });
  const operations = [{ operationId: "66666666-6666-4666-8666-666666666666", action: "introduce-target",
    input: { operationId: "66666666-6666-4666-8666-666666666666", wordId: word.id, expectedVersion: word.reviewVersion,
      sessionId, expectedSessionRevision: 1, restoreVersion: 7, targetId, targetVersion: 1, expectedStateVersion: 0 } },
  { operationId: "77777777-7777-4777-8777-777777777777", action: "know-target",
    input: { operationId: "77777777-7777-4777-8777-777777777777", restoreVersion: 7, action: "know-target", targetId: targets[1].id, targetVersion: 1, expectedStateVersion: 0 } },
  { operationId: "88888888-8888-4888-8888-888888888888", action: "pause-term",
    input: { operationId: "88888888-8888-4888-8888-888888888888", restoreVersion: 7, action: "pause-term", term: "unrelated", expectedStateVersion: 0 } }];
  for (const operation of operations) insert("vocabulary_target_operations", { operation_id: operation.operationId, action: operation.action, request_json: JSON.stringify(operation.input), created_at: now });
  insert("vocabulary_study_preferences", { id: 1, active_course_id: courseId, daily_goal_seconds: 900, paused: 0, start_rank: 1, restore_version: 7,
    focus: "ielts-advanced", next_level: "B2", policy_version: 4, private_catalog_key: "private-fixture-v1" });
  const consolidation = { targetId, version: 2, step: 2 as const, dueAt };
  const exercise = { ...entry.exercises[1], entryId, courseId, target, purpose: "consolidation" as const, consolidation };
  const state = { ...sessionState(word.id), mode: "context", courseId, supplementalReviewed: 1, lastSubmissionId: "44444444-4444-4444-8444-444444444444",
    current: { ...sessionState(word.id).current, wordVersion: word.reviewVersion, answer: "evidance", audioPlayed: false, exercise,
      supplemental: true, target, purpose: "consolidation", targetStateVersion: 2, consolidation, restoreVersion: 7, policyVersion: 4 } };
  database.prepare("UPDATE vocabulary_sessions SET state_json=? WHERE id=?").run(JSON.stringify(state), sessionId);
  return { word, target, exercise, state, entryId, courseId };
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
  holder.database.exec("DELETE FROM vocabulary_review_audit; DELETE FROM vocabulary_sessions; DELETE FROM vocabulary_review_context;");
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
  it("strictly upgrades v4 without manufacturing run or submission identities", () => {
    const current = createBackup(), legacy = { ...structuredClone(current), version: 4 };
    for (const table of V5_DURABILITY_TABLES) delete legacy.data[table];
    const frozen = JSON.stringify(legacy), upgraded = validateBackup(legacy);
    expect(upgraded.version).toBe(5); expect(JSON.stringify(legacy)).toBe(frozen);
    expect(upgraded.data.app_data_state).toHaveLength(1);
    for (const table of V5_DURABILITY_TABLES.filter((table) => table !== "app_data_state")) expect(upgraded.data[table]).toEqual([]);
    for (const table of Object.keys(legacy.data)) expect(upgraded.data[table]).toEqual(legacy.data[table]);
    const invalid = { ...legacy, version: 5 }; expect(() => validateBackup(invalid)).toThrow("缺少数据表");
  });

  it("round-trips v5 durability records, invalidates old pages and releases restored active locks", () => {
    const db = holder.database!, epoch = getDataEpoch(db), runId = "66666666-6666-4666-8666-666666666666";
    const receiptId = "77777777-7777-4777-8777-777777777777", mockId = "88888888-8888-4888-8888-888888888888";
    const mockSubmissionId = "99999999-9999-4999-8999-999999999999", writerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    insert("practice_workspace_versions", { set_id: "sample-listening", revision: 3, run_id: runId, submission_id: receiptId, completed: 1 });
    insert("writing_draft_revisions", { draft_id: "draft-1", revision: 5 });
    insert("vocabulary_study_time_segments", { id: writerId, restore_version: 1, study_date: "2026-10-04", seconds: 5, created_at: now, updated_at: now });
    const request = { setId: "sample-listening", answers: { q1: "sample" } };
    insert("submission_receipts", { id: receiptId, kind: "practice", scope_id: runId, data_epoch: epoch, request_hash: submissionHash(request), request_json: JSON.stringify(request), status: "completed", result_json: '{"attempt":{"id":1}}', lease_id: null, lease_until: null, owner_pid: null, error: "", updated_at: now });
    const question = { id: "q1", kind: "short-answer", prompt: "Original fixture", answers: ["sample"], explanation: "Original answer" };
    const set = { id: "sample-listening", kind: "listening", title: "Original", subtitle: "Fixture", instructions: "Listen", passage: "", transcript: "Sample", audioUrl: "", durationMinutes: 20, questions: [question] };
    insert("practice_sets", { id: "sample-reading", kind: "reading", title: "Original", subtitle: "Fixture", instructions: "Read", passage: "Sample", transcript: "", audio_url: "", duration_minutes: 20, questions_json: JSON.stringify([question]), created_at: now });
    const state = { ...initialMockState(), paused: false, listeningAnswers: { q1: "sample" }, durations: { listening: 5, reading: 0, writing: 0 } };
    insert("mock_exam_sessions", { id: mockId, data_epoch: epoch, revision: 7, state_json: JSON.stringify(state), snapshot_json: JSON.stringify({ listeningSet: set, readingSet: { ...set, id: "sample-reading", kind: "reading", transcript: "", passage: "Sample" }, writingPrompt: "Discuss a topic." }), submission_id: mockSubmissionId, started_at: now, updated_at: now, status: "active", writer_id: writerId, lease_until: now, result_json: null });
    beginSubmission({ submissionId: mockSubmissionId, kind: "mock", scopeId: mockId, dataEpoch: epoch, payload: { essay: "Pending essay" } }, db);
    const backup = createBackup(); expect(validateBackup(backup).version).toBe(5);
    expect(V5_DURABILITY_TABLES.every((table) => backup.data[table].length > 0)).toBe(true);
    db.prepare("UPDATE practice_workspace_versions SET revision=10").run();
    db.prepare("UPDATE writing_draft_revisions SET revision=11").run();
    db.prepare("UPDATE mock_exam_sessions SET revision=12").run();
    restoreBackup(backup); const restored = createBackup();
    expect(() => assertDataEpoch(epoch, db)).toThrow();
    expect(restored.data.practice_workspace_versions[0].revision).toBe(12);
    expect(restored.data.writing_draft_revisions[0].revision).toBe(13);
    expect(restored.data.mock_exam_sessions[0]).toMatchObject({ revision: 14, writer_id: null, lease_until: null, data_epoch: getDataEpoch(db) });
    expect(JSON.parse(String(restored.data.mock_exam_sessions[0].state_json))).toEqual({ ...state, paused: true });
    expect(restored.data.submission_receipts.find((row) => row.id === mockSubmissionId)).toMatchObject({ status: "failed", lease_id: null, owner_pid: null });
    expect(restored.data.submission_receipts.find((row) => row.id === receiptId)).toMatchObject({ status: "completed", result_json: '{"attempt":{"id":1}}', data_epoch: getDataEpoch(db) });
    for (const table of ["vocabulary_study_time_segments", "practice_attempts", "vocabulary_reviews", "vocabulary_scheduler_state"]) expect(restored.data[table]).toEqual(backup.data[table]);
    expect(validateBackup(restored).version).toBe(5);
    const beforeFailure = getDataEpoch(db), bad = structuredClone(restored); bad.data.submission_receipts[0].request_hash = "invalid";
    expect(() => restoreBackup(bad)).toThrow("提交审计"); expect(getDataEpoch(db)).toBe(beforeFailure);
  });

  it("strictly migrates a complete v3 catalog without inferring targets, historical senses or new pause state", () => {
    addCourseFixtures(); addSession(listVocabularyEntries()[0].id);
    insert("vocabulary_study_preferences", { id: 1, active_course_id: "academic", daily_goal_seconds: 1200, paused: 1, start_rank: 37, restore_version: 5 });
    const current = createBackup(), legacy = { ...structuredClone(current), version: 3 };
    for (const table of V5_DURABILITY_TABLES) delete legacy.data[table];
    for (const table of V4_VOCABULARY_TABLES) delete legacy.data[table];
    for (const row of legacy.data.vocabulary_study_preferences) for (const column of ["focus", "next_level", "policy_version", "private_catalog_key"]) delete row[column];
    for (const row of legacy.data.vocabulary_catalog_entries) { const value = JSON.parse(String(row.data_json)); delete value.targets; row.data_json = JSON.stringify(value); }
    const frozen = JSON.stringify(legacy), migrated = validateBackup(legacy);
    expect(migrated.version).toBe(5); expect(JSON.stringify(legacy)).toBe(frozen);
    for (const table of V4_VOCABULARY_TABLES) expect(migrated.data[table]).toEqual([]);
    expect(migrated.data.vocabulary_study_preferences).toEqual(current.data.vocabulary_study_preferences);
    expect(migrated.data.vocabulary_catalog_entries).toEqual(current.data.vocabulary_catalog_entries);
    for (const table of ["vocabulary_words", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_scheduler_state", "vocabulary_sessions", "study_sessions"]) expect(migrated.data[table]).toEqual(legacy.data[table]);
    for (const table of V3_VOCABULARY_TABLES) { const bad = structuredClone(legacy); delete bad.data[table]; expect(() => validateBackup(bad)).toThrow("缺少数据表"); }
    const strict = { ...structuredClone(legacy), version: 4 }; expect(() => validateBackup(strict)).toThrow("缺少数据表");
    const unknownColumn = structuredClone(legacy); unknownColumn.data.vocabulary_study_preferences[0].unknown_preference = 1;
    expect(() => validateBackup(unknownColumn)).toThrow("缺少字段");
  });
  it("round-trips v4 target introduction, persistent pauses and exact active minute card without rewriting old schedules", () => {
    const fixture = addAdvancedFixtures(), backup = createBackup();
    expect(validateBackup(backup).version).toBe(5);
    expect(V4_VOCABULARY_TABLES.every((table) => backup.data[table].length > 0)).toBe(true);
    holder.database!.prepare("UPDATE vocabulary_study_preferences SET restore_version=18").run();
    holder.database!.prepare("UPDATE vocabulary_sessions SET revision=12").run();
    const reversed = structuredClone(backup); reversed.data.vocabulary_sessions.reverse();
    restoreBackup(reversed); const restored = createBackup();
    for (const table of [...V4_VOCABULARY_TABLES, "vocabulary_reviews", "vocabulary_review_details", "vocabulary_review_audit", "vocabulary_review_context", "vocabulary_supplemental_attempts", "vocabulary_words", "vocabulary_scheduler_state", "vocabulary_learning_state", "study_sessions"]) expect(restored.data[table]).toEqual(backup.data[table]);
    expect(readVocabularySession(holder.database!)).toMatchObject({ id: sessionId, status: "active", revision: 14,
      state: { ...fixture.state, current: { ...fixture.state.current, restoreVersion: 20 } } });
    expect(restored.data.vocabulary_study_preferences).toEqual([{ ...backup.data.vocabulary_study_preferences[0], restore_version: 20 }]);
    expect(restored.files).toEqual(backup.files);
    expect(() => requireVocabularySession(holder.database!, sessionId, 1)).toThrow();
  });
  it("validates frozen v4 senses independently of a later catalog edit", () => {
    const { entryId } = addAdvancedFixtures(), backup = createBackup();
    const changed = structuredClone(backup), row = changed.data.vocabulary_catalog_entries.find((entry) => entry.id === entryId)!;
    const entry = JSON.parse(String(row.data_json)); entry.targets[0].meaningZh = "之后修订的义项"; entry.targets[0].version = 2; row.data_json = JSON.stringify(entry);
    expect(validateBackup(changed).data.vocabulary_supplemental_attempts).toEqual(backup.data.vocabulary_supplemental_attempts);
    expect(validateBackup(changed).data.vocabulary_sessions).toEqual(backup.data.vocabulary_sessions);
  });
  it("retains a frozen course after its live membership changes without weakening current target associations", () => {
    const { entryId } = addAdvancedFixtures(), backup = createBackup(), changed = structuredClone(backup);
    changed.data.vocabulary_courses.push({ ...changed.data.vocabulary_courses[0], id: "later-course", title: "Later membership" });
    const row = changed.data.vocabulary_catalog_entries.find((entry) => entry.id === entryId)!;
    const entry = JSON.parse(String(row.data_json)); entry.courseIds = ["later-course"];
    for (const target of entry.targets) target.memberships = target.memberships.map((member: { courseId: string; version: number }) =>
      ({ ...member, courseId: "later-course", version: 2 }));
    row.data_json = JSON.stringify(entry);
    expect(validateBackup(changed).data.vocabulary_sessions).toEqual(backup.data.vocabulary_sessions);
    expect(validateBackup(changed).data.vocabulary_supplemental_attempts).toEqual(backup.data.vocabulary_supplemental_attempts);
    const invalidCurrent = structuredClone(changed), raw = JSON.parse(String(invalidCurrent.data.vocabulary_catalog_entries[0].data_json));
    raw.targets[0].memberships[0].courseId = "advanced-fixture";
    invalidCurrent.data.vocabulary_catalog_entries[0].data_json = JSON.stringify(raw);
    expect(() => validateBackup(invalidCurrent)).toThrow("目标课程关联");
  });
  it("rejects malformed v4 references, minute events and operation payloads before staging any attachment", () => {
    addAdvancedFixtures(); const backup = createBackup(), filesBefore = readdirSync(uploadDirectory).sort();
    const mutations: ((snapshot: typeof backup) => void)[] = [
      (snapshot) => { delete snapshot.data.vocabulary_target_state; },
      (snapshot) => { snapshot.data.vocabulary_target_state[0].version = "2"; },
      (snapshot) => { snapshot.data.vocabulary_target_state[0].due_at = null; },
      (snapshot) => { snapshot.data.vocabulary_target_state[0].target_id = "missing"; },
      (snapshot) => { snapshot.data.vocabulary_words.push({ ...snapshot.data.vocabulary_words[0], id: "another-word", term: "another" });
        snapshot.data.vocabulary_target_state[0].word_id = "another-word"; },
      (snapshot) => { snapshot.data.vocabulary_target_state[0].last_submission_id = "99999999-9999-4999-8999-999999999999"; },
      (snapshot) => { snapshot.data.vocabulary_term_dispositions[0].normalized_term = "Unrelated"; },
      (snapshot) => { snapshot.data.vocabulary_term_dispositions[0].paused = "1"; },
      (snapshot) => { snapshot.data.vocabulary_study_preferences[0].focus = "mastered"; },
      (snapshot) => { snapshot.data.vocabulary_target_operations[0].action = "know-target"; },
      (snapshot) => { const value = JSON.parse(String(snapshot.data.vocabulary_target_operations[0].request_json)); value.unknown = true; snapshot.data.vocabulary_target_operations[0].request_json = JSON.stringify(value); },
      (snapshot) => { const value = JSON.parse(String(snapshot.data.vocabulary_sessions[0].state_json)); value.current.consolidation.targetId = "missing"; snapshot.data.vocabulary_sessions[0].state_json = JSON.stringify(value); },
      (snapshot) => { const row = snapshot.data.vocabulary_catalog_entries[0], value = JSON.parse(String(row.data_json)); value.targets[0].sourcePdf.fileSha256 = "a".repeat(64); row.data_json = JSON.stringify(value); },
      (snapshot) => { const row = snapshot.data.vocabulary_catalog_entries[0], value = JSON.parse(String(row.data_json)); value.targets[0].memberships[0].exerciseIds[0] = "missing"; row.data_json = JSON.stringify(value); },
    ];
    for (const mutate of mutations) { const invalid = structuredClone(backup); mutate(invalid); expect(() => restoreBackup(invalid)).toThrow();
      expect(createBackup().data).toEqual(backup.data); expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore); }
    const badHistoryPdf = structuredClone(backup), history = JSON.parse(String(badHistoryPdf.data.vocabulary_supplemental_attempts[0].exercise_json));
    history.target.sourcePdf.attachmentUrl = "/api/uploads/999"; badHistoryPdf.data.vocabulary_supplemental_attempts[0].exercise_json = JSON.stringify(history);
    expect(() => validateBackup(badHistoryPdf)).toThrow("PDF 来源");
  });
  it("rolls back v4 operations, target due times, session tokens and new media when final SQL integrity fails", () => {
    addAdvancedFixtures(); const original = createBackup(), broken = structuredClone(original);
    broken.data.vocabulary_metadata[0].word_id = "missing-word";
    const filesBefore = readdirSync(uploadDirectory).sort(); expect(() => restoreBackup(broken)).toThrow("关联关系损坏");
    expect(createBackup().data).toEqual(original.data); expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
    expect(holder.database!.pragma("foreign_keys", { simple: true })).toBe(1);
  });
  it("exports explicit v3 defaults from legacy active JSON without changing the original database row", () => {
    const state = sessionState(listVocabularyEntries()[0].id);
    const legacy = JSON.parse(JSON.stringify(state)); delete legacy.courseId; delete legacy.current.exercise; delete legacy.current.requestedRating; delete legacy.current.ratingSource;
    delete legacy.supplementalReviewed; delete legacy.current.supplemental; delete legacy.current.canSupplement;
    const raw = JSON.stringify(legacy);
    insert("vocabulary_sessions", { id: sessionId, revision: 1, status: "active", state_json: raw, started_at: now, updated_at: now });
    const exported = createBackup(); expect(validateBackup(exported).version).toBe(5);
    expect(JSON.parse(String(exported.data.vocabulary_sessions[0].state_json))).toEqual(state);
    expect(holder.database!.prepare("SELECT state_json FROM vocabulary_sessions WHERE id=?").get(sessionId)).toEqual({ state_json: raw });
  });
  it("strictly upgrades complete v2 snapshots without inventing old course or answer provenance", () => {
    addSession(listVocabularyEntries()[0].id);
    const legacy = { ...createBackup(), version: 2 };
    for (const table of V5_DURABILITY_TABLES) delete legacy.data[table];
    for (const table of [...V3_VOCABULARY_TABLES, ...V4_VOCABULARY_TABLES]) delete legacy.data[table];
    const state = JSON.parse(String(legacy.data.vocabulary_sessions[0].state_json));
    delete state.courseId; delete state.current.exercise; delete state.current.requestedRating; delete state.current.ratingSource;
    delete state.supplementalReviewed; delete state.current.supplemental; delete state.current.canSupplement;
    legacy.data.vocabulary_sessions[0].state_json = JSON.stringify(state);
    const raw = JSON.stringify(legacy), migrated = validateBackup(legacy);
    expect(JSON.stringify(legacy)).toBe(raw); expect(migrated.version).toBe(5);
    expect(JSON.parse(String(migrated.data.vocabulary_sessions[0].state_json))).toMatchObject({ courseId: null, supplementalReviewed: 0, current: { exercise: null, requestedRating: null, ratingSource: "automatic", supplemental: false, canSupplement: false } });
    expect(migrated.data.vocabulary_review_context).toEqual([]);
    expect(migrated.data.vocabulary_supplemental_attempts).toEqual([]);
    for (const table of ["vocabulary_words", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_scheduler_state"]) expect(migrated.data[table]).toEqual(legacy.data[table]);
    const bad = structuredClone(legacy); delete bad.data.vocabulary_review_details;
    expect(() => validateBackup(bad)).toThrow("缺少数据表");
    const strict = createBackup(); strict.data.vocabulary_sessions[0].state_json = legacy.data.vocabulary_sessions[0].state_json;
    expect(() => validateBackup(strict)).toThrow("会话状态");
  });

  it("round-trips all ten v3 tables and unfinished assessment while invalidating stale feature revisions", () => {
    addCourseFixtures(); const database = holder.database!, wordId = listVocabularyEntries()[0].id;
    const entry = listVocabularyCatalogEntries(undefined, database)[0];
    const exercise = { ...entry.exercises[0], entryId: entry.id, courseId: entry.courseIds[0] };
    addSession(wordId);
    addSupplementalFixture(wordId, exercise);
    insert("vocabulary_catalog_links", { entry_id: entry.id, word_id: wordId, detached: 0 });
    insert("vocabulary_word_context", { word_id: wordId, exercise_json: JSON.stringify(exercise), last_exercise_id: exercise.id });
    insert("vocabulary_review_context", { review_id: 1, rating_source: "automatic", exercise_json: JSON.stringify(exercise), course_id: exercise.courseId });
    insert("vocabulary_study_preferences", { id: 1, active_course_id: "academic", daily_goal_seconds: 900, paused: 0, start_rank: 1, restore_version: 1 });
    insert("vocabulary_study_heartbeats", { id: "heartbeat-fixture", study_date: "2026-10-04", seconds: 15, created_at: now });
    const preview = createVocabularyImportPreview("fixture.csv", [["word"], ["original"]], database);
    const confirmedPreview = createVocabularyImportPreview("confirmed.csv", [["word"], ["confirmedword"]], database);
    const confirmation = confirmVocabularyImport(confirmedPreview.previewId, 1, "Confirmed fixture", database);
    const assessment = startVocabularyAssessment(listVocabularyCatalogEntries(undefined, database), database);
    const saved = checkpointVocabularyAssessment(assessment.id, assessment.revision, { answers: { [assessment.questions[0].id]: "unfinished" }, currentIndex: 1 }, database);
    const backup = createBackup(); expect(V3_VOCABULARY_TABLES.every((table) => backup.data[table].length > 0)).toBe(true);
    database.prepare("UPDATE vocabulary_assessments SET revision=12").run();
    restoreBackup(backup);
    const restored = createBackup();
    expect(readVocabularyAssessment(database)).toMatchObject({ id: saved.id, revision: 14, status: "active", draft: saved.draft, result: null });
    expect(() => checkpointVocabularyAssessment(saved.id, saved.revision, saved.draft, database)).toThrow();
    expect(() => confirmVocabularyImport(preview.previewId, preview.revision, "Stale", database)).toThrow();
    expect(() => confirmVocabularyImport(confirmedPreview.previewId, 1, "Confirmed fixture", database)).toThrow();
    expect(JSON.parse(String(restored.data.vocabulary_import_previews.find((row) => row.id === confirmedPreview.previewId)!.preview_json)).confirmation).toEqual(confirmation);
    expect(restored.data.vocabulary_study_preferences).toEqual([{ ...backup.data.vocabulary_study_preferences[0], restore_version: 3 }]);
    for (const table of V3_VOCABULARY_TABLES.filter((name) => !["vocabulary_import_previews", "vocabulary_assessments", "vocabulary_study_preferences"].includes(name))) expect(restored.data[table]).toEqual(backup.data[table]);
    for (const table of V3_VOCABULARY_TABLES) { const broken = structuredClone(backup); delete broken.data[table]; expect(() => validateBackup(broken)).toThrow("缺少数据表"); }
    const broken = structuredClone(restored); broken.data.vocabulary_catalog_links[0].entry_id = "missing-entry";
    expect(() => restoreBackup(broken)).toThrow("关联关系损坏"); expect(createBackup().data).toEqual(restored.data);
  });

  it("preserves auxiliary raw errors, immutable target snapshots and FSRS state through restore", () => {
    addCourseFixtures(); const database = holder.database!, word = listVocabularyEntries()[0];
    const entry = listVocabularyCatalogEntries("general", database)[0], exercise = { ...entry.exercises[0], entryId: entry.id, courseId: "general" };
    addSession(word.id);
    addSupplementalFixture(word.id, exercise, { user_answer: exercise.targetSurface.slice(0, -1), correct: 0, confirmed_typo: 1, decision_reason: "confirmed_typo", rating_source: "self" });
    const state = { ...sessionState(word.id, "revealed"), mode: "context", supplementalReviewed: 2,
      current: { ...sessionState(word.id, "revealed").current, wordVersion: word.reviewVersion, exercise, answer: exercise.targetSurface.slice(0, -1), confirmedTypo: true, supplemental: true, canSupplement: false, requestedRating: "good" } };
    database.prepare("UPDATE vocabulary_sessions SET state_json=? WHERE id=?").run(JSON.stringify(state), sessionId);
    database.prepare("UPDATE vocabulary_words SET term='changed-after-auxiliary'").run();
    const snapshot = createBackup(); expect(validateBackup(snapshot).version).toBe(5);
    restoreBackup(snapshot); const restored = createBackup();
    for (const table of ["vocabulary_words", "vocabulary_learning_state", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_scheduler_state", "vocabulary_supplemental_attempts"]) expect(restored.data[table]).toEqual(snapshot.data[table]);
    expect(readVocabularySession(database)).toMatchObject({ id: sessionId, revision: 3, status: "active", state });
    expect(restored.data.vocabulary_supplemental_attempts[0]).toMatchObject({ correct: 0, confirmed_typo: 1, term_snapshot: "evidence", effective_rating: "good" });
  });

  it("rejects malformed auxiliary typing, decision audit, target and foreign references before replacement", () => {
    addCourseFixtures(); const database = holder.database!, word = listVocabularyEntries()[0];
    const entry = listVocabularyCatalogEntries("general", database)[0], exercise = { ...entry.exercises[0], entryId: entry.id, courseId: "general" };
    addSession(word.id); addSupplementalFixture(word.id, exercise);
    const original = createBackup(), filesBefore = readdirSync(uploadDirectory).sort();
    const changes: Record<string, string | number | null>[] = [
      { correct: "1" }, { confirmed_typo: "0" }, { duration_seconds: -1 }, { word_version: 0 }, { mode: "spelling" },
      { session_id: "missing" }, { word_id: "missing" }, { course_id: "academic" }, { submission_id: "not-a-uuid" },
      { correct: 0 }, { confirmed_typo: 1 }, { decision_reason: "incorrect_answer" }, { gave_up: 1 }, { user_answer: "" },
      { exercise_json: "null" }, { exercise_json: JSON.stringify({ ...exercise, targetStart: 0 }) },
      { exercise_json: JSON.stringify({ ...exercise, status: "draft" }) },
    ];
    for (const change of changes) {
      const bad = structuredClone(original); Object.assign(bad.data.vocabulary_supplemental_attempts[0], change);
      expect(() => restoreBackup(bad)).toThrow();
      expect(createBackup().data).toEqual(original.data);
      expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
    }
    const duplicate = structuredClone(original); duplicate.data.vocabulary_supplemental_attempts.push({ ...duplicate.data.vocabulary_supplemental_attempts[0], id: 2 });
    expect(() => validateBackup(duplicate)).toThrow("提交重复");
    const missingFlag = structuredClone(original), state = JSON.parse(String(missingFlag.data.vocabulary_sessions[0].state_json));
    delete state.supplementalReviewed; missingFlag.data.vocabulary_sessions[0].state_json = JSON.stringify(state);
    expect(() => validateBackup(missingFlag)).toThrow("会话状态");
  });

  it("selects the active vocabulary draft after a restore reorders ended and active records", () => {
    const word = listVocabularyEntries()[0]; addSession(word.id);
    const endedId = "55555555-5555-4555-8555-555555555555", timestamp = "2026-10-05T10:00:00.000Z";
    insert("vocabulary_sessions", { id: endedId, revision: 4, status: "ended", state_json: JSON.stringify({ ...sessionState(word.id), current: null }), started_at: timestamp, updated_at: timestamp });
    const snapshot = createBackup(); snapshot.data.vocabulary_sessions.reverse();
    restoreBackup(snapshot);
    expect(readVocabularySession(holder.database!)).toMatchObject({ id: sessionId, status: "active", revision: 3, state: { current: { answer: "evidance" } } });
    snapshot.data.vocabulary_sessions.reverse(); restoreBackup(snapshot);
    expect(readVocabularySession(holder.database!)).toMatchObject({ id: sessionId, status: "active", revision: 5, state: { current: { answer: "evidance" } } });
  });

  it("round-trips an actual personal-sentence review made while a catalog course is selected", () => {
    addCourseFixtures();
    const word = listVocabularyEntries()[0], exercise = vocabularyExerciseForWord(word, "general", holder.database!);
    expect(exercise).toMatchObject({ entryId: null, courseId: null, status: "published" });
    const state = { ...sessionState(word.id), mode: "context", courseId: "general", current: { ...sessionState(word.id, "revealed").current, wordVersion: word.reviewVersion, answer: exercise!.targetSurface, exercise } };
    insert("vocabulary_sessions", { id: sessionId, revision: 1, status: "active", state_json: JSON.stringify(state), started_at: now, updated_at: now });
    const result = reviewVocabularyEntry(word.id, { rating: "good", mode: "context", userAnswer: exercise!.targetSurface, durationSeconds: 9, expectedVersion: word.reviewVersion, sessionId, expectedSessionRevision: 1, submissionId, confirmedTypo: false, gaveUp: false }, new Date(Date.parse(now) + 86400000));
    expect(result!.review).toMatchObject({ correct: true, courseId: "general", exercise });
    const backup = createBackup(); expect(validateBackup(backup).version).toBe(5);
    restoreBackup(backup);
    const restored = createBackup();
    for (const table of ["vocabulary_words", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_review_audit", "vocabulary_review_context", "vocabulary_scheduler_state"]) expect(restored.data[table]).toEqual(backup.data[table]);
    const entry = listVocabularyCatalogEntries("general", holder.database!)[0];
    for (const changed of [{ ...exercise, entryId: entry.id }, { ...exercise, courseId: "general" }]) {
      const invalid = structuredClone(backup); invalid.data.vocabulary_review_context[0].exercise_json = JSON.stringify(changed);
      expect(() => validateBackup(invalid)).toThrow("必须同时存在或同时为空");
    }
    const mismatch = structuredClone(backup);
    mismatch.data.vocabulary_review_context[0].exercise_json = JSON.stringify({ ...entry.exercises[0], entryId: entry.id, courseId: "general" });
    mismatch.data.vocabulary_review_context[0].course_id = "academic";
    expect(() => validateBackup(mismatch)).toThrow("评分题面课程不一致");
  });

  it("verifies reading provenance SHA, passage identity and both ends of the allowed PDF page range", () => {
    addCourseFixtures(); const database = holder.database!;
    const resource = { provider: "个人阅读资料", classification: "user-supplied", copyright: "Synthetic fixture", verifiedAt: now, questionDocuments: [{ label: "Body", url: "/api/uploads/1", page: 2, endPage: 3 }], readingPassages: [{ id: "fixture-passage", label: "Passage", documents: [{ label: "Body", url: "/api/uploads/1", page: 2, endPage: 3 }], questionIds: [] }] };
    database.prepare("UPDATE practice_sets SET kind='reading',resource_json=?").run(JSON.stringify(resource));
    const entry = listVocabularyCatalogEntries(undefined, database)[0];
    entry.exercises[0].sourceReference = { materialId: "1", fileSha256: createHash("sha256").update(mediaBytes).digest("hex"), passageId: "fixture-passage", pdfPage: 2, endPdfPage: 3, textVersion: "reading-body-v1", start: 0, end: entry.exercises[0].sentence.length, quote: entry.exercises[0].sentence };
    database.prepare("UPDATE vocabulary_catalog_entries SET data_json=? WHERE id=?").run(JSON.stringify(entry), entry.id);
    const word = listVocabularyEntries()[0]; addSession(word.id);
    addSupplementalFixture(word.id, { ...entry.exercises[0], entryId: entry.id, courseId: entry.courseIds[0] });
    const good = createBackup(); expect(validateBackup(good).version).toBe(5);
    for (const [key, value] of [["materialId", "999"], ["fileSha256", "a".repeat(64)], ["passageId", "missing"], ["pdfPage", 1], ["endPdfPage", 4]] as const) {
      const bad = structuredClone(good), row = bad.data.vocabulary_catalog_entries.find((item) => item.id === entry.id)!;
      const changed = JSON.parse(String(row.data_json)); changed.exercises[0].sourceReference[key] = value; row.data_json = JSON.stringify(changed);
      expect(() => validateBackup(bad)).toThrow("来源");
    }
    const invalidAuxiliary = structuredClone(good), auxiliary = JSON.parse(String(invalidAuxiliary.data.vocabulary_supplemental_attempts[0].exercise_json));
    auxiliary.sourceReference.fileSha256 = "a".repeat(64); invalidAuxiliary.data.vocabulary_supplemental_attempts[0].exercise_json = JSON.stringify(auxiliary);
    expect(() => validateBackup(invalidAuxiliary)).toThrow("来源附件 SHA256");
  });
  it("validates completed assessment results and import readiness against their saved snapshots", () => {
    addCourseFixtures(); const database = holder.database!;
    const active = startVocabularyAssessment(listVocabularyCatalogEntries(undefined, database), database);
    const saved = checkpointVocabularyAssessment(active.id, active.revision, { answers: Object.fromEntries(active.questions.map((question) => [question.id, ""])), currentIndex: 30 }, database);
    submitVocabularyAssessment(active.id, saved.revision, database);
    createVocabularyImportPreview("pending.txt", [["pending"]], database);
    const good = createBackup(); expect(validateBackup(good).version).toBe(5);
    const badResult = structuredClone(good), result = JSON.parse(String(badResult.data.vocabulary_assessments[0].result_json));
    result.correct = 30; badResult.data.vocabulary_assessments[0].result_json = JSON.stringify(result);
    expect(() => validateBackup(badResult)).toThrow("测评结果");
    const badPreview = structuredClone(good), preview = JSON.parse(String(badPreview.data.vocabulary_import_previews[0].preview_json));
    preview.readiness.pending = 0; badPreview.data.vocabulary_import_previews[0].preview_json = JSON.stringify(preview);
    expect(() => validateBackup(badPreview)).toThrow("待完善数量");
  });
  it("expires heartbeat write tokens during restore and accepts only the newly fetched token", () => {
    addCourseFixtures(); const database = holder.database!;
    insert("vocabulary_study_preferences", { id: 1, active_course_id: "academic", daily_goal_seconds: 1200, paused: 1, start_rank: 37, restore_version: 5 });
    const backup = createBackup(); database.prepare("UPDATE vocabulary_study_preferences SET restore_version=12").run();
    restoreBackup(backup);
    expect(getVocabularyStudy(new Date(now), database).restoreVersion).toBe(14);
    const before = createBackup().data;
    expect(before.vocabulary_study_preferences).toEqual([{ ...backup.data.vocabulary_study_preferences[0], restore_version: 14 }]);
    for (const restoreVersion of [5, 12]) expect(() => saveVocabularyStudy({ restoreVersion, heartbeat: { id: "44444444-4444-4444-8444-444444444444", seconds: 15 } }, new Date(now), database)).toThrow(VocabularyStudyConflict);
    expect(createBackup().data).toEqual(before);
    const current = saveVocabularyStudy({ restoreVersion: 14, heartbeat: { id: "44444444-4444-4444-8444-444444444444", seconds: 15 } }, new Date(now), database);
    expect(current.todaySeconds).toBe(15);
    restoreBackup(backup);
    expect(getVocabularyStudy(new Date(now), database).restoreVersion).toBe(16);
    const repeated = createBackup();
    expect(repeated.data.vocabulary_study_heartbeats).toEqual(backup.data.vocabulary_study_heartbeats);
    expect(() => saveVocabularyStudy({ restoreVersion: 14, heartbeat: { id: "55555555-5555-4555-8555-555555555555", seconds: 15 } }, new Date(now), database)).toThrow(VocabularyStudyConflict);
  });

  it.each([1, 2, 3, 4])("invalidates token 1 when a version %s snapshot has no study preference row", (version) => {
    const original = createBackup(), incoming = { ...structuredClone(original), version };
    for (const table of V5_DURABILITY_TABLES) delete incoming.data[table];
    if (version < 3) for (const table of V3_VOCABULARY_TABLES) delete incoming.data[table];
    if (version < 4) for (const table of V4_VOCABULARY_TABLES) delete incoming.data[table];
    if (version === 1) for (const table of ["vocabulary_learning_state", "vocabulary_sessions", "vocabulary_review_audit"]) delete incoming.data[table];
    expect(validateBackup(incoming).data.vocabulary_study_preferences).toEqual([]);
    expect(getVocabularyStudy(new Date(now), holder.database!).restoreVersion).toBe(1);
    restoreBackup(incoming);
    const restored = createBackup();
    expect(restored.data.vocabulary_study_preferences).toEqual([restoredDefaultStudy]);
    for (const table of ["vocabulary_words", "vocabulary_reviews", "vocabulary_review_details", "vocabulary_scheduler_state", "study_sessions"]) expect(restored.data[table]).toEqual(original.data[table]);
    expect(() => saveVocabularyStudy({ restoreVersion: 1, dailyGoalSeconds: 60, paused: true, heartbeat: { id: "44444444-4444-4444-8444-444444444444", seconds: 15 } }, new Date(now), holder.database!)).toThrow(VocabularyStudyConflict);
    expect(createBackup().data).toEqual(restored.data);
    expect(saveVocabularyStudy({ restoreVersion: 3, heartbeat: { id: "44444444-4444-4444-8444-444444444444", seconds: 15 } }, new Date(now), holder.database!)).toMatchObject({ restoreVersion: 3, activeCourseId: null, todaySeconds: 15 });
  });

  it("initializes missing study settings against restored courses and the previous local token", () => {
    addCourseFixtures(); const incoming = createBackup();
    insert("vocabulary_study_preferences", { id: 1, active_course_id: "general", daily_goal_seconds: 3600, paused: 1, start_rank: 501, restore_version: 18 });
    restoreBackup(incoming);
    expect(createBackup().data.vocabulary_study_preferences).toEqual([{ ...restoredDefaultStudy, active_course_id: "academic", restore_version: 20 }]);
    expect(() => saveVocabularyStudy({ restoreVersion: 18, paused: true }, new Date(now), holder.database!)).toThrow(VocabularyStudyConflict);
  });

  it("requires a valid v3 timer token and rolls it back with the rest of a failed restore", () => {
    addCourseFixtures();
    insert("vocabulary_study_preferences", { id: 1, active_course_id: "academic", daily_goal_seconds: 900, paused: 0, start_rank: 1, restore_version: 7 });
    const original = createBackup();
    const missing = structuredClone(original); delete missing.data.vocabulary_study_preferences[0].restore_version;
    expect(() => validateBackup(missing)).toThrow("缺少字段");
    for (const token of [0, 1.5, Number.MAX_SAFE_INTEGER - 1, "7"]) {
      const bad = structuredClone(original); bad.data.vocabulary_study_preferences[0].restore_version = token;
      expect(() => validateBackup(bad)).toThrow("学习设置");
    }
    const bad = structuredClone(original); bad.data.vocabulary_metadata[0].word_id = "missing-word";
    const filesBefore = readdirSync(uploadDirectory).sort();
    expect(() => restoreBackup(bad)).toThrow("关联关系损坏");
    expect(createBackup().data).toEqual(original.data);
    expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
    const exhausted = structuredClone(original); exhausted.data.vocabulary_study_preferences[0].restore_version = Number.MAX_SAFE_INTEGER - 2;
    expect(() => restoreBackup(exhausted)).toThrow("计时恢复版本超出安全范围");
    expect(createBackup().data).toEqual(original.data);
    expect(readdirSync(uploadDirectory).sort()).toEqual(filesBefore);
  });
  it("migrates only the known v1 vocabulary additions without changing raw history or FSRS state", () => {
    const original = createBackup();
    const legacy = { ...structuredClone(original), version: 1 };
    for (const table of V5_DURABILITY_TABLES) delete legacy.data[table];
    for (const table of ["vocabulary_learning_state", "vocabulary_sessions", "vocabulary_review_audit", ...V3_VOCABULARY_TABLES, ...V4_VOCABULARY_TABLES]) delete legacy.data[table];
    const frozenInput = JSON.stringify(legacy);
    expect(validateBackup(legacy).version).toBe(5);
    expect(JSON.stringify(legacy)).toBe(frozenInput);
    restoreBackup(legacy);
    const restored = createBackup();
    expect(restored.version).toBe(5);
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
    for (const table of V5_DURABILITY_TABLES) delete older.data[table];
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
    expect(Object.entries(backup.data).filter(([table]) => !["vocabulary_sessions", "vocabulary_review_audit", ...V3_VOCABULARY_TABLES, ...V4_VOCABULARY_TABLES, ...V5_DURABILITY_TABLES].includes(table)).every(([, rows]) => rows.length > 0)).toBe(true);
    expect(backup.data.source_materials[0].file_path).toBe("upload:1");
    expect(JSON.stringify(backup)).not.toContain("test-secret-must-not-be-exported");
    holder.database!.prepare("UPDATE vocabulary_words SET meaning_zh = 'Changed after backup'").run();
    const result = restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(existsSync(result.safetyBackup)).toBe(true);
    expect(readFileSync(result.safetyBackup, "utf8")).toContain("Changed after backup");
    const restored = createBackup();
    expect(restored.data).toEqual({ ...backup.data, app_data_state: restored.data.app_data_state, vocabulary_study_preferences: [restoredDefaultStudy] });
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
    const original = createBackup(); restoreBackup(original); const restored = createBackup();
    expect(JSON.parse(String(createBackup().data.practice_sets[0].resource_json))).toEqual(resource);
    const broken = structuredClone(original);
    broken.data.practice_sets[0].resource_json = JSON.stringify({ ...resource, readingPassages: [{ ...resource.readingPassages[0], questionIds: ["q1"] }] });
    expect(() => restoreBackup(broken)).toThrow("不存在的题目");
    expect(createBackup().data).toEqual(restored.data);
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
    expect(createBackup().data).toEqual({ ...healthy.data, app_data_state: createBackup().data.app_data_state, vocabulary_study_preferences: [restoredDefaultStudy] });
    expect(createBackup().files).toEqual(healthy.files);
  });
});
