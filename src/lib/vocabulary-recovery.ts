import { z } from "zod";
import { reviewModes, type VocabularyEntry } from "./vocabulary";
import { vocabularyCardDraftSchema, vocabularyCheckpointSchema, vocabularySessionStateSchema, type VocabularyCardDraft, type VocabularyCheckpoint, type VocabularySession } from "./vocabulary-session";
import { vocabularyDispositionOperationSchema, vocabularyTargetLearnOperationSchema, vocabularyTargetReviewBindingSchema } from "./vocabulary-target";

export const vocabularyRecoveryKey = "ielts-studio-vocabulary-recovery";
export const vocabularySubmissionSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]), mode: z.enum(reviewModes),
  ratingSource: z.enum(["automatic", "self"]).default("self"),
  userAnswer: z.string().max(2000), confirmedTypo: z.boolean(), gaveUp: z.boolean(),
  durationSeconds: z.number().int().min(0).max(3600),
  continueWithPractice: z.boolean().optional(),
  expectedVersion: z.number().int().positive(), sessionId: z.uuid(),
  expectedSessionRevision: z.number().int().nonnegative(), submissionId: z.uuid(),
}).extend(vocabularyTargetReviewBindingSchema.shape);
export type VocabularySubmission = z.infer<typeof vocabularySubmissionSchema>;
export const vocabularyPendingOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("learn"), input: vocabularyTargetLearnOperationSchema, intro: z.boolean().default(false) }),
  z.object({ kind: z.literal("disposition"), input: vocabularyDispositionOperationSchema }),
]);
export type VocabularyPendingOperation = z.infer<typeof vocabularyPendingOperationSchema>;
const sessionSchema = z.object({
  id: z.uuid(), revision: z.number().int().nonnegative(), status: z.enum(["active", "ended"]),
  state: vocabularySessionStateSchema, startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
const recoverySchema = z.object({
  format: z.literal(2), view: z.enum(["review", "courses", "library"]),
  session: sessionSchema.nullable(), dirty: z.boolean(),
  attempted: z.object({ revision: z.number().int().nonnegative(), state: vocabularyCheckpointSchema }).nullable().default(null),
  startAttempt: z.object({ id: z.uuid(), mode: z.enum(reviewModes), courseId: z.string().min(1).max(200).nullable().optional() }).nullable().default(null),
  pending: z.object({ wordId: z.string().min(1), input: vocabularySubmissionSchema, supplemental: z.boolean().optional() }).nullable(),
  conflicted: z.object({ mode: z.enum(reviewModes), card: vocabularyCardDraftSchema, retainedAt: z.iso.datetime() }).nullable().default(null),
  pendingOperation: vocabularyPendingOperationSchema.nullable().default(null),
});
// The parser fills newer flags for old caches. Live checkpoints also accept
// older domain objects before those optional flags have been materialized.
export type VocabularyRecovery = Omit<z.infer<typeof recoverySchema>, "session" | "attempted" | "conflicted" | "pendingOperation"> & {
  session: VocabularySession | null;
  attempted: { revision: number; state: VocabularyCheckpoint } | null;
  conflicted?: { mode: VocabularySession["state"]["mode"]; card: VocabularyCardDraft; retainedAt: string } | null;
  pendingOperation?: VocabularyPendingOperation | null;
};

export function parseVocabularyRecovery(raw: string | null): VocabularyRecovery | null {
  try { const parsed = recoverySchema.safeParse(JSON.parse(raw ?? "null")); return parsed.success ? parsed.data : null; }
  catch { return null; }
}

/** A local draft can only overlay the exact server checkpoint and unchanged cue. */
export function canRecoverVocabularyDraft(recovery: VocabularyRecovery, server: VocabularySession | null, words: VocabularyEntry[]) {
  const local = recovery.session;
  if (!recovery.dirty || !local || !server || local.status !== "active" || server.status !== "active"
    || local.id !== server.id) return false;
  if (local.revision !== server.revision) {
    const sent = recovery.attempted;
    if (!sent || server.revision !== sent.revision + 1
      || !sameVocabularyCheckpoint(sent.state, server.state)
      || local.state.reviewed !== server.state.reviewed || local.state.learned !== server.state.learned
      || (local.state.supplementalReviewed ?? 0) !== (server.state.supplementalReviewed ?? 0)
      || local.state.lastSubmissionId !== server.state.lastSubmissionId) return false;
  }
  const current = local.state.current;
  return !current || words.some((word) => word.id === current.wordId && word.reviewVersion === current.wordVersion);
}

export function sameVocabularyCheckpoint(left: VocabularyCheckpoint, right: VocabularyCheckpoint) {
  return left.mode === right.mode && (left.courseId ?? null) === (right.courseId ?? null)
    && JSON.stringify(left.skippedIds) === JSON.stringify(right.skippedIds) && sameFields(left.current, right.current);
}

function sameFields(left: object | null, right: object | null) {
  if (!left || !right) return left === right;
  // Exercise snapshots are nested. JSON property order must not turn a lost
  // acknowledgement into a different checkpoint after schema normalization.
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)])) : value;
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
