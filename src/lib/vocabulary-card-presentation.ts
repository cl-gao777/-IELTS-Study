import { isVocabularyTypoCandidate, normaliseVocabularyAnswer, vocabularyContextGap, type VocabularyEntry, type VocabularyReviewMode } from "./vocabulary";
import { vocabularyExerciseGap, type VocabularyExerciseSnapshot } from "./vocabulary-course";
import { vocabularyPracticeContext, vocabularyRecallCue } from "./vocabulary-practice";
import type { VocabularyCardDraft } from "./vocabulary-session";
import type { VocabularyCardPurpose, VocabularyTargetSnapshot } from "./vocabulary-target";

type SenseCard = VocabularyCardDraft & { target?: VocabularyTargetSnapshot | null; purpose?: VocabularyCardPurpose };

/** A published target replaces the personal dictionary cue; it never rewrites it. */
export function vocabularyCardWord(word: VocabularyEntry, target?: VocabularyTargetSnapshot | null): VocabularyEntry {
  if (!target) return word;
  return { ...word, term: target.term, lemma: target.term, ipa: target.ipa, pronunciation: "", partOfSpeech: target.partOfSpeech,
    meaningZh: target.meaningZh, definitionEn: target.definitionEn, sourceMaterial: target.source, sourceSentence: "", example: "",
    collocations: [], synonyms: [], antonyms: [], wordFamily: [], tags: [], notes: "" };
}

/** Bind previews and saves to the card that was issued, not today's policy. */
export function vocabularyCardReviewBinding(draft: VocabularyCardDraft) {
  if (!draft.target) return {};
  if (!draft.exercise || !draft.purpose || draft.targetStateVersion === undefined || !draft.restoreVersion || !draft.policyVersion) return null;
  return { targetId: draft.target.id, targetVersion: draft.target.version, expectedStateVersion: draft.targetStateVersion,
    purpose: draft.purpose, restoreVersion: draft.restoreVersion, policyVersion: draft.policyVersion,
    exerciseId: draft.exercise.id, exerciseVersion: draft.exercise.version, membershipVersion: draft.target.membershipVersion };
}

/** Only a scheduled context review may request its one additional sentence. */
export function vocabularyCardContinuation(mode: VocabularyReviewMode, draft: SenseCard) {
  const supplemental = Boolean(draft.supplemental) || draft.purpose === "consolidation";
  return {
    supplemental,
    needsSchedulePreview: !supplemental,
    canSupplement: mode === "context" && draft.phase === "revealed" && !supplemental
      && Boolean(draft.exercise && draft.canSupplement),
  };
}

/** The frozen exercise owns its inflected answer, even when the lemma differs. */
export function vocabularyCardAnswers(word: VocabularyEntry, mode: VocabularyReviewMode, exercise?: VocabularyExerciseSnapshot | null, target?: VocabularyTargetSnapshot | null) {
  return mode === "context" && exercise ? exercise.acceptedAnswers : [...new Set([target?.term ?? word.term, ...(target?.headwordAnswers ?? [])])];
}
export function vocabularyCardRecallCue(word: VocabularyEntry, target?: VocabularyTargetSnapshot | null, exercise?: VocabularyExerciseSnapshot | null) {
  if (!target) return vocabularyRecallCue(word);
  const hide = (value: string) => {
    for (const answer of [target.term, ...target.headwordAnswers, ...(exercise?.acceptedAnswers ?? [])]) value = vocabularyContextGap(answer, value) ?? value;
    return value;
  };
  return vocabularyRecallCue({ term: target.term, meaningZh: hide(target.meaningZh), definitionEn: hide(target.definitionEn) });
}
export function vocabularyCardCorrect(answer: string, accepted: readonly string[]) {
  const normalized = normaliseVocabularyAnswer(answer);
  return Boolean(normalized) && accepted.some((candidate) => normaliseVocabularyAnswer(candidate) === normalized);
}
export function vocabularyCardTypo(answer: string, accepted: readonly string[]) {
  return !vocabularyCardCorrect(answer, accepted) && accepted.some((candidate) => isVocabularyTypoCandidate(answer, candidate));
}
export function vocabularyCardContext(word: VocabularyEntry, exercise?: VocabularyExerciseSnapshot | null, target?: VocabularyTargetSnapshot | null) {
  let context = exercise ? vocabularyExerciseGap(exercise) : target ? null : vocabularyPracticeContext(word);
  if (context && target) for (const answer of [target.term, ...target.headwordAnswers]) context = vocabularyContextGap(answer, context) ?? context;
  return context;
}
export function vocabularyCardMeaning(word: VocabularyEntry, exercise?: VocabularyExerciseSnapshot | null, target?: VocabularyTargetSnapshot | null) {
  let meaning = target ? target.meaningZh : exercise?.meaningZh || word.meaningZh || word.definitionEn;
  for (const answer of [target?.term ?? word.term, ...(target?.headwordAnswers ?? []), ...(exercise?.acceptedAnswers ?? [])]) meaning = vocabularyContextGap(answer, meaning) ?? meaning;
  return /[\p{L}\p{N}]/u.test(meaning) ? meaning : "";
}
