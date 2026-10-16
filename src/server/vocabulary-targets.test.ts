import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, existsSync: (filename: Parameters<typeof actual.existsSync>[0]) => String(filename).endsWith("vocabulary-catalog.json") ? false : actual.existsSync(filename) };
});
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { vocabularyCatalogEntrySchema } from "@/lib/vocabulary-course";
import { vocabularyInputSchema, type VocabularyReviewMode } from "@/lib/vocabulary";
import type { VocabularyCardDraft, VocabularySession } from "@/lib/vocabulary-session";
import { ensureVocabularyTables, saveVocabularyEntry, listVocabularyEntries, learnVocabularyEntry, reviewVocabularyEntry, previewVocabularyReview, type VocabularyReviewInput } from "./vocabulary";
import { changeVocabularySession, getVocabularySession } from "./vocabulary-session";
import { getVocabularyStudy, getVocabularyCourses, registerVocabularyCourse, selectVocabularyCourse, saveVocabularyStudy, listVocabularyCatalogEntries, loadPrivateVocabularyCatalog } from "./vocabulary-courses";
import { changeVocabularyTargetDisposition, readVocabularyTargetState, listVocabularyTermDispositions, advanceVocabularyConsolidation } from "./vocabulary-targets";
import { GET as targetsGET } from "@/app/api/vocabulary/targets/route";
import { GET as studyGET } from "@/app/api/vocabulary/study/route";
import { publishVocabularyCatalogReview } from "./vocabulary-catalog-review";
import { vocabularyCardWord } from "@/lib/vocabulary-card-presentation";

const at = new Date("2030-01-01T00:00:00.000Z"), courseId = "advanced-fixture";
const db = () => holder.database!;
function entry(term: string, level: "B2" | "C1" | "A1" = "B2", sense = "advanced", rank = 1) {
  const targetId = `${term}:${sense}`, sentences = [`We ${term} a complex issue carefully.`, `They will ${term} a serious problem tomorrow.`];
  const exercises = sentences.map((sentence, index) => ({ id: `${targetId}:${index}`, targetId, version: 1, sentence,
    targetStart: sentence.indexOf(term), targetEnd: sentence.indexOf(term) + term.length, targetSurface: term, acceptedAnswers: [term], meaningZh: "处理这个问题", source: "Original test example" }));
  return vocabularyCatalogEntrySchema.parse({ id: `entry:${term}`, term, rank, courseIds: [courseId], partOfSpeech: "noun", meaningZh: "旧基础释义", definitionEn: "Old basic definition.",
    exercises, targets: [{ id: targetId, version: 1, partOfSpeech: "verb", meaningZh: "处理", definitionEn: "To deal with a problem.", level,
      levelEvidence: [{ source: "test", scope: "sense", level }], memberships: [{ courseId, version: 1, rank, exerciseIds: exercises.map((exercise) => exercise.id) }] }] });
}
function setup(entries = [entry("address")]) {
  registerVocabularyCourse({ id: courseId, title: "Advanced", description: "test", kind: "user-import", version: 1 }, entries);
  selectVocabularyCourse(courseId); saveVocabularyStudy({ focus: "ielts-advanced" }, at);
}
function personal(term: string, dueAt = "2030-12-01T00:00:00.000Z", learned = true) {
  const word = saveVocabularyEntry(vocabularyInputSchema.parse({ term, meaningZh: "旧个人义", definitionEn: "Personal old sense.", partOfSpeech: "noun", notes: "Keep my note" }))!.word;
  if (learned) db().prepare("UPDATE vocabulary_words SET repetitions=10,interval_days=100,due_at=? WHERE id=?").run(dueAt, word.id);
  return listVocabularyEntries().find((item) => item.id === word.id)!;
}
function start(mode: VocabularyReviewMode = "context", when = at) {
  return changeVocabularySession({ action: "start", id: randomUUID(), mode, restoreVersion: 1 }, when).session!;
}
function next(session: VocabularySession, when = at) { return changeVocabularySession({ action: "next", id: session.id, expectedRevision: session.revision }, when).session!; }
function introduce(session: VocabularySession, when = at) {
  const card = session.state.current!;
  const input = { operationId: randomUUID(), expectedVersion: card.wordVersion, sessionId: session.id, expectedSessionRevision: session.revision,
    restoreVersion: card.restoreVersion!, targetId: card.target!.id, targetVersion: card.target!.version, expectedStateVersion: card.targetStateVersion! };
  return { input, result: learnVocabularyEntry(card.wordId, input, when)! };
}
function reveal(session: VocabularySession, answer = session.state.current!.exercise!.targetSurface, changes: Partial<VocabularyCardDraft> = {}, when = at) {
  return changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision, state: {
    mode: session.state.mode, skippedIds: session.state.skippedIds, courseId: session.state.courseId,
    current: { ...session.state.current!, phase: "revealed", answer, ...changes },
  } }, when).session!;
}
function grade(session: VocabularySession, when: Date, overrides: Partial<VocabularyReviewInput> = {}) {
  const input = targetGradeInput(session, overrides);
  return { input, result: reviewVocabularyEntry(session.state.current!.wordId, input, when)! };
}
function targetGradeInput(session: VocabularySession, overrides: Partial<VocabularyReviewInput> = {}): VocabularyReviewInput {
  const card = session.state.current!;
  return { rating: "good", ratingSource: "automatic", mode: session.state.mode, userAnswer: card.answer, durationSeconds: 4,
    sessionId: session.id, expectedSessionRevision: session.revision, expectedVersion: card.wordVersion, submissionId: randomUUID(),
    confirmedTypo: card.confirmedTypo, gaveUp: card.gaveUp, targetId: card.target!.id, targetVersion: card.target!.version,
    expectedStateVersion: card.targetStateVersion, purpose: card.purpose, restoreVersion: card.restoreVersion, policyVersion: card.policyVersion,
    exerciseId: card.exercise!.id, exerciseVersion: card.exercise!.version, membershipVersion: card.target!.membershipVersion, ...overrides };
}
function consolidated(session: VocabularySession) {
  let active = introduce(session).result.session!;
  const first = new Date(at.getTime() + 60_000), second = new Date(at.getTime() + 660_000);
  active = grade(reveal(next(active, first), undefined, {}, first), first).result.session!;
  active = grade(reveal(next(active, second), undefined, {}, second), second).result.session!;
  return { session: active, time: second };
}

