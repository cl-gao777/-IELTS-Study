import { vocabularyContextGap, type VocabularyEntry } from "./vocabulary";

export function vocabularyReviewQueue(words: VocabularyEntry[], now: number, skipped: ReadonlySet<string> = new Set()) {
  return words.filter((word) => !skipped.has(word.id) && Date.parse(word.dueAt) <= now)
    .sort((left, right) => Number(isVocabularyNew(left)) - Number(isVocabularyNew(right))
      || Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.id.localeCompare(right.id));
}

export function isVocabularyNew(word: VocabularyEntry) {
  return !word.hasReviewHistory && word.repetitions === 0 && !word.learningStartedAt;
}

export function vocabularyRecallCue(word: Pick<VocabularyEntry, "term" | "meaningZh" | "definitionEn">) {
  const hide = (value: string) => vocabularyContextGap(word.term, value) ?? value;
  const meaning = hide(word.meaningZh);
  const definition = hide(word.definitionEn);
  const usable = (value: string) => /[\p{L}\p{N}]/u.test(value);
  return { title: usable(meaning) ? meaning : usable(definition) ? definition : "", detail: usable(meaning) && usable(definition) ? definition : "" };
}

export function vocabularyPracticeContext(word: Pick<VocabularyEntry, "term" | "sourceSentence" | "example">) {
  return vocabularyContextGap(word.term, word.sourceSentence) ?? vocabularyContextGap(word.term, word.example);
}

export function vocabularyIntervalLabel(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} 秒后`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟后`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)} 小时后`;
  return `${Math.round(seconds / 86400)} 天后`;
}
