import { describe, expect, it } from "vitest";
import { vocabularyCardAnswers, vocabularyCardContext, vocabularyCardContinuation, vocabularyCardCorrect, vocabularyCardMeaning, vocabularyCardRecallCue, vocabularyCardReviewBinding, vocabularyCardTypo, vocabularyCardWord } from "./vocabulary-card-presentation";
import type { VocabularyEntry } from "./vocabulary";
import type { VocabularyExerciseSnapshot } from "./vocabulary-course";
import type { VocabularyCardDraft } from "./vocabulary-session";
import type { VocabularyTargetSnapshot } from "./vocabulary-target";
import { vocabularyRecallCue } from "./vocabulary-practice";

const word = { term: "analyse", meaningZh: "分析 analyse", definitionEn: "to examine carefully", sourceSentence: "We analyse samples.", example: "" } as VocabularyEntry;
const exercise: VocabularyExerciseSnapshot = { entryId: "analyse", courseId: "academic", id: "context-2", version: 1, status: "published", sentence: "The team analysed the samples.", targetStart: 9, targetEnd: 17, targetSurface: "analysed", acceptedAnswers: ["analysed", "analyzed"], meaningZh: "分析（analysed）", source: "原创例句" };
const target: VocabularyTargetSnapshot = { id: "state-verb-formal", entryId: "state", version: 2, status: "published", term: "state", normalizedTerm: "state",
  courseId: "ielts-practical", membershipVersion: 3, partOfSpeech: "verb", meaningZh: "正式陈述；明确说明", definitionEn: "to formally express information in words",
  ipa: "/steɪt/", headwordAnswers: [], level: "B2", levelEvidence: [{ source: "词条与词性参考", scope: "headword-pos", level: "B2", note: "不是该义项的实测等级" }],
  advancedReason: "用于描述报告和研究发现", source: "本地精选词表", sourcePdf: null };
