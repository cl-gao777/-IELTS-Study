import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { seedPracticeSets, seedVocabulary } from "./seed-data";

const globalDatabase = globalThis as typeof globalThis & {
  istsDatabase?: Database.Database;
};

export function databasePath() {
  const configured = process.env.DATABASE_URL ?? "file:./data/ists.db";
  const filePath = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(/* turbopackIgnore: true */ process.cwd(), filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

export function migrate(database: Database.Database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT 'Aimer',
      target_band REAL NOT NULL DEFAULT 7.0,
      daily_minutes INTEGER NOT NULL DEFAULT 90,
      notion_database_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_tasks (
      id TEXT PRIMARY KEY,
      study_date TEXT NOT NULL,
      area TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      href TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_study_tasks_date
      ON study_tasks(study_date);

    CREATE TABLE IF NOT EXISTS vocabulary_words (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      pronunciation TEXT NOT NULL,
      part_of_speech TEXT NOT NULL,
      meaning_zh TEXT NOT NULL,
      definition_en TEXT NOT NULL,
      example TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      repetitions INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      due_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vocabulary_due
      ON vocabulary_words(due_at);

    CREATE TABLE IF NOT EXISTS vocabulary_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id TEXT NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      previous_due_at TEXT NOT NULL,
      next_due_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_sets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      instructions TEXT NOT NULL,
      passage TEXT NOT NULL,
      transcript TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id TEXT NOT NULL REFERENCES practice_sets(id),
      kind TEXT NOT NULL,
      raw_score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      band_score REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coach_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      correction TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS writing_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      essay TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      overall_band REAL NOT NULL,
      criteria_json TEXT NOT NULL,
      strengths_json TEXT NOT NULL,
      improvements_json TEXT NOT NULL,
      rewrite TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mock_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      reading_attempt_id INTEGER,
      listening_attempt_id INTEGER,
      writing_submission_id INTEGER,
      overall_band REAL NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS notion_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
  `);

  const practiceColumns = new Set((database.prepare("PRAGMA table_info(practice_sets)").all() as { name: string }[]).map((column) => column.name));
  if (!practiceColumns.has("resource_json")) database.exec("ALTER TABLE practice_sets ADD COLUMN resource_json TEXT NOT NULL DEFAULT '{}' ");
  const sourceColumns = new Set(
    (
      database.prepare("PRAGMA table_info(source_materials)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  for (const [name, definition] of [
    ["file_name", "TEXT NOT NULL DEFAULT ''"],
    ["mime_type", "TEXT NOT NULL DEFAULT ''"],
    ["file_path", "TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!sourceColumns.has(name)) {
      database.exec(
        `ALTER TABLE source_materials ADD COLUMN ${name} ${definition}`,
      );
    }
  }
}

function seed(database: Database.Database) {
  if (database.prepare("SELECT 1 FROM studio_migrations WHERE id='initial-seed'").get()) return;
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT OR IGNORE INTO settings
       (id, display_name, target_band, daily_minutes, notion_database_id, updated_at)
       VALUES (1, '学习者', 6.5, 60, '', ?)`,
    )
    .run(now);

  const insertWord = database.prepare(`
    INSERT OR IGNORE INTO vocabulary_words (
      id, term, pronunciation, part_of_speech, meaning_zh, definition_en,
      example, tags_json, repetitions, interval_days, ease_factor, due_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSet = database.prepare(`
    INSERT OR IGNORE INTO practice_sets (
      id, kind, title, subtitle, instructions, passage, transcript, audio_url,
      duration_minutes, questions_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.transaction(() => {
    for (const word of seedVocabulary) {
      insertWord.run(
        word.id,
        word.term,
        word.pronunciation,
        word.partOfSpeech,
        word.meaningZh,
        word.definitionEn,
        word.example,
        JSON.stringify(word.tags),
        word.repetitions,
        word.intervalDays,
        word.easeFactor,
        word.dueAt,
        now,
        now,
      );
    }

    for (const set of seedPracticeSets) {
      insertSet.run(
        set.id,
        set.kind,
        set.title,
        set.subtitle,
        set.instructions,
        set.passage,
        set.transcript,
        set.audioUrl,
        set.durationMinutes,
        JSON.stringify(set.questions),
        now,
      );
    }
    database.prepare("INSERT OR IGNORE INTO studio_migrations(id) VALUES ('initial-seed')").run();
  })();
}

export function getDatabase() {
  if (!globalDatabase.istsDatabase) {
    const database = new Database(databasePath());
    migrate(database);
    migrateStudio(database);
    seed(database);
    globalDatabase.istsDatabase = database;
  }

  return globalDatabase.istsDatabase;
}

function migrateStudio(database: Database.Database) {
  const columns = new Set((database.prepare('PRAGMA table_info(review_items)').all() as {name:string}[]).map(c => c.name));
  for (const [name, definition] of [['category', "TEXT NOT NULL DEFAULT ''"], ['mistake_count', 'INTEGER NOT NULL DEFAULT 1'], ['reviewed_at', "TEXT NOT NULL DEFAULT ''"]]) {
    if (!columns.has(name)) database.exec(`ALTER TABLE review_items ADD COLUMN ${name} ${definition}`);
  }
  database.exec(`CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY, study_date TEXT NOT NULL, area TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS studio_preferences (
    id INTEGER PRIMARY KEY CHECK(id=1), value_json TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS studio_migrations (id TEXT PRIMARY KEY);`);
}