describe("advanced targets preserve personal progress and have their own non-FSRS consolidation", () => {
  beforeEach(() => {
    holder.database = new Database(":memory:");
    db().exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY,term TEXT NOT NULL UNIQUE,pronunciation TEXT NOT NULL,part_of_speech TEXT NOT NULL,meaning_zh TEXT NOT NULL,definition_en TEXT NOT NULL,example TEXT NOT NULL,tags_json TEXT NOT NULL,repetitions INTEGER NOT NULL DEFAULT0,interval_days INTEGER NOT NULL DEFAULT0,ease_factor REAL NOT NULL DEFAULT2.5,due_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE vocabulary_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,word_id TEXT NOT NULL REFERENCES vocabulary_words(id),rating TEXT NOT NULL,previous_due_at TEXT NOT NULL,next_due_at TEXT NOT NULL,reviewed_at TEXT NOT NULL);
      CREATE TABLE review_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_type TEXT NOT NULL,source_id TEXT NOT NULL,skill TEXT NOT NULL,prompt TEXT NOT NULL,answer TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT0,created_at TEXT NOT NULL,category TEXT NOT NULL DEFAULT'',mistake_count INTEGER NOT NULL DEFAULT1,reviewed_at TEXT NOT NULL DEFAULT'');`.replaceAll("DEFAULT0", "DEFAULT 0").replaceAll("DEFAULT1", "DEFAULT 1").replaceAll("DEFAULT2.5", "DEFAULT 2.5"));
    ensureVocabularyTables();
  });
  afterEach(() => { holder.database?.close(); holder.database = null; vi.unstubAllEnvs(); });

  it("rejects old cards after a reviewed sense changes and uses the new meaning in all four modes", () => {
    const original = entry("address"); setup([original]); personal("address", "2030-01-01T00:00:00.000Z");
    const oldSession = next(start()); const oldCard = oldSession.state.current!;
    const personalBefore = listVocabularyEntries();
    const changed = publishVocabularyCatalogReview({ entryId: original.id, expectedVersion: original.version, courseId, targetId: original.targets[0].id,
      expectedTargetVersion: 1, meaningZh: "着手解决复杂议题", definitionEn: "To take deliberate action to solve a complex issue.", partOfSpeech: "verb",
      exercises: original.exercises.map((exercise) => ({ ...exercise, meaningZh: "着手解决复杂议题" })) });
    expect(changed.targets?.[0].version).toBe(2); expect(listVocabularyEntries()).toEqual(personalBefore);
    expect(() => learnVocabularyEntry(oldCard.wordId, { operationId: randomUUID(), expectedVersion: oldCard.wordVersion, sessionId: oldSession.id,
      expectedSessionRevision: oldSession.revision, restoreVersion: oldCard.restoreVersion!, targetId: oldCard.target!.id,
      targetVersion: oldCard.target!.version, expectedStateVersion: oldCard.targetStateVersion! }, at)).toThrow();
    for (const mode of ["recognition", "recall", "spelling", "context"] as const) {
      const previous = getVocabularySession().session;
      if (previous?.status === "active") changeVocabularySession({ action: "end", id: previous.id, expectedRevision: previous.revision }, at);
      const card = next(start(mode)).state.current!;
      const display = vocabularyCardWord(listVocabularyEntries().find((word) => word.id === card.wordId)!, card.target);
      expect(display).toMatchObject({ meaningZh: "着手解决复杂议题", partOfSpeech: "verb", definitionEn: "To take deliberate action to solve a complex issue." });
      expect(card.exercise?.meaningZh).toBe("着手解决复杂议题");
    }
  });

  it("appends explicit targets without replacing catalog rank, old examples or personal meanings", () => {
    const saved = personal("address");
    const basic = vocabularyCatalogEntrySchema.parse({ ...entry("address"), targets: [], rank: 127, exercises: entry("address").exercises.map((item) => ({ ...item, targetId: undefined })) });
    registerVocabularyCourse({ id: courseId, title: "old", description: "", version: 1, kind: "builtin" }, [basic]);
    setup();
    const current = listVocabularyCatalogEntries()[0];
    expect(current.rank).toBe(127); expect(current.meaningZh).toBe("旧基础释义"); expect(current.targets).toHaveLength(1);
    expect(listVocabularyEntries()[0]).toMatchObject({ id: saved.id, meaningZh: "旧个人义", definitionEn: "Personal old sense.", notes: "Keep my note", dueAt: saved.dueAt, repetitions: 10 });
    const card = next(start()).state.current!;
    expect(card).toMatchObject({ purpose: "learn-target", phase: "learn", target: { meaningZh: "处理", partOfSpeech: "verb" } });
  });
  it("keeps basic and unclassified learned words outside every advanced queue across course changes", () => {
    const simple = personal("and", "2000-01-01T00:00:00.000Z"); setup([entry("and", "A1")]);
    expect(next(start()).state.current).toBeNull(); expect(getVocabularySession().eligibleWordIds).not.toContain(simple.id);
    expect(() => previewVocabularyReview(simple.id, at)).toThrow("进阶队列");
    selectVocabularyCourse(null); expect(getVocabularyStudy().focus).toBe("ielts-advanced");
    expect(listVocabularyEntries()[0]).toMatchObject({ dueAt: simple.dueAt, repetitions: 10 });
  });
  it("persists self-known for an unmaterialized sense and keeps whole-term suspension separate", () => {
    setup(); const target = entry("address").targets[0];
    const operation = { operationId: randomUUID(), restoreVersion: 1, action: "know-target" as const, targetId: target.id, targetVersion: 1, expectedStateVersion: 0 };
    changeVocabularyTargetDisposition(operation); changeVocabularyTargetDisposition(operation);
    expect(listVocabularyEntries()).toHaveLength(0); expect(next(start()).state.current).toBeNull();
    expect(readVocabularyTargetState(target.id, "address", db())).toMatchObject({ version: 1, paused: true, introducedAt: null });
    changeVocabularyTargetDisposition({ ...operation, operationId: randomUUID(), action: "resume-target", expectedStateVersion: 1 });
    changeVocabularyTargetDisposition({ operationId: randomUUID(), restoreVersion: 1, action: "pause-term", term: " ADDRESS ", expectedStateVersion: 0 });
    expect(listVocabularyTermDispositions()).toEqual([{ normalizedTerm: "address", paused: true, version: 1 }]);
    expect(() => changeVocabularyTargetDisposition({ ...operation, operationId: randomUUID(), expectedStateVersion: 0 })).toThrow("其他页面");
  });
  it("introduces a familiar word's new meaning immediately without changing FSRS, due, history or word version", async () => {
    const saved = personal("address"); setup(); const session = next(start());
    const before = db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id);
    const learned = introduce(session);
    expect(db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id)).toEqual(before);
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 1, dueAt: "2030-01-01T00:01:00.000Z", introducedAt: at.toISOString(), wordId: saved.id });
    expect(learnVocabularyEntry(saved.id, learned.input, new Date(at.getTime() + 20_000))!.session!.revision).toBe(learned.result.session!.revision);
    const response = await targetsGET(new Request(`http://local/api/vocabulary/targets?operationId=${learned.input.operationId}`));
    expect(await response.json()).toMatchObject({ operation: { operationId: learned.input.operationId, action: "introduce-target" } });
    expect(next(learned.result.session!, new Date(at.getTime() + 59_000)).state.current).toBeNull();
  });
  it("schedules 1/10-minute auxiliary steps, retries errors after a minute, and retains raw typo errors", () => {
    const saved = personal("address"); setup(); let session = introduce(next(start())).result.session!;
    const t1 = new Date(at.getTime() + 60_000); session = reveal(next(session, t1), "address", {}, t1);
    expect(session.state.current!.purpose).toBe("consolidation");
    const first = grade(session, t1); session = first.result.session!;
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 2, dueAt: "2030-01-01T00:11:00.000Z" });
    const t2 = new Date(at.getTime() + 660_000); session = reveal(next(session, t2), "wrong", {}, t2);
    session = grade(session, t2).result.session!;
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 2, dueAt: "2030-01-01T00:12:00.000Z" });
    const t3 = new Date(at.getTime() + 720_000); session = reveal(next(session, t3), "adress", { confirmedTypo: true }, t3);
    const final = grade(session, t3); expect(final.result.review).toMatchObject({ correct: false, confirmedTypo: true, supplemental: true });
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 3, dueAt: null });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 3 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM review_items").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_scheduler_state").get()).toEqual({ n: 0 });
    expect(listVocabularyEntries()[0]).toMatchObject({ dueAt: saved.dueAt, reviewVersion: saved.reviewVersion, repetitions: 10 });
    reviewVocabularyEntry(saved.id, final.input, new Date(t3.getTime() + 5000));
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 3 });
  });
  it("rotates both consolidation contexts while restoring the exact current sentence", () => {
    personal("address"); setup(); let session = next(start());
    const introductory = session.state.current!.exercise!.id;
    session = introduce(session).result.session!;
    const first = new Date(at.getTime() + 60_000), second = new Date(at.getTime() + 660_000);
    session = next(session, first); const firstExercise = session.state.current!.exercise!.id;
    expect(firstExercise).not.toBe(introductory);
    expect(getVocabularySession().session!.state.current!.exercise).toEqual(session.state.current!.exercise);
    session = grade(reveal(session, undefined, {}, first), first).result.session!;
    session = next(session, second);
    expect(session.state.current!.exercise!.id).toBe(introductory);
    expect(session.state.current!.exercise!.id).not.toBe(firstExercise);
  });
  it("merges coincident due events into one scheduled sample and atomically satisfies its auxiliary step", () => {
    personal("address", "2000-01-01T00:00:00.000Z"); setup(); let session = introduce(next(start())).result.session!;
    const t1 = new Date(at.getTime() + 60_000); session = reveal(next(session, t1), "address", {}, t1);
    expect(session.state.current).toMatchObject({ purpose: "merged", supplemental: false, consolidation: { step: 1 } });
    const completed = grade(session, t1);
    expect(completed.result.session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 0 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 0 });
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 2, lastSubmissionId: completed.input.submissionId });
  });
  it("freezes auxiliary purpose when the original word becomes due during answering", () => {
    const saved = personal("address", "2030-01-01T00:01:05.000Z"); setup(); let session = introduce(next(start())).result.session!;
    const issued = new Date(at.getTime() + 60_000), submitted = new Date(at.getTime() + 70_000);
    session = reveal(next(session, issued), "address", {}, submitted); expect(session.state.current!.purpose).toBe("consolidation");
    const result = grade(session, submitted).result;
    expect(result.word.dueAt).toBe(saved.dueAt); expect(result.review.supplemental).toBe(true);
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
  });
  it("rejects forged target/purpose, old protocol and stale step even with a different submission ID", () => {
    personal("address"); setup(); const initial = next(start());
    expect(() => changeVocabularySession({ action: "checkpoint", id: initial.id, expectedRevision: initial.revision, state: { mode: "context", skippedIds: [], current: { ...initial.state.current!, purpose: "scheduled" } } }, at)).toThrow("服务端");
    const introduced = introduce(initial).result;
    const time = new Date(at.getTime() + 60_000), session = reveal(next(introduced.session!, time), "address", {}, time);
    expect(() => previewVocabularyReview(session.state.current!.wordId, time)).toThrow("用法");
    expect(() => reviewVocabularyEntry(session.state.current!.wordId, { ...gradeInput(session), targetVersion: 2 }, time)).toThrow("协议");
    const event = session.state.current!.consolidation!, word = listVocabularyEntries()[0];
    const result = grade(session, time);
    expect(() => advanceVocabularyConsolidation(event, word, true, randomUUID(), time, db())).toThrow("步骤");
    expect(() => reviewVocabularyEntry(word.id, { ...result.input, submissionId: randomUUID() }, time)).toThrow("其他页面");
  });
  it("does not allow a learned word's new meaning to bypass its introduction by forging reveal phase", () => {
    personal("address", "2000-01-01T00:00:00.000Z"); setup(); const session = next(start());
    expect(session.state.current!.purpose).toBe("learn-target");
    expect(() => reveal(session, "address")).toThrow("用法");
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_target_state").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
  });
  it.each(["recall", "spelling"] as const)("accepts verified headword spellings in %s without importing context inflections", (mode) => {
    const catalog = entry("judgment");
    catalog.targets[0].headwordAnswers = ["judgment", "judgement"];
    catalog.exercises = catalog.exercises.map((exercise) => {
      const sentence = exercise.sentence.replace("judgment", "judgments");
      return { ...exercise, sentence, targetEnd: exercise.targetEnd + 1, targetSurface: "judgments", acceptedAnswers: ["judgments"] };
    });
    const saved = personal("judgment"); setup([catalog]);
    const completed = consolidated(next(start()));
    changeVocabularySession({ action: "end", id: completed.session.id, expectedRevision: completed.session.revision }, completed.time);
    db().prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(completed.time.toISOString(), saved.id);
    let session = reveal(next(start(mode, completed.time), completed.time), "judgement", { audioPlayed: true }, completed.time);
    const accepted = grade(session, completed.time); expect(accepted.result.review).toMatchObject({ correct: true, effectiveRating: "good" });
    db().prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(completed.time.toISOString(), saved.id);
    session = reveal(next(accepted.result.session!, completed.time), "judgments", { audioPlayed: true }, completed.time);
    expect(grade(session, completed.time).result.review).toMatchObject({ correct: false, effectiveRating: "again" });
  });
  it("preserves the advanced meaning and exact sentence in the forgetting record", () => {
    const saved = personal("address"); setup(); const completed = consolidated(next(start()));
    db().prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(completed.time.toISOString(), saved.id);
    const session = reveal(next(completed.session, completed.time), "wrong", {}, completed.time);
    grade(session, completed.time);
    const item = db().prepare("SELECT answer FROM review_items WHERE source_id=?").get(saved.id) as { answer: string };
    expect(item.answer).toContain("处理"); expect(item.answer).toContain("To deal with a problem.");
    expect(item.answer).toContain(session.state.current!.exercise!.sentence); expect(item.answer).not.toContain("旧个人义");
  });
  it("permits an optional extra context only for the scheduled meaning and never advances FSRS twice", () => {
    const saved = personal("address"); setup(); const completed = consolidated(next(start()));
    db().prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(completed.time.toISOString(), saved.id);
    const scheduled = reveal(next(completed.session, completed.time), undefined, {}, completed.time);
    expect(scheduled.state.current!.canSupplement).toBe(true);
    const first = grade(scheduled, completed.time, { continueWithPractice: true });
    const extra = first.result.session!.state.current!;
    expect(extra).toMatchObject({ purpose: "supplemental", supplemental: true, canSupplement: false, target: { id: "address:advanced" } });
    expect(extra.exercise!.id).not.toBe(scheduled.state.current!.exercise!.id);
    const before = db().prepare("SELECT * FROM vocabulary_scheduler_state WHERE word_id=?").get(saved.id);
    grade(reveal(first.result.session!, "wrong", {}, completed.time), completed.time);
    expect(db().prepare("SELECT * FROM vocabulary_scheduler_state WHERE word_id=?").get(saved.id)).toEqual(before);
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM review_items").get()).toEqual({ n: 0 });
  });
  it("keeps valid scheduled previews read-only and rejects paused or ended card previews", () => {
    const saved = personal("address"); setup(); const completed = consolidated(next(start()));
    db().prepare("UPDATE vocabulary_words SET due_at=? WHERE id=?").run(completed.time.toISOString(), saved.id);
    const session = next(completed.session, completed.time), input = targetGradeInput(session);
    const before = db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id);
    expect(previewVocabularyReview(saved.id, completed.time, input)!.wordVersion).toBe(saved.reviewVersion);
    expect(db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id)).toEqual(before);
    changeVocabularyTargetDisposition({ action: "know-target", operationId: randomUUID(), restoreVersion: 1, targetId: "address:advanced", targetVersion: 1, expectedStateVersion: session.state.current!.targetStateVersion });
    expect(() => previewVocabularyReview(saved.id, completed.time, input)).toThrow("进阶队列");
    changeVocabularyTargetDisposition({ action: "resume-target", operationId: randomUUID(), restoreVersion: 1, targetId: "address:advanced", targetVersion: 1, expectedStateVersion: readVocabularyTargetState("address:advanced", "address", db()).version });
    const restored = next(getVocabularySession().session!, completed.time), binding = targetGradeInput(restored);
    db().prepare("UPDATE vocabulary_sessions SET status='ended' WHERE id=?").run(restored.id);
    expect(() => previewVocabularyReview(saved.id, completed.time, binding)).toThrow("状态");
  });
  it("holds one meaning per word and does not advance introduction or steps on mode changes", () => {
    personal("address"); const first = entry("address"), second = entry("address", "C1", "second", 2);
    setup([vocabularyCatalogEntrySchema.parse({ ...first, targets: [...first.targets, ...second.targets], exercises: [...first.exercises, ...second.exercises] })]);
    let session = introduce(next(start())).result.session!;
    expect(next(session, new Date(at.getTime() + 30_000)).state.current).toBeNull();
    const time = new Date(at.getTime() + 60_000); session = next(session, time);
    session = changeVocabularySession({ action: "checkpoint", id: session.id, expectedRevision: session.revision, state: { mode: "recognition", current: null, skippedIds: [session.state.current!.wordId] } }, time).session!;
    expect(next(session, time).state.current).toBeNull();
    expect(readVocabularyTargetState("address:advanced", "address", db())).toMatchObject({ step: 1, introducedAt: at.toISOString() });
    expect(readVocabularyTargetState("address:second", "address", db())).toMatchObject({ introducedAt: null });
    changeVocabularySession({ action: "end", id: session.id, expectedRevision: session.revision }, time);
    expect(next(start("recognition", time), time).state.current).toBeNull();
  });
  it("alternates B2/C1 after actual confirmations only and keeps focus on course selection", () => {
    setup([entry("address", "B2", "advanced", 2), entry("yield", "C1", "advanced", 1), entry("maintain", "B2", "advanced", 3)]);
    let session = next(start()); expect(session.state.current!.target!.level).toBe("B2");
    expect(getVocabularyStudy().nextLevel).toBe("B2"); session = introduce(session).result.session!;
    expect(getVocabularyStudy().nextLevel).toBe("C1"); session = next(session); expect(session.state.current!.target!.level).toBe("C1");
    session = introduce(session).result.session!; expect(next(session).state.current!.target!.level).toBe("B2");
    selectVocabularyCourse(null); expect(getVocabularyStudy().focus).toBe("ielts-advanced");
  });
  it("does not resume a pending known target while another meaning of the word is consolidating", () => {
    personal("address"); const first = entry("address"), second = entry("address", "C1", "second", 2);
    setup([vocabularyCatalogEntrySchema.parse({ ...first, targets: [...first.targets, ...second.targets], exercises: [...first.exercises, ...second.exercises] })]);
    introduce(next(start()));
    changeVocabularyTargetDisposition({ action: "know-target", operationId: randomUUID(), restoreVersion: 1, targetId: "address:advanced", targetVersion: 1, expectedStateVersion: 1 });
    introduce(next(getVocabularySession().session!));
    expect(() => changeVocabularyTargetDisposition({ action: "resume-target", operationId: randomUUID(), restoreVersion: 1, targetId: "address:advanced", targetVersion: 1, expectedStateVersion: 2 })).toThrow("正在巩固");
    expect(readVocabularyTargetState("address:advanced", "address", db()).paused).toBe(true);
    expect(readVocabularyTargetState("address:second", "address", db())).toMatchObject({ paused: false, step: 1 });
  });
  it("shares one target's state across courses while freezing the requested course membership", async () => {
    personal("address"); const first = entry("address"); setup([first]); introduce(next(start()));
    const secondCourse = "advanced-fixture-b";
    const exercises = first.exercises.map((exercise) => ({ ...exercise, id: `${exercise.id}:course-b` }));
    registerVocabularyCourse({ id: secondCourse, title: "Advanced B", description: "", kind: "user-import", version: 1 }, [{ ...first, courseIds: [secondCourse], exercises,
      targets: [{ ...first.targets[0], memberships: [{ courseId: secondCourse, version: 1, rank: 9, exerciseIds: exercises.map((exercise) => exercise.id) }] }] }]);
    const response = await targetsGET(new Request(`http://local/api/vocabulary/targets?courseId=${secondCourse}`));
    expect(await response.json()).toMatchObject({ targets: [{ id: "address:advanced", courseId: secondCourse, membershipVersion: 1 }] });
    selectVocabularyCourse(secondCourse); const time = new Date(at.getTime() + 60_000), session = next(start("context", time), time);
    expect(session.state.current).toMatchObject({ purpose: "consolidation", target: { id: "address:advanced", courseId: secondCourse }, exercise: { courseId: secondCourse } });
    expect(session.state.current!.exercise!.id).toContain("course-b");
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_target_state").get()).toEqual({ n: 1 });
  });
  it("does not transfer a normalized-term pause across an English rename or steal another FSRS card", () => {
    const saved = personal("address"); setup([entry("address"), entry("yield", "C1")]);
    changeVocabularyTargetDisposition({ action: "pause-term", operationId: randomUUID(), restoreVersion: 1, term: "address", expectedStateVersion: 0 });
    const renamed = saveVocabularyEntry(vocabularyInputSchema.parse({ ...saved, term: "yield" }), saved.id, saved.reviewVersion)!.word;
    expect(renamed.dueAt).toBe(saved.dueAt); expect(listVocabularyTermDispositions()).toEqual([{ normalizedTerm: "address", paused: true, version: 1 }]);
    expect(next(start()).state.current!.target!.term).toBe("yield");
  });
  it("loads a private package once, ends the old round without grading, and never re-applies focus after a user change", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ielts-private-target-")), filename = path.join(directory, "private.json");
    try {
      personal("and"); const session = start(); writeFileSync(filename, JSON.stringify({ courses: [{ id: courseId, title: "Advanced", description: "private", kind: "user-import", version: 1 }], entries: [entry("address")] }));
      vi.stubEnv("VOCABULARY_PRIVATE_CATALOG_PATH", filename);
      expect(await (await studyGET()).json()).toMatchObject({ focus: "ielts-advanced", activeCourseId: courseId, activeCourseTitle: "Advanced" });
      expect(getVocabularySession().session).toMatchObject({ id: session.id, status: "ended" }); expect(getVocabularyStudy().focus).toBe("ielts-advanced");
      saveVocabularyStudy({ focus: "general" }); selectVocabularyCourse(null); loadPrivateVocabularyCatalog(db());
      expect(getVocabularyStudy()).toMatchObject({ focus: "general", activeCourseId: null });
      writeFileSync(filename, JSON.stringify({ courses: [{ id: courseId, title: "Advanced 2", description: "private upgrade", kind: "user-import", version: 2 }], entries: [entry("address")] }));
      loadPrivateVocabularyCatalog(db());
      expect(getVocabularyStudy()).toMatchObject({ focus: "general", activeCourseId: null });
      expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("withdraws obsolete private meanings on upgrade, rejects their old cards, and preserves history and user preferences", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ielts-private-upgrade-")), filename = path.join(directory, "private.json");
    const write = (version: number, entries: ReturnType<typeof entry>[]) => writeFileSync(filename, JSON.stringify({ courses: [{ id: courseId, title: "Advanced", description: `package ${version}`, kind: "user-import", version }], entries }));
    try {
      const saved = personal("address");
      db().prepare("INSERT INTO vocabulary_reviews(word_id,rating,previous_due_at,next_due_at,reviewed_at) VALUES(?,'good',?,?,?)").run(saved.id, saved.dueAt, saved.dueAt, "2029-01-01T00:00:00.000Z");
      write(1, [entry("address")]); vi.stubEnv("VOCABULARY_PRIVATE_CATALOG_PATH", filename); loadPrivateVocabularyCatalog(db());
      saveVocabularyStudy({ focus: "general", dailyGoalSeconds: 1800 }, at);
      let session = introduce(next(start())).result.session!;
      const first = new Date(at.getTime() + 60_000), second = new Date(at.getTime() + 660_000);
      session = grade(reveal(next(session, first), undefined, {}, first), first).result.session!;
      session = reveal(next(session, second), "wrong", {}, second);
      const originalInput = targetGradeInput(session), originalState = readVocabularyTargetState("address:advanced", "address", db());
      const wordBefore = db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id);
      const reviewsBefore = db().prepare("SELECT * FROM vocabulary_reviews").all(), auxiliaryBefore = db().prepare("SELECT * FROM vocabulary_supplemental_attempts").all();
      const corrected = entry("address", "B2", "corrected"); corrected.targets[0].meaningZh = "处理；着手解决";
      write(2, [corrected]);
      // Grading itself loads a new content version before accepting an old page's answer.
      expect(() => reviewVocabularyEntry(saved.id, originalInput, second)).toThrow("用法");
      expect(db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id)).toEqual(wordBefore);
      expect(db().prepare("SELECT * FROM vocabulary_reviews").all()).toEqual(reviewsBefore);
      expect(db().prepare("SELECT * FROM vocabulary_supplemental_attempts").all()).toEqual(auxiliaryBefore);
      expect(readVocabularyTargetState("address:advanced", "address", db())).toEqual(originalState);
      expect(getVocabularyStudy()).toMatchObject({ focus: "general", activeCourseId: courseId, dailyGoalSeconds: 1800 });
      const content = listVocabularyCatalogEntries()[0];
      expect(content.targets!.filter((target) => target.status === "published").map((target) => target.id)).toEqual(["address:corrected"]);
      expect(content.targets!.find((target) => target.id === "address:advanced")!.status).toBe("draft");
      const managed = await targetsGET(new Request(`http://local/api/vocabulary/targets?courseId=${courseId}`));
      expect((await managed.json()).targets.map((target: { id: string }) => target.id)).toEqual(["address:corrected"]);
      session = next(getVocabularySession().session!, second);
      expect(session.state.current).toMatchObject({ purpose: "learn-target", target: { id: "address:corrected" } });
      // An archived pending step remains in history but must not block the new reviewed meaning.
      introduce(session, second);
      expect(db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(saved.id)).toEqual(wordBefore);
      expect(db().prepare("SELECT * FROM vocabulary_reviews").all()).toEqual(reviewsBefore);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("withdraws only the private membership of shared targets and can explicitly republish archived content", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ielts-private-shared-")), filename = path.join(directory, "private.json");
    const write = (version: number, entries: ReturnType<typeof entry>[]) => writeFileSync(filename, JSON.stringify({ courses: [{ id: courseId, title: "Advanced", description: `package ${version}`, kind: "user-import", version }], entries }));
    try {
      const saved = personal("address"), first = entry("address"), removed = entry("yield", "C1");
      write(1, [first, removed]); vi.stubEnv("VOCABULARY_PRIVATE_CATALOG_PATH", filename); loadPrivateVocabularyCatalog(db());
      const otherCourse = "shared-advanced";
      registerVocabularyCourse({ id: otherCourse, title: "Other", description: "", kind: "user-import", version: 1 }, [{ ...first, courseIds: [otherCourse], targets: [{ ...first.targets[0], memberships: [{ ...first.targets[0].memberships[0], courseId: otherCourse }] }] }]);
      const before = listVocabularyEntries().find((word) => word.id === saved.id)!;
      write(2, []); loadPrivateVocabularyCatalog(db());
      expect(listVocabularyCatalogEntries(courseId)).toHaveLength(0);
      expect(getVocabularyCourses().courses.find((course) => course.id === courseId)).toMatchObject({ total: 0, ready: 0 });
      expect(listVocabularyCatalogEntries(otherCourse)).toHaveLength(1);
      const shared = listVocabularyCatalogEntries(otherCourse)[0].targets![0];
      expect(shared.status).toBe("published"); expect(shared.memberships.map((membership) => membership.courseId)).toEqual([otherCourse]);
      expect(listVocabularyCatalogEntries().find((catalog) => catalog.term === "yield")!.status).toBe("draft");
      expect(listVocabularyEntries().find((word) => word.id === saved.id)).toEqual(before);
      write(3, [removed]); loadPrivateVocabularyCatalog(db());
      const restored = listVocabularyCatalogEntries(courseId);
      expect(restored.map((catalog) => catalog.term)).toEqual(["yield"]);
      expect(restored[0].targets![0]).toMatchObject({ status: "published" });
      expect(getVocabularyCourses().courses.find((course) => course.id === courseId)).toMatchObject({ total: 1, ready: 1 });
      expect(listVocabularyCatalogEntries(otherCourse)[0].targets![0]).toEqual(shared);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("introduces corrected content after a learned first-recall meaning is withdrawn without resetting its original schedule", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ielts-private-first-recall-")), filename = path.join(directory, "private.json");
    const write = (version: number, entries: ReturnType<typeof entry>[]) => writeFileSync(filename, JSON.stringify({ courses: [{ id: courseId, title: "Advanced", description: `package ${version}`, kind: "user-import", version }], entries }));
    try {
      const first = entry("address"), second = entry("address", "C1", "second");
      const original = vocabularyCatalogEntrySchema.parse({ ...first, targets: [...first.targets, ...second.targets], exercises: [...first.exercises, ...second.exercises] });
      write(1, [original]); vi.stubEnv("VOCABULARY_PRIVATE_CATALOG_PATH", filename); loadPrivateVocabularyCatalog(db());
      let session = next(start()); expect(session.state.current!.purpose).toBe("learn-word");
      const wordId = session.state.current!.wordId; session = introduce(session).result.session!;
      const wordBefore = db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(wordId);
      const learningBefore = db().prepare("SELECT * FROM vocabulary_learning_state WHERE word_id=?").get(wordId);
      const targetBefore = readVocabularyTargetState("address:advanced", "address", db());
      expect(listVocabularyEntries()[0]).toMatchObject({ hasReviewHistory: false, repetitions: 0, learningStartedAt: at.toISOString() });
      // The other meaning must still wait while the first live recall is pending.
      const waiting = new Date(at.getTime() + 30_000); session = next(session, waiting); expect(session.state.current).toBeNull();
      const firstDue = new Date(at.getTime() + 60_000); session = reveal(next(session, firstDue), "address", {}, firstDue);
      const oldInput = targetGradeInput(session), corrected = entry("address", "B2", "corrected");
      corrected.targets[0].meaningZh = "处理；着手解决";
      write(2, [corrected]); expect(() => reviewVocabularyEntry(wordId, oldInput, firstDue)).toThrow("用法");
      session = next(getVocabularySession().session!, firstDue);
      expect(session.state.current).toMatchObject({ wordId, phase: "learn", purpose: "learn-target", target: { id: "address:corrected", meaningZh: "处理；着手解决" } });
      expect(session.state.current!.exercise!.targetId).toBe("address:corrected");
      session = introduce(session, firstDue).result.session!;
      expect(db().prepare("SELECT * FROM vocabulary_words WHERE id=?").get(wordId)).toEqual(wordBefore);
      expect(db().prepare("SELECT * FROM vocabulary_learning_state WHERE word_id=?").get(wordId)).toEqual(learningBefore);
      expect(readVocabularyTargetState("address:advanced", "address", db())).toEqual(targetBefore);
      expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
      expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_scheduler_state").get()).toEqual({ n: 0 });
      expect(next(session, new Date(firstDue.getTime() + 59_000)).state.current).toBeNull();
      const correctedDue = new Date(firstDue.getTime() + 60_000);
      session = reveal(next(session, correctedDue), "address", {}, correctedDue);
      expect(session.state.current).toMatchObject({ purpose: "merged", target: { id: "address:corrected" }, consolidation: { step: 1 } });
      grade(session, correctedDue);
      expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 1 });
      expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 0 });
      expect(readVocabularyTargetState("address:corrected", "address", db())).toMatchObject({ step: 2 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
function gradeInput(session: VocabularySession): VocabularyReviewInput {
  const card = session.state.current!; return { rating: "good", mode: session.state.mode, userAnswer: card.answer, durationSeconds: 1,
    sessionId: session.id, expectedSessionRevision: session.revision, expectedVersion: card.wordVersion, submissionId: randomUUID(), confirmedTypo: false, gaveUp: false };
}
