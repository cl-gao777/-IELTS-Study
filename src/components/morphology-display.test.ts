import { describe, expect, it } from "vitest";
import { morphologyDisplayPhase, morphologySelectedLesson } from "./morphology-display";
import type { MorphologyLesson, MorphologySession } from "@/lib/morphology";

describe("morphology round presentation", () => {
  it("offers a course preview after an unfinished round is ended, including an obsolete-content round", () => {
    expect(morphologyDisplayPhase({ status: "ended", state: { phase: "practice" } }, true)).toBe("preview");
    expect(morphologyDisplayPhase({ status: "ended", state: { phase: "learn" } }, true)).toBe("preview");
  });
  it("shows active practice and keeps completed results available for replay", () => {
    expect(morphologyDisplayPhase({ status: "active", state: { phase: "practice" } }, true)).toBe("practice");
    expect(morphologyDisplayPhase({ status: "ended", state: { phase: "results" } }, true)).toBe("results");
  });
  it("never applies a saved round to another course preview", () => {
    expect(morphologyDisplayPhase({ status: "active", state: { phase: "practice" } }, false)).toBe("preview");
    expect(morphologyDisplayPhase({ status: "ended", state: { phase: "results" } }, false)).toBe("preview");
  });
  it("never offers the previous course while the selected course is still loading", () => {
    const oldLesson = { id: "spec" } as MorphologyLesson, selected = { id: "bene" } as MorphologyLesson;
    const saved = { status: "ended", state: { lesson: oldLesson, phase: "results" } } as MorphologySession;
    expect(morphologySelectedLesson("bene", oldLesson, saved, true)).toBeNull();
    expect(morphologySelectedLesson("bene", oldLesson, saved, false)).toBeNull();
    expect(morphologySelectedLesson("bene", selected, saved, true)).toBeNull();
    expect(morphologySelectedLesson("bene", selected, saved, false)).toBe(selected);
  });
  it("does not replace the selected preview with an unrelated active round", () => {
    const previous = { id: "spec" } as MorphologyLesson, selected = { id: "bene" } as MorphologyLesson;
    const saved = { status: "active", state: { lesson: previous, phase: "learn" } } as MorphologySession;
    expect(morphologySelectedLesson("bene", null, saved, true)).toBeNull();
    expect(morphologySelectedLesson("bene", selected, saved, false)).toBe(selected);
    expect(morphologySelectedLesson("spec", null, saved, true)).toBe(previous);
  });
});
