import "server-only";
import type Database from "better-sqlite3";
import type { AttemptAnswer, PracticeQuestion } from "../lib/domain";
import { activeStudyStreak, choosePracticeFocus, shiftedStudyDate, summarizeObjective, type AnalyticsAttempt } from "../lib/learning-analytics";
import { writingFeedbackSchema } from "../lib/writing";
import { getDatabase } from "./db";
import { reviewModes } from "../lib/vocabulary";
import { assessmentDraftSchema, evaluateVocabularyAssessment, validateAssessmentQuestions } from "../lib/vocabulary-assessment";
import { isDeepStrictEqual } from "node:util";
import { vocabularyCatalogEntrySchema, vocabularyExerciseSnapshotSchema } from "../lib/vocabulary-course";

type Row = Record<string, unknown>;
function array<T>(json: unknown): T[] {
  try { const value = JSON.parse(String(json)); return Array.isArray(value) ? value : []; } catch { return []; }
}
function grouped(items: string[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item || "未分类", (counts.get(item || "未分类") ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function getLearningAnalytics(database: Database.Database = getDatabase(), now = new Date()) {
  const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
  const rows = (name: string): Row[] => tables.has(name) ? database.prepare(`SELECT * FROM "${name}"`).all() as Row[] : [];
  const timeZone = process.env.APP_TIME_ZONE || "Asia/Shanghai";
  const day = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const today = day(now);
  const weekDates = Array.from({ length: 7 }, (_, i) => shiftedStudyDate(today, i - 6));
  const fortnightDates = Array.from({ length: 14 }, (_, i) => shiftedStudyDate(today, i - 13));
  const sets = new Map(rows("practice_sets").map((row) => [String(row.id), row]));
  const attempts: AnalyticsAttempt[] = rows("practice_attempts").filter((row) => row.kind === "reading" || row.kind === "listening").map((row) => {
    const set = sets.get(String(row.set_id));
    return { id: Number(row.id), kind: row.kind as "reading" | "listening", title: String(set?.title ?? "历史练习"), correct: Number(row.raw_score), total: Number(row.total_questions), seconds: Number(row.duration_seconds), submittedAt: String(row.submitted_at), answers: array<AttemptAnswer>(row.answers_json), questions: array<PracticeQuestion>(set?.questions_json) };
  }).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const reading = summarizeObjective(attempts, "reading"), listening = summarizeObjective(attempts, "listening");
  const reasonRows = rows("practice_mistake_reasons");
  const reasons = (kind: "reading" | "listening") => {
    const ids = new Set(attempts.filter((item) => item.kind === kind).map((item) => item.id));
    return grouped(reasonRows.filter((row) => ids.has(Number(row.attempt_id))).map((row) => String(row.reason)));
  };
  const dictations = rows("dictation_attempts");
  const dictationErrors = { missing: 0, extra: 0, wrong: 0, spelling: 0 };
  for (const row of dictations) for (const error of array<{ kind: string }>(row.errors_json)) {
    if (error.kind in dictationErrors) dictationErrors[error.kind as keyof typeof dictationErrors] += 1;
  }
  const vocabulary = rows("vocabulary_words"), reviews = rows("vocabulary_reviews");
  const learningStates = new Map(rows("vocabulary_learning_state").map((state) => [String(state.word_id), state]));
  const wordsWithHistory = new Set(reviews.map((review) => String(review.word_id)));
  const hasKnownFirstLearning = (word: Row) => {
    const startedAt = learningStates.get(String(word.id))?.learning_started_at;
    return typeof startedAt === "string" && Number.isFinite(Date.parse(startedAt));
  };
  // Again may reset repetitions to zero; a first learning action is still learning.
  const reviewedCards = vocabulary.filter((word) => Boolean(learningStates.get(String(word.id))?.learning_started_at) || wordsWithHistory.has(String(word.id)) || Number(word.repetitions) > 0);
  const known = reviewedCards.filter((word) => Number(word.interval_days) >= 21).length;
  const audit = new Map(rows("vocabulary_review_audit").map((review) => [Number(review.review_id), review]));
  const successfulReviews = reviews.filter((review) => (audit.get(Number(review.id))?.requested_rating ?? review.rating) !== "again").length;
  const reviewIds = new Set(reviews.map((review) => Number(review.id)));
  const details = rows("vocabulary_review_details").filter((detail) => reviewIds.has(Number(detail.review_id)));
  const objectiveReviews = details.filter((review) => review.mode !== "recognition" && (review.correct === 0 || review.correct === 1));
  const byMode = reviewModes.map((mode) => {
    const modeReviews = details.filter((review) => review.mode === mode);
    const samples = mode === "recognition" ? [] : modeReviews.filter((review) => review.correct === 0 || review.correct === 1);
    const correct = samples.filter((review) => review.correct === 1).length;
    return { mode, reviewCount: modeReviews.length, sampleCount: samples.length, correctCount: correct,
      rawAccuracy: samples.length ? correct / samples.length * 100 : null,
      confirmedTypoCount: modeReviews.filter((review) => audit.get(Number(review.review_id))?.confirmed_typo === 1).length };
  });
  const vocabularyStats = {
    total: vocabulary.length, known, learning: reviewedCards.length - known, new: vocabulary.length - reviewedCards.length,
    firstLearningCount: vocabulary.filter(hasKnownFirstLearning).length,
    firstLearningUnknownCount: reviewedCards.filter((word) => !hasKnownFirstLearning(word)).length,
    due: vocabulary.filter((word) => Date.parse(String(word.due_at)) <= now.getTime()).length,
    reviews: reviews.length, scheduledGradeCount: reviews.length, retention: reviews.length ? successfulReviews / reviews.length * 100 : null,
    objectiveAccuracy: objectiveReviews.length ? objectiveReviews.filter((row) => row.correct === 1).length / objectiveReviews.length * 100 : null,
    objectiveSampleCount: objectiveReviews.length, byMode,
    confirmedTypoCount: [...audit.values()].filter((review) => review.confirmed_typo === 1).length,
    legacyAuditUnknownCount: reviews.filter((review) => !audit.has(Number(review.id))).length,
    reviewsByDay: weekDates.map((date) => ({ date, count: reviews.filter((review) => day(String(review.reviewed_at)) === date).length })),
  };
  const supplementalAttempts = rows("vocabulary_supplemental_attempts");
  const auxiliaryStats = (attempts: Row[]) => {
    const samples = attempts.filter((attempt) => attempt.correct === 0 || attempt.correct === 1);
    const correctCount = samples.filter((attempt) => attempt.correct === 1).length;
    return { attemptCount: attempts.length, sampleCount: samples.length, correctCount,
      rawAccuracy: samples.length ? correctCount / samples.length * 100 : null,
      confirmedTypoCount: attempts.filter((attempt) => attempt.confirmed_typo === 1).length };
  };
  const frozenPurpose = (json: unknown) => {
    try {
      const parsed = vocabularyExerciseSnapshotSchema.safeParse(JSON.parse(String(json)));
      return parsed.success ? parsed.data.purpose ?? null : null;
    } catch { return null; }
  };
  const consolidationAttempts = supplementalAttempts.filter((attempt) => frozenPurpose(attempt.exercise_json) === "consolidation");
  const extraSentenceAttempts = supplementalAttempts.filter((attempt) => frozenPurpose(attempt.exercise_json) === "supplemental");
  const mergedReviewIds = new Set(rows("vocabulary_review_context").filter((context) => frozenPurpose(context.exercise_json) === "merged").map((context) => Number(context.review_id)));
  const supplemental = { ...auxiliaryStats(supplementalAttempts),
    extraSentence: auxiliaryStats(extraSentenceAttempts), consolidation: auxiliaryStats(consolidationAttempts),
    unknownPurposeCount: supplementalAttempts.length - extraSentenceAttempts.length - consolidationAttempts.length,
    mergedScheduledGradeCount: reviews.filter((review) => mergedReviewIds.has(Number(review.id))).length };
  const targetStates = rows("vocabulary_target_state"), termDispositions = rows("vocabulary_term_dispositions");
  const targetOperations = rows("vocabulary_target_operations"), studyPreferences = rows("vocabulary_study_preferences");
  const targetFocus = studyPreferences.find((row) => row.id === 1)?.focus === "ielts-advanced" ? "ielts-advanced" : "general";
  const targetDefinitions = rows("vocabulary_catalog_entries").flatMap((row) => {
    try {
      const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(String(row.data_json)));
      return entry.targets.map((target) => ({ id: target.id, term: String(row.normalized_term),
        published: entry.status === "published" && target.status === "published", level: target.level }));
    } catch { return []; }
  });
  const pausedTerms = new Set(termDispositions.filter((disposition) => disposition.paused === 1).map((disposition) => disposition.normalized_term));
  const availableWordIds = new Set(vocabulary.map((word) => word.id));
  const activeConsolidations = targetStates.filter((state) => state.paused === 0 && !pausedTerms.has(state.normalized_term)
    && typeof state.word_id === "string" && availableWordIds.has(state.word_id)
    && [1, 2].includes(Number(state.step)) && typeof state.due_at === "string" && Number.isFinite(Date.parse(state.due_at))
    && targetDefinitions.some((definition) => definition.id === state.target_id && definition.published
      && (targetFocus === "general" || ["B2", "C1"].includes(definition.level ?? ""))));
  const targetStats = { focus: targetFocus, catalogTargetCount: targetDefinitions.length,
    introducedTargetCount: targetStates.filter((state) => typeof state.introduced_at === "string" && Number.isFinite(Date.parse(state.introduced_at))).length,
    selfReportedKnownTargetCount: targetStates.filter((state) => state.paused === 1).length,
    selfReportedKnownActionCount: targetOperations.filter((operation) => operation.action === "know-target").length,
    pausedTermCount: pausedTerms.size, consolidationPendingCount: activeConsolidations.length,
    consolidationDueCount: activeConsolidations.filter((state) => Date.parse(String(state.due_at)) <= now.getTime()).length };
  const assessments = rows("vocabulary_assessments"), courseTitles = new Map(rows("vocabulary_courses").map((course) => [String(course.id), String(course.title)]));
  const completedAssessments = assessments.filter((assessment) => assessment.status === "completed");
  const assessmentResults = completedAssessments.flatMap((assessment) => {
    // Reading analytics never initializes tables or rewrites unknown historical results.
    try {
      const questions = validateAssessmentQuestions(JSON.parse(String(assessment.questions_json)));
      const draft = assessmentDraftSchema.parse(JSON.parse(String(assessment.draft_json)));
      const result = evaluateVocabularyAssessment(questions, draft.answers, new Date(String(assessment.submitted_at)));
      if (!isDeepStrictEqual(result, JSON.parse(String(assessment.result_json)))) return [];
      return [{ id: String(assessment.id), total: result.total, answered: result.answered, skipped: result.skipped, correct: result.correct,
        bands: result.bands, recommendedCourseId: result.recommendedCourseId, recommendedCourseTitle: courseTitles.get(result.recommendedCourseId) ?? (result.recommendedCourseId === "academic" ? "学术课程" : "基础课程"),
        recommendedStartRank: result.recommendedStartRank, startBand: result.startBand, completedAt: result.completedAt }];
    } catch { return []; }
  }).sort((left, right) => right.completedAt.localeCompare(left.completedAt) || right.id.localeCompare(left.id));
  const assessmentStats = {
    completedCount: completedAssessments.length, activeCount: assessments.filter((assessment) => assessment.status === "active").length,
    resultUnknownCount: completedAssessments.length - assessmentResults.length,
    skippedQuestionCount: assessmentResults.reduce((count, result) => count + result.skipped, 0),
    lastResult: assessmentResults[0] ?? null,
  };
  const submissions = new Map(rows("writing_submissions").map((row) => [Number(row.id), row]));
  const writing = rows("writing_feedback_details").flatMap((detail) => {
    const submission = submissions.get(Number(detail.submission_id));
    if (!submission || !detail.provider || detail.provider === "local-fallback") return [];
    try {
      const feedback = writingFeedbackSchema.parse(JSON.parse(String(detail.feedback_json)));
      return [{ id: Number(detail.submission_id), taskType: String(submission.task_type), overallBand: feedback.overallBand, criteria: feedback.criteria, submittedAt: String(detail.created_at), wordCount: Number(submission.word_count) }];
    } catch { return []; }
  }).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const drafts = rows("writing_drafts"), completedDrafts = drafts.filter((row) => row.status === "completed");
  const writingErrors = grouped(rows("review_items").filter((row) => String(row.skill).toLowerCase() === "writing").map((row) => String(row.category || "未分类")));
  const sessions = rows("study_sessions");
  const activeDates = [...new Set(sessions.filter((row) => Number(row.duration_seconds) > 0).map((row) => String(row.study_date)))];
  const secondsOnDate = (date: string) => sessions.filter((row) => row.study_date === date).reduce((sum, row) => sum + Number(row.duration_seconds), 0);
  const activity = [
    ...attempts.map((attempt) => ({ date: attempt.submittedAt, label: `${attempt.kind === "reading" ? "Reading" : "Listening"} · ${attempt.title}`, detail: `${attempt.correct}/${attempt.total} 题正确`, href: `/practice/${attempt.kind}` })),
    ...dictations.map((row) => ({ date: String(row.created_at), label: "Listening · 听写", detail: `${array(row.errors_json).length} 个词语差异`, href: "/practice/listening" })),
    ...completedDrafts.map((row) => ({ date: String(row.updated_at), label: `Writing · ${String(row.task_type).toUpperCase()} · Draft ${row.version}`, detail: "已完成并保存", href: "/writing" })),
    ...writing.map((row) => ({ date: row.submittedAt, label: "Writing · AI 反馈", detail: `AI Estimated Band ${row.overallBand.toFixed(1)}`, href: "/writing" })),
    ...reviews.map((row) => ({ date: String(row.reviewed_at), label: "Vocabulary · SRS 复习", detail: String(row.rating), href: "/vocabulary" })),
    ...supplementalAttempts.map((row) => ({ date: String(row.reviewed_at), label: frozenPurpose(row.exercise_json) === "consolidation" ? "Vocabulary · 用法分钟巩固" : "Vocabulary · 辅助语境练习", detail: row.correct === 1 ? "原始作答正确 · 不推进 FSRS" : "原始作答错误 · 不推进 FSRS", href: "/vocabulary" })),
    ...assessmentResults.map((result) => ({ date: result.completedAt, label: "Vocabulary · 课程摸底", detail: `${result.correct}/${result.total} · 建议${result.recommendedCourseTitle}`, href: "/vocabulary" })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  return {
    today, timeZone, reading, listening, readingReasons: reasons("reading"), listeningReasons: reasons("listening"),
    focus: choosePracticeFocus(reading, listening), attempts: attempts.slice(0, 12), dictationAttempts: dictations.length, dictationErrors,
    vocabulary: { ...vocabularyStats, supplemental, targets: targetStats, assessment: assessmentStats }, writing, writingErrors, writingDrafts: drafts.length, completedDrafts: completedDrafts.length,
    completedWritingToday: completedDrafts.filter((row) => day(String(row.updated_at)) === today).length,
    study: { todayMinutes: secondsOnDate(today) / 60, weekMinutes: weekDates.reduce((sum, date) => sum + secondsOnDate(date), 0) / 60,
      daysThisWeek: weekDates.filter((date) => activeDates.includes(date)).length, streak: activeStudyStreak(activeDates, today),
      minutesByDay: fortnightDates.map((date) => ({ date, minutes: secondsOnDate(date) / 60 })) },
    activity,
  };
}
