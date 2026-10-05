import "server-only";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDatabase, databasePath } from "./db";
import { ensureLearningTables } from "./learning-workspace-store";
import { initializeWritingTables } from "./writing-drafts";
import { ensureVocabularyTables } from "./vocabulary";
import { officialResourceSchema } from "@/lib/official-resources";

type Row = Record<string, string | number | null>;
export interface StudioBackup {
  format: "ielts-studio";
  version: 1;
  exportedAt: string;
  data: Record<string, Row[]>;
  files: { materialId: number; base64: string }[];
}

const MAX_FILE_BYTES = 256 * 1024 * 1024;
class AttachmentBackupError extends Error {}
const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
function initialize() { ensureLearningTables(); initializeWritingTables(); ensureVocabularyTables(); }
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
  return { format: "ielts-studio", version: 1, exportedAt: new Date().toISOString(), data, files };
}

export function validateBackup(input: unknown): StudioBackup {
  initialize();
  if (!isRecord(input) || input.format !== "ielts-studio" || input.version !== 1 || !isRecord(input.data) || !Array.isArray(input.files) || typeof input.exportedAt !== "string" || !Number.isFinite(Date.parse(input.exportedAt))) {
    throw new Error("请使用 IELTS Studio 完整 JSON 备份（version 1）。");
  }
  const backup = input as unknown as StudioBackup;
  const allowed = new Set(tableNames());
  // This v1 format is a complete snapshot. A partial import must not erase omitted history.
  for (const required of allowed) if (!Array.isArray(backup.data[required])) throw new Error(`备份缺少数据表 ${required}，已拒绝恢复。`);
  for (const [table, rows] of Object.entries(backup.data)) {
    if (!allowed.has(table) || !Array.isArray(rows) || rows.length > 500_000) throw new Error("备份含不兼容数据表。");
    const columns = new Set((getDatabase().prepare(`PRAGMA table_info(${identifier(table)})`).all() as { name: string }[]).map((row) => row.name));
    for (const row of rows) {
      if (!isRecord(row)) throw new Error("备份记录格式错误。");
      // Before official-resource support, v1 practice rows had no resource_json.
      // Only this known additive field is upgraded; other missing data still fails.
      if (table === "practice_sets" && !Object.hasOwn(row, "resource_json")) row.resource_json = "{}";
      if (Object.keys(row).length !== columns.size) throw new Error("备份记录缺少字段或格式错误。");
      for (const [key, value] of Object.entries(row)) {
        if (!columns.has(key) || (typeof value !== "string" && typeof value !== "number" && value !== null) || (typeof value === "number" && !Number.isFinite(value))) throw new Error("备份字段不兼容。");
        if (key.endsWith("_json") && typeof value === "string") {
          try { JSON.parse(value); } catch { throw new Error(`备份中的 ${table}.${key} 不是有效 JSON。`); }
        }
      }
    }
  }
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
    for (const asset of [...parsed.data.questionDocuments, ...parsed.data.answerDocuments, ...parsed.data.audioTracks, ...parsed.data.transcriptDocuments]) {
      const id = Number(asset.url.split("/").at(-1));
      if (!ids.has(id)) throw new Error("官方练习缺少关联的 PDF 或音频附件。");
    }
  }
  return backup;
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
      for (const table of tableNames()) database.prepare(`DELETE FROM ${identifier(table)}`).run();
      for (const [table, original] of Object.entries(backup.data)) {
        for (const row of table === "source_materials" ? rows : original) {
          const columns = Object.keys(row);
          database.prepare(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
        }
      }
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
