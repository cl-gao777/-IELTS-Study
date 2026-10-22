import "server-only";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDatabase } from "./db";
import { assertDataEpoch, DataIntegrityConflict } from "./data-integrity";
import { getMorphologyLesson } from "./morphology";
import { ensureVocabularyTables, saveVocabularyEntry } from "./vocabulary";
import { getVocabularyStudy, registerVocabularyCourse } from "./vocabulary-courses";
import { isVocabularyTermPaused, readVocabularyTargetState } from "./vocabulary-targets";
import { normaliseVocabularyAnswer, vocabularyInputSchema } from "@/lib/vocabulary";
import type { VocabularyCatalogEntry, VocabularyExercise } from "@/lib/vocabulary-course";

export const MORPHOLOGY_SELECTED_COURSE = "morphology-selected";
export const morphologyEnrollmentInputSchema = z.object({
  dataEpoch: z.string().min(1), operationId: z.uuid(), lessonId: z.string().min(1),
  lessonVersion: z.number().int().positive(), wordId: z.string().min(1),
}).strict();
export type MorphologyEnrollmentResult = { status: "added" | "existing" | "paused"; message: string; wordId: string; targetId: string };

export function ensureMorphologyEnrollmentTables(database = getDatabase()) {
  database.exec(`CREATE TABLE IF NOT EXISTS morphology_selected_targets (
    target_id TEXT PRIMARY KEY, word_id TEXT NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
    normalized_term TEXT NOT NULL, lesson_id TEXT NOT NULL, word_key TEXT NOT NULL, lesson_json TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS morphology_enrollment_operations (
    id TEXT PRIMARY KEY, data_epoch TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
}

/** Explicit enrollment creates content/linkage, never a grade, introduction or schedule. */
export function enrollMorphologyWord(raw: unknown, database: Database.Database = getDatabase()): MorphologyEnrollmentResult {
  const input = morphologyEnrollmentInputSchema.parse(raw);
  assertDataEpoch(input.dataEpoch, database);
  ensureVocabularyTables(database); ensureMorphologyEnrollmentTables(database);
  const requestHash = createHash("sha256").update(JSON.stringify([input.lessonId, input.lessonVersion, input.wordId])).digest("hex");
  return database.transaction(() => {
    const saved = database.prepare("SELECT request_hash,result_json FROM morphology_enrollment_operations WHERE id=?").get(input.operationId) as { request_hash: string; result_json: string } | undefined;
    if (saved) {
      if (saved.request_hash !== requestHash) throw new DataIntegrityConflict("同一操作编号不能用于另一个关联词。", "OPERATION_CONFLICT");
      return JSON.parse(saved.result_json) as MorphologyEnrollmentResult;
    }
    const lesson = getMorphologyLesson(input.lessonId, database);
    if (!lesson || lesson.status !== "published" || lesson.version !== input.lessonVersion) throw new DataIntegrityConflict("课程内容已更新，请保留输入并刷新。", "CONTENT_CHANGED");
    const word = lesson.words.find(word => word.id === input.wordId);
    if (!word || word.illustrative) throw new Error("此内容仅作构词示例，不加入新增词汇学习。");
    const targetId = "morphology:" + createHash("sha256").update(word.id).digest("hex").slice(0, 24);
    const normalizedTerm = normaliseVocabularyAnswer(word.term), now = new Date().toISOString();
    let link = database.prepare("SELECT word_id,normalized_term FROM morphology_selected_targets WHERE target_id=?").get(targetId) as { word_id: string; normalized_term: string } | undefined;
    let detachedSelection = false;
    // A renamed personal word retains its own FSRS but no longer represents this term.
    if (link) {
      const personal = database.prepare("SELECT term FROM vocabulary_words WHERE id=?").get(link.word_id) as { term: string } | undefined;
      if (!personal || normaliseVocabularyAnswer(personal.term) !== normalizedTerm) { link = undefined; detachedSelection = true; }
    }
    let wordId = link?.word_id;
    if (!wordId) {
      const examples: VocabularyExercise[] = word.examples.map(example => {
        const start = example.sentence.toLocaleLowerCase("en").indexOf(example.targetSurface.toLocaleLowerCase("en"));
        if (start < 0) throw new Error("课程例句目标词形无效。");
        return { id: `morphology:${example.id}`, version: lesson.version, status: "published", sentence: example.sentence,
          targetStart: start, targetEnd: start + example.targetSurface.length, targetSurface: example.sentence.slice(start, start + example.targetSurface.length),
          acceptedAnswers: example.acceptedAnswers, meaningZh: example.meaningZh,
          source: "IELTS Studio 词根词缀课程原创语境例句", targetId };
      });
      const person = saveVocabularyEntry(vocabularyInputSchema.parse({
        term: word.term, partOfSpeech: word.partOfSpeech, meaningZh: word.meaningZh, definitionEn: word.definitionEn,
        example: word.examples[0].sentence, sourceSentence: word.examples[1].sentence,
        sourceMaterial: `词根词缀课程 · ${lesson.form} · 用户手选`, tags: ["词根手选", ...(word.level ? [word.level] : [])],
      }));
      if (!person) throw new Error("词汇尚未保存，请重试。");
      wordId = person.word.id;
      // Renaming leaves the original word's FSRS with its new spelling. Selecting
      // the old term again introduces this sense for its new personal identity;
      // a historical introduction on the detached identity cannot strand it.
      if (detachedSelection) database.prepare(`UPDATE vocabulary_target_state SET word_id=?,introduced_at=NULL,step=0,due_at=NULL,
        last_submission_id=NULL,version=version+1,updated_at=? WHERE target_id=? AND normalized_term=? AND (word_id IS NULL OR word_id<>?)`)
        .run(wordId, now, targetId, normalizedTerm, wordId);
      const rank = (database.prepare("SELECT COUNT(*) AS n FROM morphology_selected_targets").get() as { n: number }).n + 1;
      const entry: Partial<VocabularyCatalogEntry> & { term: string } = {
        ...vocabularyInputSchema.parse({ term: word.term, partOfSpeech: word.partOfSpeech, meaningZh: word.meaningZh, definitionEn: word.definitionEn,
          example: word.examples[0].sentence, sourceMaterial: "IELTS Studio 词根词缀课程 · 用户手选" }),
        id: `morphology-word:${word.id}`, version: lesson.version, status: "published", rank, courseIds: [MORPHOLOGY_SELECTED_COURSE], exercises: examples,
        targets: [{ id: targetId, version: lesson.version, status: "published", partOfSpeech: word.partOfSpeech, meaningZh: word.meaningZh,
          definitionEn: word.definitionEn, ipa: "", headwordAnswers: [word.term], level: word.level,
          levelEvidence: word.level && word.levelSource ? [{ source: word.levelSource, scope: "headword-pos", level: word.level, note: "词性等级依据，不宣称词根具有CEFR等级。" }] : [],
          advancedReason: "用户在词根课程中明确选择的具体用法。", source: lesson.sources.filter(source => word.sourceIds.includes(source.id)).map(source => `${source.title} ${source.url}`).join("\n"), sourcePdf: null,
          memberships: [{ courseId: MORPHOLOGY_SELECTED_COURSE, version: lesson.version, rank, exerciseIds: examples.map(example => example.id) }] }],
      };
      registerVocabularyCourse({ id: MORPHOLOGY_SELECTED_COURSE, title: "词根课程 · 我的手选词", description: "仅包含明确选择加入的义项；不自动切换当前课程。", kind: "user-import", version: 1 }, [entry], database);
      const canonical = database.prepare("SELECT id FROM vocabulary_catalog_entries WHERE normalized_term=?").get(normalizedTerm) as { id: string };
      database.prepare("INSERT INTO vocabulary_catalog_links(entry_id,word_id,detached) VALUES(?,?,0) ON CONFLICT(entry_id) DO UPDATE SET word_id=excluded.word_id,detached=0").run(canonical.id, wordId);
      database.prepare(`INSERT INTO morphology_selected_targets(target_id,word_id,normalized_term,lesson_id,word_key,lesson_json,created_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(target_id) DO UPDATE SET word_id=excluded.word_id,normalized_term=excluded.normalized_term,lesson_id=excluded.lesson_id,word_key=excluded.word_key,lesson_json=excluded.lesson_json`).run(targetId, wordId, normalizedTerm, lesson.id, word.id, JSON.stringify(lesson), now);
    }
    const paused = isVocabularyTermPaused(word.term, database) || readVocabularyTargetState(targetId, normalizedTerm, database).paused;
    const settings = getVocabularyStudy(new Date(), database);
    const filtered = settings.focus === "ielts-advanced" && !word.level;
    const result: MorphologyEnrollmentResult = { status: paused ? "paused" : link ? "existing" : "added", wordId, targetId,
      message: paused ? "已保留关联；此词或用法仍处于暂停状态，请在词库中明确恢复。"
        : filtered ? "已加入待学清单；此用法尚未核验B2/C1等级，当前进阶筛选下不会自动安排。"
        : link ? "已在手选清单中，原学习进度保持不变。" : "已加入待学清单；到期复习仍优先，新词或新用法会先学习再测试。" };
    database.prepare("INSERT INTO morphology_enrollment_operations(id,data_epoch,request_hash,result_json,created_at) VALUES(?,?,?,?,?)").run(input.operationId, input.dataEpoch, requestHash, JSON.stringify(result), now);
    return result;
  })();
}
