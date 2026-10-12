import "server-only";
import type Database from "better-sqlite3";
import { vocabularyCatalogEntrySchema, type VocabularyCatalogEntry, type VocabularyExerciseSnapshot } from "@/lib/vocabulary-course";
import { normaliseVocabularyAnswer, type VocabularyEntry } from "@/lib/vocabulary";
import { vocabularyDispositionOperationSchema, type VocabularyTarget, type VocabularyTargetSnapshot, type VocabularyTargetState, type VocabularyTermDisposition, type VocabularyFocus, type VocabularyTargetCounts, type VocabularyConsolidationSnapshot } from "@/lib/vocabulary-target";
import { getDatabase } from "./db";
import { VocabularySessionConflict, readVocabularySession, writeVocabularySession } from "./vocabulary-session-store";
import type { VocabularyCardDraft } from "@/lib/vocabulary-session";

export function ensureVocabularyTargetTables(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS vocabulary_target_state (
    target_id TEXT PRIMARY KEY, word_id TEXT REFERENCES vocabulary_words(id) ON DELETE SET NULL,
    normalized_term TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, paused INTEGER NOT NULL DEFAULT 0,
    introduced_at TEXT, step INTEGER NOT NULL DEFAULT 0, due_at TEXT, last_submission_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary_term_dispositions (
    normalized_term TEXT PRIMARY KEY, paused INTEGER NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary_target_operations (
    operation_id TEXT PRIMARY KEY, action TEXT NOT NULL, request_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
}
type TargetStateRow = { target_id: string; word_id: string | null; normalized_term: string; version: number; paused: number; introduced_at: string | null; step: 0 | 1 | 2 | 3; due_at: string | null; last_submission_id: string | null };
const publicState = (row: TargetStateRow): VocabularyTargetState => ({ targetId: row.target_id, wordId: row.word_id, normalizedTerm: row.normalized_term, version: row.version,
  paused: Boolean(row.paused), introducedAt: row.introduced_at, step: row.step, dueAt: row.due_at, lastSubmissionId: row.last_submission_id });
export function listVocabularyTargetStates(database = getDatabase()) {
  return (database.prepare("SELECT * FROM vocabulary_target_state ORDER BY target_id").all() as TargetStateRow[]).map(publicState);
}
export function listVocabularyTermDispositions(database = getDatabase()): VocabularyTermDisposition[] {
  return (database.prepare("SELECT * FROM vocabulary_term_dispositions ORDER BY normalized_term").all() as { normalized_term: string; paused: number; version: number }[])
    .map((row) => ({ normalizedTerm: row.normalized_term, paused: Boolean(row.paused), version: row.version }));
}
export function readVocabularyTargetState(targetId: string, normalizedTerm: string, database: Database.Database): VocabularyTargetState {
  const row = database.prepare("SELECT * FROM vocabulary_target_state WHERE target_id=?").get(targetId) as TargetStateRow | undefined;
  return row ? publicState(row) : { targetId, normalizedTerm, wordId: null, version: 0, paused: false, introducedAt: null, step: 0, dueAt: null, lastSubmissionId: null };
}
export function isVocabularyTermPaused(term: string, database: Database.Database): boolean {
  return Boolean((database.prepare("SELECT paused FROM vocabulary_term_dispositions WHERE normalized_term=?").get(normaliseVocabularyAnswer(term)) as { paused: number } | undefined)?.paused);
}
export function readVocabularyTargetDefinitions(database: Database.Database) {
  return (database.prepare("SELECT data_json FROM vocabulary_catalog_entries ORDER BY id").all() as { data_json: string }[])
    .flatMap((row) => { const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json)); return entry.targets.map((target) => ({ entry, target })); });
}
export function vocabularyTargetEligible(entry: VocabularyCatalogEntry, target: VocabularyTarget, focus: VocabularyFocus, database: Database.Database) {
  if (entry.status !== "published" || target.status !== "published" || isVocabularyTermPaused(entry.term, database)
    || readVocabularyTargetState(target.id, normaliseVocabularyAnswer(entry.term), database).paused) return false;
  if (focus === "ielts-advanced" && !["B2", "C1"].includes(target.level ?? "")) return false;
  return target.memberships.some((member) => new Set(entry.exercises.filter((exercise) => member.exerciseIds.includes(exercise.id)
    && exercise.targetId === target.id && exercise.status === "published").map((exercise) => normaliseVocabularyAnswer(exercise.sentence))).size >= 2);
}
export function hasActiveVocabularyConsolidation(wordId: string, database: Database.Database, excludingTargetId?: string) {
  const ids = new Set((database.prepare("SELECT target_id FROM vocabulary_target_state WHERE word_id=? AND step IN(1,2) AND paused=0").all(wordId) as { target_id: string }[])
    .map((row) => row.target_id).filter((id) => id !== excludingTargetId));
  if (!ids.size) return false;
  const preferences = database.prepare("SELECT focus FROM vocabulary_study_preferences WHERE id=1").get() as { focus: VocabularyFocus } | undefined;
  return readVocabularyTargetDefinitions(database).some(({ entry, target }) => ids.has(target.id)
    && vocabularyTargetEligible(entry, target, preferences?.focus ?? "general", database));
}
export function vocabularyTargetSnapshot(entry: VocabularyCatalogEntry, target: VocabularyTarget, courseId?: string | null): VocabularyTargetSnapshot | null {
  const member = target.memberships.find((item) => item.courseId === courseId) ?? target.memberships[0];
  if (!member) return null;
  const { memberships: _memberships, ...content } = target;
  void _memberships;
  return { ...content, entryId: entry.id, term: entry.term, normalizedTerm: normaliseVocabularyAnswer(entry.term), courseId: member.courseId, membershipVersion: member.version };
}
export function vocabularyExerciseForTarget(entry: VocabularyCatalogEntry, target: VocabularyTarget, courseId: string | null,
  database: Database.Database, wordId?: string, excludeId?: string): VocabularyExerciseSnapshot | null {
  const snapshot = vocabularyTargetSnapshot(entry, target, courseId); if (!snapshot) return null;
  const member = target.memberships.find((item) => item.courseId === snapshot.courseId)!;
  const candidates = entry.exercises.filter((exercise) => exercise.targetId === target.id && exercise.status === "published" && member.exerciseIds.includes(exercise.id));
  const previous = wordId ? database.prepare("SELECT last_exercise_id FROM vocabulary_word_context WHERE word_id=?").get(wordId) as { last_exercise_id: string } | undefined : undefined;
  const at = candidates.findIndex((item) => item.id === previous?.last_exercise_id);
  const ordered = [...candidates.slice(at + 1), ...candidates.slice(0, at + 1)];
  const exercise = ordered.find((item) => item.id !== excludeId); if (!exercise) return null;
  return { ...exercise, entryId: entry.id, courseId: snapshot.courseId, target: snapshot };
}
export function isVocabularyTargetSnapshotCurrent(snapshot: VocabularyTargetSnapshot, database: Database.Database, focus: VocabularyFocus) {
  const row = database.prepare("SELECT data_json FROM vocabulary_catalog_entries WHERE id=?").get(snapshot.entryId) as { data_json: string } | undefined;
  if (!row) return false;
  const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json)), target = entry.targets.find((item) => item.id === snapshot.id);
  if (!target || normaliseVocabularyAnswer(entry.term) !== snapshot.normalizedTerm || !vocabularyTargetEligible(entry, target, focus, database)) return false;
  const current = vocabularyTargetSnapshot(entry, target, snapshot.courseId);
  return Boolean(current && JSON.stringify(current) === JSON.stringify(snapshot));
}
export function isVocabularyTargetCardCurrent(card: VocabularyCardDraft, word: VocabularyEntry, database: Database.Database) {
  const preferences = database.prepare("SELECT focus,policy_version,restore_version FROM vocabulary_study_preferences WHERE id=1").get() as { focus: VocabularyFocus; policy_version: number; restore_version: number } | undefined;
  if (word.reviewVersion !== card.wordVersion || isVocabularyTermPaused(word.term, database)) return false;
  if (!card.target) return (preferences?.focus ?? "general") !== "ielts-advanced";
  if (card.target.normalizedTerm !== normaliseVocabularyAnswer(word.term) || card.restoreVersion !== (preferences?.restore_version ?? 1)
    || card.policyVersion !== (preferences?.policy_version ?? 1) || !isVocabularyTargetSnapshotCurrent(card.target, database, preferences?.focus ?? "general")) return false;
  const state = readVocabularyTargetState(card.target.id, card.target.normalizedTerm, database);
  const introducing = card.purpose === "learn-word" || card.purpose === "learn-target";
  if (!card.purpose || introducing && (card.phase !== "learn" || state.introducedAt) || !introducing && (!state.introducedAt || card.phase === "learn")) return false;
  if (["consolidation", "merged"].includes(card.purpose) !== Boolean(card.consolidation)
    || Boolean(card.supplemental) !== ["consolidation", "supplemental"].includes(card.purpose)) return false;
  if (state.version !== card.targetStateVersion || !card.exercise || JSON.stringify(card.exercise.target) !== JSON.stringify(card.target) || card.exercise.purpose !== card.purpose) return false;
  const definition = readVocabularyTargetDefinitions(database).find(({ target }) => target.id === card.target!.id);
  if (!definition?.target.memberships.some((member) => member.courseId === card.target!.courseId && member.version === card.target!.membershipVersion && member.exerciseIds.includes(card.exercise!.id))
    || card.exercise.targetId !== card.target.id) return false;
  if (card.consolidation && (state.wordId !== word.id || state.step !== card.consolidation.step || state.version !== card.consolidation.version || state.dueAt !== card.consolidation.dueAt
    || JSON.stringify(card.exercise.consolidation) !== JSON.stringify(card.consolidation))) return false;
  return true;
}
export function getVocabularyTargetCounts(focus: VocabularyFocus, now: Date, database: Database.Database): VocabularyTargetCounts {
  const definitions = readVocabularyTargetDefinitions(database), states = listVocabularyTargetStates(database);
  const pending = states.filter((state) => !state.paused && state.wordId && state.dueAt && definitions.some(({ entry, target }) => target.id === state.targetId && vocabularyTargetEligible(entry, target, focus, database)));
  return { eligibleTargets: definitions.filter(({ entry, target }) => vocabularyTargetEligible(entry, target, focus, database)).length,
    pausedTargets: states.filter((state) => state.paused).length, pausedTerms: listVocabularyTermDispositions(database).filter((state) => state.paused).length,
    introducedTargets: states.filter((state) => state.introducedAt).length, consolidationDue: pending.filter((state) => Date.parse(state.dueAt!) <= now.getTime()).length,
    nextConsolidationAt: pending.filter((state) => Date.parse(state.dueAt!) > now.getTime()).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0]?.dueAt ?? null };
}
export function readVocabularyTargetManagement(database = getDatabase(), courseId?: string | null) {
  const preference = database.prepare("SELECT restore_version,focus FROM vocabulary_study_preferences WHERE id=1").get() as { restore_version: number; focus: VocabularyFocus } | undefined;
  return { targets: readVocabularyTargetDefinitions(database).filter(({ target }) => !courseId || target.status === "published" && target.memberships.some((member) => member.courseId === courseId)).flatMap(({ entry, target }) => { const snapshot = vocabularyTargetSnapshot(entry, target, courseId); return snapshot ? [snapshot] : []; }),
    targetStates: listVocabularyTargetStates(database), termDispositions: listVocabularyTermDispositions(database), restoreVersion: preference?.restore_version ?? 1,
    targetCounts: getVocabularyTargetCounts(preference?.focus ?? "general", new Date(), database) };
}
export function recordVocabularyTargetOperation(operationId: string, action: string, input: unknown, now: Date, database: Database.Database) {
  const serialized = JSON.stringify(input), prior = database.prepare("SELECT request_json FROM vocabulary_target_operations WHERE operation_id=?").get(operationId) as { request_json: string } | undefined;
  if (prior && prior.request_json !== serialized) throw new VocabularySessionConflict("操作编号已用于另一操作，请同步后重试。");
  if (prior) return false;
  database.prepare("INSERT INTO vocabulary_target_operations(operation_id,action,request_json,created_at) VALUES(?,?,?,?)").run(operationId, action, serialized, now.toISOString());
  return true;
}
export function changeVocabularyTargetDisposition(input: unknown, database = getDatabase(), now = new Date()) {
  const operation = vocabularyDispositionOperationSchema.parse(input);
  return database.transaction(() => {
    const preference = database.prepare("SELECT restore_version FROM vocabulary_study_preferences WHERE id=1").get() as { restore_version: number } | undefined;
    if (operation.restoreVersion !== (preference?.restore_version ?? 1)) throw new VocabularySessionConflict("学习数据已恢复，请同步后重试。");
    if (!recordVocabularyTargetOperation(operation.operationId, operation.action, operation, now, database)) return readVocabularyTargetManagement(database);
    if (operation.action.endsWith("target")) {
      const definition = readVocabularyTargetDefinitions(database).find(({ target }) => target.id === operation.targetId);
      if (!definition || definition.target.version !== operation.targetVersion) throw new VocabularySessionConflict("用法已更新，请同步后重试。");
      const normalized = normaliseVocabularyAnswer(definition.entry.term), state = readVocabularyTargetState(definition.target.id, normalized, database);
      if (state.version !== operation.expectedStateVersion) throw new VocabularySessionConflict("用法状态已在其他页面变化，请同步后重试。");
      if (operation.action === "resume-target" && state.wordId && [1, 2].includes(state.step)
        && hasActiveVocabularyConsolidation(state.wordId, database, state.targetId))
        throw new VocabularySessionConflict("请先完成这个词正在巩固的用法，再恢复另一个用法。");
      database.prepare(`INSERT INTO vocabulary_target_state(target_id,normalized_term,version,paused,updated_at) VALUES(?,?,1,?,?)
        ON CONFLICT(target_id) DO UPDATE SET paused=excluded.paused,version=version+1,updated_at=excluded.updated_at`)
        .run(definition.target.id, normalized, Number(operation.action === "know-target"), now.toISOString());
    } else {
      const normalized = normaliseVocabularyAnswer(operation.term!);
      const state = database.prepare("SELECT version FROM vocabulary_term_dispositions WHERE normalized_term=?").get(normalized) as { version: number } | undefined;
      if ((state?.version ?? 0) !== operation.expectedStateVersion) throw new VocabularySessionConflict("单词暂停状态已在其他页面变化，请同步后重试。");
      database.prepare(`INSERT INTO vocabulary_term_dispositions(normalized_term,paused,version,updated_at) VALUES(?,?,1,?)
        ON CONFLICT(normalized_term) DO UPDATE SET paused=excluded.paused,version=version+1,updated_at=excluded.updated_at`).run(normalized, Number(operation.action === "pause-term"), now.toISOString());
    }
    const session = readVocabularySession(database);
    if (session?.status === "active" && session.state.current) writeVocabularySession(database, { ...session, revision: session.revision + 1, state: { ...session.state, current: null } }, now);
    return readVocabularyTargetManagement(database);
  })();
}
export function advanceVocabularyConsolidation(event: VocabularyConsolidationSnapshot, word: VocabularyEntry, success: boolean, submissionId: string, now: Date, database: Database.Database) {
  const state = readVocabularyTargetState(event.targetId, normaliseVocabularyAnswer(word.term), database);
  if (state.version !== event.version || state.wordId !== word.id || state.step !== event.step || state.dueAt !== event.dueAt || state.paused)
    throw new VocabularySessionConflict("用法巩固步骤已更新，请同步后继续。");
  const step = success ? event.step + 1 : event.step;
  const dueAt = step === 3 ? null : new Date(now.getTime() + (success ? 600_000 : 60_000)).toISOString();
  database.prepare("UPDATE vocabulary_target_state SET step=?,due_at=?,version=version+1,last_submission_id=?,updated_at=? WHERE target_id=? AND version=?")
    .run(step, dueAt, submissionId, now.toISOString(), event.targetId, event.version);
}
