import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { PracticeSet } from "../lib/domain";
import { initialMockState, mockStages, mockStateSchema, mockWritingPrompt, type MockResult, type MockSession, type MockState } from "../lib/mock-exam";
import { getDatabase } from "./db";
import { assertDataEpoch, DataIntegrityConflict, getDataEpoch } from "./data-integrity";
import { getPracticeSet } from "./store";

export function ensureMockExamTables(database: Database.Database = getDatabase()) {
  getDataEpoch(database);
  database.exec(`CREATE TABLE IF NOT EXISTS mock_exam_sessions (
    id TEXT PRIMARY KEY, data_epoch TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    state_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, submission_id TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','completed','ended')),
    writer_id TEXT, lease_until TEXT, result_json TEXT
  )`);
}
export type MockSessionRow = { id: string; data_epoch: string; revision: number; state_json: string; snapshot_json: string; submission_id: string; started_at: string; updated_at: string; status: MockSession["status"]; writer_id: string | null; lease_until: string | null; result_json: string | null };
type Snapshot = { listeningSet: PracticeSet; readingSet: PracticeSet; writingPrompt: string };
function row(id: string, db: Database.Database) { return db.prepare("SELECT * FROM mock_exam_sessions WHERE id=?").get(id) as MockSessionRow | undefined; }
function safeSet(set: PracticeSet): PracticeSet {
  const resource = set.resource;
  const crop = (document: NonNullable<PracticeSet["resource"]>["questionDocuments"][number]) => {
    if (!resource) return [document];
    const restrictedStart = [...resource.answerDocuments, ...resource.transcriptDocuments].filter((item) => item.url === document.url).map((item) => item.page ?? 1);
    const endPage = restrictedStart.length ? Math.min(document.endPage ?? Infinity, ...restrictedStart.map((page) => page - 1)) : document.endPage;
    return endPage !== undefined && endPage < (document.page ?? 1) ? [] : [{ ...document, ...(endPage === undefined ? {} : { endPage }) }];
  };
  const documents = resource?.questionDocuments.flatMap(crop);
  const readingPassages = resource?.readingPassages?.map((passage) => ({ ...passage, documents: passage.documents.flatMap(crop) as typeof passage.documents }));
  return { ...set, transcript: resource ? "" : set.id === "listening-campus-project" ? set.transcript : "", questions: set.questions.map((q, index) => ({ ...q, originalQuestionNumber: q.originalQuestionNumber ?? index + 1, answers: [], explanation: "", evidence: undefined, answerGroupTargets: undefined })), ...(resource ? { resource: { ...resource, readingPassages, questionDocuments: documents ?? [], answerDocuments: [], transcriptDocuments: [], originalPath: undefined } } : {}) };
}
function fromRow(record: MockSessionRow): MockSession {
  const snapshot = JSON.parse(record.snapshot_json) as Snapshot;
  return { id: record.id, dataEpoch: record.data_epoch, revision: record.revision, submissionId: record.submission_id, startedAt: record.started_at, status: record.status, state: mockStateSchema.parse(JSON.parse(record.state_json)), ...snapshot,
    listeningSet: safeSet(snapshot.listeningSet), readingSet: safeSet(snapshot.readingSet), result: record.result_json ? JSON.parse(record.result_json) : null, writerId: record.writer_id, leaseUntil: record.lease_until };
}
export function getMockSession(db: Database.Database = getDatabase()): { dataEpoch: string; session: MockSession | null } {
  ensureMockExamTables(db);
  const record = db.prepare("SELECT * FROM mock_exam_sessions WHERE status <> 'ended' ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1").get() as MockSessionRow | undefined;
  return { dataEpoch: getDataEpoch(db), session: record ? fromRow(record) : null };
}
export function startMockSession(input: { dataEpoch: string; listeningSetId: string; readingSetId: string }, db: Database.Database = getDatabase()) {
  ensureMockExamTables(db);
  return db.transaction(() => {
    assertDataEpoch(input.dataEpoch, db);
    const active = db.prepare("SELECT * FROM mock_exam_sessions WHERE status='active' LIMIT 1").get() as MockSessionRow | undefined;
    if (active) return fromRow(active);
    const listeningSet = getPracticeSet(input.listeningSetId), readingSet = getPracticeSet(input.readingSetId);
    if (!listeningSet || listeningSet.kind !== "listening" || !readingSet || readingSet.kind !== "reading" || !listeningSet.questions.length || !readingSet.questions.length) throw new Error("请选择有题目的听力和阅读试卷。");
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare("INSERT INTO mock_exam_sessions(id,data_epoch,state_json,snapshot_json,submission_id,started_at,updated_at,status) VALUES(?,?,?,?,?,?,?,'active')")
      .run(id, input.dataEpoch, JSON.stringify(initialMockState(readingSet.resource?.readingPassages?.[0]?.id)), JSON.stringify({ listeningSet, readingSet, writingPrompt: mockWritingPrompt }), randomUUID(), now, now);
    return fromRow(row(id, db)!);
  })();
}
function requireSession(id: string, epoch: string, db: Database.Database) {
  assertDataEpoch(epoch, db); const record = row(id, db);
  if (!record || record.data_epoch !== epoch) throw new DataIntegrityConflict();
  return record;
}
function requireWriter(record: MockSessionRow, writerId: string) {
  if (record.writer_id !== writerId || Date.parse(record.lease_until ?? "") <= Date.now()) throw new DataIntegrityConflict("另一页面正在编辑，或编辑权限已过期。请保留草稿后重新继续。", "WRITER_CONFLICT");
}
function hasSubmission(record: MockSessionRow, db: Database.Database) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE name='submission_receipts'").get();
  return Boolean(table && db.prepare("SELECT id FROM submission_receipts WHERE id=?").get(record.submission_id));
}
export function claimMockWriter(input: { id: string; dataEpoch: string; writerId: string }, db: Database.Database = getDatabase()) {
  ensureMockExamTables(db);
  return db.transaction(() => {
    const record = requireSession(input.id, input.dataEpoch, db);
    if (record.status !== "active") return fromRow(record);
    if (record.writer_id && record.writer_id !== input.writerId && Date.parse(record.lease_until ?? "") > Date.now()) throw new DataIntegrityConflict("此考试正在另一页面进行，或旧窗口正在释放权限；本页只读。若已关闭旧窗口，请等待最多 15 秒后再点击继续。", "WRITER_CONFLICT");
    db.prepare("UPDATE mock_exam_sessions SET writer_id=?,lease_until=? WHERE id=?").run(input.writerId, new Date(Date.now() + 15000).toISOString(), input.id);
    return fromRow(row(input.id, db)!);
  })();
}
function validateProgress(previous: MockState, next: MockState, snapshot: Snapshot) {
  const before = mockStages.indexOf(previous.stage), after = mockStages.indexOf(next.stage);
  if (after < before || after > before + 1) throw new DataIntegrityConflict("已完成的部分不能返回修改。", "DRAFT_CONFLICT");
  for (const stage of mockStages) if (next.durations[stage] < previous.durations[stage]) throw new DataIntegrityConflict("计时版本已过期。", "DRAFT_CONFLICT");
  if (before > 0 && JSON.stringify(next.listeningAnswers) !== JSON.stringify(previous.listeningAnswers)) throw new DataIntegrityConflict("听力部分已完成。", "DRAFT_CONFLICT");
  if (before > 1 && JSON.stringify(next.readingAnswers) !== JSON.stringify(previous.readingAnswers)) throw new DataIntegrityConflict("阅读部分已完成。", "DRAFT_CONFLICT");
  for (const [kind, selected] of [["listening", next.listeningAnswers], ["reading", next.readingAnswers]] as const) {
    const ids = new Set(snapshot[`${kind}Set`].questions.map((q) => q.id));
    if (Object.keys(selected).some((id) => !ids.has(id))) throw new Error("答案引用了不存在的题号。");
  }
  if (next.passageId && !snapshot.readingSet.resource?.readingPassages?.some((p) => p.id === next.passageId)) throw new Error("篇章不存在。");
}
export function checkpointMockSession(input: { id: string; dataEpoch: string; writerId: string; expectedRevision: number; state: MockState; release?: boolean }, db: Database.Database = getDatabase()) {
  ensureMockExamTables(db);
  return db.transaction(() => {
    const record = requireSession(input.id, input.dataEpoch, db); requireWriter(record, input.writerId);
    if (record.status !== "active" || record.revision !== input.expectedRevision) throw new DataIntegrityConflict("考试草稿已由另一页面更新，请保留本页内容后重新加载。", "DRAFT_CONFLICT");
    const state = mockStateSchema.parse(input.state);
    // Once a submission is sent, even a reclaimed writer cannot alter its answer payload.
    if (hasSubmission(record, db)) {
      const before = mockStateSchema.parse(JSON.parse(record.state_json));
      if (JSON.stringify({ ...state, paused: true }) !== JSON.stringify({ ...before, paused: true })) throw new DataIntegrityConflict("此答卷已提交处理，只能查询或重试原提交。", "SUBMISSION_CONFLICT");
    }
    validateProgress(mockStateSchema.parse(JSON.parse(record.state_json)), state, JSON.parse(record.snapshot_json));
    if (input.release) state.paused = true;
    db.prepare("UPDATE mock_exam_sessions SET state_json=?,revision=revision+1,updated_at=?,writer_id=?,lease_until=? WHERE id=?")
      .run(JSON.stringify(state), new Date().toISOString(), input.release ? null : input.writerId, input.release ? null : new Date(Date.now() + 15000).toISOString(), input.id);
    return fromRow(row(input.id, db)!);
  })();
}
export function endMockSession(input: { id: string; dataEpoch: string; expectedRevision: number }, db: Database.Database = getDatabase()) {
  ensureMockExamTables(db);
  return db.transaction(() => {
    const record = requireSession(input.id, input.dataEpoch, db);
    if (record.status === "active" && hasSubmission(record, db)) throw new DataIntegrityConflict("请先查询本次提交结果，不能丢弃正在处理的答卷。", "SUBMISSION_CONFLICT");
    if (record.status === "active" && record.writer_id && Date.parse(record.lease_until ?? "") > Date.now()) throw new DataIntegrityConflict("请先暂停当前编辑页面再结束本轮。", "WRITER_CONFLICT");
    if (record.revision !== input.expectedRevision) throw new DataIntegrityConflict("会话版本冲突。", "DRAFT_CONFLICT");
    db.prepare("UPDATE mock_exam_sessions SET status='ended',writer_id=NULL,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(), input.id);
  })();
}
export function frozenMockSubmission(input: { sessionId: string; submissionId: string; dataEpoch: string; writerId: string }, db: Database.Database = getDatabase()) {
  ensureMockExamTables(db); const record = requireSession(input.sessionId, input.dataEpoch, db);
  if (record.submission_id !== input.submissionId) throw new DataIntegrityConflict("提交身份不匹配。", "SUBMISSION_CONFLICT");
  const state = mockStateSchema.parse(JSON.parse(record.state_json));
  if (record.status !== "completed") requireWriter(record, input.writerId);
  if (state.stage !== "writing" || state.essay.trim().length < 40) throw new Error("请完成作文再提交整卷。");
  return { record, state, snapshot: JSON.parse(record.snapshot_json) as Snapshot };
}
export function completeMockSession(id: string, result: MockResult, db: Database.Database = getDatabase()) {
  db.prepare("UPDATE mock_exam_sessions SET status='completed',result_json=?,writer_id=NULL,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify(result), new Date().toISOString(), id);
}
