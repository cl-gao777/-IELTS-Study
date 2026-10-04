import "server-only";
import type Database from "better-sqlite3";
import type { AttemptAnswer, PracticeQuestion } from "../lib/domain";
import { activeStudyStreak, choosePracticeFocus, shiftedStudyDate, summarizeObjective, type AnalyticsAttempt } from "../lib/learning-analytics";
import { writingFeedbackSchema } from "../lib/writing";
import { getDatabase } from "./db";

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
  const reviewedCards = vocabulary.filter((word) => Number(word.repetitions) > 0);
  const known = reviewedCards.filter((word) => Number(word.interval_days) >= 21).length;
  const successfulReviews = reviews.filter((review) => review.rating !== "again").length;
  const objectiveReviews = rows("vocabulary_review_details").filter((review) => review.correct === 0 || review.correct === 1);
  const vocabularyStats = {
    total: vocabulary.length, known, learning: reviewedCards.length - known, new: vocabulary.length - reviewedCards.length,
    due: vocabulary.filter((word) => Date.parse(String(word.due_at)) <= now.getTime()).length,
    reviews: reviews.length, retention: reviews.length ? successfulReviews / reviews.length * 100 : null,
    objectiveAccuracy: objectiveReviews.length ? objectiveReviews.filter((row) => row.correct === 1).length / objectiveReviews.length * 100 : null,
    reviewsByDay: weekDates.map((date) => ({ date, count: reviews.filter((review) => day(String(review.reviewed_at)) === date).length })),
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
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  return {
    today, timeZone, reading, listening, readingReasons: reasons("reading"), listeningReasons: reasons("listening"),
    focus: choosePracticeFocus(reading, listening), attempts: attempts.slice(0, 12), dictationAttempts: dictations.length, dictationErrors,
    vocabulary: vocabularyStats, writing, writingErrors, writingDrafts: drafts.length, completedDrafts: completedDrafts.length,
    completedWritingToday: completedDrafts.filter((row) => day(String(row.updated_at)) === today).length,
    study: { todayMinutes: secondsOnDate(today) / 60, weekMinutes: weekDates.reduce((sum, date) => sum + secondsOnDate(date), 0) / 60,
      daysThisWeek: weekDates.filter((date) => activeDates.includes(date)).length, streak: activeStudyStreak(activeDates, today),
      minutesByDay: fortnightDates.map((date) => ({ date, minutes: secondsOnDate(date) / 60 })) },
    activity,
  };
}
