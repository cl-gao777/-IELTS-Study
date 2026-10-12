import { z } from "zod";
import { reviewModes, type VocabularyEntry, type VocabularyReviewMode } from "./vocabulary";
import type { ReviewRating } from "./srs";
import { vocabularyExerciseSnapshotSchema, type VocabularyExerciseSnapshot, type VocabularyRatingSource } from "./vocabulary-course";
import { vocabularyTargetSnapshotSchema, vocabularyCardPurposeSchema, vocabularyConsolidationSnapshotSchema, type VocabularyTargetSnapshot, type VocabularyCardPurpose, type VocabularyConsolidationSnapshot, type VocabularyTargetState, type VocabularyTermDisposition, type VocabularyTargetCounts } from "./vocabulary-target";

export interface VocabularyCardDraft {
  wordId: string;
  wordVersion: number;
  phase: "front" | "revealed" | "learn";
  answer: string;
  gaveUp: boolean;
  confirmedTypo: boolean;
  audioPlayed: boolean;
  exercise: VocabularyExerciseSnapshot | null;
  requestedRating: ReviewRating | null;
  ratingSource: VocabularyRatingSource;
  /** Server-selected extra context; completing it never advances FSRS. */
  supplemental?: boolean;
  /** A scheduled context can offer one alternate context after its grade saves. */
  canSupplement?: boolean;
  startedAt: string;
  target?: VocabularyTargetSnapshot;
  purpose?: VocabularyCardPurpose;
  targetStateVersion?: number;
  consolidation?: VocabularyConsolidationSnapshot;
  restoreVersion?: number;
  policyVersion?: number;
}
export interface VocabularySession {
  id: string;
  revision: number;
  status: "active" | "ended";
  state: {
    mode: VocabularyReviewMode;
    courseId: string | null;
    current: VocabularyCardDraft | null;
    skippedIds: string[];
    reviewed: number;
    learned: number;
    supplementalReviewed?: number;
    lastSubmissionId: string | null;
  };
  startedAt: string;
  updatedAt: string;
}
export type VocabularyCheckpoint = Pick<VocabularySession["state"], "mode" | "current" | "skippedIds"> & { courseId?: string | null };
export type VocabularyDecisionReason = "self_assessed" | "correct_answer" | "incorrect_answer" | "gave_up" | "confirmed_typo";
export interface VocabularyReviewRecord {
  id: number;
  submissionId: string;
  sessionId: string;
  wordId: string;
  wordVersion: number;
  mode: VocabularyReviewMode;
  userAnswer: string;
  correct: boolean | null;
  termSnapshot: string;
  requestedRating: ReviewRating;
  effectiveRating: ReviewRating;
  decisionReason: VocabularyDecisionReason;
  confirmedTypo: boolean;
  gaveUp: boolean;
  reviewedAt: string;
  nextDueAt: string;
  ratingSource: VocabularyRatingSource | null;
  exercise: VocabularyExerciseSnapshot | null;
  courseId: string | null;
  supplemental?: boolean;
}
export interface VocabularySessionResponse {
  session: VocabularySession | null;
  words: VocabularyEntry[];
  submission?: VocabularyReviewRecord | null;
  error?: string;
  targetStates?: VocabularyTargetState[];
  termDispositions?: VocabularyTermDisposition[];
  targetCounts?: VocabularyTargetCounts;
  eligibleWordIds?: string[];
  queuePreview?: { scheduledDue: number; nextScheduledAt: string | null };
}
export const vocabularyCardDraftSchema = z.object({
  wordId: z.string().min(1).max(200), wordVersion: z.number().int().positive(),
  phase: z.enum(["front", "revealed", "learn"]), answer: z.string().max(2000),
  gaveUp: z.boolean(), confirmedTypo: z.boolean(), audioPlayed: z.boolean().default(false), startedAt: z.iso.datetime(),
  exercise: vocabularyExerciseSnapshotSchema.nullable().default(null),
  requestedRating: z.enum(["again", "hard", "good", "easy"]).nullable().default(null),
  ratingSource: z.enum(["automatic", "self"]).default("automatic"),
  supplemental: z.boolean().default(false), canSupplement: z.boolean().default(false),
  target: vocabularyTargetSnapshotSchema.optional(), purpose: vocabularyCardPurposeSchema.optional(),
  targetStateVersion: z.number().int().nonnegative().optional(), consolidation: vocabularyConsolidationSnapshotSchema.optional(),
  restoreVersion: z.number().int().positive().optional(), policyVersion: z.number().int().positive().optional(),
});
export const vocabularyCheckpointSchema = z.object({
  mode: z.enum(reviewModes), current: vocabularyCardDraftSchema.nullable(),
  skippedIds: z.array(z.string().min(1).max(200)).max(10000),
  courseId: z.string().min(1).max(200).nullable().optional(),
}).strict();
export const vocabularySessionStateSchema = vocabularyCheckpointSchema.extend({
  reviewed: z.number().int().nonnegative(), learned: z.number().int().nonnegative(),
  supplementalReviewed: z.number().int().nonnegative().default(0),
  lastSubmissionId: z.uuid().nullable(),
  courseId: z.string().min(1).max(200).nullable().default(null),
});
