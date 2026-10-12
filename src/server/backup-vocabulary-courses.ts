import "server-only";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { vocabularyCatalogEntrySchema, vocabularyCourseSchema, vocabularyExerciseSnapshotSchema, type VocabularyExercise } from "@/lib/vocabulary-course";
import { officialResourceSchema } from "@/lib/official-resources";
import { isVocabularyTypoCandidate, normaliseVocabularyAnswer, vocabularyInputSchema } from "@/lib/vocabulary";
import { assessmentDraftSchema, evaluateVocabularyAssessment, validateAssessmentQuestions } from "@/lib/vocabulary-assessment";
import { summarizeVocabularyImport, type VocabularyImportRow } from "@/lib/vocabulary-import";

export const V3_VOCABULARY_TABLES = ["vocabulary_courses", "vocabulary_catalog_entries", "vocabulary_catalog_links", "vocabulary_review_context", "vocabulary_word_context", "vocabulary_study_preferences", "vocabulary_study_heartbeats", "vocabulary_import_previews", "vocabulary_assessments", "vocabulary_supplemental_attempts"] as const;
type Data = Record<string, Record<string, string | number | null>[]>;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const need = (ok: unknown, message: string) => { if (!ok) throw new Error(`词汇课程备份${message}。`); };
function exact<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.parse(input); need(isDeepStrictEqual(parsed, input), "记录缺少字段或含未知字段"); return parsed;
}

/** Only the documented additive v3 fields are filled; old raw answers/history are untouched. */
export function migrateVocabularyCourseBackup(data: Data) {
  for (const table of V3_VOCABULARY_TABLES) if (!Object.hasOwn(data, table)) data[table] = [];
  for (const row of data.vocabulary_sessions ?? []) {
    if (typeof row.state_json !== "string") continue;
    let state: unknown; try { state = JSON.parse(row.state_json); } catch { continue; }
    if (!object(state)) continue;
    if (!Object.hasOwn(state, "courseId")) state.courseId = null;
    if (!Object.hasOwn(state, "supplementalReviewed")) state.supplementalReviewed = 0;
    if (object(state.current)) {
      if (!Object.hasOwn(state.current, "exercise")) state.current.exercise = null;
      if (!Object.hasOwn(state.current, "requestedRating")) state.current.requestedRating = null;
      if (!Object.hasOwn(state.current, "ratingSource")) state.current.ratingSource = "automatic";
      if (!Object.hasOwn(state.current, "supplemental")) state.current.supplemental = false;
      if (!Object.hasOwn(state.current, "canSupplement")) state.current.canSupplement = false;
    }
    row.state_json = JSON.stringify(state);
  }
}

