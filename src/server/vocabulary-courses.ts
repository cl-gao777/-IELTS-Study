import "server-only";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { vocabularyCatalogEntrySchema, vocabularyCatalogSchema, vocabularyCourseSchema, vocabularyExerciseSnapshotSchema, isVocabularyCatalogEntryLearnable,
  type VocabularyCatalog, type VocabularyCatalogEntry, type VocabularyCourse, type VocabularyCoursesResponse,
  type VocabularyExerciseSnapshot, type VocabularyStudyState, type VocabularyStudyUpdate } from "@/lib/vocabulary-course";
import { normaliseVocabularyAnswer, vocabularyInputSchema, type VocabularyEntry } from "@/lib/vocabulary";
import { getDatabase } from "./db";
import { listVocabularyEntries, saveVocabularyEntry } from "./vocabulary";
import { studyDate } from "./preferences";
import { VocabularySessionConflict } from "./vocabulary-session-store";
import { readVocabularySession, writeVocabularySession } from "./vocabulary-session-store";
import { ensureVocabularyTargetTables, isVocabularyTargetSnapshotCurrent, isVocabularyTermPaused, vocabularyExerciseForTarget, readVocabularyTargetDefinitions, vocabularyTargetEligible, readVocabularyTargetState } from "./vocabulary-targets";
import type { VocabularyFocus } from "@/lib/vocabulary-target";

