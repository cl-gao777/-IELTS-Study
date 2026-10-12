import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, existsSync: (filename: Parameters<typeof actual.existsSync>[0]) => String(filename).endsWith("vocabulary-catalog.json") ? false : actual.existsSync(filename) };
});
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("@/server/db", () => ({ getDatabase: () => holder.database! }));
import { VocabularySessionClient, type VocabularyTransport } from "./vocabulary-session-client";
import { vocabularyInputSchema } from "./vocabulary";
import { vocabularyCatalogEntrySchema } from "./vocabulary-course";
import { ensureVocabularyTables, saveVocabularyEntry, listVocabularyEntries, learnVocabularyEntry, reviewVocabularyEntry, type VocabularyReviewInput } from "@/server/vocabulary";
import { changeVocabularySession, getVocabularySession, type VocabularySessionOperation } from "@/server/vocabulary-session";
import { registerVocabularyCourse, selectVocabularyCourse, saveVocabularyStudy } from "@/server/vocabulary-courses";
import { changeVocabularyTargetDisposition, readVocabularyTargetState } from "@/server/vocabulary-targets";
import { GET as targetsGET } from "@/app/api/vocabulary/targets/route";

const now = Date.parse("2030-01-01T00:00:00.000Z"), courseId = "client-cross-advanced";
const db = () => holder.database!;
const clients: VocabularySessionClient[] = [];
const sentence = "We address the complex issue carefully.";
function setup(dueAt = "2030-01-01T00:01:05.000Z") {
  const word = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "address", partOfSpeech: "noun", meaningZh: "地址", definitionEn: "a postal location" }))!.word;
  db().prepare("UPDATE vocabulary_words SET repetitions=10,interval_days=40,due_at=? WHERE id=?").run(dueAt, word.id);
  const exercises = [sentence, "The report will address a difficult concern."].map((text, index) => ({
    id: `address-advanced:${index}`, targetId: "address-advanced", version: 1, sentence: text,
    targetStart: text.indexOf("address"), targetEnd: text.indexOf("address") + 7, targetSurface: "address", acceptedAnswers: ["address"], meaningZh: "处理问题", source: "test original context",
  }));
  const entry = vocabularyCatalogEntrySchema.parse({ id: "address-entry", term: "address", rank: 1, courseIds: [courseId], partOfSpeech: "noun", meaningZh: "地址", definitionEn: "a postal location", exercises,
    targets: [{ id: "address-advanced", version: 1, partOfSpeech: "verb", meaningZh: "处理问题", definitionEn: "to deal with a problem", level: "B2",
      levelEvidence: [{ source: "test", scope: "sense", level: "B2" }], memberships: [{ courseId, version: 1, rank: 1, exerciseIds: exercises.map((item) => item.id) }] }] });
  registerVocabularyCourse({ id: courseId, title: "Advanced", description: "test", kind: "user-import", version: 1 }, [entry]);
  selectVocabularyCourse(courseId); saveVocabularyStudy({ focus: "ielts-advanced" });
  changeVocabularySession({ action: "start", id: randomUUID(), mode: "context", restoreVersion: 1 });
  const values = new Map<string, string>();
  const cache = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let lose: "learn" | "review" | "targets" | null = null;
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const transport: VocabularyTransport = async (url, body) => {
    const input = body as Record<string, unknown> | undefined; calls.push({ url, body: input });
    let payload: Awaited<ReturnType<VocabularyTransport>>["payload"];
    try {
      if (!input && url.startsWith("/api/vocabulary/targets")) {
        const response = await targetsGET(new Request(`http://localhost${url}`));
        return { ok: response.ok, status: response.status, payload: await response.json() };
      }
      if (!input) payload = getVocabularySession(new URL(url, "http://localhost").searchParams.get("submissionId") ?? undefined);
      else if (url.endsWith("/session")) payload = changeVocabularySession(input as unknown as VocabularySessionOperation);
      else if (url.endsWith("/targets")) { changeVocabularyTargetDisposition(input); payload = getVocabularySession(); }
      else if (url.endsWith("/learn")) {
        const learned = learnVocabularyEntry(word.id, input as unknown as Parameters<typeof learnVocabularyEntry>[1])!;
        payload = { ...getVocabularySession(), ...learned };
      } else if (url.endsWith("/review")) {
        const reviewed = reviewVocabularyEntry(word.id, input as unknown as VocabularyReviewInput)!;
        payload = { ...getVocabularySession(), ...reviewed };
      }
      else throw new Error(`Unexpected request ${url}`);
    } catch (error) {
      return { ok: false, status: 409, payload: { ...getVocabularySession(), error: error instanceof Error ? error.message : "Conflict" } };
    }
    const action = url.endsWith("/learn") ? "learn" : url.endsWith("/review") ? "review" : url.endsWith("/targets") ? "targets" : null;
    if (input && lose && action === lose) { lose = null; throw new TypeError("acknowledgement lost after commit"); }
    return { ok: true, status: 200, payload };
  };
  const client = () => { const value = new VocabularySessionClient(listVocabularyEntries(), Date.now(), transport); clients.push(value); return value; };
  return { wordId: word.id, cache, client, calls, loseNext: (kind: NonNullable<typeof lose>) => { lose = kind; } };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  holder.database = new Database(":memory:");
  db().exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY,term TEXT NOT NULL UNIQUE,pronunciation TEXT NOT NULL,part_of_speech TEXT NOT NULL,meaning_zh TEXT NOT NULL,definition_en TEXT NOT NULL,example TEXT NOT NULL,tags_json TEXT NOT NULL,repetitions INTEGER NOT NULL DEFAULT 0,interval_days INTEGER NOT NULL DEFAULT 0,ease_factor REAL NOT NULL DEFAULT 2.5,due_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE vocabulary_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,word_id TEXT NOT NULL REFERENCES vocabulary_words(id),rating TEXT NOT NULL,previous_due_at TEXT NOT NULL,next_due_at TEXT NOT NULL,reviewed_at TEXT NOT NULL);
    CREATE TABLE review_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_type TEXT NOT NULL,source_id TEXT NOT NULL,skill TEXT NOT NULL,prompt TEXT NOT NULL,answer TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',mistake_count INTEGER NOT NULL DEFAULT 1,reviewed_at TEXT NOT NULL DEFAULT '');`);
  ensureVocabularyTables();
});
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); holder.database?.close(); holder.database = null; vi.useRealTimers(); });

