import "server-only";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, databasePath } from "./db";
import { ensureLearningTables } from "./learning-workspace-store";
import { initializeWritingTables } from "./writing-drafts";
import { ensureVocabularyTables } from "./vocabulary";
import { officialResourceSchema, validateReadingPassages } from "@/lib/official-resources";
import type { PracticeSet } from "@/lib/domain";
import { vocabularyCardDraftSchema, vocabularySessionStateSchema } from "@/lib/vocabulary-session";
import { reviewModes } from "@/lib/vocabulary";
import { refreshVocabularySessionRevisions } from "./vocabulary-session-store";
import { ensureVocabularyCourseTables } from "./vocabulary-courses";
import { ensureVocabularyAssessmentTables } from "./vocabulary-assessment";
import { ensureVocabularyImportTables } from "./vocabulary-import";
import { migrateVocabularyCourseBackup, validateVocabularyCourseBackup } from "./backup-vocabulary-courses";
import { isDeepStrictEqual } from "node:util";
import { ensureVocabularyTargetTables } from "./vocabulary-targets";
import { migrateVocabularyTargetBackup, validateVocabularyTargetBackup } from "./backup-vocabulary-targets";
import { ensureDataIntegrityTables, rotateDataEpoch } from "./data-integrity";
import { ensureSubmissionTables } from "./submissions";
import { ensureMockExamTables } from "./mock-exam-session";
import { migrateDurabilityBackup, validateDurabilityBackup } from "./backup-durability";

type Row = Record<string, string | number | null>;
export interface StudioBackup {
  format: "ielts-studio";
  version: 5;
  exportedAt: string;
  data: Record<string, Row[]>;
  files: { materialId: number; base64: string }[];
}

