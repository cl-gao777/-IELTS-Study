export type VocabularyAudioErrorCode = "unsupported" | "empty-text" | "start-timeout" | "completion-timeout" | "playback-error" | "cancelled";

export class VocabularyAudioError extends Error {
  constructor(readonly code: VocabularyAudioErrorCode, message: string) {
    super(message);
    this.name = code === "cancelled" ? "AbortError" : "VocabularyAudioError";
  }
}

/** Resolve only after the browser has started and completed the utterance. */
export function playVocabularyAudio(text: string, options: {
  signal?: AbortSignal;
  onStart?: () => void;
  startTimeoutMs?: number;
  completionTimeoutMs?: number;
} = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new VocabularyAudioError("cancelled", "播放已取消。")); return; }
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      reject(new VocabularyAudioError("unsupported", "此浏览器暂不支持发音，可暂缓此词或切换练习方式。")); return;
    }
    if (!text.trim()) { reject(new VocabularyAudioError("empty-text", "没有可播放的文本。")); return; }
    const synthesis = window.speechSynthesis;
    let utterance: SpeechSynthesisUtterance | null = null;
    let started = false;
    let settled = false;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;

    function finish(error?: VocabularyAudioError) {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer); clearTimeout(completionTimer);
      options.signal?.removeEventListener("abort", cancel);
      if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; }
      if (error) {
        try { synthesis.cancel(); } catch { /* A failed audio device must not hide its original error. */ }
        reject(error);
      } else resolve();
    }
    function cancel() { finish(new VocabularyAudioError("cancelled", "播放已取消。")); }

    try {
      synthesis.cancel();
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.rate = 0.9;
      const voices = synthesis.getVoices();
      const englishVoice = voices.find((voice) => voice.lang.toLowerCase() === "en-gb") ?? voices.find((voice) => /^en(?:-|$)/i.test(voice.lang));
      if (englishVoice) utterance.voice = englishVoice;
      utterance.onstart = () => {
        if (settled) return;
        started = true;
        clearTimeout(startTimer);
        completionTimer = setTimeout(() => finish(new VocabularyAudioError("completion-timeout", "发音播放未能结束，请重试，或暂缓此词。")), options.completionTimeoutMs ?? Math.max(15_000, Math.min(180_000, text.length * 150)));
        options.onStart?.();
      };
      utterance.onend = () => {
        if (started) finish();
        else finish(new VocabularyAudioError("playback-error", "发音没有成功启动，请重试播放。"));
      };
      utterance.onerror = (event) => {
        const unavailable = event.error === "language-unavailable" || event.error === "voice-unavailable" || event.error === "synthesis-unavailable";
        finish(new VocabularyAudioError("playback-error", unavailable ? "当前英语语音不可用，请重试，或暂缓此词并切换练习方式。" : "发音播放失败，请重试，或暂缓此词。"));
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      startTimer = setTimeout(() => finish(new VocabularyAudioError("start-timeout", "发音未能启动，请重试，或暂缓此词并切换练习方式。")), options.startTimeoutMs ?? 5_000);
      synthesis.speak(utterance);
    } catch {
      finish(new VocabularyAudioError("playback-error", "无法启动发音，请重试，或暂缓此词。"));
    }
  });
}
