import { createEmptyCard, fsrs, Rating, type Card, type CardInput, type Grade } from "ts-fsrs";
import type { ReviewRating } from "./srs";

export interface ReviewHistoryEntry {
  rating: ReviewRating;
  reviewedAt: string;
}

export interface VocabularyScheduler {
  readonly id: string;
  schedule(state: CardInput, rating: ReviewRating, now: Date): Card;
  preview(state: CardInput, now: Date): VocabularyReviewPreview["ratings"];
  migrate(history: ReviewHistoryEntry[], now: Date): Card;
}

export interface VocabularyReviewPreview {
  scheduler: "fsrs";
  retention: 0.9;
  generatedAt: string;
  currentDueAt: string;
  wordVersion: number;
  ratings: Record<ReviewRating, { dueAt: string; intervalSeconds: number; scheduledDays: number }>;
}

export const vocabularyRetention = 0.9;

// Keep ts-fsrs 5.4.2's learning defaults explicit. A new/learning card repeats
// after 1 minute on Again; a forgotten review card relearns after 10 minutes.
const engine = fsrs({
  enable_fuzz: false,
  request_retention: vocabularyRetention,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});
const grades: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export const vocabularyScheduler: VocabularyScheduler = {
  id: "fsrs",
  schedule(state, rating, now) {
    return engine.next(state, now, grades[rating]).card;
  },
  preview(state, now) {
    const outcomes = engine.repeat(state, now);
    return Object.fromEntries((Object.keys(grades) as ReviewRating[]).map((rating) => {
      const card = outcomes[grades[rating]].card;
      return [rating, {
        dueAt: card.due.toISOString(),
        intervalSeconds: Math.max(0, Math.round((card.due.getTime() - now.getTime()) / 1000)),
        scheduledDays: card.scheduled_days,
      }];
    })) as VocabularyReviewPreview["ratings"];
  },
  migrate(history, now) {
    const valid = history.filter((item) => grades[item.rating] && Number.isFinite(Date.parse(item.reviewedAt)))
      .sort((left, right) => Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt));
    let card = createEmptyCard(valid[0]?.reviewedAt ?? now);
    for (const item of valid) card = engine.next(card, new Date(item.reviewedAt), grades[item.rating]).card;
    return card;
  },
};

export function parseSchedulerState(serialized: string): CardInput {
  const value = JSON.parse(serialized) as CardInput;
  const metrics = value && [value.stability, value.difficulty, value.elapsed_days, value.scheduled_days, value.learning_steps, value.reps, value.lapses];
  if (!value || !metrics || metrics.some((metric) => !Number.isFinite(metric) || metric < 0) || !Number.isFinite(Date.parse(String(value.due))) || ![0, 1, 2, 3].includes(Number(value.state)) || (value.last_review != null && !Number.isFinite(Date.parse(String(value.last_review))))) {
    throw new Error("Invalid vocabulary scheduler state");
  }
  return value;
}
