import { z } from "zod";

const identity = z.string().trim().min(1).max(200);
export const vocabularyFocusSchema = z.enum(["general", "ielts-advanced"]);
export type VocabularyFocus = z.infer<typeof vocabularyFocusSchema>;
export const vocabularyLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const vocabularyLevelEvidenceSchema = z.object({
  source: z.string().min(1).max(2000), url: z.string().url().optional(),
  scope: z.enum(["headword-pos", "sense", "editorial"]),
  level: vocabularyLevelSchema, note: z.string().max(2000).default(""),
});
export const vocabularySourcePdfSchema = z.object({
  attachmentUrl: z.string().regex(/^\/api\/uploads\/[1-9]\d*$/),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/), pdfPage: z.number().int().positive(),
  quote: z.string().min(1).max(4000),
});
export const vocabularyTargetMembershipSchema = z.object({
  courseId: identity, version: z.number().int().positive(), rank: z.number().int().positive(),
  exerciseIds: z.array(identity).min(2).max(500),
});
export const vocabularyTargetSchema = z.object({
  id: identity, version: z.number().int().positive(), status: z.enum(["draft", "published"]).default("published"),
  partOfSpeech: z.string().trim().min(1).max(100), meaningZh: z.string().trim().min(1).max(1000),
  definitionEn: z.string().trim().min(1).max(2000), ipa: z.string().max(200).default(""),
  headwordAnswers: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  level: vocabularyLevelSchema.nullable().default(null),
  levelEvidence: z.array(vocabularyLevelEvidenceSchema).max(30).default([]),
  advancedReason: z.string().max(2000).default(""), source: z.string().max(2000).default(""),
  sourcePdf: vocabularySourcePdfSchema.nullable().default(null),
  memberships: z.array(vocabularyTargetMembershipSchema).min(1).max(1000),
});
export const vocabularyTargetSnapshotSchema = vocabularyTargetSchema.omit({ memberships: true }).extend({
  entryId: identity, term: z.string().min(1).max(100), normalizedTerm: z.string().min(1).max(100),
  courseId: identity, membershipVersion: z.number().int().positive(),
});
export const vocabularyConsolidationSnapshotSchema = z.object({
  targetId: identity, version: z.number().int().positive(), step: z.union([z.literal(1), z.literal(2)]), dueAt: z.iso.datetime(),
});
export const vocabularyCardPurposeSchema = z.enum(["learn-word", "learn-target", "scheduled", "supplemental", "consolidation", "merged"]);
export const vocabularyDispositionOperationSchema = z.object({
  operationId: z.uuid(), restoreVersion: z.number().int().positive(),
  action: z.enum(["know-target", "resume-target", "pause-term", "resume-term"]),
  targetId: identity.optional(), targetVersion: z.number().int().positive().optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(), term: z.string().min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (value.action.endsWith("target") && (!value.targetId || !value.targetVersion || value.expectedStateVersion === undefined))
    context.addIssue({ code: "custom", message: "请同步当前用法的版本后重试。" });
  if (value.action.endsWith("term") && (!value.term || value.expectedStateVersion === undefined))
    context.addIssue({ code: "custom", message: "请同步当前单词的暂停状态后重试。" });
});
export type VocabularyTarget = z.infer<typeof vocabularyTargetSchema>;
export type VocabularyTargetSnapshot = z.infer<typeof vocabularyTargetSnapshotSchema>;
export type VocabularyConsolidationSnapshot = z.infer<typeof vocabularyConsolidationSnapshotSchema>;
export type VocabularyDispositionOperation = z.infer<typeof vocabularyDispositionOperationSchema>;
export type VocabularyCardPurpose = z.infer<typeof vocabularyCardPurposeSchema>;
export const vocabularyTargetLearnOperationSchema = z.object({
  wordId: identity, operationId: z.uuid(), expectedVersion: z.number().int().positive(),
  sessionId: z.uuid(), expectedSessionRevision: z.number().int().positive(), restoreVersion: z.number().int().positive(),
  targetId: identity, targetVersion: z.number().int().positive(), expectedStateVersion: z.number().int().nonnegative(),
}).strict();
export const vocabularyTargetReviewBindingSchema = z.object({
  targetId: identity.optional(), targetVersion: z.number().int().positive().optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(), purpose: vocabularyCardPurposeSchema.optional(),
  restoreVersion: z.number().int().positive().optional(), policyVersion: z.number().int().positive().optional(),
  exerciseId: identity.optional(), exerciseVersion: z.number().int().positive().optional(), membershipVersion: z.number().int().positive().optional(),
});
export interface VocabularyTargetState {
  targetId: string; wordId: string | null; normalizedTerm: string; version: number; paused: boolean;
  introducedAt: string | null; step: 0 | 1 | 2 | 3; dueAt: string | null; lastSubmissionId: string | null;
}
export interface VocabularyTermDisposition { normalizedTerm: string; paused: boolean; version: number }
export interface VocabularyTargetCounts {
  eligibleTargets: number; pausedTargets: number; pausedTerms: number; introducedTargets: number;
  consolidationDue: number; nextConsolidationAt: string | null;
}