const MAX_FILE_BYTES = 256 * 1024 * 1024;
// The only tables absent from the last known v1 vocabulary schema.
const V2_VOCABULARY_TABLES = ["vocabulary_learning_state", "vocabulary_sessions", "vocabulary_review_audit"] as const;
class AttachmentBackupError extends Error {}
const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
function initialize() { ensureLearningTables(); initializeWritingTables(); ensureVocabularyTables(); ensureVocabularyCourseTables(); ensureVocabularyTargetTables(getDatabase()); ensureVocabularyImportTables(); ensureVocabularyAssessmentTables(); ensureDataIntegrityTables(); ensureSubmissionTables(); ensureMockExamTables(); }
function tableNames() {
  return (getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isBase64(value: string) {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  // Avoid a repeated capture group: V8 can exhaust its regex stack on full MP3s.
  return !/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding));
}
// User-owned runtime files are not build assets and must never enter the traced bundle.
export function uploadRoot() { return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./data/uploads"); }

export function createBackup(): StudioBackup {
  initialize();
  const database = getDatabase();
  const data = database.transaction(() => Object.fromEntries(tableNames().map((table) => [table, database.prepare(`SELECT * FROM ${identifier(table)}`).all() as Row[]])))();
  // Compatibility values apply to the cloned export, never frozen on-disk history.
  migrateVocabularyCourseBackup(data);
  migrateVocabularyTargetBackup(data);
  const files: StudioBackup["files"] = [];
  let totalBytes = 0;
  for (const row of data.source_materials ?? []) {
    if (!row.file_path) continue;
    const file = path.resolve(/* turbopackIgnore: true */ String(row.file_path));
    if (!existsSync(/* turbopackIgnore: true */ file)) throw new AttachmentBackupError(`材料文件缺失：${row.file_name}，请恢复文件后重试。`);
    // Resolve symlinks as well as '..' before reading an attachment.
    const relative = path.relative(realpathSync(/* turbopackIgnore: true */ uploadRoot()), realpathSync(/* turbopackIgnore: true */ file));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new AttachmentBackupError("材料文件位于上传目录之外。");
    const stats = statSync(/* turbopackIgnore: true */ file);
    if (!stats.isFile()) throw new AttachmentBackupError("材料附件不是文件。");
    totalBytes += stats.size;
    if (totalBytes > MAX_FILE_BYTES) throw new AttachmentBackupError("附件总大小超过 256 MB，请先使用完整文件夹备份。");
    files.push({ materialId: Number(row.id), base64: readFileSync(/* turbopackIgnore: true */ file).toString("base64") });
    // Backups must never restore a sender-controlled filesystem path.
    row.file_path = `upload:${row.id}`;
  }
  return { format: "ielts-studio", version: 5, exportedAt: new Date().toISOString(), data, files };
}

export function validateBackup(input: unknown): StudioBackup {
  initialize();
  if (!isRecord(input) || Object.keys(input).sort().join(",") !== "data,exportedAt,files,format,version" || input.format !== "ielts-studio" || ![1, 2, 3, 4, 5].includes(Number(input.version)) || typeof input.version !== "number" || !isRecord(input.data) || !Array.isArray(input.files) || typeof input.exportedAt !== "string" || !Number.isFinite(Date.parse(input.exportedAt))) {
    throw new Error("请使用 IELTS Studio 完整 JSON 备份（version 5 或已知 version 1/2/3/4）。");
  }
  // Validation and a known migration must not mutate the caller's original snapshot.
  const backup = structuredClone(input) as unknown as StudioBackup;
  if (input.version === 1) {
    for (const table of V2_VOCABULARY_TABLES) if (!Object.hasOwn(backup.data, table)) backup.data[table] = [];
    // Preserve the already-supported pre-resource v1 format, but no arbitrary missing fields.
    if (Array.isArray(backup.data.practice_sets)) for (const row of backup.data.practice_sets) {
      if (isRecord(row) && !Object.hasOwn(row, "resource_json")) row.resource_json = "{}";
    }
  }
  if (input.version === 1 || input.version === 2) migrateVocabularyCourseBackup(backup.data);
  if (input.version < 4) migrateVocabularyTargetBackup(backup.data);
  if (input.version < 5) migrateDurabilityBackup(backup.data);
  backup.version = 5;
  const allowed = new Set(tableNames());
  // Both formats are complete snapshots after their explicit additive migration.
  for (const required of allowed) if (!Array.isArray(backup.data[required])) throw new Error(`备份缺少数据表 ${required}，已拒绝恢复。`);
  for (const [table, rows] of Object.entries(backup.data)) {
    if (!allowed.has(table) || !Array.isArray(rows) || rows.length > 500_000) throw new Error("备份含不兼容数据表。");
    const columns = new Set((getDatabase().prepare(`PRAGMA table_info(${identifier(table)})`).all() as { name: string }[]).map((row) => row.name));
    for (const row of rows) {
      if (!isRecord(row)) throw new Error("备份记录格式错误。");
      if (Object.keys(row).length !== columns.size) throw new Error("备份记录缺少字段或格式错误。");
      for (const [key, value] of Object.entries(row)) {
        if (!columns.has(key) || (typeof value !== "string" && typeof value !== "number" && value !== null) || (typeof value === "number" && !Number.isFinite(value))) throw new Error("备份字段不兼容。");
        if (key.endsWith("_json") && typeof value === "string") {
          try { JSON.parse(value); } catch { throw new Error(`备份中的 ${table}.${key} 不是有效 JSON。`); }
        }
      }
    }
  }
  validateVocabularySnapshot(backup);
  if (backup.data.settings.length !== 1 || backup.data.settings[0].id !== 1) throw new Error("备份缺少有效的个人设置。");
  let bytes = 0;
  const ids = new Set<number>();
  for (const file of backup.files) {
    if (!isRecord(file) || Object.keys(file).length !== 2 || !Number.isInteger(file.materialId) || file.materialId <= 0 || ids.has(file.materialId) || typeof file.base64 !== "string" || !isBase64(file.base64)) throw new Error("备份文件格式错误。");
    ids.add(file.materialId);
    bytes += file.base64.length * 0.75;
    if (bytes > MAX_FILE_BYTES) throw new Error("备份附件超过 256 MB。");
  }
  for (const row of backup.data.source_materials) {
    if (row.file_path) {
      if (row.file_path !== `upload:${row.id}`) throw new Error("备份含非法附件路径；仅接受便携 upload 引用。");
      if (!ids.has(Number(row.id))) throw new Error("备份缺少上传文件。");
      const name = String(row.file_name);
      if (name !== path.posix.basename(name) || name !== path.win32.basename(name)) throw new Error("备份附件文件名不能包含目录路径。");
    }
  }
  for (const id of ids) if (!backup.data.source_materials.some((row) => Number(row.id) === id && row.file_path === `upload:${id}`)) throw new Error("文件未关联有效材料。");
  for (const row of backup.data.practice_sets) {
    const resource = JSON.parse(String(row.resource_json));
    if (isRecord(resource) && Object.keys(resource).length === 0) continue;
    const parsed = officialResourceSchema.safeParse(resource);
    if (!parsed.success) throw new Error("官方练习的资源信息格式无效。");
    validateReadingPassages({ kind: String(row.kind) as PracticeSet["kind"], questions: JSON.parse(String(row.questions_json)), resource: parsed.data });
    for (const asset of [...parsed.data.questionDocuments, ...parsed.data.answerDocuments, ...parsed.data.audioTracks, ...parsed.data.transcriptDocuments, ...(parsed.data.readingPassages ?? []).flatMap((passage) => passage.documents)]) {
      const id = Number(asset.url.split("/").at(-1));
      if (!ids.has(id)) throw new Error("官方练习缺少关联的 PDF 或音频附件。");
    }
  }
  validateVocabularyCourseBackup(backup.data, backup.files);
  validateVocabularyTargetBackup(backup.data, backup.files);
  validateDurabilityBackup(backup.data, backup.files);
  return backup;
}

function validateVocabularySnapshot(backup: StudioBackup) {
  const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
  const ratings = new Set(["again", "hard", "good", "easy"]);
  const reasons = new Set(["self_assessed", "correct_answer", "incorrect_answer", "gave_up", "confirmed_typo"]);
  const stateSchema = vocabularySessionStateSchema.extend({ current: vocabularyCardDraftSchema.extend({ audioPlayed: z.boolean() }).strict().nullable() }).strict();
  for (const row of backup.data.vocabulary_learning_state) {
    if (typeof row.word_id !== "string" || !row.word_id || !positiveInteger(row.review_version) || (row.learning_started_at !== null && !validDate(row.learning_started_at))) throw new Error("词汇学习状态无效。");
  }
  let activeSessions = 0;
  for (const row of backup.data.vocabulary_sessions) {
    const parsed = typeof row.state_json === "string" ? stateSchema.safeParse(JSON.parse(row.state_json)) : null;
    if (typeof row.id !== "string" || !row.id || !positiveInteger(row.revision) || Number(row.revision) > Number.MAX_SAFE_INTEGER - 2 || !["active", "ended"].includes(String(row.status)) || !validDate(row.started_at) || !validDate(row.updated_at) || !parsed?.success || !isDeepStrictEqual(parsed.data, JSON.parse(String(row.state_json)))) throw new Error("词汇会话状态无效。");
    if (row.status === "active") activeSessions++;
  }
  if (activeSessions > 1) throw new Error("备份包含多个活动词汇会话。");
  for (const row of backup.data.vocabulary_review_details) {
    if (!reviewModes.includes(row.mode as typeof reviewModes[number]) || ![null, 0, 1].includes(row.correct as null | number) || !Number.isInteger(row.duration_seconds) || Number(row.duration_seconds) < 0) throw new Error("词汇原始作答记录无效。");
  }
  for (const row of backup.data.vocabulary_review_audit) {
    if (!positiveInteger(row.review_id) || !positiveInteger(row.word_version) || typeof row.submission_id !== "string" || !row.submission_id || typeof row.session_id !== "string" || !row.session_id || !ratings.has(String(row.requested_rating)) || !ratings.has(String(row.effective_rating)) || !reasons.has(String(row.decision_reason)) || typeof row.term_snapshot !== "string" || !row.term_snapshot || ![0, 1].includes(Number(row.confirmed_typo)) || ![0, 1].includes(Number(row.gave_up)) || typeof row.confirmed_typo !== "number" || typeof row.gave_up !== "number") throw new Error("词汇评分审计记录无效。");
    const review = backup.data.vocabulary_reviews.find((item) => item.id === row.review_id);
    const detail = backup.data.vocabulary_review_details.find((item) => item.review_id === row.review_id);
    if (!review || !detail || review.rating !== row.effective_rating) throw new Error("词汇评分审计与原始复习记录不一致。");
  }
}

export function restoreBackup(input: unknown) {
  const backup = validateBackup(input);
  const database = getDatabase();
  const directory = path.join(/* turbopackIgnore: true */ path.dirname(databasePath()), "backups");
  mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
  const safetyPrefix = path.join(/* turbopackIgnore: true */ directory, `before-restore-${Date.now()}-${randomUUID()}`);
  let safety = `${safetyPrefix}.json`;
  let safetyBackupType: "json" | "sqlite" = "json";
  let warning = "";
  let currentBackup: StudioBackup | undefined;
  try { currentBackup = createBackup(); }
  catch (error) {
    if (!(error instanceof AttachmentBackupError)) throw error;
    // Permit a healthy backup to repair missing media, while retaining the exact old database.
    safety = `${safetyPrefix}.db`;
    safetyBackupType = "sqlite";
    warning = `原有附件无法完整备份（${error.message}）。恢复前已保存原 SQLite 数据库，原附件文件保留；此安全副本不含附件。`;
  }
  writeFileSync(/* turbopackIgnore: true */ safety, currentBackup ? JSON.stringify(currentBackup) : database.serialize(), { flag: "wx" });
  mkdirSync(/* turbopackIgnore: true */ uploadRoot(), { recursive: true });
  const created: string[] = [];
  const rows = backup.data.source_materials.map((row) => ({ ...row }));
  try {
    for (const file of backup.files) {
      const row = rows.find((item) => Number(item.id) === file.materialId)!;
      const extension = path.extname(String(row.file_name)).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 10);
      const destination = path.join(/* turbopackIgnore: true */ uploadRoot(), `${randomUUID()}${extension}`);
      writeFileSync(/* turbopackIgnore: true */ destination, Buffer.from(file.base64, "base64"), { flag: "wx" });
      created.push(destination);
      row.file_path = destination;
    }
    // Disable only for the synchronous replacement transaction, then check every FK before commit.
    database.pragma("foreign_keys = OFF");
    database.transaction(() => {
      const durabilityRevisions = new Map(["practice_workspace_versions", "writing_draft_revisions", "mock_exam_sessions"].map((table) => {
        const key = table === "practice_workspace_versions" ? "set_id" : table === "writing_draft_revisions" ? "draft_id" : "id";
        return [table, { key, rows: new Map((database.prepare(`SELECT ${key} AS id,revision FROM ${table}`).all() as { id: string; revision: number }[]).map((row) => [row.id, row.revision])) }];
      }));
      const priorRevisions = new Map((database.prepare("SELECT id, revision FROM vocabulary_sessions").all() as { id: string; revision: number }[]).map((row) => [row.id, row.revision]));
      const priorStudy = database.prepare("SELECT restore_version FROM vocabulary_study_preferences WHERE id=1").get() as { restore_version: number } | undefined;
      const featureRevisions = new Map(["vocabulary_import_previews", "vocabulary_assessments"].map((table) => [table, new Map((database.prepare(`SELECT id,revision FROM ${identifier(table)}`).all() as { id: string; revision: number }[]).map((row) => [row.id, row.revision]))]));
      for (const table of tableNames()) database.prepare(`DELETE FROM ${identifier(table)}`).run();
      for (const [table, original] of Object.entries(backup.data)) {
        for (const row of table === "source_materials" ? rows : original) {
          const columns = Object.keys(row);
          database.prepare(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
        }
      }
      // The active card/queue survive restore, while every old tab's write token expires.
      refreshVocabularySessionRevisions(database, priorRevisions);
      const restoredStudy = database.prepare("SELECT restore_version FROM vocabulary_study_preferences WHERE id=1").get() as { restore_version: number } | undefined;
      const restoreVersion = Math.max(restoredStudy?.restore_version ?? 1, priorStudy?.restore_version ?? 1) + 2;
      if (!Number.isSafeInteger(restoreVersion) || restoreVersion > Number.MAX_SAFE_INTEGER - 2) throw new Error("备份计时恢复版本超出安全范围。");
      if (restoredStudy) {
        database.prepare("UPDATE vocabulary_study_preferences SET restore_version=? WHERE id=1").run(restoreVersion);
      } else {
        // A legacy/empty snapshot must not recreate token 1 and accept an old tab's heartbeat.
        const academic = database.prepare("SELECT id FROM vocabulary_courses WHERE id='academic'").get();
        database.prepare("INSERT INTO vocabulary_study_preferences(id,active_course_id,daily_goal_seconds,paused,start_rank,restore_version) VALUES(1,?,900,0,1,?)").run(academic ? "academic" : null, restoreVersion);
      }
      // An exact restored target draft needs the new restore token, while its sense,
      // minute event, target-state version, typed answer and original timestamps survive.
      for (const row of database.prepare("SELECT id,state_json FROM vocabulary_sessions").all() as { id: string; state_json: string }[]) {
        const state = JSON.parse(row.state_json);
        if (state.current && Object.hasOwn(state.current, "restoreVersion")) {
          state.current.restoreVersion = restoreVersion;
          database.prepare("UPDATE vocabulary_sessions SET state_json=? WHERE id=?").run(JSON.stringify(state), row.id);
        }
      }
      for (const [table, revisions] of featureRevisions) for (const row of database.prepare(`SELECT id,revision FROM ${identifier(table)}`).all() as { id: string; revision: number }[]) {
        const revision = Math.max(row.revision, revisions.get(row.id) ?? 0) + 2;
        if (!Number.isSafeInteger(revision)) throw new Error("备份会话版本超出安全范围。");
        database.prepare(`UPDATE ${identifier(table)} SET revision=? WHERE id=?`).run(revision, row.id);
      }
      const dataEpoch = rotateDataEpoch(database);
      for (const [table, { key, rows: revisions }] of durabilityRevisions) for (const row of database.prepare(`SELECT ${key} AS id,revision FROM ${table}`).all() as { id: string; revision: number }[]) {
        const revision = Math.max(row.revision, revisions.get(row.id) ?? 0) + 2;
        if (!Number.isSafeInteger(revision)) throw new Error("草稿恢复版本超出安全范围。");
        database.prepare(`UPDATE ${table} SET revision=? WHERE ${key}=?`).run(revision, row.id);
      }
      database.prepare("UPDATE submission_receipts SET data_epoch=?").run(dataEpoch);
      database.prepare("UPDATE submission_receipts SET status='failed',lease_id=NULL,lease_until=NULL,owner_pid=NULL,error='恢复后请使用原提交编号重试。' WHERE status='processing'").run();
      database.prepare("UPDATE mock_exam_sessions SET data_epoch=?,writer_id=NULL,lease_until=NULL").run(dataEpoch);
      for (const row of database.prepare("SELECT id,state_json FROM mock_exam_sessions WHERE status='active'").all() as { id: string; state_json: string }[]) {
        const state = JSON.parse(row.state_json); state.paused = true;
        database.prepare("UPDATE mock_exam_sessions SET state_json=? WHERE id=?").run(JSON.stringify(state), row.id);
      }
      // Annotate only newly introduced legacy metadata; never infer old grading snapshots.
      ensureVocabularyTables(database);
      if ((database.pragma("foreign_key_check") as unknown[]).length) throw new Error("备份关联关系损坏，已取消恢复；原有数据保留。");
      database.prepare("INSERT OR IGNORE INTO studio_migrations(id) VALUES ('initial-seed')").run();
    })();
  } catch (error) {
    for (const file of created) { try { unlinkSync(/* turbopackIgnore: true */ file); } catch { /* Preserve the original restore error. An unreferenced file is safe to remove later. */ } }
    throw error;
  } finally {
    database.pragma("foreign_keys = ON");
  }
  return { safetyBackup: safety, safetyBackupType, warning };
}

export async function databaseBackup() {
  initialize();
  const directory = path.join(/* turbopackIgnore: true */ path.dirname(databasePath()), "backups");
  mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
  const file = path.join(/* turbopackIgnore: true */ directory, `sqlite-${Date.now()}-${randomUUID()}.db`);
  await getDatabase().backup(file);
  return readFileSync(/* turbopackIgnore: true */ file);
}
