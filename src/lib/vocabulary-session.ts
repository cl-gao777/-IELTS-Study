import { z } from "zod";
import { reviewModes, type VocabularyEntry, type VocabularyReviewMode } from "./vocabulary";
import type { ReviewRating } from "./srs";

export interface VocabularyCardDraft {
  wordId: string;
  wordVersion: number;
  phase: "front" | "revealed" | "learn";
  answer: string;
  gaveUp: boolean;
  confirmedTypo: boolean;
  audioPlayed: boolean;
  startedAt: string;
}
export interface VocabularySession {
  id: string;
  revision: number;
  status: "active" | "ended";
  state: {
    mode: VocabularyReviewMode;
    current: VocabularyCardDraft | null;
    skippedIds: string[];
    reviewed: number;
    learned: number;
    lastSubmissionId: string | null;
  };
  startedAt: string;
  updatedAt: string;
}
export type VocabularyCheckpoint = Pick<VocabularySession["state"], "mode" | "current" | "skippedIds">;
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
}
export interface VocabularySessionResponse {
  session: VocabularySession | null;
  words: VocabularyEntry[];
  submission?: VocabularyReviewRecord | null;
  error?: string;
}
export const vocabularyCardDraftSchema = z.object({
  wordId: z.string().min(1).max(200), wordVersion: z.number().int().positive(),
  phase: z.enum(["front", "revealed", "learn"]), answer: z.string().max(2000),
  gaveUp: z.boolean(), confirmedTypo: z.boolean(), audioPlayed: z.boolean().default(false), startedAt: z.iso.datetime(),
});
export const vocabularyCheckpointSchema = z.object({
  mode: z.enum(reviewModes), current: vocabularyCardDraftSchema.nullable(),
  skippedIds: z.array(z.string().min(1).max(200)).max(10000),
}).strict();
export const vocabularySessionStateSchema = vocabularyCheckpointSchema.extend({
  reviewed: z.number().int().nonnegative(), learned: z.number().int().nonnegative(),
  lastSubmissionId: z.uuid().nullable(),
});
