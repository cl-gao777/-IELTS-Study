import "server-only";
import type Database from "better-sqlite3";
import type { VocabularyCardDraft, VocabularySession } from "@/lib/vocabulary-session";
import { normaliseVocabularyAnswer, type VocabularyEntry } from "@/lib/vocabulary";
import { getVocabularyStudy, materializeVocabularyCatalogEntry, vocabularyExerciseForWord, supplementalVocabularyExerciseForWord } from "./vocabulary-courses";
import { listVocabularyEntries } from "./vocabulary";
import { readVocabularyTargetDefinitions, readVocabularyTargetState, listVocabularyTargetStates, vocabularyTargetEligible, vocabularyExerciseForTarget, isVocabularyTermPaused } from "./vocabulary-targets";

export function selectVocabularyTargetCard(session: VocabularySession, now: Date, database: Database.Database): VocabularyCardDraft | null {
  const settings = getVocabularyStudy(now, database), focus = settings.focus ?? "general";
  const allDefinitions = readVocabularyTargetDefinitions(database);
  const definitions = allDefinitions.filter(({ entry, target }) => vocabularyTargetEligible(entry, target, focus, database));
  const words = listVocabularyEntries().filter((word) => !session.state.skippedIds.includes(word.id) && !isVocabularyTermPaused(word.term, database));
  const isNew = (word: VocabularyEntry) => !word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0;
  const states = listVocabularyTargetStates(database);
  const eligible = (word: VocabularyEntry) => definitions.filter(({ entry }) => normaliseVocabularyAnswer(entry.term) === normaliseVocabularyAnswer(word.term));
  const pending = (word: VocabularyEntry) => states.find((state) => state.wordId === word.id && state.normalizedTerm === normaliseVocabularyAnswer(word.term)
    && [1, 2].includes(state.step) && !state.paused && eligible(word).some(({ target }) => target.id === state.targetId));
  const card = (word: VocabularyEntry, definition: typeof definitions[number], purpose: NonNullable<VocabularyCardDraft["purpose"]>): VocabularyCardDraft | null => {
    const exercise = vocabularyExerciseForTarget(definition.entry, definition.target, settings.activeCourseId, database, word.id); if (!exercise?.target) return null;
    const state = readVocabularyTargetState(definition.target.id, normaliseVocabularyAnswer(word.term), database);
    const consolidation = ["consolidation", "merged"].includes(purpose) && state.dueAt && [1, 2].includes(state.step)
      ? { targetId: state.targetId, version: state.version, step: state.step as 1 | 2, dueAt: state.dueAt } : undefined;
    const frozenExercise = { ...exercise, purpose, ...(consolidation ? { consolidation } : {}) };
    return { wordId: word.id, wordVersion: word.reviewVersion, phase: purpose.startsWith("learn-") ? "learn" : "front",
      answer: "", gaveUp: false, confirmedTypo: false, audioPlayed: false, requestedRating: null, ratingSource: "automatic",
      exercise: frozenExercise, target: exercise.target, purpose, targetStateVersion: state.version,
      ...(consolidation ? { consolidation } : {}), restoreVersion: settings.restoreVersion, policyVersion: settings.policyVersion ?? 1,
      supplemental: purpose === "consolidation", canSupplement: purpose === "scheduled" && session.state.mode === "context" && ![1, 2].includes(state.step)
        && Boolean(vocabularyExerciseForTarget(definition.entry, definition.target, exercise.courseId, database, word.id, exercise.id)), startedAt: now.toISOString() };
  };
  // Due words take precedence. An introduced meaning waiting for its first recall
  // holds this word, so a different sentence cannot expose its answer early.
  for (const word of words.filter((item) => !isNew(item) && Date.parse(item.dueAt) <= now.getTime()).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))) {
    if (focus === "general" && !allDefinitions.some(({ entry, target }) => normaliseVocabularyAnswer(entry.term) === normaliseVocabularyAnswer(word.term)
      && (target.memberships.some((member) => member.courseId === settings.activeCourseId) || readVocabularyTargetState(target.id, normaliseVocabularyAnswer(entry.term), database).introducedAt))) {
      const exercise = vocabularyExerciseForWord(word, settings.activeCourseId, database);
      if (!exercise?.target) return { wordId: word.id, wordVersion: word.reviewVersion, phase: "front", answer: "", gaveUp: false, confirmedTypo: false,
        audioPlayed: false, requestedRating: null, ratingSource: "automatic", exercise, supplemental: false,
        canSupplement: session.state.mode === "context" && Boolean(supplementalVocabularyExerciseForWord(word, exercise, settings.activeCourseId, database)), startedAt: now.toISOString() };
    }
    const active = pending(word);
    if (active) {
      if (session.state.mode !== "context" || Date.parse(active.dueAt!) > now.getTime()) continue;
      const definition = eligible(word).find(({ target }) => target.id === active.targetId);
      if (definition) return card(word, definition, "merged");
    }
    const introduced = eligible(word).filter(({ entry, target }) => readVocabularyTargetState(target.id, normaliseVocabularyAnswer(entry.term), database).introducedAt)
      .sort((a, b) => Number(!a.target.memberships.some((member) => member.courseId === settings.activeCourseId)) - Number(!b.target.memberships.some((member) => member.courseId === settings.activeCourseId)) || a.target.id.localeCompare(b.target.id));
    if (introduced[0]) return card(word, introduced[0], "scheduled");
  }
  if (session.state.mode === "context") {
    for (const state of states.filter((item) => !item.paused && [1, 2].includes(item.step) && item.dueAt && Date.parse(item.dueAt) <= now.getTime()).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))) {
      const word = words.find((item) => item.id === state.wordId && normaliseVocabularyAnswer(item.term) === state.normalizedTerm);
      const definition = definitions.find(({ target }) => target.id === state.targetId);
      if (word && definition) return card(word, definition, "consolidation");
    }
  }
  if (!settings.activeCourseId) return null;
  const candidates = definitions.filter(({ entry, target }) => target.memberships.some((member) => member.courseId === settings.activeCourseId && member.rank >= settings.startRank)
    && !readVocabularyTargetState(target.id, normaliseVocabularyAnswer(entry.term), database).introducedAt)
    .sort((a, b) => Number(a.target.level !== settings.nextLevel) - Number(b.target.level !== settings.nextLevel)
      || a.target.memberships.find((member) => member.courseId === settings.activeCourseId)!.rank - b.target.memberships.find((member) => member.courseId === settings.activeCourseId)!.rank || a.target.id.localeCompare(b.target.id));
  for (const definition of candidates) {
    let word = words.find((item) => normaliseVocabularyAnswer(item.term) === normaliseVocabularyAnswer(definition.entry.term));
    // Hold a genuinely pending first recall, but a withdrawn or paused meaning
    // must not strand a word that has learned but never received its first grade.
    const firstRecallPending = word && !isNew(word) && !word.hasReviewHistory && word.repetitions <= 0
      && eligible(word).some(({ entry, target }) => readVocabularyTargetState(target.id, normaliseVocabularyAnswer(entry.term), database).introducedAt);
    if (word && (pending(word) || firstRecallPending)) continue;
    const existing = listVocabularyEntries().find((item) => normaliseVocabularyAnswer(item.term) === normaliseVocabularyAnswer(definition.entry.term));
    if (existing && session.state.skippedIds.includes(existing.id)) continue;
    word ??= materializeVocabularyCatalogEntry(definition.entry, database) ?? undefined;
    if (word) return card(word, definition, isNew(word) ? "learn-word" : "learn-target");
  }
  return null;
}

