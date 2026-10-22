import type Database from "better-sqlite3";
import { normaliseVocabularyAnswer } from "@/lib/vocabulary";

/** Optional additive source; ordinary vocabulary pages never install or enroll a course. */
export function morphologySelectedTargetRanks(database: Database.Database): Map<string, number> {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='morphology_selected_targets'").get()) return new Map();
  const rows = database.prepare(`SELECT s.target_id,s.normalized_term,w.term FROM morphology_selected_targets s
    JOIN vocabulary_words w ON w.id=s.word_id ORDER BY s.created_at,s.target_id`).all() as { target_id: string; normalized_term: string; term: string }[];
  return new Map(rows.filter(row => normaliseVocabularyAnswer(row.term) === row.normalized_term).map((row, index) => [row.target_id, index + 1]));
}
