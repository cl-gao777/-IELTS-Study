import "server-only";
import type { VocabularySession, VocabularySessionResponse } from "@/lib/vocabulary-session";
import { getDatabase } from "./db";
import { changeVocabularySession, getVocabularySession } from "./vocabulary-session";
import { readVocabularySession } from "./vocabulary-session-store";
import { invalidateVocabularyMutableReads, invalidateVocabularyReadScope } from "./vocabulary-read-scope";

const nextError = "上一题已保存，下一题暂未读取。可重试取题，不会重复评分。";
function savedSnapshot<T extends {session: VocabularySession | null}>(result:T):T & Partial<VocabularySessionResponse> {
  try { return {...result,...getVocabularySession()}; }
  catch { return {...result,nextError}; }
}

/** The save has committed before selection: a draw failure cannot undo a grade. */
export function completeVocabularyTransition<T extends { session: VocabularySession | null }>(
  result: T, advance: boolean, alreadySaved = false,
): T & Partial<VocabularySessionResponse> {
  if (!advance) return result;
  const database = getDatabase();
  // Mutations can change eligibility and word schedules; never reuse their old snapshot.
  invalidateVocabularyMutableReads(database);
  const latest = readVocabularySession(database);
  if (!alreadySaved && latest?.status === "active" && result.session?.id === latest.id
    && result.session.revision === latest.revision && !latest.state.current) {
    try {
      return { ...result, ...changeVocabularySession({ action: "next", id: latest.id, expectedRevision: latest.revision }) };
    } catch {
      invalidateVocabularyReadScope(database);
      // Reconcile only assignment, never retry the operation that was already saved.
      const snapshot = savedSnapshot(result);
      return { ...result, ...snapshot, ...(!snapshot.session?.state.current
        ? { nextError } : {}) };
    }
  }
  // Duplicate submissions return the fixed server assignment, without drawing again.
  return savedSnapshot(result);
}
