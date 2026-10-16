import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDatabase } from "./db";
import { assertDataEpoch, DataIntegrityConflict, ensureDataIntegrityTables } from "./data-integrity";

export interface SubmissionInput { submissionId: string; kind: "practice" | "mock"; scopeId: string; dataEpoch: string; payload: unknown }
type Receipt = { id: string; kind: string; scope_id: string; data_epoch: string; request_hash: string; request_json: string;
  status: "processing" | "completed" | "failed"; result_json: string | null; lease_id: string | null;
  lease_until: string | null; owner_pid: number | null; error: string; updated_at: string };
export interface SubmissionClaim { status: "processing" | "completed"; acquired: boolean; leaseId?: string; result?: unknown }
const leaseMilliseconds = 120_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureSubmissionTables(database: Database.Database = getDatabase()) {
  ensureDataIntegrityTables(database);
  database.exec(`CREATE TABLE IF NOT EXISTS submission_receipts (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('practice','mock')), scope_id TEXT NOT NULL,
    data_epoch TEXT NOT NULL, request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')), result_json TEXT,
    lease_id TEXT, lease_until TEXT, owner_pid INTEGER, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    UNIQUE(kind,scope_id)
  )`);
}
export function canonicalSubmission(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSubmission).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => JSON.stringify(key) + ":" + canonicalSubmission((value as Record<string, unknown>)[key])).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function submissionHash(payload: unknown) { return createHash("sha256").update(canonicalSubmission(payload)).digest("hex"); }
function read(id: string, database: Database.Database) { return database.prepare("SELECT * FROM submission_receipts WHERE id=?").get(id) as Receipt | undefined; }
function ownerAlive(pid: number | null) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function checkInput(input: SubmissionInput, database: Database.Database) {
  assertDataEpoch(input.dataEpoch, database);
  if (!uuid.test(input.submissionId) || !input.scopeId || !["practice", "mock"].includes(input.kind))
    throw new DataIntegrityConflict("提交身份无效，请刷新后重试。", "REFRESH_REQUIRED");
  const row = read(input.submissionId, database);
  if (row && (row.kind !== input.kind || row.scope_id !== input.scopeId || row.request_hash !== submissionHash(input.payload)))
    throw new DataIntegrityConflict("本次提交内容与首次请求不同，请查询已保存结果。", "SUBMISSION_CONFLICT");
  const scoped = database.prepare("SELECT id FROM submission_receipts WHERE kind=? AND scope_id=?").get(input.kind, input.scopeId) as { id: string } | undefined;
  if (scoped && scoped.id !== input.submissionId) throw new DataIntegrityConflict("此答卷已有提交，请查询原提交结果。", "SUBMISSION_CONFLICT");
  return row;
}

/** A completed retry remains valid after its workspace starts another run. Never claims or creates a receipt. */
export function findCompletedSubmission(input: SubmissionInput, database: Database.Database = getDatabase()): { result: unknown } | null {
  assertDataEpoch(input.dataEpoch, database);
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='submission_receipts'").get();
  if (!table) return null;
  const row = checkInput(input, database);
  return row?.status === "completed" ? { result: JSON.parse(row.result_json!) as unknown } : null;
}

export function beginSubmission(input: SubmissionInput, database: Database.Database = getDatabase()): SubmissionClaim {
  ensureSubmissionTables(database);
  return database.transaction(() => {
    const row = checkInput(input, database);
    if (row?.status === "completed") return { status: "completed" as const, acquired: false, result: JSON.parse(row.result_json!) };
    if (row?.status === "processing" && Date.parse(row.lease_until ?? "") > Date.now() && ownerAlive(row.owner_pid))
      return { status: "processing" as const, acquired: false };
    const leaseId = randomUUID(), now = new Date().toISOString(), until = new Date(Date.now() + leaseMilliseconds).toISOString();
    database.prepare(`INSERT INTO submission_receipts(id,kind,scope_id,data_epoch,request_hash,request_json,status,lease_id,lease_until,owner_pid,updated_at)
      VALUES(?,?,?,?,?,?,'processing',?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='processing',lease_id=excluded.lease_id,
      lease_until=excluded.lease_until,owner_pid=excluded.owner_pid,error='',data_epoch=excluded.data_epoch,updated_at=excluded.updated_at`).run(
      input.submissionId, input.kind, input.scopeId, input.dataEpoch, submissionHash(input.payload), canonicalSubmission(input.payload), leaseId, until, process.pid, now);
    return { status: "processing" as const, acquired: true, leaseId };
  })();
}

export function renewSubmissionLease(id: string, leaseId: string, epoch: string, database: Database.Database = getDatabase()) {
  assertDataEpoch(epoch, database);
  return database.prepare("UPDATE submission_receipts SET lease_until=? WHERE id=? AND lease_id=? AND status='processing'")
    .run(new Date(Date.now() + leaseMilliseconds).toISOString(), id, leaseId).changes === 1;
}

/** All domain records and the receipt commit together; any callback failure rolls back everything. */
export function completeSubmission<T>(input: SubmissionInput, leaseId: string, action: () => T, database: Database.Database = getDatabase()): T {
  ensureSubmissionTables(database);
  return database.transaction(() => {
    const row = checkInput(input, database);
    if (row?.status === "completed") return JSON.parse(row.result_json!) as T;
    if (row?.status !== "processing" || row.lease_id !== leaseId) throw new DataIntegrityConflict("提交任务已由其他页面处理，请查询结果。", "SUBMISSION_CONFLICT");
    const result = action();
    database.prepare("UPDATE submission_receipts SET status='completed',result_json=?,lease_id=NULL,lease_until=NULL,owner_pid=NULL,error='',updated_at=? WHERE id=?")
      .run(JSON.stringify(result), new Date().toISOString(), input.submissionId);
    return result;
  })();
}

export function failSubmission(id: string, leaseId: string, epoch: string, message: string, database: Database.Database = getDatabase()) {
  assertDataEpoch(epoch, database);
  database.prepare("UPDATE submission_receipts SET status='failed',lease_id=NULL,lease_until=NULL,owner_pid=NULL,error=?,updated_at=? WHERE id=? AND lease_id=? AND status='processing'")
    .run(message.slice(0, 2000), new Date().toISOString(), id, leaseId);
}

export function lookupSubmission(id: string, epoch: string, database: Database.Database = getDatabase()) {
  ensureSubmissionTables(database); assertDataEpoch(epoch, database);
  const row = read(id, database);
  if (!row) return { status: "not-found" as const };
  const abandoned = row.status === "processing" && (Date.parse(row.lease_until ?? "") <= Date.now() || !ownerAlive(row.owner_pid));
  return { status: abandoned ? "failed" as const : row.status, submissionId: row.id,
    ...(row.status === "completed" ? { result: JSON.parse(row.result_json!) as unknown } : {}),
    ...(row.error ? { error: row.error } : {}) };
}
