import type { MorphologyLesson, MorphologySession } from "@/lib/morphology";

type DisplaySession = Pick<MorphologySession, "status"> & { state: Pick<MorphologySession["state"], "phase"> };

/** An abandoned round remains in history, but cannot serve an active question. */
export function morphologyDisplayPhase(session: DisplaySession | null | undefined, studyingCurrent: boolean) {
  if (!session || !studyingCurrent) return "preview";
  return session.status === "active" || session.state.phase === "results" ? session.state.phase : "preview";
}

/** A route/selection is authoritative; another round is never a loading fallback. */
export function morphologySelectedLesson(selectedId: string | undefined, preview: MorphologyLesson | null, session: MorphologySession | null | undefined, loading: boolean) {
  const matches = (lesson: MorphologyLesson) => !selectedId || lesson.id === selectedId;
  if (session?.status === "active" && matches(session.state.lesson)) return session.state.lesson;
  if (loading) return null;
  if (preview && matches(preview)) return preview;
  return !selectedId ? session?.state.lesson ?? null : null;
}
