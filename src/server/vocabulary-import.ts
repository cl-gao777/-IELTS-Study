import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { vocabularyRowsToEntries, summarizeVocabularyImport, normalizedImportTerm, type VocabularyImportPreview, type VocabularyImportConfirmation } from "@/lib/vocabulary-import";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import { isVocabularyCatalogEntryLearnable } from "@/lib/vocabulary-course";
import { getDatabase } from "./db";
import { ensureVocabularyCourseTables, listVocabularyCatalogEntries, registerVocabularyCourse } from "./vocabulary-courses";

export function ensureVocabularyImportTables(database: Database.Database = getDatabase()) {
  database.exec(`CREATE TABLE IF NOT EXISTS vocabulary_import_previews (
    id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,preview_json TEXT NOT NULL,
    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,confirmed_course_id TEXT REFERENCES vocabulary_courses(id)
  );`);
}
export class VocabularyImportConflict extends Error { constructor(message = "导入预览已失效，请重新预览文件。") { super(message); } }
export function createVocabularyImportPreview(fileName: string, rows: string[][], database = getDatabase(), now = new Date()): VocabularyImportPreview {
  ensureVocabularyCourseTables(database); ensureVocabularyImportTables(database);
  z.string().min(1).max(500).parse(fileName);
  const catalog = listVocabularyCatalogEntries(undefined, database), existing = new Set(catalog.map((entry) => normalizedImportTerm(entry.term)));
  const readyTerms = new Set(catalog.filter(isVocabularyCatalogEntryLearnable).map((entry) => normalizedImportTerm(entry.term)));
  const entries = vocabularyRowsToEntries(rows, existing, /\.txt$/i.test(fileName) && rows.every((row) => row.length === 1) ? false : undefined), id = randomUUID();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const eligible = entries.filter((entry) => entry.status === "new" || entry.status === "existing");
  const ready = eligible.filter((entry) => readyTerms.has(normalizedImportTerm(entry.term))).length;
  const preview = { previewId: id, revision: 1, fileName, expiresAt, entries, summary: summarizeVocabularyImport(entries), readiness: { ready, pending: eligible.length - ready } };
  database.prepare("INSERT INTO vocabulary_import_previews VALUES (?,1,'pending',?,?,?,NULL)").run(id, JSON.stringify(preview), now.toISOString(), expiresAt);
  return preview;
}
export function confirmVocabularyImport(previewId: string, expectedRevision: number, titleInput: string, database = getDatabase(), now = new Date()): VocabularyImportConfirmation {
  ensureVocabularyCourseTables(database); ensureVocabularyImportTables(database);
  const title = z.string().trim().min(1, "请填写课程名称。").max(200).parse(titleInput);
  return database.transaction(() => {
    const row = database.prepare("SELECT * FROM vocabulary_import_previews WHERE id=?").get(previewId) as { revision: number; status: string; preview_json: string; expires_at: string; confirmed_course_id: string | null } | undefined;
    if (!row) throw new VocabularyImportConflict();
    const preview = JSON.parse(row.preview_json) as VocabularyImportPreview;
    if (row.status === "confirmed") {
      if (row.revision === expectedRevision + 1 && preview.revision === expectedRevision && preview.confirmedTitle === title && preview.confirmation?.courseId === row.confirmed_course_id) return preview.confirmation;
      throw new VocabularyImportConflict("这个预览已确认或恢复，请从课程列表打开导入结果。");
    }
    if (row.revision !== expectedRevision || Date.parse(row.expires_at) <= now.getTime()) throw new VocabularyImportConflict();
    const eligible = preview.entries.filter((entry) => entry.status === "new" || entry.status === "existing");
    if (row.status !== "pending") throw new VocabularyImportConflict();
    if (!eligible.length) throw new Error("没有有效且不重复的词条可导入。");
    const courseId = `import:${randomUUID()}`;
    const result = registerVocabularyCourse({ id: courseId, title, description: `导入自 ${preview.fileName}`, kind: "user-import", version: 1 }, eligible.map((entry) => ({ ...vocabularyInputSchema.parse(entry), status: "draft" as const })), database);
    const members = listVocabularyCatalogEntries(courseId, database), ready = members.filter(isVocabularyCatalogEntryLearnable).length;
    const confirmation = { courseId, added: result.addedEntries, skipped: preview.summary.invalid + preview.summary.duplicate, existing: result.existingEntries, readiness: { ready, pending: members.length - ready } };
    database.prepare("UPDATE vocabulary_import_previews SET status='confirmed',revision=revision+1,confirmed_course_id=?,preview_json=? WHERE id=?").run(courseId, JSON.stringify({ ...preview, revision: expectedRevision, confirmedTitle: title, confirmation }), previewId);
    return confirmation;
  })();
}