export function ensureVocabularyCourseTables(database: Database.Database = getDatabase()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary_courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      kind TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary_catalog_entries (id TEXT PRIMARY KEY, normalized_term TEXT NOT NULL UNIQUE,
      data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary_catalog_links (entry_id TEXT PRIMARY KEY REFERENCES vocabulary_catalog_entries(id) ON DELETE CASCADE,
      word_id TEXT REFERENCES vocabulary_words(id) ON DELETE CASCADE, detached INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vocabulary_review_context (review_id INTEGER PRIMARY KEY REFERENCES vocabulary_reviews(id) ON DELETE CASCADE,
      rating_source TEXT NOT NULL, exercise_json TEXT NOT NULL DEFAULT '{}', course_id TEXT);
    CREATE TABLE IF NOT EXISTS vocabulary_word_context (word_id TEXT PRIMARY KEY REFERENCES vocabulary_words(id) ON DELETE CASCADE,
      exercise_json TEXT NOT NULL, last_exercise_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS vocabulary_study_preferences (id INTEGER PRIMARY KEY CHECK(id=1), active_course_id TEXT,
      daily_goal_seconds INTEGER NOT NULL DEFAULT 900, paused INTEGER NOT NULL DEFAULT 0, start_rank INTEGER NOT NULL DEFAULT 1,
      restore_version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS vocabulary_study_heartbeats (id TEXT PRIMARY KEY, study_date TEXT NOT NULL,
      seconds INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary_study_time_segments (id TEXT PRIMARY KEY, restore_version INTEGER NOT NULL,
      study_date TEXT NOT NULL, seconds INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const preferencesColumns = database.prepare("PRAGMA table_info(vocabulary_study_preferences)").all() as { name: string }[];
  if (!preferencesColumns.some((column) => column.name === "restore_version")) {
    database.exec("ALTER TABLE vocabulary_study_preferences ADD COLUMN restore_version INTEGER NOT NULL DEFAULT 1");
  }
  for (const [column, definition] of [["focus", "TEXT NOT NULL DEFAULT 'general'"], ["next_level", "TEXT NOT NULL DEFAULT 'B2'"], ["policy_version", "INTEGER NOT NULL DEFAULT 1"], ["private_catalog_key", "TEXT"]]) {
    if (!preferencesColumns.some((item) => item.name === column)) database.exec(`ALTER TABLE vocabulary_study_preferences ADD COLUMN ${column} ${definition}`);
  }
  ensureVocabularyTargetTables(database);
}

/** Register content only. Importing a word never creates a card, schedule, or review. */
export function registerVocabularyCourse(courseInput: VocabularyCourse, entryInputs: readonly (Partial<VocabularyCatalogEntry> & { term: string })[], database = getDatabase(), replaceContent = false) {
  ensureVocabularyCourseTables(database);
  const course = vocabularyCourseSchema.parse(courseInput);
  return database.transaction(() => {
    const now = new Date().toISOString(); let addedEntries = 0; let existingEntries = 0;
    database.prepare(`INSERT INTO vocabulary_courses(id,title,description,kind,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,kind=excluded.kind,version=excluded.version,updated_at=excluded.updated_at
      WHERE title<>excluded.title OR description<>excluded.description OR kind<>excluded.kind OR version<>excluded.version`)
      .run(course.id, course.title, course.description, course.kind, course.version, now, now);
    for (const [index, input] of entryInputs.entries()) {
      const term = normaliseVocabularyAnswer(input.term);
      const row = database.prepare("SELECT id,data_json FROM vocabulary_catalog_entries WHERE normalized_term=?").get(term) as { id: string; data_json: string } | undefined;
      const saved = row ? vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json)) : null;
      const previousExercises = new Map(saved?.exercises.map((exercise) => [exercise.id, exercise]) ?? []);
      const exercises = (input.exercises ?? saved?.exercises ?? []).map((exercise) => {
        const previous = previousExercises.get(exercise.id);
        // Re-extraction cannot undo a user's review of a quoted sentence. A newer
        // local revision likewise takes precedence over an older bundled exercise.
        if (!previous) return exercise;
        if (previous.locallyReviewed || previous.sourceReference || previous.version > exercise.version) return previous;
        const content = (item: typeof exercise) => JSON.stringify({ ...item, version: undefined });
        return content(previous) === content(exercise) ? previous : { ...exercise, version: Math.max(previous.version + 1, exercise.version) };
      });
      const targets = (input.targets ?? []).map((incoming) => {
        const previous = saved?.targets?.find((target) => target.id === incoming.id);
        if (!previous) return incoming;
        const memberships = [...previous.memberships.filter((member) => !incoming.memberships.some((item) => item.courseId === member.courseId)), ...incoming.memberships.map((member) => {
          const prior = previous.memberships.find((item) => item.courseId === member.courseId);
          if (!prior) return member;
          if (prior.locallyReviewed || prior.version > member.version) return prior;
          const content = (item: typeof member) => JSON.stringify({ ...item, version: undefined });
          return content(prior) === content(member) ? member : { ...member, version: Math.max(prior.version + 1, member.version) };
        })];
        const content = (item: typeof incoming) => JSON.stringify({ ...item, version: undefined, memberships: undefined });
        const target = previous.locallyReviewed || previous.version > incoming.version ? previous : incoming;
        return { ...target, memberships, version: previous.locallyReviewed ? previous.version : Math.max(previous.version, incoming.version) + Number(content(previous) !== content(target) && incoming.version <= previous.version) };
      });
      const entry = vocabularyCatalogEntrySchema.parse({ rank: index + 1, ...saved, ...input,
        ...(saved && (!replaceContent || saved.locallyReviewed) ? saved : {}), id: saved?.id ?? input.id ?? `${course.id}:${term}`,
        ...(saved && replaceContent ? { version: saved.version, exercises: [
          ...exercises, ...saved.exercises.filter((exercise) => !exercises.some((incoming) => incoming.id === exercise.id))] } : {}),
        targets: [...(saved?.targets ?? []).filter((target) => !targets.some((incoming) => incoming.id === target.id)), ...targets],
        ...(input.targets?.length ? { exercises: [...(saved?.exercises ?? []).filter((exercise) => !exercises.some((incoming) => incoming.id === exercise.id)), ...exercises] } : {}),
        courseIds: [...new Set([...(saved?.courseIds ?? []), ...(input.courseIds ?? []), course.id])] });
      if (saved) {
        existingEntries++;
        const content = (item: VocabularyCatalogEntry) => JSON.stringify({ ...item, id: undefined, version: undefined, courseIds: undefined, rank: undefined });
        entry.version = saved.version + Number(content(saved) !== content(entry));
        if (JSON.stringify(saved) !== JSON.stringify(entry)) database.prepare("UPDATE vocabulary_catalog_entries SET data_json=?,updated_at=? WHERE id=?").run(JSON.stringify(entry), now, saved.id);
      } else {
        addedEntries++;
        database.prepare("INSERT INTO vocabulary_catalog_entries(id,normalized_term,data_json,created_at,updated_at) VALUES(?,?,?,?,?)").run(entry.id, term, JSON.stringify(entry), now, now);
      }
    }
    return { course, addedEntries, existingEntries };
  })();
}

let privateCatalogCache: { signature: string; catalog: VocabularyCatalog } | undefined;
/** The private package is authoritative only for its own course memberships. */
function retireMissingPrivateVocabularyTargets(courseId: string, inputs: VocabularyCatalogEntry[], database: Database.Database) {
  const desiredEntries = new Map(inputs.map((entry) => [normaliseVocabularyAnswer(entry.term), entry]));
  const desired = new Map(inputs.map((entry) => [normaliseVocabularyAnswer(entry.term), new Set((entry.targets ?? [])
    .filter((target) => target.memberships.some((membership) => membership.courseId === courseId)).map((target) => target.id))]));
  const rows = database.prepare("SELECT id,data_json FROM vocabulary_catalog_entries").all() as { id: string; data_json: string }[];
  for (const row of rows) {
    const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json));
    if (!entry.courseIds.includes(courseId)) continue;
    const expected = desired.get(normaliseVocabularyAnswer(entry.term));
    const targets = entry.targets.map((target) => {
      if (!target.memberships.some((membership) => membership.courseId === courseId) || expected?.has(target.id)) return target;
      const remaining = target.memberships.filter((membership) => membership.courseId !== courseId);
      if (remaining.length) return { ...target, memberships: remaining };
      return target.status === "draft" ? target : { ...target, status: "draft" as const, version: target.version + 1 };
    });
    // The target controls publication. Keep sentence revisions intact so course
    // retirement cannot overwrite a source review or prevent explicit republishing.
    const status = entry.courseIds.every((id) => id === courseId) ? desiredEntries.get(normaliseVocabularyAnswer(entry.term))?.status ?? "draft" as const : entry.status;
    const next = { ...entry, targets, status };
    if (JSON.stringify(next) !== JSON.stringify(entry)) database.prepare("UPDATE vocabulary_catalog_entries SET data_json=?,updated_at=? WHERE id=?")
      .run(JSON.stringify({ ...next, version: entry.version + 1 }), new Date().toISOString(), row.id);
  }
}
function privateVocabularyCourseIds(database: Database.Database): Set<string> {
  const row = database.prepare("SELECT private_catalog_key FROM vocabulary_study_preferences WHERE id=1").get() as { private_catalog_key: string | null } | undefined;
  return new Set((row?.private_catalog_key ?? "").split("|").filter(Boolean).map((part) => part.slice(0, part.lastIndexOf(":"))));
}
function isCurrentPrivateVocabularyMember(entry: VocabularyCatalogEntry, courseId: string, privateIds: Set<string>) {
  return !privateIds.has(courseId) || entry.status === "published" && entry.targets?.some((target) => target.status === "published"
    && target.memberships.some((membership) => membership.courseId === courseId));
}
/** Optional private package is persisted in SQLite; it never replaces public rank or personal data. */
export function loadPrivateVocabularyCatalog(database = getDatabase()) {
  ensureVocabularyCourseTables(database);
  if (process.env.NODE_ENV === "test" && !process.env.VOCABULARY_PRIVATE_CATALOG_PATH) return;
  const filename = process.env.VOCABULARY_PRIVATE_CATALOG_PATH ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data", "vocabulary-private-catalog.json");
  if (!existsSync(/* turbopackIgnore: true */ filename)) return;
  const stats = statSync(/* turbopackIgnore: true */ filename), signature = `${filename}:${stats.mtimeMs}:${stats.size}`;
  if (privateCatalogCache?.signature !== signature) privateCatalogCache = { signature, catalog: vocabularyCatalogSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ filename, "utf8"))) };
  const catalog = privateCatalogCache.catalog, key = catalog.courses.map((course) => `${course.id}:${course.version}`).sort().join("|");
  database.transaction(() => {
    const state = database.prepare("SELECT private_catalog_key FROM vocabulary_study_preferences WHERE id=1").get() as { private_catalog_key: string | null } | undefined;
    for (const course of catalog.courses) {
      const saved = database.prepare("SELECT version FROM vocabulary_courses WHERE id=?").get(course.id) as { version: number } | undefined;
      if (!saved || saved.version < course.version) {
        const incoming = catalog.entries.filter((entry) => entry.courseIds.includes(course.id));
        retireMissingPrivateVocabularyTargets(course.id, incoming, database);
        // Publication versions introduced by withdrawal cannot permanently prevent
        // the authoritative package from explicitly publishing a reviewed target again.
        const previous = new Map(readVocabularyTargetDefinitions(database).map(({ target }) => [target.id, target]));
        registerVocabularyCourse(course, incoming.map((entry) => ({ ...entry, targets: entry.targets.map((target) => {
          const prior = previous.get(target.id);
          return prior?.status === "draft" && target.status === "published"
            ? { ...target, version: Math.max(prior.version + 1, target.version) } : target;
        }) })), database);
      }
    }
    if (state?.private_catalog_key === key) return;
    // A content-version update must not override a course or focus the user
    // selected after the package's first activation.
    if (state?.private_catalog_key) {
      database.prepare("UPDATE vocabulary_study_preferences SET private_catalog_key=? WHERE id=1").run(key);
      return;
    }
    const course = catalog.courses[0]; if (!course) return;
    database.prepare(`INSERT INTO vocabulary_study_preferences(id,active_course_id,focus,next_level,policy_version,private_catalog_key) VALUES(1,?,'ielts-advanced','B2',2,?)
      ON CONFLICT(id) DO UPDATE SET active_course_id=excluded.active_course_id,focus='ielts-advanced',start_rank=1,policy_version=policy_version+1,private_catalog_key=excluded.private_catalog_key`).run(course.id, key);
    const session = readVocabularySession(database);
    if (session?.status === "active") writeVocabularySession(database, { ...session, status: "ended", revision: session.revision + 1 }, new Date());
  })();
}

