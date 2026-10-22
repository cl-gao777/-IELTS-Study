import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { morphologyLessonSchema, morphologySessionStateSchema, morphologyAnswerResultSchema, morphologyHistorySchema,
  normaliseMorphologyAnswer, morphologyContextPrompt, morphologyContextCue, type MorphologySessionState, type MorphologyAnswerResult } from "@/lib/morphology";

type Row = Record<string, string | number | null>;
type Data = Record<string, Row[]>;
export const V6_MORPHOLOGY_TABLES = ["morphology_lessons", "morphology_progress", "morphology_sessions", "morphology_attempts",
  "morphology_runs", "morphology_operations", "morphology_study_segments", "morphology_selected_targets", "morphology_enrollment_operations"] as const;
const uuid = z.uuid(), date = z.iso.datetime(), integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2);
const positive = integer.min(1), hash = /^[a-f0-9]{64}$/;
const json = (row: Row, key: string): unknown => JSON.parse(String(row[key]));
function requireValid(condition: unknown, message = "词根课程备份的关联或审计数据无效。") { if (!condition) throw new Error(message); }
function same(actual: unknown, expected: unknown) { requireValid(isDeepStrictEqual(actual, expected)); }

/** Known old formats contain no morphology history; never invent completions or grades. */
export function migrateMorphologyBackup(data: Data) {
  for (const table of V6_MORPHOLOGY_TABLES) {
    if (Object.hasOwn(data, table) && (!Array.isArray(data[table]) || data[table].length)) throw new Error("旧版备份不能声明新版词根学习记录。");
    data[table] = [];
  }
}

function validateFrozenQuestions(state: MorphologySessionState) {
  const lesson = state.lesson;
  const expectedIds = [lesson.id + ":meaning", lesson.id + ":structure", ...lesson.words.map(word => lesson.id + ":context:" + word.id)];
  if (state.retry !== "weak") same(state.questions.map(question => question.id), expectedIds);
  for (const question of state.questions) {
    requireValid(expectedIds.includes(question.id));
    requireValid(new Set(question.options).size === question.options.length);
    if (question.kind === "meaning") {
      requireValid(question.id === lesson.id + ":meaning" && question.wordId === null && question.options.includes(lesson.meaningZh));
      same(question.acceptedAnswers, [lesson.meaningZh]); same(question.explanation, lesson.overviewZh); same(question.sentence, "");
      same(question.prompt, `本课中 ${lesson.form} 表达的核心含义是什么？`); same(question.hint, lesson.overviewZh);
      if (lesson.meaningDistractors?.length) same([...question.options].sort(), [lesson.meaningZh, ...lesson.meaningDistractors].sort());
    } else if (question.kind === "structure") {
      requireValid(question.id === lesson.id + ":structure" && question.wordId === null);
      same([...question.options].sort(), [...lesson.structureQuestion.options].sort());
      same(question.acceptedAnswers, [lesson.structureQuestion.answer]); same(question.prompt, lesson.structureQuestion.prompt);
      same(question.explanation, lesson.structureQuestion.explanation); same(question.sentence, "");
      same(question.hint, lesson.spellingZh);
    } else {
      const word = lesson.words.find(word => word.id === question.wordId);
      requireValid(word && question.id === lesson.id + ":context:" + word.id && !question.options.length);
      const example = word!.examples.find(example => example.sentence === question.sentence && isDeepStrictEqual(example.acceptedAnswers, question.acceptedAnswers));
      requireValid(example, "词根语境题不对应已冻结的例句与词形。");
      same(question.explanation, word!.explanationZh);
      same(question.prompt, morphologyContextPrompt(example!, morphologyContextCue(lesson, word!, example!)));
      same(question.hint, word!.segments.map(segment => segment.surface + "（" + segment.meaningZh + "）").join(" + "));
    }
  }
  const questionIds = state.questions.map(question => question.id);
  const expectedResults = questionIds.slice(0, state.questionIndex);
  requireValid(state.results.length === expectedResults.length || state.results.length === expectedResults.length + 1);
  same(state.results.map(result => result.questionId), questionIds.slice(0, state.results.length));
  for (const result of state.results) {
    const question = state.questions.find(question => question.id === result.questionId)!;
    same(result.acceptedAnswers, question.acceptedAnswers); same(result.explanation, question.explanation); same(result.sentence, question.sentence);
    requireValid(result.gaveUp || Boolean(result.answer.trim()));
    same(result.correct, !result.gaveUp && question.acceptedAnswers.some(answer => normaliseMorphologyAnswer(answer) === normaliseMorphologyAnswer(result.answer)));
  }
}

