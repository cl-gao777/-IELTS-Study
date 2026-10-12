"use client";

import { useEffect, useRef, useState } from "react";
import { playVocabularyAudio } from "@/lib/vocabulary-audio";

type AudioStatus = "idle" | "starting" | "playing";
export function useVocabularyCardAudio(identity: string) {
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), [identity]);
  function cancel() { controller.current?.abort(); controller.current = null; setStatus("idle"); }
  function play(text: string, onComplete?: () => void) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setError(""); setStatus("starting");
    void playVocabularyAudio(text, { signal: request.signal, onStart: () => { if (!request.signal.aborted) setStatus("playing"); } })
      .then(() => { if (controller.current === request && !request.signal.aborted) { setStatus("idle"); onComplete?.(); } })
      .catch((failure: unknown) => {
        if (controller.current !== request || request.signal.aborted) return;
        setStatus("idle"); setError(failure instanceof Error ? failure.message : "发音播放失败，请重试。");
      });
  }
  return { status, error, play, cancel };
}