let catalogCache: { signature: string; catalog: VocabularyCatalog } | undefined;
export function loadVocabularyCatalog(database = getDatabase()) {
  ensureVocabularyCourseTables(database);
  const filename = path.join(/* turbopackIgnore: true */ process.cwd(), "src", "data", "vocabulary-catalog.json");
  if (!existsSync(/* turbopackIgnore: true */ filename)) { loadPrivateVocabularyCatalog(database); return; }
  const stats = statSync(/* turbopackIgnore: true */ filename); const signature = `${filename}:${stats.mtimeMs}:${stats.size}`;
  if (catalogCache?.signature !== signature) catalogCache = { signature, catalog: vocabularyCatalogSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ filename, "utf8"))) };
  const catalog = catalogCache.catalog;
  database.transaction(() => {
    for (const course of catalog.courses) {
      const saved = database.prepare("SELECT version FROM vocabulary_courses WHERE id=?").get(course.id) as { version: number } | undefined;
      const desired = catalog.entries.filter((entry) => entry.courseIds.includes(course.id));
      if (!saved || saved.version < course.version) registerVocabularyCourse(course, desired, database, true);
      else {
        // A restored or partially staged catalog can have the current course version
        // but omit members. Fill membership without replacing locally reviewed content.
        const present = new Map((database.prepare("SELECT normalized_term,data_json FROM vocabulary_catalog_entries").all() as { normalized_term: string; data_json: string }[])
          .map((row) => [row.normalized_term, JSON.parse(row.data_json).courseIds as string[]]));
        const missing = desired.filter((entry) => !present.get(normaliseVocabularyAnswer(entry.term))?.includes(course.id));
        if (missing.length) registerVocabularyCourse(course, missing, database);
      }
    }
  })();
  loadPrivateVocabularyCatalog(database);
}

