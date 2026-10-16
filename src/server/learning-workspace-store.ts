import "server-only";
import { randomUUID } from "node:crypto";
import type { PracticeAttempt, PracticeQuestion } from "@/lib/domain";
import { compareDictation } from "@/lib/dictation";
import { emptyMaterialMetadata, emptyPracticeDraft, type MaterialMetadata, type PassageAnnotation, type PracticeDraft, type PracticeWorkspaceState } from "@/lib/learning-workspace";
import { getDatabase } from "./db";
import { assertDataEpoch, DataIntegrityConflict, getDataEpoch } from "./data-integrity";
import { createPracticeSet, getMaterial, getPracticeSet } from "./store";

export function ensureLearningTables() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS material_metadata (material_id INTEGER PRIMARY KEY REFERENCES source_materials(id) ON DELETE CASCADE, metadata_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS practice_annotations (set_id TEXT PRIMARY KEY REFERENCES practice_sets(id) ON DELETE CASCADE, annotations_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS practice_drafts (set_id TEXT PRIMARY KEY REFERENCES practice_sets(id) ON DELETE CASCADE, draft_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS practice_workspace_versions (set_id TEXT PRIMARY KEY REFERENCES practice_sets(id) ON DELETE CASCADE, revision INTEGER NOT NULL, run_id TEXT NOT NULL, submission_id TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS practice_mistake_reasons (attempt_id INTEGER NOT NULL REFERENCES practice_attempts(id) ON DELETE CASCADE, question_id TEXT NOT NULL, reason TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(attempt_id, question_id));
    CREATE TABLE IF NOT EXISTS dictation_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, set_id TEXT NOT NULL REFERENCES practice_sets(id) ON DELETE CASCADE, expected TEXT NOT NULL, submitted TEXT NOT NULL, errors_json TEXT NOT NULL, start_seconds REAL, end_seconds REAL, created_at TEXT NOT NULL);
  `);
}
export function getMaterialMetadata(id: number): MaterialMetadata {
  ensureLearningTables();
  const row = getDatabase().prepare("SELECT metadata_json FROM material_metadata WHERE material_id = ?").get(id) as { metadata_json: string } | undefined;
  return row ? { ...emptyMaterialMetadata, ...JSON.parse(row.metadata_json) } : { ...emptyMaterialMetadata };
}
export function updateMaterial(id: number, input: { title: string; content: string; sourceUrl: string; metadata: MaterialMetadata }) {
  ensureLearningTables();
  if (!getMaterial(id)) return null;
  getDatabase().transaction(() => {
    getDatabase().prepare("UPDATE source_materials SET title = ?, content = ?, source_url = ? WHERE id = ?").run(input.title, input.content, input.sourceUrl, id);
    getDatabase().prepare("INSERT INTO material_metadata (material_id, metadata_json) VALUES (?, ?) ON CONFLICT(material_id) DO UPDATE SET metadata_json = excluded.metadata_json").run(id, JSON.stringify(input.metadata));
    // Pure study sets track the latest transcript; scored sets remain immutable snapshots.
    getDatabase().prepare("UPDATE practice_sets SET title = ?, passage = CASE WHEN kind = 'reading' THEN ? ELSE passage END, transcript = CASE WHEN kind = 'listening' THEN ? ELSE transcript END WHERE id = ?").run(input.title, input.content, input.content, `material-${id}-study`);
  })();
  return getMaterial(id);
}
export function createMaterialPractice(id: number, questions: PracticeQuestion[], durationMinutes: number) {
  const material = getMaterial(id);
  if (!material || !["reading", "listening"].includes(material.kind)) return null;
  const kind = material.kind as "reading" | "listening";
  const setId = questions.length ? `material-${id}-${randomUUID()}` : `material-${id}-study`;
  const existing = getPracticeSet(setId);
  if (existing) return existing;
  return createPracticeSet({ id: setId, kind, title: material.title, subtitle: "个人学习资料 · 本地保存", instructions: questions.length ? "完成题目后提交评分；原文证据和解析由你录入。" : "自由学习：选词、标注、记笔记，或练习听写。", passage: kind === "reading" ? material.content : "", transcript: kind === "listening" && !material.content.startsWith("Audio source") ? material.content : "", audioUrl: kind === "listening" && material.mimeType.startsWith("audio/") ? material.fileUrl : "", durationMinutes, questions });
}
export function getPracticeWorkspaceState(setId: string): PracticeWorkspaceState {
  ensureLearningTables();
  const database = getDatabase();
  database.prepare("INSERT OR IGNORE INTO practice_workspace_versions (set_id,revision,run_id,submission_id) SELECT ?,0,?,? WHERE EXISTS(SELECT 1 FROM practice_sets WHERE id=?)").run(setId, randomUUID(), randomUUID(), setId);
  const protocol = database.prepare("SELECT revision,run_id,submission_id,completed FROM practice_workspace_versions WHERE set_id=?").get(setId) as { revision: number; run_id: string; submission_id: string; completed: number } | undefined;
  const draft = database.prepare("SELECT draft_json FROM practice_drafts WHERE set_id = ?").get(setId) as { draft_json: string } | undefined;
  const annotations = database.prepare("SELECT annotations_json FROM practice_annotations WHERE set_id = ?").get(setId) as { annotations_json: string } | undefined;
  const row = database.prepare("SELECT * FROM practice_attempts WHERE set_id = ? ORDER BY id DESC LIMIT 1").get(setId) as Record<string, unknown> | undefined;
  const attempt: PracticeAttempt | null = row ? { id: Number(row.id), setId, kind: row.kind as "reading" | "listening", rawScore: Number(row.raw_score), totalQuestions: Number(row.total_questions), bandScore: Number(row.band_score), durationSeconds: Number(row.duration_seconds), answers: JSON.parse(String(row.answers_json)), submittedAt: String(row.submitted_at) } : null;
  const reasons = attempt ? database.prepare("SELECT question_id, reason FROM practice_mistake_reasons WHERE attempt_id = ?").all(attempt.id) as { question_id: string; reason: string }[] : [];
  return { draft: draft ? { ...emptyPracticeDraft, ...JSON.parse(draft.draft_json) } : { ...emptyPracticeDraft }, annotations: annotations ? JSON.parse(annotations.annotations_json) : [], attempt, reasons: Object.fromEntries(reasons.map((reason) => [reason.question_id, reason.reason])), dataEpoch: getDataEpoch(), revision: protocol?.revision ?? 0, runId: protocol?.run_id ?? "", submissionId: protocol?.submission_id ?? "" };
}

export function saveProtectedPracticeWorkspace(setId: string, input: { draft: PracticeDraft; annotations: PassageAnnotation[]; dataEpoch: string; expectedRevision: number; runId: string; restart?: boolean }) {
  ensureLearningTables();
  return getDatabase().transaction(() => {
    assertDataEpoch(input.dataEpoch);
    const state = getPracticeWorkspaceState(setId);
    if (!state.runId) return null;
    if (state.revision !== input.expectedRevision || state.runId !== input.runId) throw new DataIntegrityConflict("另一页面已更新此答卷，请导出当前内容并刷新。", "DRAFT_CONFLICT");
    if (input.restart) {
      getDatabase().prepare("UPDATE practice_workspace_versions SET run_id=?,submission_id=?,completed=0 WHERE set_id=?").run(randomUUID(), randomUUID(), setId);
    }
    const completed = getDatabase().prepare("SELECT completed FROM practice_workspace_versions WHERE set_id=?").get(setId) as { completed: number };
    const persisted = completed.completed && !input.restart ? { ...input.draft, isRetry: false, answers: state.attempt ? Object.fromEntries(state.attempt.answers.map((answer) => [answer.questionId, answer.submitted])) : state.draft.answers } : input.draft;
    savePracticeWorkspace(setId, persisted, input.annotations);
    getDatabase().prepare("UPDATE practice_workspace_versions SET revision=revision+1 WHERE set_id=?").run(setId);
    return getPracticeWorkspaceState(setId);
  })();
}

export function assertPracticeRun(setId: string, runId: string, submissionId: string, epoch: string) {
  assertDataEpoch(epoch);
  const state = getPracticeWorkspaceState(setId);
  if (state.runId !== runId || state.submissionId !== submissionId) throw new DataIntegrityConflict("答卷已切换，请查询原提交或刷新。", "SUBMISSION_CONFLICT");
}

export function completePracticeRun(setId: string) {
  getDatabase().prepare("UPDATE practice_workspace_versions SET completed=1 WHERE set_id=?").run(setId);
  // A completed answer sheet is immutable; free-form study notes may still be saved.
  const state = getPracticeWorkspaceState(setId);
  savePracticeWorkspace(setId, { ...state.draft, isRetry: false }, state.annotations);
}
export function savePracticeWorkspace(setId: string, draft: PracticeDraft, annotations: PassageAnnotation[]) {
  ensureLearningTables();
  if (!getPracticeSet(setId)) return false;
  const now = new Date().toISOString();
  getDatabase().transaction(() => {
    getDatabase().prepare("INSERT INTO practice_drafts VALUES (?, ?, ?) ON CONFLICT(set_id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at").run(setId, JSON.stringify(draft), now);
    getDatabase().prepare("INSERT INTO practice_annotations VALUES (?, ?, ?) ON CONFLICT(set_id) DO UPDATE SET annotations_json = excluded.annotations_json, updated_at = excluded.updated_at").run(setId, JSON.stringify(annotations), now);
  })();
  return true;
}
export function saveMistakeReason(attemptId: number, questionId: string, reason: string) {
  ensureLearningTables();
  const row = getDatabase().prepare("SELECT answers_json FROM practice_attempts WHERE id = ?").get(attemptId) as { answers_json: string } | undefined;
  const answers: PracticeAttempt["answers"] = row ? JSON.parse(row.answers_json) : [];
  if (!answers.some((answer) => answer.questionId === questionId && !answer.correct)) return false;
  getDatabase().prepare("INSERT INTO practice_mistake_reasons VALUES (?, ?, ?, ?) ON CONFLICT(attempt_id, question_id) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at").run(attemptId, questionId, reason, new Date().toISOString());
  return true;
}
export function saveDictation(input: { setId: string; expected: string; submitted: string; startSeconds?: number; endSeconds?: number }) {
  ensureLearningTables();
  if (getPracticeSet(input.setId)?.kind !== "listening") return null;
  const tokens = compareDictation(input.expected, input.submitted);
  const errors = tokens.filter((token) => token.kind !== "correct");
  const now = new Date().toISOString();
  const id = getDatabase().transaction(() => {
    const record = getDatabase().prepare("INSERT INTO dictation_attempts (set_id, expected, submitted, errors_json, start_seconds, end_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.setId, input.expected, input.submitted, JSON.stringify(errors), input.startSeconds ?? null, input.endSeconds ?? null, now);
    if (errors.length) getDatabase().prepare("INSERT INTO review_items (source_type, source_id, skill, prompt, answer, resolved, created_at) VALUES ('dictation', ?, 'listening', ?, ?, 0, ?)").run(String(record.lastInsertRowid), `听写：${input.submitted || '（空白）'}`, `${input.expected}\n${errors.map((error) => `${error.kind}: ${error.actual || '∅'} → ${error.expected || '∅'}`).join('; ')}`, now);
    return Number(record.lastInsertRowid);
  })();
  return { id, tokens, errorCount: errors.length };
}
