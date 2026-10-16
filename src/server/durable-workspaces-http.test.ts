import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPracticeDraft } from "../lib/learning-workspace";
import type { WritingDraftInput } from "../lib/writing";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null, generate: vi.fn() }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
vi.mock("./ai", () => ({ generateAiText: holder.generate }));
import { getDataEpoch, rotateDataEpoch } from "./data-integrity";
import { initializeWritingTables, saveProtectedWritingDraft } from "./writing-drafts";
import { PUT as writingPut } from "../app/api/writing/drafts/route";
import { POST as evaluate } from "../app/api/writing/evaluate/route";
import { PUT as practicePut } from "../app/api/practice/workspace/[id]/route";
import { POST as practiceSubmit } from "../app/api/practice/attempts/route";
import { ensureLearningTables, getPracticeWorkspaceState } from "./learning-workspace-store";
function request(body: unknown, method = "PUT") { return new Request("http://localhost/api/test", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
let draft: WritingDraftInput;
beforeEach(() => {
  holder.database = new Database(":memory:"); holder.generate.mockReset();
  holder.database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE writing_submissions(id INTEGER PRIMARY KEY,task_type TEXT,prompt TEXT,essay TEXT,word_count INTEGER,overall_band REAL,criteria_json TEXT,strengths_json TEXT,improvements_json TEXT,rewrite TEXT,submitted_at TEXT);
    CREATE TABLE review_items(id INTEGER PRIMARY KEY,source_type TEXT,source_id TEXT,skill TEXT,prompt TEXT,answer TEXT,resolved INTEGER,created_at TEXT);
    CREATE TABLE source_materials(id INTEGER PRIMARY KEY);
    CREATE TABLE practice_sets(id TEXT PRIMARY KEY,kind TEXT,title TEXT,subtitle TEXT,instructions TEXT,passage TEXT,transcript TEXT,audio_url TEXT,duration_minutes INTEGER,questions_json TEXT,resource_json TEXT,created_at TEXT);
    CREATE TABLE practice_attempts(id INTEGER PRIMARY KEY,set_id TEXT,kind TEXT,raw_score INTEGER,total_questions INTEGER,band_score REAL,duration_seconds INTEGER,answers_json TEXT,submitted_at TEXT);
    INSERT INTO practice_sets VALUES('r','reading','Read','','','Text','','',20,'[]','{}','2026-10-13');`);
  initializeWritingTables(); ensureLearningTables();
  const id = randomUUID(); draft = { id, groupId: id, version: 1, taskType: "task-2", category: "Opinion", prompt: "Discuss transport.", image: "", essay: "Cities should invest in transport to improve access to jobs and education.", elapsedSeconds: 0, timeLimitMinutes: 40, status: "draft", updatedAt: "2026-10-13T00:00:00.000Z" };
});
afterEach(() => { holder.database!.close(); holder.database = null; });
describe("workspace HTTP restore protection", () => {
  it("returns an old completed result after explicit retry without changing the current run or duplicating scores", async () => {
    holder.database!.exec(`CREATE TABLE studio_preferences(id INTEGER PRIMARY KEY,value_json TEXT);
      CREATE TABLE study_tasks(id TEXT PRIMARY KEY,study_date TEXT,area TEXT,title TEXT,detail TEXT,estimated_minutes INTEGER,completed INTEGER,href TEXT,updated_at TEXT);`);
    holder.database!.prepare("UPDATE practice_sets SET questions_json=? WHERE id='r'").run(JSON.stringify([{ id: "q1", kind: "short-answer", prompt: "First word?", answers: ["Text"], explanation: "The first word." }]));
    const first = getPracticeWorkspaceState("r");
    const body = { setId: "r", answers: { q1: "Wrong" }, durationSeconds: 12, dataEpoch: first.dataEpoch, runId: first.runId, submissionId: first.submissionId };
    const submitted = await practiceSubmit(request(body, "POST"));
    expect(submitted.status).toBe(200);
    const original = await submitted.json();
    expect(original.attempt.rawScore).toBe(0);
    const context = { params: Promise.resolve({ id: "r" }) };
    const restart = await practicePut(request({ draft: { ...emptyPracticeDraft, isRetry: true }, annotations: [], dataEpoch: first.dataEpoch, expectedRevision: first.revision, runId: first.runId, restart: true }), context);
    expect(restart.status).toBe(200);
    const current = await restart.json();
    expect(current.runId).not.toBe(first.runId); expect(current.submissionId).not.toBe(first.submissionId);
    const rowsBefore = holder.database!.prepare("SELECT * FROM submission_receipts").all();
    const retry = await practiceSubmit(request(body, "POST"));
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual(original);
    expect(getPracticeWorkspaceState("r")).toMatchObject({ runId: current.runId, submissionId: current.submissionId, revision: current.revision, draft: { isRetry: true } });
    for (const changed of [{ ...body, answers: { q1: "Text" } }, { ...body, durationSeconds: 13 }, { ...body, runId: randomUUID() }, { ...body, dataEpoch: undefined }])
      expect((await practiceSubmit(request(changed, "POST"))).status).toBe(409);
    rotateDataEpoch();
    expect((await practiceSubmit(request(body, "POST"))).status).toBe(409);
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM practice_attempts").get()).toEqual({ n: 1 });
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM review_items").get()).toEqual({ n: 1 });
    expect(holder.database!.prepare("SELECT * FROM submission_receipts").all()).toEqual(rowsBefore);
  });
  it("does not create a processing receipt for an invalid first run", async () => {
    const current = getPracticeWorkspaceState("r");
    const response = await practiceSubmit(request({ setId: "r", answers: {}, durationSeconds: 12, dataEpoch: current.dataEpoch, runId: randomUUID(), submissionId: randomUUID() }, "POST"));
    expect(response.status).toBe(409);
    expect(holder.database!.prepare("SELECT name FROM sqlite_master WHERE name='submission_receipts'").get()).toBeUndefined();
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM practice_attempts").get()).toEqual({ n: 0 });
  });
  it("rejects old protocol and stale practice pages before any write", async () => {
    const state = getPracticeWorkspaceState("r"); const context = { params: Promise.resolve({ id: "r" }) };
    expect((await practicePut(request({ draft: emptyPracticeDraft, annotations: [] }), context)).status).toBe(409);
    rotateDataEpoch();
    expect((await practicePut(request({ draft: emptyPracticeDraft, annotations: [], dataEpoch: state.dataEpoch, expectedRevision: state.revision, runId: state.runId }), context)).status).toBe(409);
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM practice_drafts").get()).toEqual({ n: 0 });
  });
  it("rejects obsolete writing autosave without changing restored text", async () => {
    const epoch = getDataEpoch(); const saved = saveProtectedWritingDraft(draft, 0, epoch);
    expect((await writingPut(request(draft))).status).toBe(409);
    rotateDataEpoch();
    expect((await writingPut(request({ ...draft, essay: "Old page text", dataEpoch: epoch, expectedRevision: saved.revision }))).status).toBe(409);
    expect(holder.database!.prepare("SELECT essay FROM writing_drafts").get()).toEqual({ essay: draft.essay });
  });
  it("rejects AI feedback returning after restore, preserving historical records", async () => {
    const epoch = getDataEpoch(); const saved = saveProtectedWritingDraft(draft, 0, epoch);
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; }); holder.generate.mockReturnValue(pending);
    const response = evaluate(request({ ...draft, dataEpoch: epoch, expectedRevision: saved.revision }));
    await vi.waitFor(() => expect(holder.generate).toHaveBeenCalledOnce());
    rotateDataEpoch();
    finish({ provider: "test", text: JSON.stringify({ overallBand: 6, overall: "Clear.", criteria: { taskResponse: 6, coherenceCohesion: 6, lexicalResource: 6, grammarAccuracy: 6 }, criterionFeedback: { taskResponse: "Clear", coherenceCohesion: "Clear", lexicalResource: "Clear", grammarAccuracy: "Clear" }, strongSentences: [], weakSentences: [], grammarErrors: [], vocabularyProblems: [], betterExpressions: [], rewrite: "Improve access to employment.", actionItems: ["Revise." ] }) });
    expect((await response).status).toBe(409);
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM writing_submissions").get()).toEqual({ n: 0 });
    expect(holder.database!.prepare("SELECT COUNT(*) AS n FROM review_items").get()).toEqual({ n: 0 });
  });
});