export function listVocabularyCatalogEntries(courseId?: string, database = getDatabase()): VocabularyCatalogEntry[] {
  ensureVocabularyCourseTables(database);
  const privateIds = privateVocabularyCourseIds(database);
  return (database.prepare("SELECT data_json FROM vocabulary_catalog_entries ORDER BY id").all() as { data_json: string }[])
    .map((row) => vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json)))
    .filter((entry) => !courseId || entry.courseIds.includes(courseId) && isCurrentPrivateVocabularyMember(entry, courseId, privateIds)).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

export function getVocabularyStudy(now = new Date(), database = getDatabase()): VocabularyStudyState {
  ensureVocabularyCourseTables(database);
  const row = database.prepare("SELECT * FROM vocabulary_study_preferences WHERE id=1").get() as { active_course_id: string | null; daily_goal_seconds: number; paused: number; start_rank: number; restore_version: number; focus: VocabularyFocus; policy_version: number; next_level: "B2" | "C1" } | undefined;
  const hasSessions = database.prepare("SELECT 1 FROM sqlite_master WHERE name='study_sessions'").get();
  const seconds = hasSessions ? (database.prepare("SELECT COALESCE(SUM(duration_seconds),0) AS total FROM study_sessions WHERE study_date=? AND area='Vocabulary'").get(studyDate(now)) as { total: number }).total : 0;
  const activeCourseTitle = (database.prepare("SELECT title FROM vocabulary_courses WHERE id=?").get(row ? row.active_course_id : "academic") as { title: string } | undefined)?.title ?? null;
  return { activeCourseId: row ? row.active_course_id : "academic", dailyGoalSeconds: row?.daily_goal_seconds ?? 900,
    paused: Boolean(row?.paused), startRank: row?.start_rank ?? 1, todaySeconds: seconds, restoreVersion: row?.restore_version ?? 1,
    focus: row?.focus ?? "general", policyVersion: row?.policy_version ?? 1, nextLevel: row?.next_level ?? "B2", activeCourseTitle };
}

