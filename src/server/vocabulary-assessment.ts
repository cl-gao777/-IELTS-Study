import "server-only";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assessmentBands, assessmentDraftSchema, evaluateVocabularyAssessment, validateAssessmentQuestions, type VocabularyAssessment, type VocabularyAssessmentQuestionSnapshot } from "@/lib/vocabulary-assessment";
import { isVocabularyCatalogEntryLearnable, vocabularyExerciseGap, type VocabularyCatalogEntry } from "@/lib/vocabulary-course";
import { getDatabase } from "./db";

export function ensureVocabularyAssessmentTables(database: Database.Database = getDatabase()) {
  database.exec(`CREATE TABLE IF NOT EXISTS vocabulary_assessments (
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, status TEXT NOT NULL, questions_json TEXT NOT NULL,
    draft_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT
  );`);
}
type AssessmentRow = { id: string; revision: number; status: "active" | "completed"; questions_json: string; draft_json: string; result_json: string | null; created_at: string; updated_at: string; submitted_at: string | null };
export class VocabularyAssessmentConflict extends Error { constructor() { super("测评已在其他页面或恢复后更新，请读取最新进度。"); } }
function publicAssessment(row: AssessmentRow): VocabularyAssessment {
  const questions = validateAssessmentQuestions(JSON.parse(row.questions_json));
  return { id: row.id, revision: row.revision, status: row.status,
    questions: questions.map(({ id, band, prompt, meaningZh }) => ({ id, band, prompt, meaningZh })),
    draft: assessmentDraftSchema.parse(JSON.parse(row.draft_json)), result: row.result_json ? JSON.parse(row.result_json) : null,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function latest(database: Database.Database) {
  // Snapshot row order is not a continuation token; an unfinished test takes precedence.
  return database.prepare("SELECT * FROM vocabulary_assessments ORDER BY (status='active') DESC,created_at DESC,updated_at DESC,id DESC LIMIT 1").get() as AssessmentRow | undefined;
}
export function readVocabularyAssessment(database: Database.Database = getDatabase()) {
  ensureVocabularyAssessmentTables(database); const row = latest(database); return row ? publicAssessment(row) : null;
}

export function buildVocabularyAssessmentQuestions(entries: VocabularyCatalogEntry[], random = Math.random) {
  const questions: VocabularyAssessmentQuestionSnapshot[] = [], used = new Set<string>();
  for (const band of assessmentBands) {
    const number = Number(band.slice(-1));
    const pool = entries.filter((entry) => isVocabularyCatalogEntryLearnable(entry) && !used.has(entry.id) && entry.courseIds.includes(band === "nawl" ? "academic" : "general")
      && (band === "nawl" || entry.rank >= (number - 1) * 500 + 1 && entry.rank <= (number === 5 ? 2809 : number * 500))
      && entry.exercises.some((exercise) => exercise.status === "published" && !exercise.sourceReference && exercise.meaningZh.trim()));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const count = band === "nawl" ? 10 : 4;
    if (pool.length < count) throw new Error(`${band} 的可用语境题不足 ${count} 道，请完成课程内容后再开始摸底。`);
    for (const entry of pool.slice(0, count)) {
      used.add(entry.id); const exercise = entry.exercises.find((item) => item.status === "published" && !item.sourceReference && item.meaningZh.trim())!;
      questions.push({ id: randomUUID(), band, entryId: entry.id, courseId: band === "nawl" ? "academic" : "general",
        prompt: vocabularyExerciseGap(exercise), meaningZh: exercise.meaningZh, sentence: exercise.sentence,
        targetStart: exercise.targetStart, targetEnd: exercise.targetEnd, targetSurface: exercise.targetSurface, acceptedAnswers: [...exercise.acceptedAnswers], source: exercise.source });
    }
  }
  return validateAssessmentQuestions(questions);
}

export function startVocabularyAssessment(entries: VocabularyCatalogEntry[], database: Database.Database = getDatabase(), now = new Date()) {
  ensureVocabularyAssessmentTables(database);
  return database.transaction(() => {
    const active = latest(database); if (active?.status === "active") return publicAssessment(active);
    const questions = buildVocabularyAssessmentQuestions(entries), id = randomUUID(), timestamp = now.toISOString();
    database.prepare("INSERT INTO vocabulary_assessments VALUES (?,1,'active',?,?,NULL,?,?,NULL)").run(id, JSON.stringify(questions), JSON.stringify({ answers: {}, currentIndex: 0 }), timestamp, timestamp);
    return publicAssessment(latest(database)!);
  })();
}
export function checkpointVocabularyAssessment(id: string, expectedRevision: number, draft: VocabularyAssessment["draft"], database: Database.Database = getDatabase(), now = new Date()) {
  ensureVocabularyAssessmentTables(database);
  return database.transaction(() => {
    const row = latest(database); if (!row || row.id !== id || row.status !== "active" || row.revision !== expectedRevision) throw new VocabularyAssessmentConflict();
    const parsed = assessmentDraftSchema.parse(draft), questions = validateAssessmentQuestions(JSON.parse(row.questions_json));
    if (Object.keys(parsed.answers).some((key) => !questions.some((question) => question.id === key))) throw new Error("测评包含未知题号。");
    database.prepare("UPDATE vocabulary_assessments SET revision=revision+1,draft_json=?,updated_at=? WHERE id=?").run(JSON.stringify(parsed), now.toISOString(), id);
    return publicAssessment(latest(database)!);
  })();
}
export function submitVocabularyAssessment(id: string, expectedRevision: number, database: Database.Database = getDatabase(), now = new Date()) {
  ensureVocabularyAssessmentTables(database);
  return database.transaction(() => {
    const row = latest(database); if (!row || row.id !== id) throw new VocabularyAssessmentConflict();
    if (row.status === "completed") return publicAssessment(row);
    if (row.revision !== expectedRevision) throw new VocabularyAssessmentConflict();
    const questions = validateAssessmentQuestions(JSON.parse(row.questions_json)), draft = assessmentDraftSchema.parse(JSON.parse(row.draft_json));
    const result = evaluateVocabularyAssessment(questions, draft.answers, now);
    database.prepare("UPDATE vocabulary_assessments SET revision=revision+1,status='completed',result_json=?,submitted_at=?,updated_at=? WHERE id=?").run(JSON.stringify(result), now.toISOString(), now.toISOString(), id);
    return publicAssessment(latest(database)!);
  })();
}