describe("fixed vocabulary card presentation", () => {
  it("marks the exercise's inflected answers, not the dictionary lemma", () => {
    const accepted = vocabularyCardAnswers(word, "context", exercise);
    expect(vocabularyCardCorrect(" ANALYZED ", accepted)).toBe(true);
    expect(vocabularyCardCorrect("analyse", accepted)).toBe(false);
    expect(vocabularyCardCorrect("", accepted)).toBe(false);
    expect(vocabularyCardAnswers(word, "spelling", exercise)).toEqual(["analyse"]);
  });
  it("accepts only one edit or adjacent transposition as a typo candidate", () => {
    expect(vocabularyCardTypo("analsyed", exercise.acceptedAnswers)).toBe(true);
    expect(vocabularyCardTypo("analysed", exercise.acceptedAnswers)).toBe(false);
    expect(vocabularyCardTypo("", exercise.acceptedAnswers)).toBe(false);
    expect(vocabularyCardTypo("wrong", exercise.acceptedAnswers)).toBe(false);
  });
  it("masks the chosen gap and repeated alternative answers in the rest of the cue", () => {
    const repeated = { ...exercise, sentence: "The team analysed what another team analyzed." };
    const context = vocabularyCardContext(word, repeated);
    expect(context).toBe("The team ______ what another team ______.");
    expect(vocabularyCardMeaning(word, exercise)).toBe("分析（______）");
    expect(vocabularyCardMeaning(word, null)).toBe("分析 ______");
  });
  it("falls back to a personal source sentence without fabricating a question", () => {
    expect(vocabularyCardContext(word, null)).toBe("We ______ samples.");
    expect(vocabularyCardContext({ ...word, sourceSentence: "No matching word.", example: "" }, null)).toBeNull();
  });
  it("offers an additional sentence only for an eligible revealed scheduled context", () => {
    const draft = { phase: "revealed", exercise, canSupplement: true, supplemental: false } as VocabularyCardDraft;
    expect(vocabularyCardContinuation("context", draft)).toEqual({ supplemental: false, needsSchedulePreview: true, canSupplement: true });
    expect(vocabularyCardContinuation("context", { ...draft, phase: "front" }).canSupplement).toBe(false);
    expect(vocabularyCardContinuation("context", { ...draft, canSupplement: false }).canSupplement).toBe(false);
    expect(vocabularyCardContinuation("context", { ...draft, exercise: null }).canSupplement).toBe(false);
    for (const mode of ["recognition", "recall", "spelling"] as const) expect(vocabularyCardContinuation(mode, draft).canSupplement).toBe(false);
  });
  it("does not require a scheduling forecast or offer another sentence for auxiliary practice", () => {
    const draft = { phase: "revealed", exercise, canSupplement: true, supplemental: true } as VocabularyCardDraft;
    expect(vocabularyCardContinuation("context", draft)).toEqual({ supplemental: true, needsSchedulePreview: false, canSupplement: false });
  });
  it("uses the frozen advanced sense in every mode without changing the personal simple entry", () => {
    const personal = { ...word, term: "state", meaningZh: "状态；国家", definitionEn: "the condition of something", partOfSpeech: "noun",
      notes: "个人简单释义笔记", example: "The state was small.", sourceSentence: "The state was old." };
    const before = structuredClone(personal);
    const presented = vocabularyCardWord(personal, target);
    expect(presented).toMatchObject({ term: "state", partOfSpeech: "verb", meaningZh: target.meaningZh, definitionEn: target.definitionEn, ipa: target.ipa });
    const cue = vocabularyRecallCue(presented);
    expect(cue.title).toBe(target.meaningZh);
    expect(cue.detail).toBe(target.definitionEn);
    expect(JSON.stringify(presented)).not.toContain("状态；国家");
    expect(JSON.stringify(presented)).not.toContain("个人简单释义笔记");
    for (const mode of ["recognition", "recall", "spelling"] as const) expect(vocabularyCardAnswers(personal, mode, null, target)).toEqual(["state"]);
    expect(personal).toEqual(before);
  });
  it("never falls back to personal simple materials when an advanced target lacks a context", () => {
    const presented = vocabularyCardWord({ ...word, term: "state", example: "The state is small." }, target);
    expect(vocabularyCardContext(presented, null)).toBeNull();
    expect(vocabularyCardMeaning(word, null, { ...target, meaningZh: "" })).toBe("");
    expect(vocabularyCardMeaning(word, null, { ...target, meaningZh: "正式 state 陈述" })).toBe("正式 ______ 陈述");
  });
  it("keeps card purpose and all frozen content versions in the review binding", () => {
    const draft = { target, exercise, purpose: "merged", targetStateVersion: 7, policyVersion: 5, restoreVersion: 4 } as VocabularyCardDraft;
    expect(vocabularyCardReviewBinding(draft)).toEqual({ targetId: target.id, targetVersion: 2, expectedStateVersion: 7, purpose: "merged",
      policyVersion: 5, restoreVersion: 4, exerciseId: exercise.id, exerciseVersion: 1, membershipVersion: 3 });
    expect(vocabularyCardReviewBinding({ ...draft, policyVersion: undefined })).toBeNull();
    expect(vocabularyCardReviewBinding({ exercise } as VocabularyCardDraft)).toEqual({});
    expect(vocabularyCardContinuation("context", { ...draft, phase: "revealed", purpose: "consolidation", supplemental: true })).toEqual({ supplemental: true, needsSchedulePreview: false, canSupplement: false });
  });
  it("accepts registered headword spellings separately from the context inflection and masks all cue variants", () => {
    const modern = { ...target, term: "analyse", normalizedTerm: "analyse", headwordAnswers: ["analyze"],
      meaningZh: "analyse / analyze：分析", definitionEn: "to analyse or analyze samples that were analysed" };
    expect(vocabularyCardAnswers(word, "recall", exercise, modern)).toEqual(["analyse", "analyze"]);
    expect(vocabularyCardCorrect("analyzed", vocabularyCardAnswers(word, "recall", exercise, modern))).toBe(false);
    expect(vocabularyCardCorrect("analyzed", vocabularyCardAnswers(word, "context", exercise, modern))).toBe(true);
    const cue = vocabularyCardRecallCue(word, modern, exercise);
    expect(cue.title).toBe("______ / ______：分析");
    expect(cue.detail).toBe("to ______ or ______ samples that were ______");
    const repeated = { ...exercise, sentence: "The team analysed what another team would analyze.", targetStart: 9, targetEnd: 17 };
    expect(vocabularyCardContext(word, repeated, modern)).toBe("The team ______ what another team would ______.");
  });
});
