import { z } from "zod";
import { normaliseVocabularyAnswer } from "./vocabulary";
import { vocabularyExerciseGap } from "./vocabulary-course";
export const assessmentBands = ["ngsl-1", "ngsl-2", "ngsl-3", "ngsl-4", "ngsl-5", "nawl"] as const;
export type VocabularyAssessmentBand = typeof assessmentBands[number];
export interface VocabularyAssessmentQuestion { id: string; band: VocabularyAssessmentBand; prompt: string; meaningZh: string }
export interface VocabularyAssessmentQuestionSnapshot extends VocabularyAssessmentQuestion {
  entryId: string; courseId: string; sentence: string; targetStart: number; targetEnd: number; targetSurface: string; acceptedAnswers: string[]; source: string;
}
export interface VocabularyAssessmentResult {
  total: number; answered: number; skipped: number; correct: number;
  bands: { band: VocabularyAssessmentBand; total: number; correct: number }[];
  recommendedCourseId: string; recommendedStartRank: number; startBand: VocabularyAssessmentBand; completedAt: string;
  feedback: { id: string; correct: boolean; submitted: string; sentence: string; acceptedAnswers: string[]; source: string }[];
}
export interface VocabularyAssessment {
  id: string; revision: number; status: "active" | "completed";
  questions: VocabularyAssessmentQuestion[];
  draft: { answers: Record<string, string>; currentIndex: number };
  result: VocabularyAssessmentResult | null; createdAt: string; updatedAt: string;
}
export interface VocabularyAssessmentResponse { assessment: VocabularyAssessment | null; error?: string }
export const assessmentDraftSchema = z.object({ answers: z.record(z.string().min(1).max(100), z.string().max(2000)), currentIndex: z.number().int().min(0).max(30) }).strict();
export const assessmentQuestionSchema = z.object({
  id: z.string().min(1).max(100), band: z.enum(assessmentBands), prompt: z.string().min(1).max(4006), meaningZh: z.string().min(1).max(1000),
  entryId: z.string().min(1).max(200), courseId: z.string().min(1).max(200), sentence: z.string().min(1).max(4000), source: z.string().max(2000),
  targetStart: z.number().int().nonnegative(), targetEnd: z.number().int().positive(), targetSurface: z.string().min(1).max(200), acceptedAnswers: z.array(z.string().min(1).max(200)).min(1).max(30),
}).strict().superRefine((value, context) => {
  if (value.sentence.slice(value.targetStart, value.targetEnd) !== value.targetSurface || value.targetEnd > value.sentence.length || value.prompt !== vocabularyExerciseGap({ ...value, status: "published", version: 1 })) context.addIssue({ code: "custom", message: "测评题目与来源句中的目标位置不一致。" });
  if (!value.acceptedAnswers.some((answer) => normaliseVocabularyAnswer(answer) === normaliseVocabularyAnswer(value.targetSurface))) context.addIssue({ code: "custom", message: "测评答案须包含原句词形。" });
});

export function validateAssessmentQuestions(input: unknown): VocabularyAssessmentQuestionSnapshot[] {
  const questions = z.array(assessmentQuestionSchema).length(30).parse(input);
  if (new Set(questions.map((question) => question.id)).size !== 30 || new Set(questions.map((question) => question.entryId)).size !== 30) throw new Error("测评题目重复。");
  for (const band of assessmentBands) if (questions.filter((question) => question.band === band).length !== (band === "nawl" ? 10 : 4)) throw new Error("测评须包含五个基础频档各 4 题及 10 道学术词题。");
  return questions;
}

export function evaluateVocabularyAssessment(questions: VocabularyAssessmentQuestionSnapshot[], answers: Record<string, string>, now = new Date()): VocabularyAssessmentResult {
  validateAssessmentQuestions(questions);
  if (Object.keys(answers).some((id) => !questions.some((question) => question.id === id))) throw new Error("测评包含未知题号。");
  if (questions.some((question) => !Object.hasOwn(answers, question.id))) throw new Error("请完成全部 30 题；不会的词可选择跳过，退出会保留当前进度。");
  const feedback = questions.map((question) => ({ id: question.id,
    correct: Boolean(answers[question.id].trim()) && question.acceptedAnswers.some((answer) => normaliseVocabularyAnswer(answer) === normaliseVocabularyAnswer(answers[question.id])),
    submitted: answers[question.id], sentence: question.sentence, acceptedAnswers: question.acceptedAnswers, source: question.source }));
  const bands = assessmentBands.map((band) => ({ band, total: questions.filter((question) => question.band === band).length,
    correct: questions.filter((question) => question.band === band && feedback.find((item) => item.id === question.id)!.correct).length }));
  const startBand = bands.find((band) => band.band !== "nawl" && band.correct < 3)?.band ?? "nawl";
  return { total: 30, answered: feedback.filter((item) => item.submitted.trim()).length, skipped: feedback.filter((item) => !item.submitted.trim()).length,
    correct: feedback.filter((item) => item.correct).length, bands, recommendedCourseId: startBand === "nawl" ? "academic" : "general", recommendedStartRank: startBand === "nawl" ? 1 : (Number(startBand.slice(-1)) - 1) * 500 + 1, startBand,
    completedAt: now.toISOString(), feedback };
}