export class VocabularyStudyConflict extends Error {
  constructor(public readonly study: VocabularyStudyState) {
    super("学习数据已恢复，请刷新后继续计时或修改设置。"); this.name = "VocabularyStudyConflict";
  }
}

export function requireVocabularyStudyVersion(restoreVersion: number | undefined, now = new Date(), database = getDatabase()) {
  const study = getVocabularyStudy(now, database);
  if (restoreVersion !== undefined && restoreVersion !== study.restoreVersion) throw new VocabularyStudyConflict(study);
  return study;
}

export function saveVocabularyStudy(input: VocabularyStudyUpdate, now = new Date(), database = getDatabase()) {
  ensureVocabularyCourseTables(database);
  return database.transaction(() => {
    // Check before even looking up a heartbeat: the same ID may have been removed
    // by restore, and stale goal/pause writes must not replace the restored state.
    const current = requireVocabularyStudyVersion(input.restoreVersion, now, database);
    const goal = input.dailyGoalSeconds ?? current.dailyGoalSeconds;
    const paused = input.paused ?? current.paused;
    const focus = input.focus ?? current.focus ?? "general";
    database.prepare(`INSERT INTO vocabulary_study_preferences(id,active_course_id,daily_goal_seconds,paused,start_rank,focus) VALUES(1,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET daily_goal_seconds=excluded.daily_goal_seconds,paused=excluded.paused,focus=excluded.focus,
      policy_version=policy_version+CASE WHEN focus<>excluded.focus THEN 1 ELSE 0 END`)
      .run(current.activeCourseId, goal, Number(paused), current.startRank, focus);
    if (input.heartbeat) {
      database.exec(`CREATE TABLE IF NOT EXISTS study_sessions(id TEXT PRIMARY KEY,study_date TEXT NOT NULL,area TEXT NOT NULL,duration_seconds INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`);
      // The client counts only focused, visible, unpaused seconds. The durable ID makes
      // an offline packet safe to retry, including after pausing or ending the round.
      const previous = database.prepare("SELECT seconds,study_date FROM vocabulary_study_time_segments WHERE id=?").get(input.heartbeat.id) as { seconds: number; study_date: string } | undefined;
      // Old heartbeat IDs already contributed to study_sessions. They establish
      // the baseline when an offline pre-upgrade packet is replayed.
      const legacy = database.prepare("SELECT seconds,study_date FROM vocabulary_study_heartbeats WHERE id=?").get(input.heartbeat.id) as { seconds: number; study_date: string } | undefined;
      const date = previous?.study_date ?? legacy?.study_date ?? studyDate(now); const id = `vocabulary-active:${date}`;
      const total = Math.min(15, Math.max(0, input.heartbeat.seconds));
      const credited = Math.max(0, total - (previous?.seconds ?? legacy?.seconds ?? 0));
      database.prepare(`INSERT INTO vocabulary_study_time_segments(id,restore_version,study_date,seconds,created_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET seconds=MAX(seconds,excluded.seconds),updated_at=excluded.updated_at`)
        .run(input.heartbeat.id, current.restoreVersion, date, Math.max(total, previous?.seconds ?? legacy?.seconds ?? 0), now.toISOString(), now.toISOString());
      database.prepare("INSERT OR IGNORE INTO vocabulary_study_heartbeats(id,study_date,seconds,created_at) VALUES(?,?,?,?)").run(input.heartbeat.id, date, total, now.toISOString());
      database.prepare(`INSERT INTO study_sessions(id,study_date,area,duration_seconds,updated_at) VALUES(?,?,'Vocabulary',?,?)
        ON CONFLICT(id) DO UPDATE SET duration_seconds=duration_seconds+excluded.duration_seconds,updated_at=excluded.updated_at`).run(id, date, credited, now.toISOString());
    }
    return getVocabularyStudy(now, database);
  })();
}

