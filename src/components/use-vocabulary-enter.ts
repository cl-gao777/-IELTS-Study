"use client";

import { useEffect, useRef } from "react";
import { bindVocabularyEnter } from "@/lib/vocabulary-enter";

export function useVocabularyEnter() {
  const cardRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (cardRef.current) return bindVocabularyEnter(cardRef.current, () => primaryRef.current, () => answerRef.current);
  }, []);
  return { cardRef, primaryRef, answerRef };
}
