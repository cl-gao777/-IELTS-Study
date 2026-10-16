import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyMaterialMetadata, emptyPracticeDraft } from "../lib/learning-workspace";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));
import { addMaterial, createPracticeSet, getPracticeSet } from "./store";
import { createMaterialPractice, ensureLearningTables, getMaterialMetadata, getPracticeWorkspaceState, saveDictation, saveMistakeReason, savePracticeWorkspace, saveProtectedPracticeWorkspace, completePracticeRun, updateMaterial } from "./learning-workspace-store";
import { rotateDataEpoch } from "./data-integrity";
import { beginSubmission, completeSubmission } from "./submissions";
describe("local materials and practice persistence", () => {
  let directory: string; let filename: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ielts-practice-test-")); filename = path.join(directory, "practice.db"); holder.database = new Database(filename);
    holder.database.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE source_materials (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,kind TEXT,content TEXT,source_url TEXT,file_name TEXT DEFAULT '',mime_type TEXT DEFAULT '',file_path TEXT DEFAULT '',created_at TEXT);
      CREATE TABLE practice_sets (id TEXT PRIMARY KEY,kind TEXT,title TEXT,subtitle TEXT,instructions TEXT,passage TEXT,transcript TEXT,audio_url TEXT,duration_minutes INTEGER,questions_json TEXT,created_at TEXT);
      CREATE TABLE practice_attempts (id INTEGER PRIMARY KEY,set_id TEXT,kind TEXT,raw_score INTEGER,total_questions INTEGER,band_score REAL,duration_seconds INTEGER,answers_json TEXT,submitted_at TEXT);
      CREATE TABLE review_items(id INTEGER PRIMARY KEY,source_type TEXT,source_id TEXT,skill TEXT,prompt TEXT,answer TEXT,resolved INTEGER,created_at TEXT);`);
    ensureLearningTables();
  });
  afterEach(() => { holder.database?.close(); holder.database = null; rmSync(directory, { recursive: true, force: true }); });
  it("retains annotations, notes, answers and transcript after SQLite restart", () => {
    const material = addMaterial({ title: "My text", kind: "reading", content: "Trees cool cities.", sourceUrl: "" });
    updateMaterial(material.id, { title: material.title, content: material.content, sourceUrl: "", metadata: { ...emptyMaterialMetadata, tags: ["Environment"], notes: "My source" } });
    const set = createMaterialPractice(material.id, [], 20)!;
    expect(createMaterialPractice(material.id, [], 20)!.id).toBe(set.id);
    savePracticeWorkspace(set.id, { ...emptyPracticeDraft, answers: { q1: "Trees" }, elapsed: 46, notes: "Important", isRetry: true }, [{ id: "a1", start: 0, end: 5, style: "highlight", note: "植物" }]);
    holder.database!.close(); holder.database = new Database(filename);
    const loaded = getPracticeWorkspaceState(set.id);
    expect(loaded.draft).toMatchObject({ answers: { q1: "Trees" }, elapsed: 46, notes: "Important", isRetry: true });
    expect(loaded.annotations[0].note).toBe("植物"); expect(getMaterialMetadata(material.id).tags).toEqual(["Environment"]);
  });
  it("preserves scored source snapshots when later editing a material", () => {
    const material = addMaterial({ title: "Text", kind: "reading", content: "Original text", sourceUrl: "" });
    const set = createMaterialPractice(material.id, [{ id: "q", kind: "short-answer", prompt: "Word?", answers: ["Original"], explanation: "First word" }], 10)!;
    updateMaterial(material.id, { title: "Updated", content: "Changed text", sourceUrl: "", metadata: emptyMaterialMetadata });
    expect(getPracticeSet(set.id)?.passage).toBe("Original text");
  });
  it("keeps one shared run, rejects stale revisions and restored pages, and creates a fresh explicit retry", () => {
    createPracticeSet({ id: "r", kind: "reading", title: "Text", subtitle: "", instructions: "", passage: "Text", transcript: "", audioUrl: "", durationMinutes: 10, questions: [] });
    const first = getPracticeWorkspaceState("r");
    expect(getPracticeWorkspaceState("r").runId).toBe(first.runId);
    const input = { dataEpoch: first.dataEpoch, expectedRevision: first.revision, runId: first.runId, draft: { ...emptyPracticeDraft, notes: "Newest notes" }, annotations: [] };
    const saved = saveProtectedPracticeWorkspace("r", input)!;
    expect(saved.revision).toBe(1); expect(saved.runId).toBe(first.runId);
    expect(() => saveProtectedPracticeWorkspace("r", input)).toThrow("另一页面");
    const retry = saveProtectedPracticeWorkspace("r", { ...input, expectedRevision: 1, restart: true })!;
    expect(retry.runId).not.toBe(saved.runId); expect(retry.submissionId).not.toBe(saved.submissionId);
    rotateDataEpoch();
    expect(() => saveProtectedPracticeWorkspace("r", { ...input, expectedRevision: 2, runId: retry.runId })).toThrow("数据已恢复");
    expect(getPracticeWorkspaceState("r").draft.notes).toBe("Newest notes");
  });
  it("commits result and completion once and rolls back partial attempts", () => {
    createPracticeSet({ id: "r", kind: "reading", title: "Text", subtitle: "", instructions: "", passage: "Text", transcript: "", audioUrl: "", durationMinutes: 10, questions: [] });
    const state = getPracticeWorkspaceState("r");
    const input = { submissionId: state.submissionId, kind: "practice" as const, scopeId: state.runId, dataEpoch: state.dataEpoch, payload: { answer: "x" } };
    const claim = beginSubmission(input);
    let count = 0;
    const result = completeSubmission(input, claim.leaseId!, () => { count++; completePracticeRun("r"); return { score: 1 }; });
    expect(completeSubmission(input, claim.leaseId!, () => { count++; return { score: 2 }; })).toEqual(result);
    expect(count).toBe(1);
    expect(() => beginSubmission({ ...input, payload: { answer: "other" } })).toThrow("首次请求不同");
    const retry = saveProtectedPracticeWorkspace("r", { dataEpoch: state.dataEpoch, expectedRevision: 0, runId: state.runId, restart: true, draft: emptyPracticeDraft, annotations: [] })!;
    const second = { ...input, submissionId: retry.submissionId, scopeId: retry.runId };
    const lease = beginSubmission(second);
    expect(() => completeSubmission(second, lease.leaseId!, () => { completePracticeRun("r"); throw new Error("failure"); })).toThrow("failure");
    expect(holder.database!.prepare("SELECT completed FROM practice_workspace_versions WHERE set_id='r'").get()).toEqual({ completed: 0 });
  });
  it("saves aligned dictation errors and one Review Item atomically", () => {
    const set = createPracticeSet({ id: "l", kind: "listening", title: "Audio", subtitle: "", instructions: "", passage: "", transcript: "the green park", audioUrl: "", durationMinutes: 10, questions: [] });
    const result = saveDictation({ setId: set.id, expected: "the green park", submitted: "the park", startSeconds: 2, endSeconds: 8 })!;
    expect(result.errorCount).toBe(1); expect(result.tokens.map((token) => token.kind)).toEqual(["correct", "missing", "correct"]);
    const row = holder.database!.prepare("SELECT * FROM dictation_attempts").get() as { errors_json: string; start_seconds: number };
    expect(JSON.parse(row.errors_json)).toEqual([{ kind: "missing", expected: "green", actual: "" }]); expect(row.start_seconds).toBe(2);
    expect(holder.database!.prepare("SELECT COUNT(*) AS count FROM review_items").get()).toEqual({ count: 1 });
    expect(saveDictation({ setId: "missing", expected: "test", submitted: "test" })).toBeNull();
  });
  it("only classifies an existing incorrect answer", () => {
    holder.database!.prepare("INSERT INTO practice_attempts (id,answers_json) VALUES(1,?)").run(JSON.stringify([{ questionId: "wrong", correct: false }, { questionId: "right", correct: true }]));
    expect(saveMistakeReason(1, "right", "粗心")).toBe(false);
    expect(saveMistakeReason(1, "wrong", "定位失败")).toBe(true);
    expect(holder.database!.prepare("SELECT reason FROM practice_mistake_reasons").get()).toEqual({ reason: "定位失败" });
  });
});