export function validateVocabularyCourseBackup(data: Data, files: { materialId: number; base64: string }[] = []) {
  const courses = new Set(data.vocabulary_courses.map((row) => row.id));
  const words = new Set(data.vocabulary_words.map((row) => row.id));
  const reviews = new Set(data.vocabulary_reviews.map((row) => row.id));
  const sessions = new Set(data.vocabulary_sessions.map((row) => row.id));
  const entries = new Map<string, ReturnType<typeof vocabularyCatalogEntrySchema.parse>>();
  const terms = new Set<string>();
  const fileHashes = new Map<number, string>();
  const checkSource = (exercise: VocabularyExercise) => {
    const source = exercise.sourceReference; if (!source) return;
    const materialId = Number(source.materialId), material = data.source_materials.find((row) => row.id === materialId);
    const file = files.find((item) => item.materialId === materialId);
    need(Number.isSafeInteger(materialId) && String(materialId) === source.materialId && material && file, "来源材料或附件不存在");
    if (!fileHashes.has(materialId)) fileHashes.set(materialId, createHash("sha256").update(Buffer.from(file!.base64, "base64")).digest("hex"));
    need(fileHashes.get(materialId) === source.fileSha256, "来源附件 SHA256 不一致");
    need(exercise.sentence === source.quote && source.end - source.start === source.quote.length, "来源原句与题面不一致");
    const found = data.practice_sets.some((row) => {
      if (row.kind !== "reading") return false;
      const resource = officialResourceSchema.safeParse(JSON.parse(String(row.resource_json)));
      if (!resource.success) return false;
      const passage = resource.data.readingPassages?.find((item) => item.id === source.passageId);
      return passage?.documents.some((document) => Number(document.url.split("/").at(-1)) === materialId && source.pdfPage >= (document.page ?? 1) && (source.endPdfPage ?? source.pdfPage) <= (document.endPage ?? document.page ?? 1));
    });
    need(found, "来源 Passage 或 PDF 页码不在允许的正文范围");
  };
  for (const row of data.vocabulary_courses) {
    vocabularyCourseSchema.parse({ id: row.id, title: row.title, description: row.description, kind: row.kind, version: row.version });
    need(date(row.created_at) && date(row.updated_at), "课程时间无效");
  }
  need(courses.size === data.vocabulary_courses.length, "课程 ID 重复");
  for (const row of data.vocabulary_catalog_entries) {
    const entry = exact(vocabularyCatalogEntrySchema, JSON.parse(String(row.data_json)));
    need(row.id === entry.id && row.normalized_term === normaliseVocabularyAnswer(entry.term) && !terms.has(String(row.normalized_term)) && !entries.has(entry.id), "词条标识或去重键无效");
    need(entry.courseIds.every((id) => courses.has(id)) && new Set(entry.courseIds).size === entry.courseIds.length, "词条关联课程不存在");
    need(date(row.created_at) && date(row.updated_at), "词条时间无效");
    need(new Set(entry.exercises.map((exercise) => exercise.id)).size === entry.exercises.length, "同一词条的题面 ID 重复");
    for (const exercise of entry.exercises) checkSource(exercise);
    entries.set(entry.id, entry); terms.add(String(row.normalized_term));
  }
  const checkExercise = (value: unknown) => {
    const exercise = exact(vocabularyExerciseSnapshotSchema, value);
    need(exercise.status === "published", "已学习题面不能是未发布草稿");
    need((exercise.entryId === null) === (exercise.courseId === null), "题面词条与课程关联必须同时存在或同时为空");
    checkSource(exercise);
    need((exercise.entryId === null || entries.has(exercise.entryId)) && (exercise.courseId === null || courses.has(exercise.courseId)), "题面关联词条或课程不存在");
    // These are immutable current/historical snapshots. A package can withdraw
    // that membership later without erasing its original learning provenance.
    // Live catalog memberships are validated separately against today's courseIds.
    return exercise;
  };
  for (const row of data.vocabulary_catalog_links) need(entries.has(String(row.entry_id)) && (row.word_id === null || words.has(row.word_id)) && [0, 1].includes(Number(row.detached)) && typeof row.detached === "number", "词条进度关联关系损坏");
  for (const row of data.vocabulary_word_context) {
    need(words.has(row.word_id) && typeof row.last_exercise_id === "string", "当前题面关联关系损坏"); checkExercise(JSON.parse(String(row.exercise_json)));
  }
  for (const row of data.vocabulary_review_context) {
    need(reviews.has(row.review_id) && ["automatic", "self"].includes(String(row.rating_source)) && (row.course_id === null || courses.has(row.course_id)), "评分来源关联关系损坏");
    const raw: unknown = JSON.parse(String(row.exercise_json));
    if (raw !== null && !(object(raw) && Object.keys(raw).length === 0)) {
      const exercise = checkExercise(raw);
      // Personal sentences have no catalog/course provenance. The review may still
      // record the valid course selected for that study session.
      need(exercise.entryId === null || exercise.courseId === row.course_id, "评分题面课程不一致");
    }
  }
  const attemptIds = new Set<number>(), submissionIds = new Set(data.vocabulary_review_audit.map((row) => row.submission_id));
  const ratings = new Set(["again", "hard", "good", "easy"]);
  for (const row of data.vocabulary_supplemental_attempts) {
    need(positive(row.id) && !attemptIds.has(row.id) && typeof row.submission_id === "string" && z.uuid().safeParse(row.submission_id).success && !submissionIds.has(row.submission_id), "辅助练习标识无效或提交重复");
    need(typeof row.session_id === "string" && sessions.has(row.session_id) && typeof row.word_id === "string" && words.has(row.word_id) && positive(row.word_version), "辅助练习词条或会话关联损坏");
    need(row.mode === "context" && typeof row.user_answer === "string" && row.user_answer.length <= 2000 && typeof row.correct === "number" && [0, 1].includes(row.correct)
      && typeof row.term_snapshot === "string" && row.term_snapshot.length > 0 && row.term_snapshot.length <= 200
      && ratings.has(String(row.requested_rating)) && ratings.has(String(row.effective_rating)) && ["automatic", "self"].includes(String(row.rating_source))
      && typeof row.confirmed_typo === "number" && [0, 1].includes(row.confirmed_typo) && typeof row.gave_up === "number" && [0, 1].includes(row.gave_up)
      && typeof row.duration_seconds === "number" && Number.isSafeInteger(row.duration_seconds) && row.duration_seconds >= 0
      && date(row.reviewed_at) && date(row.next_due_at) && (row.course_id === null || courses.has(row.course_id)), "辅助练习原始作答无效");
    const exercise = checkExercise(JSON.parse(String(row.exercise_json)));
    need(exercise.entryId === null || exercise.courseId === row.course_id, "辅助练习题面课程不一致");
    // The frozen exercise, not today's edited word or exercise, explains an old answer.
    const correct = Boolean(String(row.user_answer).trim()) && exercise.acceptedAnswers.some((answer) => normaliseVocabularyAnswer(String(row.user_answer)) === normaliseVocabularyAnswer(answer));
    const confirmedTypo = row.confirmed_typo === 1;
    need(row.correct === Number(correct), "辅助练习客观正确性与原始答案不一致");
    need(!confirmedTypo || row.gave_up === 0 && !correct && exercise.acceptedAnswers.some((answer) => isVocabularyTypoCandidate(String(row.user_answer), answer)), "辅助练习笔误确认资格无效");
    const reason = row.gave_up === 1 ? "gave_up" : confirmedTypo ? "confirmed_typo" : correct ? "correct_answer" : "incorrect_answer";
    const effectiveRating = row.gave_up === 1 || !correct && !confirmedTypo ? "again" : row.requested_rating;
    need(row.decision_reason === reason && row.effective_rating === effectiveRating, "辅助练习评分审计与原始答案不一致");
    attemptIds.add(row.id as number); submissionIds.add(row.submission_id);
  }
  need(data.vocabulary_study_preferences.length <= 1, "学习设置重复");
  for (const row of data.vocabulary_study_preferences) need(row.id === 1 && (row.active_course_id === null || courses.has(row.active_course_id)) && positive(row.daily_goal_seconds) && Number(row.daily_goal_seconds) <= 86400 && positive(row.start_rank) && positive(row.restore_version) && Number(row.restore_version) <= Number.MAX_SAFE_INTEGER - 2 && [0, 1].includes(Number(row.paused)) && typeof row.paused === "number", "学习设置无效");
  for (const row of data.vocabulary_study_heartbeats) need(typeof row.id === "string" && row.id && /^\d{4}-\d{2}-\d{2}$/.test(String(row.study_date)) && Number.isInteger(row.seconds) && Number(row.seconds) >= 0 && Number(row.seconds) <= 15 && date(row.created_at), "学习心跳无效");
  for (const row of data.vocabulary_sessions) {
    const state = JSON.parse(String(row.state_json));
    need(state.courseId === null || courses.has(state.courseId), "会话课程不存在");
    if (state.current?.exercise) checkExercise(state.current.exercise);
    if (state.current?.supplemental) need(state.mode === "context" && state.current.exercise && state.current.phase !== "learn" && state.current.canSupplement === false, "辅助练习会话状态无效");
    if (state.current?.canSupplement) need(state.mode === "context" && state.current.exercise && state.current.phase !== "learn" && state.current.supplemental === false, "追加练习入口状态无效");
  }
  const count = z.number().int().nonnegative();
  const readiness = z.object({ ready: count, pending: count }).strict();
  const confirmation = z.object({ courseId: z.string().min(1).max(200), added: count, existing: count, skipped: count, readiness }).strict();
  const previewSchema = z.object({ previewId: z.uuid(), revision: z.number().int().positive(), fileName: z.string().min(1).max(500), expiresAt: z.iso.datetime(), entries: z.array(z.unknown()).min(1).max(5000), readiness, confirmation: confirmation.optional(), confirmedTitle: z.string().min(1).max(200).optional(), summary: z.object({ total: count, new: count, existing: count, duplicate: count, invalid: count }).strict() }).strict();
  for (const row of data.vocabulary_import_previews) {
    const preview = previewSchema.parse(JSON.parse(String(row.preview_json)));
    need(row.id === preview.previewId && positive(row.revision) && row.revision <= Number.MAX_SAFE_INTEGER - 2 && ["pending", "confirmed"].includes(String(row.status)) && date(row.created_at) && date(row.expires_at) && row.expires_at === preview.expiresAt, "导入预览状态无效");
    need(row.status === "pending" ? row.confirmed_course_id === null && preview.confirmation === undefined && preview.confirmedTitle === undefined : courses.has(row.confirmed_course_id) && preview.confirmation?.courseId === row.confirmed_course_id && preview.confirmedTitle, "导入预览课程关联损坏");
    need(preview.revision <= Number(row.revision), "导入预览版本无效");
    if (preview.confirmation) {
      const saved = preview.confirmation;
      need(saved.added + saved.existing === preview.summary.new + preview.summary.existing && saved.skipped === preview.summary.duplicate + preview.summary.invalid && saved.readiness.ready + saved.readiness.pending === saved.added + saved.existing, "导入确认结果不一致");
    }
    for (const input of preview.entries) {
      need(object(input), "导入行格式无效"); const entry = input as VocabularyImportRow;
      need(positive(entry.row) && ["new", "existing", "duplicate", "invalid"].includes(entry.status) && Array.isArray(entry.issues) && entry.issues.every((issue) => typeof issue === "string"), "导入行状态无效");
      const { row: number, status, issues, ...word } = entry; void number; void issues;
      // Invalid rows retain the original invalid term so users can see the precise problem.
      exact(vocabularyInputSchema, status === "invalid" ? { ...word, term: "invalid-row" } : word);
    }
    need(isDeepStrictEqual(preview.summary, summarizeVocabularyImport(preview.entries as VocabularyImportRow[])), "导入汇总不一致");
    need(preview.readiness.ready + preview.readiness.pending === preview.summary.new + preview.summary.existing, "导入待完善数量不一致");
  }
  let active = 0;
  for (const row of data.vocabulary_assessments) {
    need(typeof row.id === "string" && row.id && positive(row.revision) && row.revision <= Number.MAX_SAFE_INTEGER - 2 && ["active", "completed"].includes(String(row.status)) && date(row.created_at) && date(row.updated_at), "测评状态无效");
    const questions = validateAssessmentQuestions(JSON.parse(String(row.questions_json)));
    const draft = exact(assessmentDraftSchema, JSON.parse(String(row.draft_json)));
    need(Object.keys(draft.answers).every((id) => questions.some((question) => question.id === id)), "测评草稿含未知题号");
    for (const question of questions) {
      const entry = entries.get(question.entryId), band = Number(question.band.slice(-1));
      need(entry && courses.has(question.courseId) && entry.courseIds.includes(question.courseId), "测评题目关联关系损坏");
      need(question.courseId === (question.band === "nawl" ? "academic" : "general") && (question.band === "nawl" || entry!.rank >= (band - 1) * 500 + 1 && entry!.rank <= (band === 5 ? 2809 : band * 500)), "测评题目频档不一致");
    }
    if (row.status === "active") { active++; need(row.result_json === null && row.submitted_at === null, "未完成测评不能包含结果"); }
    else {
      need(date(row.submitted_at) && typeof row.result_json === "string", "测评完成时间无效");
      need(isDeepStrictEqual(JSON.parse(String(row.result_json)), evaluateVocabularyAssessment(questions, draft.answers, new Date(String(row.submitted_at)))), "测评结果与保存答案不一致");
    }
  }
  need(active <= 1, "包含多个活动测评");
}
