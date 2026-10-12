import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isVocabularyCatalogEntryLearnable, vocabularyCatalogEntrySchema, vocabularyExerciseSchema, type VocabularyCatalogEntry } from "@/lib/vocabulary-course";
import { getDatabase } from "./db";
import { loadVocabularyCatalog, listVocabularyCatalogEntries } from "./vocabulary-courses";
import { VocabularySessionConflict } from "./vocabulary-session-store";

export const catalogReviewSchema = z.object({
  entryId: z.string().min(1).max(200), expectedVersion: z.number().int().positive(),
  meaningZh: z.string().trim().min(1).max(500), definitionEn: z.string().trim().min(1).max(1000),
  partOfSpeech: z.string().trim().min(1).max(50), exercises: z.array(vocabularyExerciseSchema).min(2).max(500),
}).strict();

export function queryVocabularyCatalogEntries(options: { courseId?: string; query?: string; status?: string; page?: number; pageSize?: number } = {}, database = getDatabase()) {
  loadVocabularyCatalog(database);
  const query = (options.query ?? "").trim().toLowerCase();
  const entries = listVocabularyCatalogEntries(options.courseId || undefined, database).filter((entry) => {
    const draft = entry.status === "draft" || entry.exercises.some((exercise) => exercise.status === "draft");
    return (!query || `${entry.term} ${entry.meaningZh}`.toLowerCase().includes(query))
      && (options.status !== "draft" || draft) && (options.status !== "published" || isVocabularyCatalogEntryLearnable(entry));
  });
  const page = Math.max(1, Math.floor(options.page ?? 1)), pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 20)));
  return { entries: entries.slice((page - 1) * pageSize, page * pageSize), total: entries.length, page, pageSize };
}

/** Changes content only. A personal word, due date, FSRS state, and history stay untouched. */
export function publishVocabularyCatalogReview(input: z.infer<typeof catalogReviewSchema>, database = getDatabase()) {
  loadVocabularyCatalog(database);
  return database.transaction(() => {
    const row = database.prepare("SELECT data_json FROM vocabulary_catalog_entries WHERE id=?").get(input.entryId) as { data_json: string } | undefined;
    if (!row) throw new VocabularySessionConflict("课程词条已不存在，请刷新。");
    const current = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json));
    if (current.version !== input.expectedVersion) throw new VocabularySessionConflict("这个词条已在其他页面更新，请重新核对资料。");
    const previous = new Map(current.exercises.map((exercise) => [exercise.id, exercise]));
    const ids = new Set<string>();
    const exercises = input.exercises.map((proposed) => {
      if (ids.has(proposed.id)) throw new Error("题目 ID 不能重复。");
      ids.add(proposed.id);
      const old = previous.get(proposed.id);
      const sameText = old?.sentence === proposed.sentence;
      const { sourceReference: ignored, ...withoutReference } = proposed; void ignored;
      const next = {
        ...withoutReference, id: old?.id ?? `personal-context:${randomUUID()}`,
        // Never let the client forge provenance for an edited or newly authored sentence.
        ...(sameText && old?.sourceReference ? { sourceReference: old.sourceReference } : {}),
        source: sameText && old?.sourceReference ? old.source.replace("（原句待核对）", "（原句已核对）") : proposed.sourceReference ? "用户编辑的学习例句（不再标为 PDF 原句）" : proposed.source || "用户原创学习例句",
        version: old ? old.version : 1,
      };
      if (old && JSON.stringify({ ...next, version: old.version }) !== JSON.stringify(old)) next.version = old.version + 1;
      return vocabularyExerciseSchema.parse(next);
    });
    const entry: VocabularyCatalogEntry = vocabularyCatalogEntrySchema.parse({ ...current, version: current.version + 1,
      status: "published", meaningZh: input.meaningZh, definitionEn: input.definitionEn, partOfSpeech: input.partOfSpeech, exercises,
      example: exercises.find((exercise) => exercise.status === "published")?.sentence ?? current.example });
    if (!isVocabularyCatalogEntryLearnable(entry)) throw new Error("发布前须补齐中英文释义、词性，并核对至少两个不同的有效语境题。");
    database.prepare("UPDATE vocabulary_catalog_entries SET data_json=?,updated_at=? WHERE id=?").run(JSON.stringify(entry), new Date().toISOString(), entry.id);
    return entry;
  })();
}