describe("advanced vocabulary client against authoritative SQLite operations", () => {
  it("queries the real operation and grading ledgers after lost responses, freezing auxiliary purpose across the word's due date", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    const original = listVocabularyEntries()[0];
    expect(client.getSnapshot().session!.state.current?.purpose).toBe("learn-target");
    f.loseNext("learn"); await client.learnWord(original);
    expect(client.getSnapshot().pendingOperation).toBeNull();
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_target_operations").get()).toEqual({ n: 1 });
    expect(listVocabularyEntries()[0]).toEqual(original);
    vi.setSystemTime(now + 60_000); await client.refresh();
    expect(client.getSnapshot().session!.state.current).toMatchObject({ purpose: "consolidation", supplemental: true });
    vi.setSystemTime(now + 70_000); client.changeDraft({ answer: "address", phase: "revealed" });
    f.loseNext("review"); await client.reviewWord(original, { mode: "context", rating: "good", ratingSource: "automatic", userAnswer: "address", gaveUp: false, confirmedTypo: false, durationSeconds: 10 });
    expect(client.getSnapshot().pending).toBeNull();
    expect(client.getSnapshot().message).toContain("用法巩固已保存");
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
    expect(listVocabularyEntries()[0]).toEqual(original);
    expect(readVocabularyTargetState("address-advanced", "address", db())).toMatchObject({ step: 2 });
    expect(f.calls.filter((call) => call.url.endsWith("/learn"))).toHaveLength(1);
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(1);
    vi.setSystemTime(now + 670_000); await client.refresh();
    expect(client.getSnapshot().session!.state.current).toMatchObject({ purpose: "merged", supplemental: false });
    client.changeDraft({ answer: "address", phase: "revealed" });
    await client.reviewWord(original, { mode: "context", rating: "good", ratingSource: "automatic", userAnswer: "address", gaveUp: false, confirmedTypo: false, durationSeconds: 1 });
    expect(client.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 1 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 1 });
  });
  it("defers the whole word on a mode change and keeps real term pause and self-known operations out of FSRS", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    const original = listVocabularyEntries()[0];
    await client.learnWord(original); vi.setSystemTime(now + 60_000); await client.refresh();
    await client.changeMode("recognition");
    expect(client.getSnapshot().session!.state).toMatchObject({ current: null, skippedIds: [f.wordId], mode: "recognition" });
    expect(readVocabularyTargetState("address-advanced", "address", db())).toMatchObject({ step: 1 });
    f.loseNext("targets");
    await client.disposition({ action: "pause-term", term: "address", expectedStateVersion: 0, restoreVersion: 1 });
    expect(client.getSnapshot().pendingOperation).toBeNull();
    expect(client.getSnapshot().termDispositions).toEqual([{ normalizedTerm: "address", paused: true, version: 1 }]);
    await client.disposition({ action: "know-target", targetId: "address-advanced", targetVersion: 1, expectedStateVersion: 1, restoreVersion: 1 });
    expect(listVocabularyEntries()[0]).toEqual(original);
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_reviews").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) AS n FROM vocabulary_supplemental_attempts").get()).toEqual({ n: 0 });
    expect(client.getSnapshot().targetCounts).toMatchObject({ pausedTargets: 1, pausedTerms: 1 });
  });
});