export function vocabularyQueuePreview(words: VocabularyEntry[], session: VocabularySession | null, now: Date, database: Database.Database) {
  const settings = getVocabularyStudy(now, database), definitions = readVocabularyTargetDefinitions(database), states = listVocabularyTargetStates(database);
  const eligibleDates = words.filter((word) => (word.learningStartedAt || word.hasReviewHistory || word.repetitions > 0) && !(session?.status === "active" && session.state.skippedIds.includes(word.id)))
    .flatMap((word) => {
      const candidates = definitions.filter(({ entry, target }) => normaliseVocabularyAnswer(entry.term) === normaliseVocabularyAnswer(word.term) && vocabularyTargetEligible(entry, target, settings.focus ?? "general", database));
      if (settings.focus === "ielts-advanced" && !candidates.length) return [];
      const active = states.find((state) => state.wordId === word.id && !state.paused && [1, 2].includes(state.step) && candidates.some(({ target }) => target.id === state.targetId));
      if (active) return session?.state.mode !== "context" ? [] : [Math.max(Date.parse(word.dueAt), Date.parse(active.dueAt!))];
      if (settings.focus === "ielts-advanced" && !candidates.some(({ target }) => readVocabularyTargetState(target.id, normaliseVocabularyAnswer(word.term), database).introducedAt)) return [];
      return [Date.parse(word.dueAt)];
    });
  return { scheduledDue: eligibleDates.filter((due) => due <= now.getTime()).length, nextScheduledAt: eligibleDates.filter((due) => due > now.getTime()).sort((a, b) => a - b).map((due) => new Date(due).toISOString())[0] ?? null };
}
