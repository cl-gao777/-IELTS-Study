import { z } from "zod";
import { reviewModes, type VocabularyEntry } from "./vocabulary";
import { vocabularyCheckpointSchema, vocabularySessionStateSchema, type VocabularySession } from "./vocabulary-session";

export const vocabularyRecoveryKey = "ielts-studio-vocabulary-recovery";
export const vocabularySubmissionSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]), mode: z.enum(reviewModes),
  userAnswer: z.string().max(2000), confirmedTypo: z.boolean(), gaveUp: z.boolean(),
  durationSeconds: z.number().int().min(0).max(3600),
  expectedVersion: z.number().int().positive(), sessionId: z.uuid(),
  expectedSessionRevision: z.number().int().nonnegative(), submissionId: z.uuid(),
});
export type VocabularySubmission = z.infer<typeof vocabularySubmissionSchema>;
const sessionSchema = z.object({
  id: z.uuid(), revision: z.number().int().nonnegative(), status: z.enum(["active", "ended"]),
  state: vocabularySessionStateSchema, startedAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
const recoverySchema = z.object({
  format: z.literal(2), view: z.enum(["review", "library"]),
  session: sessionSchema.nullable(), dirty: z.boolean(),
  attempted: z.object({ revision: z.number().int().nonnegative(), state: vocabularyCheckpointSchema }).nullable().default(null),
  startAttempt: z.object({ id: z.uuid(), mode: z.enum(reviewModes) }).nullable().default(null),
  pending: z.object({ wordId: z.string().min(1), input: vocabularySubmissionSchema }).nullable(),
});
export type VocabularyRecovery = z.infer<typeof recoverySchema>;

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
      || local.state.lastSubmissionId !== server.state.lastSubmissionId) return false;
  }
  const current = local.state.current;
  return !current || words.some((word) => word.id === current.wordId && word.reviewVersion === current.wordVersion);
}

export function sameVocabularyCheckpoint(left: Pick<VocabularySession["state"], "mode" | "current" | "skippedIds">, right: Pick<VocabularySession["state"], "mode" | "current" | "skippedIds">) {
  return left.mode === right.mode && JSON.stringify(left.skippedIds) === JSON.stringify(right.skippedIds) && sameFields(left.current, right.current);
}

function sameFields(left: object | null, right: object | null) {
  if (!left || !right) return left === right;
  const ordered = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
