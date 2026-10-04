import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ database: null as Database.Database | null }));
vi.mock("./db", () => ({ getDatabase: () => holder.database! }));

import { vocabularyInputSchema } from "../lib/vocabulary";
import { ensureVocabularyTables, listVocabularyEntries, reviewVocabularyEntry, saveVocabularyEntry } from "./vocabulary";

describe("durable vocabulary workflow", () => {
  let directory: string;
  let filename: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ielts-vocabulary-test-"));
    filename = path.join(directory, "vocabulary.db");
    holder.database = new Database(filename);
    holder.database.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE vocabulary_words (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, pronunciation TEXT NOT NULL, part_of_speech TEXT NOT NULL, meaning_zh TEXT NOT NULL, definition_en TEXT NOT NULL, example TEXT NOT NULL, tags_json TEXT NOT NULL, repetitions INTEGER NOT NULL DEFAULT 0, interval_days INTEGER NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5, due_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE vocabulary_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, word_id TEXT NOT NULL REFERENCES vocabulary_words(id), rating TEXT NOT NULL, previous_due_at TEXT NOT NULL, next_due_at TEXT NOT NULL, reviewed_at TEXT NOT NULL);
      CREATE TABLE review_items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL, skill TEXT NOT NULL, prompt TEXT NOT NULL, answer TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', mistake_count INTEGER NOT NULL DEFAULT 1, reviewed_at TEXT NOT NULL DEFAULT '');`);
    ensureVocabularyTables();
  });
  afterEach(() => { holder.database?.close(); holder.database = null; rmSync(directory, { recursive: true, force: true }); });

  it("persists full card fields, returns camelCase, and preserves progress when editing", () => {
    const input = vocabularyInputSchema.parse({ term: "economy", meaningZh: "经济", definitionEn: "the economic system", ipa: "/ɪˈkɒnəmi/", sourceSentence: "The economy grew.", sourceMaterial: "My article", wordFamily: ["economic", "economist"], notes: "Different from economical" });
    const saved = saveVocabularyEntry(input)!.word;
    expect(saved.meaningZh).toBe("经济");
    expect(saved.dueAt).toBeTruthy();
    expect(saved.sourceMaterial).toBe("My article");
    const reviewed = reviewVocabularyEntry(saved.id, { rating: "easy", mode: "recognition", correct: null, userAnswer: "", durationSeconds: 10 })!;
    const edited = saveVocabularyEntry({ ...input, meaningZh: "经济体系" }, saved.id)!.word;
    expect(edited.dueAt).toBe(reviewed.dueAt);
    expect(edited.repetitions).toBe(reviewed.repetitions);
    holder.database!.close(); holder.database = new Database(filename);
    const restarted = listVocabularyEntries()[0];
    expect(restarted.meaningZh).toBe("经济体系");
    expect(restarted.wordFamily).toEqual(["economic", "economist"]);
    expect(restarted.dueAt).toBe(reviewed.dueAt);
  });

  it("deduplicates captures case-insensitively without overwriting existing definitions", () => {
    const first = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "Economy", meaningZh: "经济" }))!;
    const second = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "economy" }))!;
    expect(second.existing).toBe(true);
    expect(second.word.id).toBe(first.word.id);
    expect(second.word.meaningZh).toBe("经济");
    expect(listVocabularyEntries()).toHaveLength(1);
  });

  it("records wrong spelling, creates one Review Item, and increments repeat mistakes", () => {
    const word = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "economy", meaningZh: "经济" }))!.word;
    const input = { rating: "again" as const, mode: "spelling" as const, correct: false, userAnswer: "econmy", durationSeconds: 15 };
    reviewVocabularyEntry(word.id, input, new Date("2026-10-04T01:00:00.000Z"));
    reviewVocabularyEntry(word.id, input, new Date("2026-10-04T01:10:00.000Z"));
    const mistakes = holder.database!.prepare("SELECT * FROM review_items").all() as Array<{ mistake_count: number; category: string }>;
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]).toMatchObject({ mistake_count: 2, category: "Spelling" });
    expect(holder.database!.prepare("SELECT * FROM vocabulary_reviews").all()).toHaveLength(2);
    expect(holder.database!.prepare("SELECT mode, user_answer, correct FROM vocabulary_review_details LIMIT 1").get()).toEqual({ mode: "spelling", user_answer: "econmy", correct: 0 });
    expect(holder.database!.prepare("SELECT algorithm FROM vocabulary_scheduler_state").get()).toEqual({ algorithm: "fsrs" });
  });

  it("leaves legacy due dates intact until actual review and rebuilds missing FSRS state", () => {
    const word = saveVocabularyEntry(vocabularyInputSchema.parse({ term: "evidence" }))!.word;
    holder.database!.prepare("UPDATE vocabulary_words SET due_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(word.id);
    ensureVocabularyTables();
    expect(listVocabularyEntries()[0].dueAt).toBe("2030-01-01T00:00:00.000Z");
    const input = { rating: "good" as const, mode: "recognition" as const, correct: null, userAnswer: "", durationSeconds: 10 };
    reviewVocabularyEntry(word.id, input, new Date("2026-10-03T01:00:00.000Z"));
    holder.database!.prepare("DELETE FROM vocabulary_scheduler_state WHERE word_id = ?").run(word.id);
    const reviewed = reviewVocabularyEntry(word.id, input, new Date("2026-10-04T01:00:00.000Z"))!;
    expect(reviewed.repetitions).toBe(2);
  });
});