export function validateMorphologyBackup(data: Data) {
  for (const table of V6_MORPHOLOGY_TABLES) requireValid(Array.isArray(data[table]), "备份缺少词根课程数据表。");
  const lessons = new Map(data.morphology_lessons.map(row => {
    const raw = json(row, "data_json"), lesson = morphologyLessonSchema.parse(raw); same(raw, lesson);
    requireValid(row.id === lesson.id && row.version === lesson.version); return [lesson.id, lesson] as const;
  }));
  requireValid(lessons.size === data.morphology_lessons.length);
  let active = 0;
  const sessions = new Map(data.morphology_sessions.map(row => {
    const raw = json(row, "state_json"), state = morphologySessionStateSchema.parse(raw); same(raw, state);
    requireValid(uuid.safeParse(row.id).success && positive.safeParse(row.revision).success && ["active", "ended"].includes(String(row.status))
      && date.safeParse(row.started_at).success && date.safeParse(row.updated_at).success && lessons.has(state.lesson.id));
    requireValid(row.status !== "active" || state.phase !== "results");
    requireValid(row.status !== "ended" || state.paused);
    if (row.status === "active") active++;
    validateFrozenQuestions(state); return [String(row.id), { row, state }] as const;
  }));
  requireValid(active <= 1 && sessions.size === data.morphology_sessions.length);
  const attempts = new Map<string, MorphologyAnswerResult>();
  const firsts = new Map<string, number>(), sampled = new Map<string, { firstAt: string | null; earliest: string }>();
  for (const row of data.morphology_attempts) {
    const raw = json(row, "result_json"), result = morphologyAnswerResultSchema.parse(raw); same(raw, result);
    const session = sessions.get(String(row.session_id));
    requireValid(session && uuid.safeParse(row.id).success && row.id === result.operationId && hash.test(String(row.request_hash))
      && date.safeParse(row.created_at).success && row.created_at === result.submittedAt
      && row.lesson_id === session.state.lesson.id && row.lesson_version === session.state.lesson.version && row.question_id === result.questionId);
    same(session!.state.results.find(answer => answer.operationId === row.id), result);
    requireValid(!attempts.has(String(row.id))); attempts.set(String(row.id), result);
    const key = String(row.lesson_id) + ":" + row.question_id;
    const sample = sampled.get(key) ?? { firstAt: null, earliest: result.submittedAt };
    if (result.submittedAt < sample.earliest) sample.earliest = result.submittedAt;
    if (result.firstAttempt) sample.firstAt = result.submittedAt;
    sampled.set(key, sample);
    if (result.firstAttempt) firsts.set(key, (firsts.get(key) ?? 0) + 1);
  }
  for (const [key, sample] of sampled) requireValid(firsts.get(key) === 1 && sample.firstAt === sample.earliest, "首次词根练习样本重复、缺失或转移到后续作答。");
  for (const { state } of sessions.values()) for (const result of state.results) same(attempts.get(result.operationId), result);
  const runs = new Map<string, ReturnType<typeof morphologyHistorySchema.parse>>();
  for (const row of data.morphology_runs) {
    const raw = json(row, "result_json"), result = morphologyHistorySchema.parse(raw); same(raw, result);
    const session = sessions.get(String(row.id));
    requireValid(session && session.row.status === "ended" && session.state.phase === "results" && row.id === result.id
      && row.lesson_id === result.lessonId && row.lesson_version === result.lessonVersion && date.safeParse(row.completed_at).success && row.completed_at === result.completedAt);
    const { state } = session!, answers = state.results;
    same({ lessonId: result.lessonId, lessonVersion: result.lessonVersion, lessonTitle: result.lessonTitle, retry: result.retry,
      correct: result.correct, total: result.total, independentCorrect: result.independentCorrect, independentTotal: result.independentTotal,
      hintedCorrect: result.hintedCorrect, hintedTotal: result.hintedTotal, firstIndependentCorrect: result.firstIndependentCorrect, firstIndependentTotal: result.firstIndependentTotal },
    { lessonId: state.lesson.id, lessonVersion: state.lesson.version, lessonTitle: state.lesson.titleZh, retry: state.retry,
      correct: answers.filter(answer => answer.correct).length, total: state.questions.length,
      independentCorrect: answers.filter(answer => !answer.hintUsed && answer.correct).length, independentTotal: answers.filter(answer => !answer.hintUsed).length,
      hintedCorrect: answers.filter(answer => answer.hintUsed && answer.correct).length, hintedTotal: answers.filter(answer => answer.hintUsed).length,
      firstIndependentCorrect: answers.filter(answer => answer.firstAttempt && !answer.hintUsed && answer.correct).length, firstIndependentTotal: answers.filter(answer => answer.firstAttempt && !answer.hintUsed).length });
    requireValid(!runs.has(result.id)); runs.set(result.id, result);
  }
  for (const [id, { state }] of sessions) if (state.phase === "results") requireValid(runs.has(id));
  for (const row of data.morphology_progress) {
    requireValid(lessons.has(String(row.lesson_id)) && integer.safeParse(row.completed_runs).success && integer.safeParse(row.last_correct).success
      && integer.safeParse(row.last_total).success && (row.read_at === null || date.safeParse(row.read_at).success) && (row.completed_at === null || date.safeParse(row.completed_at).success));
    const completed = [...runs.values()].filter(run => run.lessonId === row.lesson_id);
    requireValid(row.completed_runs === completed.length);
    if (completed.length) requireValid(completed.some(run => run.completedAt === row.completed_at && run.correct === row.last_correct && run.total === row.last_total));
    else requireValid(row.completed_at === null && row.last_correct === 0 && row.last_total === 0);
  }
  for (const run of runs.values()) requireValid(data.morphology_progress.some(row => row.lesson_id === run.lessonId));
  for (const row of data.morphology_operations) requireValid(uuid.safeParse(row.id).success && hash.test(String(row.request_hash)) && sessions.has(String(row.session_id)));
  for (const row of data.morphology_study_segments) {
    const day = String(row.study_date);
    requireValid(uuid.safeParse(row.id).success && sessions.has(String(row.session_id)) && uuid.safeParse(row.data_epoch).success
      && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
      && integer.max(86400).safeParse(row.seconds).success && date.safeParse(row.updated_at).success);
    const aggregate = data.study_sessions.find(item => item.id === "morphology:" + row.id);
    if (row.seconds || aggregate) requireValid(aggregate?.area === "Morphology" && aggregate.study_date === day && aggregate.duration_seconds === row.seconds);
  }
  for (const row of data.study_sessions.filter(row => row.area === "Morphology")) requireValid(data.morphology_study_segments.some(segment => row.id === "morphology:" + segment.id), "词根学习时间缺少对应的累计片段。");
  for (const row of data.morphology_selected_targets) {
    requireValid(typeof row.target_id === "string" && typeof row.normalized_term === "string" && typeof row.lesson_id === "string" && typeof row.word_key === "string"
      && date.safeParse(row.created_at).success && data.vocabulary_words.some(word => word.id === row.word_id) && lessons.has(row.lesson_id));
    const original = json(row, "lesson_json"), lesson = morphologyLessonSchema.parse(original); same(original, lesson);
    const word = lesson.words.find(word => word.id === row.word_key);
    requireValid(lesson.id === row.lesson_id && word && !word.illustrative && normaliseMorphologyAnswer(word.term) === row.normalized_term);
    requireValid(row.target_id === "morphology:" + createHash("sha256").update(word!.id).digest("hex").slice(0, 24));
    requireValid(data.vocabulary_catalog_entries.some(entry => {
      const item = JSON.parse(String(entry.data_json));
      return item.normalizedTerm === row.normalized_term || normaliseMorphologyAnswer(item.term) === row.normalized_term
        ? item.targets?.some((target: { id: string; memberships: { courseId: string }[] }) => target.id === row.target_id && target.memberships.some(member => member.courseId === "morphology-selected")) : false;
    }));
  }
  const enrollmentResult = z.object({ status: z.enum(["added", "existing", "paused"]), message: z.string(), wordId: z.uuid(), targetId: z.string().min(1) }).strict();
  for (const row of data.morphology_enrollment_operations) {
    requireValid(uuid.safeParse(row.id).success && uuid.safeParse(row.data_epoch).success && hash.test(String(row.request_hash)) && date.safeParse(row.created_at).success);
    enrollmentResult.parse(json(row, "result_json"));
  }
}