export function selectVocabularyCourse(courseId: string | null, startRank = 1, database = getDatabase(), restoreVersion?: number) {
  const current = requireVocabularyStudyVersion(restoreVersion, new Date(), database);
  loadVocabularyCatalog(database);
  if (courseId && !database.prepare("SELECT 1 FROM vocabulary_courses WHERE id=?").get(courseId)) throw new VocabularySessionConflict("课程已不存在，请刷新课程列表。");
  database.prepare(`INSERT INTO vocabulary_study_preferences(id,active_course_id,daily_goal_seconds,paused,start_rank) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET active_course_id=excluded.active_course_id,start_rank=excluded.start_rank`)
    .run(courseId, current.dailyGoalSeconds, Number(current.paused), startRank);
  if (courseId !== current.activeCourseId || startRank !== current.startRank) {
    const session = readVocabularySession(database);
    if (session?.status === "active") writeVocabularySession(database, { ...session, revision: session.revision + 1, status: "ended" }, new Date());
  }
  return getVocabularyCourses({}, database);
}

export function getVocabularyCourses(options: { query?: string; page?: number; pageSize?: number } = {}, database = getDatabase()): VocabularyCoursesResponse {
  loadVocabularyCatalog(database);
  const entries = listVocabularyCatalogEntries(undefined, database);
  const words = listVocabularyEntries(); const byWord = new Map(words.map((word) => [word.id, word]));
  const links = database.prepare("SELECT entry_id,word_id FROM vocabulary_catalog_links WHERE detached=0").all() as { entry_id: string; word_id: string }[];
  const byEntry = new Map(links.map((link) => [link.entry_id, byWord.get(link.word_id)]));
  // Existing personal words also share progress before their first course selection.
  const byTerm = new Map(words.map((word) => [normaliseVocabularyAnswer(word.term), word]));
  const query = (options.query ?? "").trim().toLocaleLowerCase(); const now = Date.now();
  const privateIds = privateVocabularyCourseIds(database);
  const courses = (database.prepare("SELECT * FROM vocabulary_courses ORDER BY kind,id").all() as Array<Record<string, string | number>>)
    .map((row) => {
      const course = vocabularyCourseSchema.parse(row); const members = entries.filter((entry) => entry.courseIds.includes(course.id) && isCurrentPrivateVocabularyMember(entry, course.id, privateIds));
      const progress = members.map((entry) => {
        const linked = byEntry.get(entry.id); const normalized = normaliseVocabularyAnswer(entry.term);
        return linked && normaliseVocabularyAnswer(linked.term) === normalized ? linked : byTerm.get(normalized);
      }).filter((word): word is VocabularyEntry => Boolean(word && (word.learningStartedAt || word.hasReviewHistory || word.repetitions > 0)));
      const ready = members.filter(isVocabularyCatalogEntryLearnable).length;
      return { ...course, total: members.length, ready, pending: members.length - ready, learned: progress.length, due: progress.filter((word) => Date.parse(word.dueAt) <= now).length };
    }).filter((course) => !query || `${course.title} ${course.description}`.toLocaleLowerCase().includes(query));
  const page = Math.max(1, options.page ?? 1); const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 20));
  const settings = getVocabularyStudy(new Date(), database);
  return { courses: courses.slice((page - 1) * pageSize, page * pageSize), activeCourseId: settings.activeCourseId, startRank: settings.startRank, total: courses.length, page, pageSize };
}

