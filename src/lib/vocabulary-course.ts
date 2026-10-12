import { z } from "zod";
import { vocabularyInputSchema, normaliseVocabularyAnswer } from "./vocabulary";
import { vocabularyTargetSchema, vocabularyTargetSnapshotSchema, vocabularyCardPurposeSchema, vocabularyConsolidationSnapshotSchema, type VocabularyTarget, type VocabularyFocus } from "./vocabulary-target";

const identity = z.string().trim().min(1).max(200);
export const vocabularySourceReferenceSchema = z.object({
  materialId: identity, fileSha256: z.string().regex(/^[a-f0-9]{64}$/), passageId: identity,
  pdfPage: z.number().int().positive(), endPdfPage: z.number().int().positive().optional(),
  textVersion: z.literal("reading-body-v1").optional(), start: z.number().int().nonnegative(),
  end: z.number().int().positive(), quote: z.string().min(1).max(4000),
}).superRefine((value, context) => {
  if (value.end <= value.start || (value.endPdfPage !== undefined && value.endPdfPage < value.pdfPage))
    context.addIssue({ code: "custom", message: "原文位置范围无效。" });
});
export const vocabularyExerciseSchema = z.object({
  status: z.enum(["draft", "published"]).default("published"),
  id: identity, version: z.number().int().positive(), sentence: z.string().min(1).max(4000),
  targetStart: z.number().int().nonnegative(), targetEnd: z.number().int().positive(),
  targetSurface: z.string().min(1).max(200), acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  meaningZh: z.string().max(1000).default(""), source: z.string().max(2000).default(""),
  sourceReference: vocabularySourceReferenceSchema.optional(),
  targetId: identity.optional(),
}).superRefine((value, context) => {
  if (value.targetEnd <= value.targetStart || value.sentence.slice(value.targetStart, value.targetEnd) !== value.targetSurface)
    context.addIssue({ code: "custom", message: "题面目标位置必须准确对应原句词形。" });
  if (!value.acceptedAnswers.some((answer) => normaliseVocabularyAnswer(answer) === normaliseVocabularyAnswer(value.targetSurface)))
    context.addIssue({ code: "custom", message: "可接受答案必须包含原句词形。" });
});
export const vocabularyExerciseSnapshotSchema = vocabularyExerciseSchema.safeExtend({ entryId: identity.nullable(), courseId: identity.nullable(),
  target: vocabularyTargetSnapshotSchema.optional(), purpose: vocabularyCardPurposeSchema.optional(), consolidation: vocabularyConsolidationSnapshotSchema.optional() });
export const vocabularyCourseSchema = z.object({
  id: identity, title: z.string().trim().min(1).max(200), description: z.string().max(4000).default(""),
  kind: z.enum(["builtin", "user-import"]).default("builtin"), version: z.number().int().positive().default(1),
});
export const vocabularyCatalogEntrySchema = vocabularyInputSchema.extend({
  status: z.enum(["draft", "published"]).default("published"), version: z.number().int().positive().default(1),
  id: identity, courseIds: z.array(identity).min(1).max(1000), rank: z.number().int().positive(),
  exercises: z.array(vocabularyExerciseSchema).max(500).default([]),
  targets: z.array(vocabularyTargetSchema).max(100).default([]),
});
export const vocabularyCatalogSchema = z.object({
  courses: z.array(vocabularyCourseSchema), entries: z.array(vocabularyCatalogEntrySchema),
});
export type VocabularyCourse = z.infer<typeof vocabularyCourseSchema>;
export type VocabularyCatalogEntry = Omit<z.infer<typeof vocabularyCatalogEntrySchema>, "targets"> & { targets?: VocabularyTarget[] };
export type VocabularyExercise = z.infer<typeof vocabularyExerciseSchema>;
export type VocabularyExerciseSnapshot = z.infer<typeof vocabularyExerciseSnapshotSchema>;
export type VocabularyCatalog = z.infer<typeof vocabularyCatalogSchema>;
export type VocabularyRatingSource = "automatic" | "self";
export type VocabularyCourseSummary = VocabularyCourse & { total: number; ready: number; pending: number; learned: number; due: number };
export interface VocabularyCoursesResponse { courses: VocabularyCourseSummary[]; activeCourseId: string | null; startRank: number; total: number; page: number; pageSize: number }
export interface VocabularyStudyState { restoreVersion: number; dailyGoalSeconds: number; todaySeconds: number; paused: boolean; activeCourseId: string | null; activeCourseTitle?: string | null; startRank: number; focus?: VocabularyFocus; policyVersion?: number; nextLevel?: "B2" | "C1" }
export interface VocabularyStudyUpdate { restoreVersion?: number; dailyGoalSeconds?: number; paused?: boolean; focus?: VocabularyFocus; heartbeat?: { id: string; seconds: number } }

export function vocabularyExerciseGap(exercise: VocabularyExercise) {
  const alternatives = [...new Set([exercise.targetSurface, ...exercise.acceptedAnswers])].sort((a, b) => b.length - a.length)
    .map((answer) => answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/['’‘]/g, "['’‘]")).join("|");
  const hide = (part: string) => part.replace(new RegExp(`(?<![A-Za-z])(?:${alternatives})(?![A-Za-z])`, "gi"), "______");
  return hide(exercise.sentence.slice(0, exercise.targetStart)) + "______" + hide(exercise.sentence.slice(exercise.targetEnd));
}

/** Incomplete imports remain visible in courses but cannot silently become learning cards. */
export function isVocabularyCatalogEntryLearnable(entry: VocabularyCatalogEntry): boolean {
  if (entry.status !== "published" || !entry.meaningZh.trim() || !entry.definitionEn.trim() || !entry.partOfSpeech.trim()) return false;
  const published = entry.exercises.filter((exercise) => exercise.status === "published" && vocabularyExerciseSchema.safeParse(exercise).success);
  return new Set(published.map((exercise) => normaliseVocabularyAnswer(exercise.sentence))).size >= 2;
}
