import "server-only";
import type Database from "better-sqlite3";
import { vocabularySessionStateSchema, type VocabularySession } from "@/lib/vocabulary-session";

type SessionRow = { id: string; revision: number; status: "active" | "ended"; state_json: string; started_at: string; updated_at: string };
export function ensureVocabularySessionTables(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS vocabulary_sessions (
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL,
    state_json TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
}
export function readVocabularySession(database: Database.Database, id?: string): VocabularySession | null {
  const row = (id
    ? database.prepare("SELECT * FROM vocabulary_sessions WHERE id = ?").get(id)
    : database.prepare("SELECT * FROM vocabulary_sessions ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC, started_at DESC, id ASC LIMIT 1").get()) as SessionRow | undefined;
  if (!row) return null;
  return { id: row.id, revision: row.revision, status: row.status,
    state: vocabularySessionStateSchema.parse(JSON.parse(row.state_json)), startedAt: row.started_at, updatedAt: row.updated_at };
}
export class VocabularySessionConflict extends Error {
  constructor(message = "本轮练习已在其他页面更新，请按最新进度继续。") { super(message); this.name = "VocabularySessionConflict"; }
}
export function requireVocabularySession(database: Database.Database, id: string, revision: number) {
  const session = readVocabularySession(database);
  if (!session || session.id !== id || session.status !== "active" || session.revision !== revision) throw new VocabularySessionConflict();
  return session;
}
export function writeVocabularySession(database: Database.Database, session: VocabularySession, now: Date) {
  const updated = { ...session, revision: session.revision + 1, updatedAt: now.toISOString() };
  database.prepare("UPDATE vocabulary_sessions SET revision = ?, status = ?, state_json = ?, updated_at = ? WHERE id = ?")
    .run(updated.revision, updated.status, JSON.stringify(updated.state), updated.updatedAt, updated.id);
  return updated;
}
/** Run inside restore: retain the backed-up draft, but invalidate every pre-restore client. */
export function refreshVocabularySessionRevisions(database: Database.Database, priorRevisions: ReadonlyMap<string, number>, now = new Date()) {
  const sessions = database.prepare("SELECT id, revision FROM vocabulary_sessions").all() as { id: string; revision: number }[];
  const update = database.prepare("UPDATE vocabulary_sessions SET revision = ?, updated_at = ? WHERE id = ?");
  // Reserve a two-revision jump for restore, distinguishable from one lost checkpoint acknowledgement.
  for (const session of sessions) update.run(Math.max(session.revision, priorRevisions.get(session.id) ?? 0) + 2, now.toISOString(), session.id);
}
