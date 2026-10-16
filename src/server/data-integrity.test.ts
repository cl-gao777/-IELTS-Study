import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Use isolated database"); } }));
import { assertDataEpoch, getDataEpoch, rotateDataEpoch } from "./data-integrity";
import { beginSubmission, completeSubmission, failSubmission, lookupSubmission, type SubmissionInput } from "./submissions";
let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); db.exec("CREATE TABLE scores(id INTEGER PRIMARY KEY,value TEXT)"); });
afterEach(() => db.close());
const input = (): SubmissionInput => ({ submissionId: randomUUID(), scopeId: randomUUID(), kind: "practice", dataEpoch: getDataEpoch(db), payload: { answers: { r1: "answer" }, durationSeconds: 10 } });
describe("data epochs and durable submission receipts", () => {
  it("rejects old and missing epochs and rolls the new token back on failed restore", () => {
    const epoch = getDataEpoch(db); expect(() => assertDataEpoch(undefined, db)).toThrow("刷新");
    expect(() => db.transaction(() => { rotateDataEpoch(db); throw new Error("restore failed"); })()).toThrow();
    expect(getDataEpoch(db)).toBe(epoch); rotateDataEpoch(db); expect(() => assertDataEpoch(epoch, db)).toThrow("数据已恢复");
  });
  it("returns the first result after a lost response without duplicating domain rows", () => {
    const request = input(), first = beginSubmission(request, db);
    const result = completeSubmission(request, first.leaseId!, () => { db.prepare("INSERT INTO scores(value) VALUES('grade')").run(); return { id: 1 }; }, db);
    const retry = beginSubmission({ ...request, payload: { durationSeconds: 10, answers: { r1: "answer" } } }, db);
    expect(retry).toEqual({ status: "completed", acquired: false, result });
    expect(db.prepare("SELECT COUNT(*) AS n FROM scores").get()).toEqual({ n: 1 });
    expect(lookupSubmission(request.submissionId, request.dataEpoch, db)).toMatchObject({ status: "completed", result });
  });
  it("rejects changed answers and a different submission identity for the same run", () => {
    const request = input(); beginSubmission(request, db);
    expect(() => beginSubmission({ ...request, payload: { answers: {} } }, db)).toThrow("不同");
    expect(() => beginSubmission({ ...request, submissionId: randomUUID() }, db)).toThrow("已有提交");
    expect(beginSubmission(request, db)).toMatchObject({ status: "processing", acquired: false });
  });
  it("rolls back every score when completion fails and retries with the same ID", () => {
    const request = input(), first = beginSubmission(request, db);
    expect(() => completeSubmission(request, first.leaseId!, () => { db.prepare("INSERT INTO scores(value) VALUES('partial')").run(); throw new Error("injected"); }, db)).toThrow("injected");
    expect(db.prepare("SELECT COUNT(*) AS n FROM scores").get()).toEqual({ n: 0 });
    failSubmission(request.submissionId, first.leaseId!, request.dataEpoch, "retry", db);
    const retry = beginSubmission(request, db); expect(retry.acquired).toBe(true);
    expect(completeSubmission(request, retry.leaseId!, () => ({ ok: true }), db)).toEqual({ ok: true });
  });
  it("rejects an AI completion that crosses restoration", () => {
    const request = input(), first = beginSubmission(request, db); rotateDataEpoch(db);
    expect(() => completeSubmission(request, first.leaseId!, () => { db.prepare("INSERT INTO scores(value) VALUES('stale')").run(); return {}; }, db)).toThrow("数据已恢复");
    expect(db.prepare("SELECT COUNT(*) AS n FROM scores").get()).toEqual({ n: 0 });
  });
  it("takes over a persisted processing submission when its lease expires", () => {
    const request = input(), first = beginSubmission(request, db);
    db.prepare("UPDATE submission_receipts SET lease_until='2000-01-01T00:00:00.000Z'").run();
    expect(lookupSubmission(request.submissionId, request.dataEpoch, db).status).toBe("failed");
    const retry = beginSubmission(request, db); expect(retry.acquired).toBe(true); expect(retry.leaseId).not.toBe(first.leaseId);
    expect(() => completeSubmission(request, first.leaseId!, () => ({}), db)).toThrow("其他页面");
  });
});
