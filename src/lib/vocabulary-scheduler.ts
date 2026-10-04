import { createEmptyCard, fsrs, Rating, type Card, type CardInput, type Grade } from "ts-fsrs";
import type { ReviewRating } from "./srs";

export interface ReviewHistoryEntry {
  rating: ReviewRating;
  reviewedAt: string;
}

export interface VocabularyScheduler {
  readonly id: string;
  schedule(state: CardInput, rating: ReviewRating, now: Date): Card;
  migrate(history: ReviewHistoryEntry[], now: Date): Card;
}

const engine = fsrs({ enable_fuzz: false, request_retention: 0.9 });
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
