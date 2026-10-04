import { describe, expect, it } from "vitest";
import { compareDictation } from "./dictation";
describe("dictation alignment", () => {
  it("ignores case and punctuation", () => expect(compareDictation("We're ready, today.", "we’re ready today").every((word) => word.kind === "correct")).toBe(true));
  it("keeps alignment after a missing word", () => expect(compareDictation("the small green park", "the green park").map((word) => word.kind)).toEqual(["correct", "missing", "correct", "correct"]));
  it("identifies added words", () => expect(compareDictation("the park", "the small park").map((word) => word.kind)).toEqual(["correct", "extra", "correct"]));
  it("separates probable spelling from substitution", () => expect(compareDictation("environment river", "enviroment building").map((word) => word.kind)).toEqual(["spelling", "wrong"]));
  it("handles an empty attempt", () => expect(compareDictation("two words", "").map((word) => word.kind)).toEqual(["missing", "missing"]));
});
