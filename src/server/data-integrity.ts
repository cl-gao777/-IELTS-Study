import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDatabase } from "./db";

export class DataIntegrityConflict extends Error {
  readonly status = 409;
  constructor(message = "数据已恢复，请先导出未保存内容，再刷新页面。", readonly code = "DATA_RESTORED") { super(message); }
}

export function ensureDataIntegrityTables(database: Database.Database = getDatabase()) {
  database.exec(`CREATE TABLE IF NOT EXISTS app_data_state (
    id INTEGER PRIMARY KEY CHECK(id=1), data_epoch TEXT NOT NULL
  )`);
  database.prepare("INSERT OR IGNORE INTO app_data_state(id,data_epoch) VALUES(1,?)").run(randomUUID());
}

export function getDataEpoch(database: Database.Database = getDatabase()): string {
  ensureDataIntegrityTables(database);
  return (database.prepare("SELECT data_epoch FROM app_data_state WHERE id=1").get() as { data_epoch: string }).data_epoch;
}

export function assertDataEpoch(epoch: unknown, database: Database.Database = getDatabase()) {
  if (typeof epoch !== "string" || !epoch) throw new DataIntegrityConflict("页面协议已更新，请保留未保存内容并刷新。", "REFRESH_REQUIRED");
  if (epoch !== getDataEpoch(database)) throw new DataIntegrityConflict();
}

/** Called inside the successful restore transaction, never before replacement. */
export function rotateDataEpoch(database: Database.Database = getDatabase()) {
  ensureDataIntegrityTables(database);
  const epoch = randomUUID();
  database.prepare("UPDATE app_data_state SET data_epoch=? WHERE id=1").run(epoch);
  return epoch;
}

export function dataConflictResponse(error: unknown) {
  return error instanceof DataIntegrityConflict
    ? Response.json({ error: error.message, code: error.code }, { status: error.status })
    : null;
}
