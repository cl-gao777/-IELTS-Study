import type { AttemptAnswer, PracticeQuestion } from "./domain";

export interface AnalyticsAttempt {
  id: number; kind: "reading" | "listening"; title: string; correct: number; total: number;
  seconds: number; submittedAt: string; answers: AttemptAnswer[]; questions: PracticeQuestion[];
}
export interface QuestionTypeMetric { kind: string; correct: number; total: number; accuracy: number; secondsPerQuestion: number }
export function summarizeObjective(attempts: AnalyticsAttempt[], kind: AnalyticsAttempt["kind"]) {
  const selected = attempts.filter((attempt) => attempt.kind === kind && attempt.total > 0);
  const correct = selected.reduce((sum, attempt) => sum + attempt.correct, 0);
  const total = selected.reduce((sum, attempt) => sum + attempt.total, 0);
  const seconds = selected.reduce((sum, attempt) => sum + attempt.seconds, 0);
  const types = new Map<string, { correct: number; total: number; seconds: number }>();
  for (const attempt of selected) {
    const questions = new Map(attempt.questions.map((question) => [question.id, question.kind]));
    for (const answer of attempt.answers) {
      const type = questions.get(answer.questionId) ?? "unknown";
      const value = types.get(type) ?? { correct: 0, total: 0, seconds: 0 };
      value.correct += Number(answer.correct); value.total += 1; value.seconds += attempt.seconds / attempt.total;
      types.set(type, value);
    }
  }
  const byType: QuestionTypeMetric[] = [...types].map(([kind, value]) => ({ kind, correct: value.correct, total: value.total, accuracy: value.correct / value.total * 100, secondsPerQuestion: value.seconds / value.total }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
  return { attempts: selected.length, correct, total, accuracy: total ? correct / total * 100 : null, secondsPerQuestion: total ? seconds / total : null, byType };
}

export function shiftedStudyDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function activeStudyStreak(dates: string[], today: string) {
  const active = new Set(dates);
  let cursor = active.has(today) ? today : shiftedStudyDate(today, -1);
  let streak = 0;
  while (active.has(cursor)) { streak += 1; cursor = shiftedStudyDate(cursor, -1); }
  return streak;
}

export function choosePracticeFocus(reading: ReturnType<typeof summarizeObjective>, listening: ReturnType<typeof summarizeObjective>) {
  if (!reading.total) return { skill: "reading", href: "/practice/reading", text: "先完成一组 Reading 题目，建立实际阅读基线。" };
  if (!listening.total) return { skill: "listening", href: "/practice/listening", text: "再完成一组 Listening 题目，建立实际听力基线。" };
  const skill = reading.accuracy! <= listening.accuracy! ? "reading" : "listening";
  const stats = skill === "reading" ? reading : listening;
  return { skill, href: `/practice/${skill}`, text: `优先投入 ${skill === "reading" ? "Reading" : "Listening"}：已答 ${stats.total} 题，正确率 ${stats.accuracy!.toFixed(0)}%。先复习最弱题型，再用新材料验证。` };
}
