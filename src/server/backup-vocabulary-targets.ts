import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normaliseVocabularyAnswer } from "@/lib/vocabulary";
import { vocabularyCatalogEntrySchema, vocabularyExerciseSnapshotSchema } from "@/lib/vocabulary-course";
import { vocabularyConsolidationSnapshotSchema, vocabularyDispositionOperationSchema, vocabularyFocusSchema,
  vocabularySourcePdfSchema, vocabularyTargetLearnOperationSchema, vocabularyTargetSnapshotSchema } from "@/lib/vocabulary-target";

type Row = Record<string, string | number | null>;
type Data = Record<string, Row[]>;
export const V4_VOCABULARY_TABLES = ["vocabulary_target_state", "vocabulary_term_dispositions", "vocabulary_target_operations"] as const;
const need = (ok: unknown, message: string) => { if (!ok) throw new Error(`词汇用法备份${message}。`); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const date = (value: unknown): value is string => typeof value === "string" && z.iso.datetime().safeParse(value).success;
const normalizedTerm = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && value === normaliseVocabularyAnswer(value);
function exact<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.parse(value); need(isDeepStrictEqual(parsed, value), "记录缺少字段或含未知字段"); return parsed;
}

/** Known v1/v2/v3 additions only. Frozen historical answers and schedules stay untouched. */
export function migrateVocabularyTargetBackup(data: Data) {
  for (const table of V4_VOCABULARY_TABLES) if (!Object.hasOwn(data, table)) data[table] = [];
  for (const row of data.vocabulary_study_preferences ?? []) {
    for (const [key, value] of Object.entries({ focus: "general", next_level: "B2", policy_version: 1, private_catalog_key: null })) {
      if (!Object.hasOwn(row, key)) row[key] = value;
    }
  }
  for (const row of data.vocabulary_catalog_entries ?? []) {
    if (typeof row.data_json !== "string") continue;
    let entry: unknown; try { entry = JSON.parse(row.data_json); } catch { continue; }
    if (object(entry) && !Object.hasOwn(entry, "targets")) {
      entry.targets = [];
      row.data_json = JSON.stringify(entry);
    }
  }
}

