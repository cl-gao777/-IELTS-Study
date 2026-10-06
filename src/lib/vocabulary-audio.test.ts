import { afterEach, describe, expect, it, vi } from "vitest";
import { playVocabularyAudio } from "./vocabulary-audio";

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: SpeechSynthesisUtterance["onstart"] = null;
  onend: SpeechSynthesisUtterance["onend"] = null;
  onerror: SpeechSynthesisUtterance["onerror"] = null;
  constructor(readonly text: string) {}
}
function setupSpeech() {
  const utterances: SpeechSynthesisUtterance[] = [];
  const synthesis = {
    cancel: vi.fn(),
    getVoices: () => [{ lang: "en-US" }, { lang: "en-GB" }] as SpeechSynthesisVoice[],
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterances.push(utterance)),
  };
  vi.stubGlobal("window", { speechSynthesis: synthesis });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return { synthesis, utterances };
}
const start = (utterance: SpeechSynthesisUtterance) => utterance.onstart?.call(utterance, {} as SpeechSynthesisEvent);
const end = (utterance: SpeechSynthesisUtterance) => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent);

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("vocabulary audio completion", () => {
  it("requires a real start and end event, preferring an English GB voice", async () => {
    const { utterances } = setupSpeech();
    const onStart = vi.fn();
    const completed = vi.fn();
    const playing = playVocabularyAudio("economy", { onStart }).then(completed);
    expect(utterances[0].lang).toBe("en-GB");
    expect(utterances[0].voice?.lang).toBe("en-GB");
    expect(completed).not.toHaveBeenCalled();
    start(utterances[0]); await Promise.resolve();
    expect(onStart).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    end(utterances[0]); await playing;
    expect(completed).toHaveBeenCalledOnce();
    expect(utterances[0].onend).toBeNull();
  });

  it("reports unsupported speech instead of pretending to play", async () => {
    vi.stubGlobal("window", {});
    await expect(playVocabularyAudio("economy")).rejects.toMatchObject({ code: "unsupported" });
  });

  it("catches asynchronous voice errors and does not accept an end without a start", async () => {
    const { utterances } = setupSpeech();
    const failure = expect(playVocabularyAudio("economy")).rejects.toMatchObject({ code: "playback-error" });
    utterances[0].onerror?.call(utterances[0], { error: "language-unavailable" } as SpeechSynthesisErrorEvent);
    await failure;
    const unstarted = expect(playVocabularyAudio("economy")).rejects.toMatchObject({ code: "playback-error" });
    end(utterances[1]); await unstarted;
  });

  it("times out an utterance that never starts or completes", async () => {
    vi.useFakeTimers();
    const { utterances } = setupSpeech();
    const notStarted = expect(playVocabularyAudio("economy", { startTimeoutMs: 100 })).rejects.toMatchObject({ code: "start-timeout" });
    await vi.advanceTimersByTimeAsync(100); await notStarted;
    const notEnded = expect(playVocabularyAudio("economy", { completionTimeoutMs: 100 })).rejects.toMatchObject({ code: "completion-timeout" });
    start(utterances[1]);
    await vi.advanceTimersByTimeAsync(100); await notEnded;
  });

  it("cancels old speech, rejects with AbortError, and ignores late completion", async () => {
    const { synthesis, utterances } = setupSpeech();
    const controller = new AbortController();
    const cancelled = expect(playVocabularyAudio("economy", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError", code: "cancelled" });
    start(utterances[0]); controller.abort(); await cancelled;
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(utterances[0].onend).toBeNull();
    end(utterances[0]);
  });
});
