import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MorphologyPractice, MorphologyResults } from "./morphology-practice";
import { MorphologyLessonContent } from "./morphology-lesson";
import { MorphologyClient, type MorphologyClientSnapshot } from "@/lib/morphology-client";

function state(revealed = false, hintUsed = false): MorphologyClientSnapshot {
  return { ready: true, busy: false, saving: false, message: "", frozen: false, retainedInput: "", pending: null, verifiedMissing: false,
    workspace: { dataEpoch: "epoch", todaySeconds: 0, totalSeconds: 0, session: { id: "session", revision: 1, status: "active", startedAt: "", updatedAt: "", state: {
      lesson: { id: "port", version: 1, form: "port", titleZh: "SECRET COURSE MEANING", words: [{ id: "portable", term: "portable", partOfSpeech: "adjective", meaningZh: "便携的", definitionEn: "easy to carry", relation: "derivation", level: "B2", levelSource: "", illustrative: false, segments: [{ surface: "port", meaningZh: "carry" }], explanationZh: "SECRET BREAKDOWN", examples: [{ id: "ex", sentence: "This portable device is useful.", meaningZh: "此装置可携带" }], sourceIds: ["source"] }], sources: [{ id: "source", title: "SOURCE TITLE", url: "https://example.com", reviewedAt: "2026-10-22", license: "CC BY-SA", note: "" }] },
      phase: "practice", questionIndex: 0, retry: "initial", paused: false, input: revealed ? "wrong" : "", hintUsed,
      questions: [{ id: "q1", kind: "context", prompt: "This ______ device is useful.", options: [], acceptedAnswers: ["portable"], hint: "EXPLICIT HINT", explanation: "SECRET BREAKDOWN", sentence: "This portable device is useful.", wordId: "portable" }],
      results: revealed ? [{ questionId: "q1", answer: "wrong", correct: false, hintUsed, gaveUp: false, firstAttempt: true, acceptedAnswers: ["portable"], explanation: "SECRET BREAKDOWN", sentence: "This portable device is useful.", submittedAt: "", operationId: "op" }] : [],
    } } } } as unknown as MorphologyClientSnapshot;
}

describe("morphology answer boundaries", () => {
  it("does not mount course meaning, word data, answers, hints or full sentences before checking", () => {
    const html = renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={state()} />);
    expect(html).toContain("This ______ device is useful.");
    for (const hidden of ["portable", "SECRET COURSE MEANING", "SECRET BREAKDOWN", "EXPLICIT HINT", "SOURCE TITLE", "easy to carry"]) expect(html).not.toContain(hidden);
    expect(html).toContain('autoComplete="off"'); expect(html).toContain('spellCheck="false"');
  });
  it("mounts a hint only after an explicit recorded request, without revealing the full word list", () => {
    const html = renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={state(false, true)} />);
    expect(html).toContain("EXPLICIT HINT"); expect(html).not.toContain("portable"); expect(html).not.toContain("SECRET COURSE MEANING");
  });
  it("shows the submitted answer, full sentence and explanations only after a recorded result", () => {
    const html = renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={state(true)} />);
    expect(html).toContain("portable"); expect(html).toContain("SECRET BREAKDOWN"); expect(html).toContain("你的回答"); expect(html).toContain("wrong"); expect(html).not.toContain("SECRET COURSE MEANING");
  });
  it("shows v3 translations after checking, but never mounts them in the question", () => {
    const before = state(), after = state(true);
    for (const snapshot of [before, after]) {
      const lesson = snapshot.workspace!.session!.state.lesson; lesson.version = 3;
      Object.assign(lesson.words[0].examples[0], { meaningZh: "这台便携式设备很有用。", acceptedAnswers: ["portable"] });
    }
    expect(renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={before} />)).not.toContain("这台便携式设备很有用。");
    const revealed = renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={after} />);
    expect(revealed.slice(0, revealed.indexOf("查看 portable"))).toContain("这台便携式设备很有用。");
    expect(renderToStaticMarkup(<MorphologyResults session={after.workspace!.session!} busy={false} onRetry={() => {}} />)).toContain("这台便携式设备很有用。");
  });
  it("labels old history without inventing a sentence translation", () => {
    const html = renderToStaticMarkup(<MorphologyPractice client={new MorphologyClient()} state={state(true)} />);
    expect(html).toContain("该版本未提供整句译文。"); expect(html).not.toContain("此装置可携带");
  });
  it("puts the word meaning beside its heading and removes the repeated standalone gloss", () => {
    const lesson = state().workspace!.session!.state.lesson; lesson.version = 3; lesson.variants = [];
    const html = renderToStaticMarkup(<MorphologyLessonContent lesson={lesson} dataEpoch="epoch" disabled={false} onStale={() => {}} />);
    expect(html).toMatch(/<h3>portable .*· 便携的<\/span><\/h3>/);
    expect(html).not.toContain("<strong>便携的</strong>");
  });
});