export function materializeVocabularyCatalogEntry(entry: VocabularyCatalogEntry, database = getDatabase()): VocabularyEntry | null {
  if (!isVocabularyCatalogEntryLearnable(entry)) return null;
  const link = database.prepare("SELECT word_id,detached FROM vocabulary_catalog_links WHERE entry_id=?").get(entry.id) as { word_id: string | null; detached: number } | undefined;
  if (link?.detached) return null;
  if (link?.word_id) return listVocabularyEntries().find((word) => word.id === link.word_id && normaliseVocabularyAnswer(word.term) === normaliseVocabularyAnswer(entry.term)) ?? null;
  const existing = listVocabularyEntries().find((word) => normaliseVocabularyAnswer(word.term) === normaliseVocabularyAnswer(entry.term));
  const result = existing ? { word: existing } : saveVocabularyEntry(vocabularyInputSchema.parse(entry))!;
  database.prepare("INSERT INTO vocabulary_catalog_links(entry_id,word_id,detached) VALUES(?,?,0) ON CONFLICT(entry_id) DO UPDATE SET word_id=excluded.word_id,detached=0").run(entry.id, result.word.id);
  return result.word;
}

/** Rematch a renamed card without taking another personal card's catalog identity. */
export function rematchVocabularyCatalogWord(wordId: string, term: string, database = getDatabase()) {
  database.prepare("UPDATE vocabulary_catalog_links SET detached=1 WHERE word_id=?").run(wordId);
  database.prepare("DELETE FROM vocabulary_word_context WHERE word_id=?").run(wordId);
  database.prepare("UPDATE vocabulary_target_state SET word_id=NULL,version=version+1 WHERE word_id=?").run(wordId);
  const entry = database.prepare("SELECT id FROM vocabulary_catalog_entries WHERE normalized_term=?").get(normaliseVocabularyAnswer(term)) as { id: string } | undefined;
  if (!entry) return;
  database.prepare(`INSERT INTO vocabulary_catalog_links(entry_id,word_id,detached) VALUES(?,?,0)
    ON CONFLICT(entry_id) DO UPDATE SET word_id=excluded.word_id,detached=0
    WHERE vocabulary_catalog_links.word_id IS NULL OR vocabulary_catalog_links.word_id=excluded.word_id`).run(entry.id, wordId);
}

function vocabularyExercisesForWord(word: VocabularyEntry, courseId: string | null, database: Database.Database): VocabularyExerciseSnapshot[] {
  if (isVocabularyTermPaused(word.term, database)) return [];
  const focus = getVocabularyStudy(new Date(), database).focus ?? "general";
  const targets = readVocabularyTargetDefinitions(database).filter(({ entry, target }) => normaliseVocabularyAnswer(entry.term) === normaliseVocabularyAnswer(word.term)
    && vocabularyTargetEligible(entry, target, focus, database) && (focus === "ielts-advanced" || target.memberships.some((member) => member.courseId === courseId)
      || readVocabularyTargetState(target.id, normaliseVocabularyAnswer(word.term), database).introducedAt));
  if (targets.length) return targets.flatMap(({ entry, target }) => {
    const first = vocabularyExerciseForTarget(entry, target, courseId, database, word.id);
    const second = first ? vocabularyExerciseForTarget(entry, target, courseId, database, word.id, first.id) : null;
    return [first, second].filter((exercise): exercise is VocabularyExerciseSnapshot => Boolean(exercise));
  });
  if (focus === "ielts-advanced") return [];
  const link = database.prepare(`SELECT e.data_json FROM vocabulary_catalog_links l JOIN vocabulary_catalog_entries e ON e.id=l.entry_id
    WHERE l.word_id=? AND l.detached=0 AND e.normalized_term=?`).get(word.id, normaliseVocabularyAnswer(word.term)) as { data_json: string } | undefined;
  if (link) {
    const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(link.data_json));
    const published = entry.status === "published" ? entry.exercises.filter((item) => item.status === "published" && !item.targetId) : [];
    const passage = courseId?.startsWith("reading:") ? published.filter((item) => item.sourceReference && courseId.endsWith(item.sourceReference.passageId)) : [];
    const candidates = passage.length ? passage : published.filter((item) => !item.sourceReference);
    if (candidates.length) return candidates.map((exercise) => ({ ...exercise, entryId: entry.id,
      courseId: courseId && entry.courseIds.includes(courseId) ? courseId : entry.courseIds[0] }));
  }
  const candidates: VocabularyExerciseSnapshot[] = [];
  for (const [index, sentence] of [word.sourceSentence, word.example].entries()) {
    if (candidates.some((exercise) => exercise.sentence === sentence)) continue;
    const escaped = word.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i").exec(sentence);
    if (match) candidates.push({ id: `personal:${word.id}:${word.reviewVersion}${index ? ":example" : ""}`, version: word.reviewVersion,
      status: "published", entryId: null, courseId: null, sentence, targetStart: match.index, targetEnd: match.index + match[0].length,
      targetSurface: match[0], acceptedAnswers: [match[0]], meaningZh: word.meaningZh, source: word.sourceMaterial });
  }
  return candidates;
}

