import { z } from "zod";
import type { VocabularyWord } from "./domain";

export const reviewModes = ["recognition", "recall", "spelling", "context"] as const;
export type VocabularyReviewMode = (typeof reviewModes)[number];

export interface VocabularyMetadata {
  lemma: string;
  ipa: string;
  sourceSentence: string;
  sourceMaterial: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  wordFamily: string[];
  notes: string;
}

export interface VocabularyEntry extends VocabularyWord, VocabularyMetadata {
  scheduler: "fsrs";
}

const text = (max: number) => z.string().trim().max(max).default("");
const list = z.array(z.string().trim().min(1).max(100)).max(30).default([]);

export const vocabularyInputSchema = z.object({
  term: z.string().trim().min(1).max(100),
  pronunciation: text(100),
  partOfSpeech: text(50),
  meaningZh: text(500),
  definitionEn: text(1000),
  example: text(2000),
  tags: list,
  lemma: text(100),
  ipa: text(100),
  sourceSentence: text(2000),
  sourceMaterial: text(500),
  collocations: list,
  synonyms: list,
  antonyms: list,
  wordFamily: list,
  notes: text(5000),
});

export type VocabularyInput = z.infer<typeof vocabularyInputSchema>;

export function normaliseVocabularyAnswer(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

/** Returns null when the sentence cannot safely become a fill-in-the-gap card. */
export function vocabularyContextGap(term: string, sentence: string): string | null {
  if (!term.trim() || !sentence.trim()) return null;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "gi");
  if (!expression.test(sentence)) return null;
  expression.lastIndex = 0;
  return sentence.replace(expression, "______");
}

export function speakEnglish(textToSpeak: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  utterance.lang = "en-GB";
  const britishVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase() === "en-gb");
  if (britishVoice) utterance.voice = britishVoice;
  utterance.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}
