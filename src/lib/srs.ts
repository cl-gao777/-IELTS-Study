export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface VocabularySchedule {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
}

export interface ScheduledVocabularyReview extends VocabularySchedule {
  dueAt: string;
}

const MINIMUM_EASE_FACTOR = 1.3;

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

export function scheduleVocabularyReview(
  current: VocabularySchedule,
  rating: ReviewRating,
  now = new Date(),
): ScheduledVocabularyReview {
  if (rating === "again") {
    return {
      repetitions: 0,
      intervalDays: 0,
      easeFactor: Math.max(
        MINIMUM_EASE_FACTOR,
        Number((current.easeFactor - 0.2).toFixed(2)),
      ),
      dueAt: addMinutes(now, 10).toISOString(),
    };
  }

  if (rating === "hard") {
    const intervalDays =
      current.repetitions === 0
        ? 1
        : Math.max(1, Math.round(current.intervalDays * 1.2));

    return {
      repetitions: current.repetitions + 1,
      intervalDays,
      easeFactor: Math.max(
        MINIMUM_EASE_FACTOR,
        Number((current.easeFactor - 0.15).toFixed(2)),
      ),
      dueAt: addDays(now, intervalDays).toISOString(),
    };
  }

  if (rating === "easy") {
    const intervalDays =
      current.repetitions === 0
        ? 4
        : Math.max(
            4,
            Math.round(current.intervalDays * current.easeFactor * 1.3),
          );

    return {
      repetitions: current.repetitions + 1,
      intervalDays,
      easeFactor: Number((current.easeFactor + 0.15).toFixed(2)),
      dueAt: addDays(now, intervalDays).toISOString(),
    };
  }

  const intervalDays =
    current.repetitions === 0
      ? 1
      : current.repetitions === 1
        ? 6
        : Math.max(1, Math.round(current.intervalDays * current.easeFactor));

  return {
    repetitions: current.repetitions + 1,
    intervalDays,
    easeFactor: current.easeFactor,
    dueAt: addDays(now, intervalDays).toISOString(),
  };
}
