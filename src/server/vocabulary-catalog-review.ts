import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isVocabularyCatalogEntryLearnable, vocabularyCatalogEntrySchema, vocabularyExerciseSchema, type VocabularyCatalogEntry } from "@/lib/vocabulary-course";
import { getDatabase } from "./db";
import { loadVocabularyCatalog, listVocabularyCatalogEntries } from "./vocabulary-courses";
import { VocabularySessionConflict } from "./vocabulary-session-store";

export const catalogReviewSchema = z.object({
  entryId: z.string().min(1).max(200), expectedVersion: z.number().int().positive(),
  courseId: z.string().min(1).max(200).optional(), targetId: z.string().min(1).max(200).optional(), expectedTargetVersion: z.number().int().positive().optional(),
  meaningZh: z.string().trim().min(1).max(500), definitionEn: z.string().trim().min(1).max(1000),
  partOfSpeech: z.string().trim().min(1).max(50), exercises: z.array(vocabularyExerciseSchema).min(2).max(500),
}).strict();

export function queryVocabularyCatalogEntries(options: { courseId?: string; query?: string; status?: string; page?: number; pageSize?: number } = {}, database = getDatabase()) {
  loadVocabularyCatalog(database);
  const query = (options.query ?? "").trim().toLowerCase();
  const entries = listVocabularyCatalogEntries(options.courseId || undefined, database).flatMap((entry) => {
    const targets = entry.targets?.filter((target) => target.memberships.some((member) => member.courseId === options.courseId)) ?? [];
    if (!targets.length) return [{ ...entry, reviewTargetId: undefined as string | undefined }];
    return targets.map((target) => {
      const member = target.memberships.find((item) => item.courseId === options.courseId)!;
      return { ...entry, reviewTargetId: target.id, meaningZh: target.meaningZh, definitionEn: target.definitionEn, partOfSpeech: target.partOfSpeech,
        status: target.status, targets: [target], exercises: entry.exercises.filter((exercise) => member.exerciseIds.includes(exercise.id)) };
    });
  }).filter((entry) => {
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
    const target = input.targetId ? current.targets.find((item) => item.id === input.targetId) : undefined;
    const membership = target?.memberships.find((item) => item.courseId === input.courseId);
    if (input.targetId && (!target || !membership || input.expectedTargetVersion !== target.version)) throw new VocabularySessionConflict("这个课程用法已更新，请重新选择用法。");
    if (!target && current.targets.length && (!input.courseId || current.targets.some((item) => item.memberships.some((member) => member.courseId === input.courseId)))) throw new VocabularySessionConflict("请选择当前课程的具体用法后再保存。");
    const allowed = membership ? current.exercises.filter((exercise) => membership.exerciseIds.includes(exercise.id)) : current.exercises;
    const previous = new Map(allowed.map((exercise) => [exercise.id, exercise]));
    const ids = new Set<string>();
    const exercises = input.exercises.map((proposed) => {
      if (ids.has(proposed.id)) throw new Error("题目 ID 不能重复。");
      ids.add(proposed.id);
      const old = previous.get(proposed.id);
      if (target && proposed.targetId && proposed.targetId !== target.id) throw new Error("例句不属于当前用法。");
      if (!old && current.exercises.some((exercise) => exercise.id === proposed.id)) throw new Error("不能修改其他用法的例句。");
      const shared = old && target && current.targets.some((other) => other.memberships.some((member) => (other.id !== target.id || member.courseId !== input.courseId) && member.exerciseIds.includes(old.id)));
      const sameText = old?.sentence === proposed.sentence;
      const { sourceReference: ignored, ...withoutReference } = proposed; void ignored;
      const next = {
        ...withoutReference, locallyReviewed: true, ...(target ? { targetId: target.id } : {}), id: old && !shared ? old.id : `personal-context:${randomUUID()}`,
        // Never let the client forge provenance for an edited or newly authored sentence.
        ...(sameText && old?.sourceReference ? { sourceReference: old.sourceReference } : {}),
        source: sameText && old ? old.source.replace("（原句待核对）", "（原句已核对）") : "用户编辑的学习例句（不再标为 PDF 原句）",
        version: old ? old.version : 1,
      };
      if (old && JSON.stringify({ ...next, version: old.version }) !== JSON.stringify(old)) next.version = old.version + 1;
      return vocabularyExerciseSchema.parse(next);
    });
    const reviewed = { ...current, status: "published" as const, meaningZh: input.meaningZh, definitionEn: input.definitionEn, partOfSpeech: input.partOfSpeech, exercises };
    if (!isVocabularyCatalogEntryLearnable(reviewed)) throw new Error("发布前须补齐中英文释义、词性，并核对至少两个不同的有效语境题。");
    const entry: VocabularyCatalogEntry = vocabularyCatalogEntrySchema.parse({ ...current, version: current.version + 1,
      ...(target ? {
        status: "published", exercises: [...current.exercises.filter((exercise) => !exercises.some((next) => next.id === exercise.id)), ...exercises],
        targets: current.targets.map((item) => item.id !== target.id ? item : { ...item, locallyReviewed: true, version: item.version + 1, status: "published",
          meaningZh: input.meaningZh, definitionEn: input.definitionEn, partOfSpeech: input.partOfSpeech,
          memberships: item.memberships.map((member) => member.courseId !== input.courseId ? member : { ...member, locallyReviewed: true, version: member.version + 1, exerciseIds: exercises.map((exercise) => exercise.id) }) }),
      } : { ...reviewed, locallyReviewed: true, version: current.version + 1,
        example: exercises.find((exercise) => exercise.status === "published")?.sentence ?? current.example }) });
    database.prepare("UPDATE vocabulary_catalog_entries SET data_json=?,updated_at=? WHERE id=?").run(JSON.stringify(entry), new Date().toISOString(), entry.id);
    return entry;
  })();
}