export function validateVocabularyTargetBackup(data: Data, files: { materialId: number; base64: string }[]) {
  const courses = new Set(data.vocabulary_courses.map((row) => row.id));
  const words = new Map(data.vocabulary_words.map((row) => [row.id, normaliseVocabularyAnswer(String(row.term))]));
  const entries = new Map(data.vocabulary_catalog_entries.map((row) => {
    const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(String(row.data_json))); return [entry.id, entry] as const;
  }));
  const definitions = new Map<string, { entryId: string; normalizedTerm: string }>();
  const hashes = new Map<number, string>();
  const checkPdf = (value: unknown) => {
    if (value === null) return;
    const source = exact(vocabularySourcePdfSchema, value);
    const materialId = Number(source.attachmentUrl.split("/").at(-1));
    const material = data.source_materials.find((row) => row.id === materialId);
    const file = files.find((item) => item.materialId === materialId);
    need(Number.isSafeInteger(materialId) && materialId > 0 && material && file && material.mime_type === "application/pdf", "PDF 来源材料或附件不存在");
    if (!hashes.has(materialId)) hashes.set(materialId, createHash("sha256").update(Buffer.from(file!.base64, "base64")).digest("hex"));
    need(hashes.get(materialId) === source.fileSha256, "PDF 来源附件 SHA256 不一致");
  };
  for (const entry of entries.values()) {
    for (const target of entry.targets) {
      need(!definitions.has(target.id), "目标 ID 重复");
      need(new Set(target.memberships.map((membership) => membership.courseId)).size === target.memberships.length, "目标课程成员重复");
      for (const membership of target.memberships) {
        need(courses.has(membership.courseId) && entry.courseIds.includes(membership.courseId), "目标课程关联损坏");
        need(new Set(membership.exerciseIds).size === membership.exerciseIds.length, "目标题面 ID 重复");
        const exercises = membership.exerciseIds.map((id) => entry.exercises.find((exercise) => exercise.id === id));
        need(exercises.every((exercise) => exercise?.targetId === target.id), "目标题面成员关联损坏");
        if (target.status === "published") need(new Set(exercises.filter((exercise) => exercise?.status === "published").map((exercise) => normaliseVocabularyAnswer(exercise!.sentence))).size >= 2, "已发布目标缺少两道有效题面");
      }
      checkPdf(target.sourcePdf);
      definitions.set(target.id, { entryId: entry.id, normalizedTerm: normaliseVocabularyAnswer(entry.term) });
    }
    for (const exercise of entry.exercises) if (exercise.targetId !== undefined) {
      need(entry.targets.some((target) => target.id === exercise.targetId), "题面目标不存在");
    }
  }
  const historicalTargets = new Map<string, { normalizedTerm: string }>();
  const checkSnapshot = (value: unknown) => {
    const snapshot = exact(vocabularyTargetSnapshotSchema, value);
    need(entries.has(snapshot.entryId) && courses.has(snapshot.courseId)
      && snapshot.normalizedTerm === normaliseVocabularyAnswer(snapshot.term), "冻结目标词条或课程关联损坏");
    checkPdf(snapshot.sourcePdf);
    // A later edit must not replace the meaning, answer or level in an old Practice Attempt.
    historicalTargets.set(snapshot.id, { normalizedTerm: snapshot.normalizedTerm });
    return snapshot;
  };
  const checkExercise = (value: unknown) => {
    if (value === null || object(value) && Object.keys(value).length === 0) return null;
    const exercise = exact(vocabularyExerciseSnapshotSchema, value);
    if (exercise.target) {
      const target = checkSnapshot(exercise.target);
      need(exercise.targetId === target.id && exercise.entryId === target.entryId && exercise.courseId === target.courseId, "冻结题面与目标关联不一致");
    } else need(exercise.targetId === undefined && exercise.consolidation === undefined, "冻结题面缺少目标义项");
    if (exercise.consolidation) {
      exact(vocabularyConsolidationSnapshotSchema, exercise.consolidation);
      need(exercise.target?.id === exercise.consolidation.targetId && ["consolidation", "merged"].includes(exercise.purpose ?? ""), "分钟巩固事件与题面不一致");
    }
    if (exercise.purpose === "consolidation" || exercise.purpose === "merged") need(exercise.consolidation, "分钟巩固题面缺少事件");
    return exercise;
  };
  const submissions = new Map<string, ReturnType<typeof checkExercise>>();
  for (const row of data.vocabulary_word_context) checkExercise(JSON.parse(String(row.exercise_json)));
  for (const row of data.vocabulary_review_context) {
    const exercise = checkExercise(JSON.parse(String(row.exercise_json)));
    const audit = data.vocabulary_review_audit.find((item) => item.review_id === row.review_id);
    if (audit) submissions.set(String(audit.submission_id), exercise);
  }
  for (const row of data.vocabulary_supplemental_attempts) submissions.set(String(row.submission_id), checkExercise(JSON.parse(String(row.exercise_json))));
  for (const row of data.vocabulary_sessions) {
    const state = JSON.parse(String(row.state_json)), current = state.current;
    if (!current) continue;
    const exercise = current.exercise ? checkExercise(current.exercise) : null;
    if (current.target) {
      const target = checkSnapshot(current.target);
      need(!exercise?.target || isDeepStrictEqual(exercise.target, target), "当前卡片与冻结题面目标不一致");
    }
    if (current.purpose === "learn-target") need(current.phase === "learn" && current.target && !current.supplemental, "用法介绍卡片状态无效");
    if (current.purpose === "learn-word") need(current.phase === "learn" && !current.supplemental, "新词介绍卡片状态无效");
    if (current.consolidation) {
      exact(vocabularyConsolidationSnapshotSchema, current.consolidation);
      need(current.target?.id === current.consolidation.targetId && exercise?.consolidation
        && isDeepStrictEqual(exercise.consolidation, current.consolidation) && ["consolidation", "merged"].includes(current.purpose), "当前分钟巩固事件关联损坏");
    }
    if (current.purpose === "consolidation") need(current.supplemental && current.consolidation && !current.canSupplement, "辅助分钟巩固卡片状态无效");
    if (current.purpose === "merged") need(!current.supplemental && current.consolidation, "合并正式评分卡片状态无效");
    if (current.purpose && exercise?.purpose) need(current.purpose === exercise.purpose, "当前卡片与题面用途不一致");
  }
  const targetStates = new Set<string>();
  for (const row of data.vocabulary_target_state) {
    need(typeof row.target_id === "string" && row.target_id && !targetStates.has(row.target_id) && normalizedTerm(row.normalized_term)
      && positive(row.version) && row.version <= Number.MAX_SAFE_INTEGER - 2 && [0, 1].includes(row.paused as number) && typeof row.paused === "number"
      && typeof row.step === "number" && [0, 1, 2, 3].includes(row.step) && date(row.updated_at)
      && (row.word_id === null || typeof row.word_id === "string" && words.has(row.word_id))
      && (row.introduced_at === null || date(row.introduced_at)), "目标学习状态无效");
    const definition = definitions.get(String(row.target_id));
    need(definition && definition.normalizedTerm === row.normalized_term, "目标状态词条关联损坏");
    need(row.word_id === null || words.get(row.word_id) === row.normalized_term, "目标状态个人词条关联损坏");
    need(row.step === 1 || row.step === 2 ? date(row.due_at) && row.introduced_at !== null : row.due_at === null, "分钟巩固步骤或到期时间无效");
    need(row.last_submission_id === null || typeof row.last_submission_id === "string" && z.uuid().safeParse(row.last_submission_id).success, "目标最近提交标识无效");
    if (row.last_submission_id !== null) {
      const event = submissions.get(String(row.last_submission_id))?.consolidation;
      need(event?.targetId === row.target_id && Number(row.version) > Number(event?.version), "目标最近提交关联损坏");
    }
    targetStates.add(String(row.target_id));
  }
  const dispositions = new Set<string>();
  for (const row of data.vocabulary_term_dispositions) {
    need(normalizedTerm(row.normalized_term) && !dispositions.has(row.normalized_term) && typeof row.paused === "number" && [0, 1].includes(row.paused)
      && positive(row.version) && row.version <= Number.MAX_SAFE_INTEGER - 2 && date(row.updated_at), "整词暂停状态无效");
    dispositions.add(String(row.normalized_term));
  }
  const operationIds = new Set<string>();
  for (const row of data.vocabulary_target_operations) {
    need(typeof row.operation_id === "string" && z.uuid().safeParse(row.operation_id).success && !operationIds.has(row.operation_id) && date(row.created_at), "操作去重标识无效");
    const input: unknown = JSON.parse(String(row.request_json));
    const operation = row.action === "introduce-target" ? exact(vocabularyTargetLearnOperationSchema, input) : exact(vocabularyDispositionOperationSchema, input);
    need(operation.operationId === row.operation_id && (row.action === "introduce-target" || "action" in operation && operation.action === row.action), "操作去重请求不一致");
    if ("targetId" in operation && operation.targetId) need(definitions.has(operation.targetId) || historicalTargets.has(operation.targetId), "操作目标关联损坏");
    if (row.action === "introduce-target") need("wordId" in operation && words.has(operation.wordId) && "sessionId" in operation
      && data.vocabulary_sessions.some((session) => session.id === operation.sessionId), "用法介绍操作词条或会话关联损坏");
    operationIds.add(String(row.operation_id));
  }
  for (const row of data.vocabulary_study_preferences) need(vocabularyFocusSchema.safeParse(row.focus).success && ["B2", "C1"].includes(String(row.next_level))
    && positive(row.policy_version) && row.policy_version <= Number.MAX_SAFE_INTEGER - 2
    && (row.private_catalog_key === null || typeof row.private_catalog_key === "string" && row.private_catalog_key.length > 0 && row.private_catalog_key.length <= 2000), "进阶学习设置无效");
}