export function supplementalVocabularyExerciseForWord(word: VocabularyEntry, current: VocabularyExerciseSnapshot | null,
  courseId: string | null, database = getDatabase()): VocabularyExerciseSnapshot | null {
  if (!current) return null;
  if (current.target) {
    const state = readVocabularyTargetState(current.target.id, current.target.normalizedTerm, database);
    if (!state.introducedAt || state.paused || [1, 2].includes(state.step)) return null;
    const definition = readVocabularyTargetDefinitions(database).find(({ target }) => target.id === current.target!.id);
    if (!definition || !vocabularyTargetEligible(definition.entry, definition.target, getVocabularyStudy(new Date(), database).focus ?? "general", database)) return null;
    const exercise = vocabularyExerciseForTarget(definition.entry, definition.target, current.courseId, database, word.id, current.id);
    return exercise && exercise.sentence !== current.sentence ? { ...exercise, purpose: "supplemental" } : null;
  }
  return vocabularyExercisesForWord(word, courseId, database).find((exercise) => exercise.id !== current.id && exercise.sentence !== current.sentence) ?? null;
}

export function vocabularyExerciseForWord(word: VocabularyEntry, courseId: string | null, database = getDatabase()): VocabularyExerciseSnapshot | null {
  const saved = database.prepare("SELECT exercise_json,last_exercise_id FROM vocabulary_word_context WHERE word_id=?").get(word.id) as { exercise_json: string; last_exercise_id: string } | undefined;
  if (saved && !word.hasReviewHistory) {
    const parsed = vocabularyExerciseSnapshotSchema.safeParse(JSON.parse(saved.exercise_json));
    if (parsed.success && (!parsed.data.target || parsed.data.courseId === courseId) && isVocabularyExerciseCurrent(parsed.data, database)) return parsed.data;
  }
  const candidates = vocabularyExercisesForWord(word, courseId, database);
  const previousIndex = candidates.findIndex((item) => item.id === saved?.last_exercise_id);
  return candidates[(previousIndex + 1) % candidates.length] ?? null;
}

/** History keeps its snapshot; a new submission must still refer to a published current exercise. */
export function isVocabularyExerciseCurrent(exercise: VocabularyExerciseSnapshot | null, database = getDatabase()): boolean {
  if (!exercise) return true;
  if (exercise.target && !isVocabularyTargetSnapshotCurrent(exercise.target, database, getVocabularyStudy(new Date(), database).focus ?? "general")) return false;
  if (exercise.status !== "published") return false;
  if (!exercise.entryId) return true;
  const row = database.prepare("SELECT data_json FROM vocabulary_catalog_entries WHERE id=?").get(exercise.entryId) as { data_json: string } | undefined;
  if (!row) return false;
  const entry = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json));
  return entry.status === "published" && entry.exercises.some((current) => current.id === exercise.id && current.version === exercise.version && current.status === "published");
}

export function rememberVocabularyExercise(wordId: string, exercise: VocabularyExerciseSnapshot | null | undefined, database = getDatabase()) {
  if (!exercise) return;
  database.prepare(`INSERT INTO vocabulary_word_context(word_id,exercise_json,last_exercise_id) VALUES(?,?,?)
    ON CONFLICT(word_id) DO UPDATE SET exercise_json=excluded.exercise_json,last_exercise_id=excluded.last_exercise_id`).run(wordId, JSON.stringify(exercise), exercise.id);
}
