import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null, failAI: false, waitAI: null as Promise<void> | null }));
vi.mock("./db", async (original) => ({ ...await original<typeof import("./db")>(), getDatabase: () => holder.database! }));
vi.mock("./ai", () => ({ evaluateWriting: async () => {
  if (holder.waitAI) await holder.waitAI;
  if (holder.failAI) throw new Error("AI unavailable");
  return { provider: "local-fallback", overallBand: 0, criteria: { taskResponse: 0, coherenceCohesion: 0, lexicalResource: 0, grammarAccuracy: 0 }, strengths: [], improvements: ["未评估"], rewrite: "" };
} }));
import { migrate } from "./db";
import { createPracticeSet, getPracticeSet, listPracticeSets } from "./store";
import { seedPracticeSets } from "./seed-data";
import { getDataEpoch, rotateDataEpoch } from "./data-integrity";
import { claimMockWriter, checkpointMockSession, getMockSession, startMockSession, frozenMockSubmission, endMockSession } from "./mock-exam-session";
import { POST } from "@/app/api/mock-exam/route";
import { defaultMockPaper, mockPaperDescription } from "../lib/mock-exam";
import { MockExamClient, type MockClientTransport } from "../lib/mock-exam-client";
import { GET as getSession, PUT as sessionRequest } from "@/app/api/mock-exam/session/route";
import { lookupSubmission } from "./submissions";
import { initializeWritingTables } from "./writing-drafts";
const db = () => holder.database!;
beforeEach(() => {
  holder.database = new Database(":memory:"); migrate(db());
  db().exec("CREATE TABLE studio_preferences(id INTEGER PRIMARY KEY,value_json TEXT)");
  initializeWritingTables();
  seedPracticeSets.forEach((set) => createPracticeSet(set)); holder.failAI = false; holder.waitAI = null;
});
afterEach(() => { db().close(); vi.useRealTimers(); });
function setup() {
  const session = startMockSession({ dataEpoch: getDataEpoch(), listeningSetId: "listening-campus-project", readingSetId: "reading-urban-cooling" });
  const writerId = randomUUID(); return { session: claimMockWriter({ id: session.id, dataEpoch: session.dataEpoch, writerId }), writerId };
}
function ready() {
  const f = setup();
  let session = checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: { ...f.session.state, stage: "reading", listeningAnswers: { [f.session.listeningSet.questions[0].id]: "workshop" } } });
  session = checkpointMockSession({ id: session.id, dataEpoch: session.dataEpoch, writerId: f.writerId, expectedRevision: session.revision, state: { ...session.state, stage: "writing", essay: "Public transport is a practical investment because reliable services help residents travel efficiently and reduce congestion." } });
  return { session, writerId: f.writerId, input: { sessionId: session.id, submissionId: session.submissionId, dataEpoch: session.dataEpoch, writerId: f.writerId } };
}
const submit = (input: ReturnType<typeof ready>["input"]) => POST(new Request("http://localhost/api/mock-exam", { method: "POST", body: JSON.stringify(input) }));
const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
describe("durable Mock Exam", () => {
  it("defaults to the original sample rather than a title-sorted imported PDF, and excludes zero-question choices", () => {
    const set = { ...seedPracticeSets.find((s) => s.kind === "reading")!, id: "first", title: "000 imported" }; createPracticeSet(set);
    createPracticeSet({ ...set, id: "empty", questions: [] });
    expect(defaultMockPaper(listPracticeSets("reading"), "reading")).toBe("reading-urban-cooling");
    expect(defaultMockPaper([{ ...set, questions: [] }], "reading")).toBe("");
    expect(mockPaperDescription({ questions: [{ ...set.questions[0], originalQuestionNumber: 2 }], resource: undefined })).toContain("缺题");
    expect(() => startMockSession({ dataEpoch: getDataEpoch(), listeningSetId: "listening-campus-project", readingSetId: "empty" })).toThrow();
  });
  it("freezes full scoring snapshots while hiding answer and transcript documents from the client", () => {
    const f = setup(); expect(f.session.readingSet.questions.every((q) => !q.answers.length && !q.explanation)).toBe(true);
    const original = getPracticeSet("reading-urban-cooling")!;
    db().prepare("UPDATE practice_sets SET questions_json=? WHERE id=?").run(JSON.stringify(original.questions.map((q) => ({ ...q, answers: ["edited"] }))), original.id);
    let session = checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: { ...f.session.state, stage: "reading" } });
    session = checkpointMockSession({ id: session.id, dataEpoch: session.dataEpoch, writerId: f.writerId, expectedRevision: session.revision, state: { ...session.state, stage: "writing", essay: "This essay contains enough characters to be submitted successfully." } });
    const frozen = frozenMockSubmission({ sessionId: session.id, submissionId: session.submissionId, dataEpoch: session.dataEpoch, writerId: f.writerId });
    expect(frozen.snapshot.readingSet.questions[0].answers).toEqual(original.questions[0].answers);
  });
  it("keeps answers, positions, zoom and actual durations, rejects backwards stages and stale revisions", () => {
    const f = setup(); const state = { ...f.session.state, listeningAnswers: { [f.session.listeningSet.questions[0].id]: "answer" }, positions: { "listening:source": 301 }, zooms: { listening: 150 }, audioPosition: 65, durations: { listening: 5, reading: 0, writing: 0 } };
    const saved = checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: 1, state });
    expect(getMockSession().session?.state).toEqual(state);
    expect(() => checkpointMockSession({ id: saved.id, dataEpoch: saved.dataEpoch, writerId: f.writerId, expectedRevision: 1, state })).toThrow();
    const advanced = checkpointMockSession({ id: saved.id, dataEpoch: saved.dataEpoch, writerId: f.writerId, expectedRevision: saved.revision, state: { ...state, stage: "reading" } });
    expect(() => checkpointMockSession({ id: advanced.id, dataEpoch: advanced.dataEpoch, writerId: f.writerId, expectedRevision: advanced.revision, state })).toThrow("不能返回");
    expect(() => checkpointMockSession({ id: advanced.id, dataEpoch: advanced.dataEpoch, writerId: f.writerId, expectedRevision: advanced.revision, state: { ...advanced.state, listeningAnswers: {} } })).toThrow("听力部分");
  });
  it("permits only one writer and releases its lease on pause", () => {
    const f = setup(), other = randomUUID();
    expect(() => claimMockWriter({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: other })).toThrow("另一页面");
    checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: f.session.state, release: true });
    expect(claimMockWriter({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: other }).writerId).toBe(other);
  });
  it("allows a new writer after a closed window lease expires and rejects the old writer", () => {
    vi.useFakeTimers(); const f = setup(), other = randomUUID(); vi.advanceTimersByTime(16000);
    expect(claimMockWriter({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: other }).writerId).toBe(other);
    expect(() => checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: f.session.state })).toThrow("编辑权限");
  });
  it("returns only bounded PDF question ranges and genuine audio, with no answer or transcript entries", () => {
    const reading = getPracticeSet("reading-urban-cooling")!;
    const resource = { provider: "Personal", classification: "user-supplied", sourceUrl: "", licenseUrl: "", copyright: "Local source", verifiedAt: "2026-10-13", notes: "", issues: [], questionDocuments: [{ label: "paper", url: "/api/uploads/1", sourceUrl: "", page: 1 }], answerDocuments: [{ label: "answer", url: "/api/uploads/1", sourceUrl: "", page: 5 }], audioTracks: [], transcriptDocuments: [], readingPassages: [{ id: "p1", label: "Passage 1", documents: [{ label: "paper", url: "/api/uploads/1", sourceUrl: "", page: 1, endPage: 4 }], questionIds: reading.questions.map((q) => q.id) }] };
    db().prepare("UPDATE practice_sets SET resource_json=? WHERE id=?").run(JSON.stringify(resource), reading.id);
    const listening = getPracticeSet("listening-campus-project")!;
    db().prepare("UPDATE practice_sets SET resource_json=? WHERE id=?").run(JSON.stringify({ ...resource, readingPassages: undefined, audioTracks: [{ label: "recording", url: "/api/uploads/2", sourceUrl: "" }], transcriptDocuments: [{ label: "text", url: "/api/uploads/3", sourceUrl: "" }] }), listening.id);
    const { session } = setup(); expect(session.readingSet.resource?.questionDocuments[0].endPage).toBe(4); expect(session.readingSet.resource?.answerDocuments).toEqual([]);
    expect(session.listeningSet.resource?.audioTracks[0].url).toBe("/api/uploads/2"); expect(session.listeningSet.transcript).toBe(""); expect(session.listeningSet.resource?.transcriptDocuments).toEqual([]);
  });
  it("rejects all saves and submissions from before a successful restore", async () => {
    const f = ready(); rotateDataEpoch();
    expect(() => checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: f.session.state })).toThrow("数据已恢复");
    expect((await submit(f.input)).status).toBe(409); expect(count("practice_attempts")).toBe(0);
  });
  it("commits one result and one essay on response loss and repeated submission without a fabricated writing score", async () => {
    const f = ready(); const first = await submit(f.input); expect(first.status).toBe(200); const result = await first.json();
    const duplicate = await submit(f.input); expect(await duplicate.json()).toEqual(result);
    expect(count("practice_attempts")).toBe(2); expect(count("mock_exams")).toBe(1); expect(count("writing_drafts")).toBe(1); expect(count("writing_submissions")).toBe(0);
  });
  it("rolls back both objective scores and the essay when a later domain write fails", async () => {
    const f = ready(); db().exec("CREATE TRIGGER fail_mock BEFORE INSERT ON mock_exams BEGIN SELECT RAISE(ABORT,'forced domain failure'); END;");
    expect((await submit(f.input)).status).toBe(400); expect(count("practice_attempts")).toBe(0); expect(count("review_items")).toBe(0); expect(count("writing_drafts")).toBe(0);
    db().exec("DROP TRIGGER fail_mock"); expect((await submit(f.input)).status).toBe(200); expect(count("mock_exams")).toBe(1);
  });
  it("uses a persistent task claim for simultaneous AI requests and rejects a late result after restore", async () => {
    const f = ready(); let release!: () => void; holder.waitAI = new Promise<void>((done) => { release = done; });
    const first = submit(f.input); await vi.waitFor(() => expect(count("submission_receipts")).toBe(1));
    expect((await submit(f.input)).status).toBe(202); rotateDataEpoch(); release();
    expect((await first).status).toBe(409); expect(count("practice_attempts")).toBe(0); expect(count("writing_drafts")).toBe(0);
  });
  it("locks the payload after a failed submission and refuses to discard an unresolved exam", async () => {
    const f = ready(); holder.failAI = true; expect((await submit(f.input)).status).toBe(400);
    expect(() => checkpointMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, writerId: f.writerId, expectedRevision: f.session.revision, state: { ...f.session.state, essay: "A different essay cannot replace the submitted answer snapshot." } })).toThrow("已提交处理");
    expect(() => endMockSession({ id: f.session.id, dataEpoch: f.session.dataEpoch, expectedRevision: f.session.revision })).toThrow("查询");
  });
});
describe("Mock Exam client restoration", () => {
  function fixture() {
    let cached: unknown = null, loseResponse = false, loseCheckpoint = false, loseRead = false;
    const writerId = randomUUID(), calls: string[] = [];
    const transport: MockClientTransport = { writerId, read: () => cached, write: (value) => { cached = structuredClone(value); }, async request(url, body) {
      calls.push(url);
      if (!body && loseRead) { loseRead = false; throw new Error("read temporarily unavailable"); }
      if (url.startsWith("/api/submissions/")) return { ok: true, status: 200, payload: lookupSubmission(url.split("/")[3].split("?")[0], getDataEpoch()) };
      const request = new Request("http://localhost" + url, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
      const response = url === "/api/mock-exam" ? await POST(request) : body ? await sessionRequest(request) : await getSession();
      if ((body as { action?: string } | undefined)?.action === "checkpoint" && loseCheckpoint) { loseCheckpoint = false; loseRead = true; throw new Error("checkpoint response lost"); }
      if (url === "/api/mock-exam" && loseResponse) { loseResponse = false; throw new Error("response lost"); }
      return { ok: response.ok, status: response.status, payload: await response.json() };
    } };
    return { client: () => new MockExamClient(transport), anotherClient: () => new MockExamClient({ ...transport, writerId: randomUUID() }), cache: () => cached, lose: () => { loseResponse = true; }, loseCheckpoint: () => { loseCheckpoint = true; }, calls };
  }
  it("restores immediate local typing and pauses instead of adding hidden wall time", async () => {
    const f = fixture(), first = f.client(); await first.initialize(); await first.start("listening-campus-project", "reading-urban-cooling"); await first.resume();
    first.change({ listeningAnswers: { [first.getSnapshot().session!.listeningSet.questions[0].id]: "unsaved typing" } }); first.tick(5);
    const next = f.client(); await next.initialize(); expect(next.getSnapshot().state?.listeningAnswers).toEqual(first.getSnapshot().state?.listeningAnswers); expect(next.getSnapshot().state?.durations.listening).toBe(5); expect(next.getSnapshot().state?.paused).toBe(true);
    next.tick(100); expect(next.getSnapshot().state?.durations.listening).toBe(5); await next.resume(); await next.pause(); expect(getMockSession().session?.state.durations.listening).toBe(5);
  });
  it("queries the saved receipt after a lost response rather than posting another score", async () => {
    const f = fixture(), client = f.client(); await client.initialize(); await client.start("listening-campus-project", "reading-urban-cooling"); await client.resume(); await client.nextStage(); await client.nextStage(); client.change({ essay: "Public transport should receive funding because useful services enable residents to reach jobs without increasing road traffic." }); f.lose(); await client.submit();
    expect(client.getSnapshot().session?.status).toBe("completed"); expect(f.calls.filter((url) => url === "/api/mock-exam")).toHaveLength(1); expect(count("mock_exams")).toBe(1);
  });
  it("reconciles an acknowledged server checkpoint after losing both response and immediate read, retaining later typing", async () => {
    const f = fixture(), client = f.client(); await client.initialize(); await client.start("listening-campus-project", "reading-urban-cooling"); await client.resume();
    const questionId = client.getSnapshot().session!.listeningSet.questions[0].id;
    client.change({ listeningAnswers: { [questionId]: "first answer" } }); f.loseCheckpoint(); await client.checkpoint();
    client.change({ listeningAnswers: { [questionId]: "later typing" } }); await client.checkpoint();
    expect(client.getSnapshot().frozen).toBe(false); expect(getMockSession().session!.state.listeningAnswers[questionId]).toBe("later typing");
  });
  it("a second document cannot overwrite cached typing or acquire the live lease, but can restore it after the old window expires", async () => {
    vi.useFakeTimers(); const f = fixture(), original = f.client(); await original.initialize(); await original.start("listening-campus-project", "reading-urban-cooling"); await original.resume();
    const questionId = original.getSnapshot().session!.listeningSet.questions[0].id; original.change({ listeningAnswers: { [questionId]: "local only" } }); const cache = f.cache();
    const second = f.anotherClient(); await second.initialize(); expect(f.cache()).toEqual(cache); await second.resume(); expect(second.getSnapshot().writer).toBe(false);
    vi.advanceTimersByTime(16000); await second.resume(); expect(second.getSnapshot().writer).toBe(true); expect(getMockSession().session!.state.listeningAnswers[questionId]).toBe("local only");
  });
  it("freezes a restored-page save while preserving its recovery copy", async () => {
    const f = fixture(), client = f.client(); await client.initialize(); await client.start("listening-campus-project", "reading-urban-cooling"); await client.resume(); client.change({ listeningAnswers: { [client.getSnapshot().session!.listeningSet.questions[0].id]: "preserved" } }); const recovery = f.cache(); rotateDataEpoch(); await client.checkpoint();
    expect(client.getSnapshot().frozen).toBe(true); expect(f.cache()).toMatchObject({ ...(recovery as object), pendingCheckpoint: expect.any(Object) });
    expect(Object.values(client.getSnapshot().state!.listeningAnswers)).toEqual(["preserved"]);
  });
});
