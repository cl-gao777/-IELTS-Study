import "server-only";

import type {
  CoachMessage,
  DashboardSnapshot,
  PracticeAttempt,
  PracticeQuestion,
  PracticeSet,
  ReviewItem,
  SourceMaterial,
  StudyArea,
  StudyTask,
  VocabularyWord,
  WritingSubmission,
} from "@/lib/domain";
import {
  calculateAcademicBand,
  scoreObjectiveAnswers,
} from "@/lib/practice-scoring";
import {
  type ReviewRating,
  scheduleVocabularyReview,
} from "@/lib/srs";

import { getDatabase } from "./db";
import { getPreferences, studyDate } from "./preferences";
import { parseOfficialResource, validateReadingPassages } from "@/lib/official-resources";

type Row = Record<string, unknown>;

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIME_ZONE ?? "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function displayDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIME_ZONE ?? "Asia/Shanghai",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function taskFromRow(row: Row): StudyTask {
  return {
    id: String(row.id),
    studyDate: String(row.study_date),
    area: String(row.area) as StudyArea,
    title: String(row.title),
    detail: String(row.detail),
    estimatedMinutes: Number(row.estimated_minutes),
    completed: Boolean(row.completed),
    href: String(row.href),
  };
}

function wordFromRow(row: Row): VocabularyWord {
  return {
    id: String(row.id),
    term: String(row.term),
    pronunciation: String(row.pronunciation),
    partOfSpeech: String(row.part_of_speech),
    meaningZh: String(row.meaning_zh),
    definitionEn: String(row.definition_en),
    example: String(row.example),
    tags: JSON.parse(String(row.tags_json)) as string[],
    repetitions: Number(row.repetitions),
    intervalDays: Number(row.interval_days),
    easeFactor: Number(row.ease_factor),
    dueAt: String(row.due_at),
  };
}

function practiceSetFromRow(row: Row): PracticeSet {
  const set: PracticeSet = {
    id: String(row.id),
    kind: String(row.kind) as PracticeSet["kind"],
    title: String(row.title),
    subtitle: String(row.subtitle),
    instructions: String(row.instructions),
    passage: String(row.passage),
    transcript: String(row.transcript),
    audioUrl: String(row.audio_url),
    durationMinutes: Number(row.duration_minutes),
    questions: JSON.parse(String(row.questions_json)) as PracticeQuestion[],
    resource: parseOfficialResource(JSON.parse(String(row.resource_json || "{}"))),
  };
  validateReadingPassages(set);
  return set;
}

function attemptFromRow(row: Row): PracticeAttempt {
  return {
    id: Number(row.id),
    setId: String(row.set_id),
    kind: String(row.kind) as PracticeAttempt["kind"],
    rawScore: Number(row.raw_score),
    totalQuestions: Number(row.total_questions),
    bandScore: Number(row.band_score),
    durationSeconds: Number(row.duration_seconds),
    answers: JSON.parse(String(row.answers_json)),
    submittedAt: String(row.submitted_at),
  };
}

function writingFromRow(row: Row): WritingSubmission {
  return {
    id: Number(row.id),
    taskType: String(row.task_type) as WritingSubmission["taskType"],
    prompt: String(row.prompt),
    essay: String(row.essay),
    wordCount: Number(row.word_count),
    overallBand: Number(row.overall_band),
    criteria: JSON.parse(String(row.criteria_json)),
    strengths: JSON.parse(String(row.strengths_json)),
    improvements: JSON.parse(String(row.improvements_json)),
    rewrite: String(row.rewrite),
    submittedAt: String(row.submitted_at),
  };
}

function ensureDailyTasks(date = localDate()) {
  const database = getDatabase();
  const budget = getPreferences().dailyMinutes;
  const portions = [Math.floor(budget*.2),Math.floor(budget*.25),Math.floor(budget*.3)];
  portions.push(budget-portions.reduce((a,b)=>a+b,0));
  const tasks = [
    {
      id: `${date}-vocabulary`,
      area: "Vocabulary",
      title: "复习到期词汇，学习 5 个新词",
      detail: "主动回忆 · FSRS 间隔复习",
      minutes: portions[0],
      href: "/vocabulary",
    },
    {
      id: `${date}-listening`,
      area: "Listening",
      title: "完成一段精听或听写",
      detail: "先读题预测，再听音频定位",
      minutes: portions[1],
      href: "/practice/listening",
    },
    {
      id: `${date}-reading`,
      area: "Reading",
      title: "阅读一篇文章并寻找证据",
      detail: "定位原文 · 归因错题",
      minutes: portions[2],
      href: "/practice/reading",
    },
    {
      id: `${date}-writing`,
      area: "Writing",
      title: "完成或改写一篇作文",
      detail: "组织观点 · 修改句子 · 对比版本",
      minutes: portions[3],
      href: "/writing",
    },
  ] as const;

  const insert = database.prepare(`
    INSERT INTO study_tasks (
      id, study_date, area, title, detail, estimated_minutes, completed, href, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,estimated_minutes=excluded.estimated_minutes,href=excluded.href
  `);
  const now = new Date().toISOString();

  database.transaction(() => {
    for (const task of tasks) {
      insert.run(
        task.id,
        date,
        task.area,
        task.title,
        task.detail,
        task.minutes,
        task.href,
        now,
      );
    }
  })();
}

function markTodayAreaComplete(area: StudyArea) {
  const date = localDate();
  ensureDailyTasks(date);
  getDatabase()
    .prepare(
      `UPDATE study_tasks
       SET completed = 1, updated_at = ?
       WHERE study_date = ? AND area = ?`,
    )
    .run(new Date().toISOString(), date, area);
}

function latestBand(kind: "reading" | "listening") {
  const row = getDatabase()
    .prepare(
      `SELECT band_score FROM practice_attempts
       WHERE kind = ? AND total_questions = 40 ORDER BY submitted_at DESC LIMIT 1`,
    )
    .get(kind) as { band_score: number } | undefined;
  return row ? Number(row.band_score) : 0;
}

function latestWritingBand() {
  const row = getDatabase()
    .prepare(
      `SELECT overall_band FROM writing_submissions WHERE overall_band > 0
       ORDER BY submitted_at DESC LIMIT 1`,
    )
    .get() as { overall_band: number } | undefined;
  return row ? Number(row.overall_band) : 0;
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const database = getDatabase();
  const date = localDate();
  ensureDailyTasks(date);
  const tasks = (
    database
      .prepare(
        "SELECT * FROM study_tasks WHERE study_date = ? ORDER BY rowid ASC",
      )
      .all(date) as Row[]
  ).map(taskFromRow);
  const due = database
    .prepare(
      "SELECT COUNT(*) AS count FROM vocabulary_words WHERE due_at <= ?",
    )
    .get(new Date().toISOString()) as { count: number };
  const review = database
    .prepare("SELECT COUNT(*) AS count FROM review_items WHERE resolved = 0")
    .get() as { count: number };
  const recentAttempts = (
    database
      .prepare(
        "SELECT * FROM practice_attempts ORDER BY submitted_at DESC LIMIT 5",
      )
      .all() as Row[]
  ).map(attemptFromRow);
  const recentWriting = (
    database
      .prepare(
        "SELECT * FROM writing_submissions ORDER BY submitted_at DESC LIMIT 3",
      )
      .all() as Row[]
  ).map(writingFromRow);
  const listening = latestBand("listening");
  const reading = latestBand("reading");
  const writing = latestWritingBand();
  const activeBands = [listening, reading, writing].filter((band) => band > 0);

  return {
    date,
    displayDate: displayDate(),
    tasks,
    dueVocabulary: due.count,
    recentAttempts,
    recentWriting,
    reviewCount: review.count,
    estimatedBands: {
      listening,
      reading,
      writing,
      overall: activeBands.length
        ? Number(
            (
              activeBands.reduce((sum, band) => sum + band, 0) /
              activeBands.length
            ).toFixed(1),
          )
        : 0,
    },
    streak: calculateStreak(),
    dailyMinutes: getPreferences().dailyMinutes,
    targetBand: getPreferences().targetBand,
    displayName: getPreferences().displayName,
    todayMinutes: Math.round(Number((database.prepare("SELECT COALESCE(SUM(duration_seconds),0) AS seconds FROM study_sessions WHERE study_date=?").get(studyDate()) as {seconds:number}).seconds)/60),
  };
}

export function toggleStudyTask(id: string) {
  const database = getDatabase();
  database
    .prepare(
      `UPDATE study_tasks
       SET completed = CASE completed WHEN 1 THEN 0 ELSE 1 END, updated_at = ?
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), id);
  const row = database
    .prepare("SELECT * FROM study_tasks WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? taskFromRow(row) : null;
}

export function calculateStreak() {
  const rows = getDatabase()
    .prepare(
      `SELECT study_date, SUM(completed) AS completed
       FROM study_tasks GROUP BY study_date ORDER BY study_date DESC`,
    )
    .all() as Array<{ study_date: string; completed: number }>;
  let streak = 0;
  let cursor = new Date(`${localDate()}T12:00:00Z`);

  for (const row of rows) {
    const expected = localDate(cursor);
    if (row.study_date !== expected || Number(row.completed) === 0) {
      if (streak === 0 && row.study_date === expected) {
        cursor = new Date(cursor.getTime() - 86_400_000);
        continue;
      }
      break;
    }
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  return streak;
}

export function listVocabulary(query = "") {
  const database = getDatabase();
  const rows = query
    ? (database
        .prepare(
          `SELECT * FROM vocabulary_words
           WHERE term LIKE ? OR meaning_zh LIKE ?
           ORDER BY due_at ASC, term ASC`,
        )
        .all(`%${query}%`, `%${query}%`) as Row[])
    : (database
        .prepare(
          "SELECT * FROM vocabulary_words ORDER BY due_at ASC, term ASC",
        )
        .all() as Row[]);
  return rows.map(wordFromRow);
}

export function getNextDueVocabulary() {
  const row = getDatabase()
    .prepare(
      "SELECT * FROM vocabulary_words WHERE due_at <= ? ORDER BY due_at ASC LIMIT 1",
    )
    .get(new Date().toISOString()) as Row | undefined;
  return row ? wordFromRow(row) : null;
}

export function addVocabularyWord(
  input: Omit<
    VocabularyWord,
    "id" | "repetitions" | "intervalDays" | "easeFactor" | "dueAt"
  >,
) {
  const now = new Date().toISOString();
  const id = `${input.term.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  getDatabase()
    .prepare(
      `INSERT INTO vocabulary_words (
        id, term, pronunciation, part_of_speech, meaning_zh, definition_en,
        example, tags_json, repetitions, interval_days, ease_factor, due_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 2.5, ?, ?, ?)`,
    )
    .run(
      id,
      input.term,
      input.pronunciation,
      input.partOfSpeech,
      input.meaningZh,
      input.definitionEn,
      input.example,
      JSON.stringify(input.tags),
      now,
      now,
      now,
    );
  return getDatabase()
    .prepare("SELECT * FROM vocabulary_words WHERE id = ?")
    .get(id) as Row;
}

export function reviewVocabularyWord(id: string, rating: ReviewRating) {
  const database = getDatabase();
  const row = database
    .prepare("SELECT * FROM vocabulary_words WHERE id = ?")
    .get(id) as Row | undefined;
  if (!row) {
    return null;
  }
  const word = wordFromRow(row);
  const now = new Date();
  const scheduled = scheduleVocabularyReview(word, rating, now);

  database.transaction(() => {
    database
      .prepare(
        `UPDATE vocabulary_words
         SET repetitions = ?, interval_days = ?, ease_factor = ?, due_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        scheduled.repetitions,
        scheduled.intervalDays,
        scheduled.easeFactor,
        scheduled.dueAt,
        now.toISOString(),
        id,
      );
    database
      .prepare(
        `INSERT INTO vocabulary_reviews
         (word_id, rating, previous_due_at, next_due_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, rating, word.dueAt, scheduled.dueAt, now.toISOString());
  })();

  markTodayAreaComplete("Vocabulary");

  return {
    ...word,
    ...scheduled,
  };
}

export function listPracticeSets(kind?: PracticeSet["kind"]) {
  const rows = kind
    ? (getDatabase()
        .prepare("SELECT * FROM practice_sets WHERE kind = ? ORDER BY title")
        .all(kind) as Row[])
    : (getDatabase()
        .prepare("SELECT * FROM practice_sets ORDER BY kind, title")
        .all() as Row[]);
  return rows.map(practiceSetFromRow);
}

export function createPracticeSet(set: PracticeSet) {
  getDatabase()
    .prepare(
      `INSERT INTO practice_sets (
        id, kind, title, subtitle, instructions, passage, transcript,
        audio_url, duration_minutes, questions_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
      new Date().toISOString(),
    );
  return set;
}

export function getPracticeSet(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM practice_sets WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? practiceSetFromRow(row) : null;
}

export function submitPracticeAttempt(input: {
  setId: string;
  answers: Record<string, string>;
  durationSeconds: number;
}) {
  const set = getPracticeSet(input.setId);
  if (!set) {
    return null;
  }
  const score = scoreObjectiveAnswers(input.answers, set.questions);
  const band = set.resource?.bandEstimateAllowed === false ? 0 : calculateAcademicBand(score.correct, score.total, set.kind);
  const database = getDatabase();
  const submittedAt = new Date().toISOString();

  const result = database
    .prepare(
      `INSERT INTO practice_attempts (
        set_id, kind, raw_score, total_questions, band_score,
        duration_seconds, answers_json, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      set.id,
      set.kind,
      score.correct,
      score.total,
      band,
      Math.max(0, Math.round(input.durationSeconds)),
      JSON.stringify(score.details.map((detail) => ({
        questionId: detail.id,
        submitted: detail.submitted,
        expected: detail.expected,
        correct: detail.correct,
      }))),
      submittedAt,
    );

  const attemptId = Number(result.lastInsertRowid);
  const addReview = database.prepare(
    `INSERT INTO review_items
     (source_type, source_id, skill, prompt, answer, resolved, created_at)
     VALUES ('practice-attempt', ?, ?, ?, ?, 0, ?)`,
  );
  database.transaction(() => {
    for (const detail of score.details.filter((item) => !item.correct)) {
      const question = set.questions.find((item) => item.id === detail.id);
      if (question) {
        addReview.run(
          String(attemptId),
          set.kind,
          question.prompt,
          `你的答案：${detail.submitted || "（未作答）"}\n正确答案：${question.answers.join(" / ")}\n题型：${question.kind}\n证据：${question.evidence || "材料未提供逐字证据"}\n解析：${question.explanation}`,
          submittedAt,
        );
      }
    }
  })();

  markTodayAreaComplete(set.kind === "reading" ? "Reading" : "Listening");

  return {
    id: attemptId,
    setId: set.id,
    kind: set.kind,
    rawScore: score.correct,
    totalQuestions: score.total,
    bandScore: band,
    durationSeconds: input.durationSeconds,
    answers: score.details.map((detail) => ({
      questionId: detail.id,
      submitted: detail.submitted,
      expected: detail.expected,
      correct: detail.correct,
    })),
    submittedAt,
  } satisfies PracticeAttempt;
}

export function listAttempts(limit = 20) {
  return (
    getDatabase()
      .prepare(
        "SELECT * FROM practice_attempts ORDER BY submitted_at DESC LIMIT ?",
      )
      .all(limit) as Row[]
  ).map(attemptFromRow);
}

export function saveCoachTurn(input: {
  user: string;
  assistant: string;
  correction: string;
  provider: string;
}) {
  const database = getDatabase();
  const insert = database.prepare(
    `INSERT INTO coach_messages
     (role, content, correction, provider, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  database.transaction(() => {
    insert.run("user", input.user, "", "", now);
    insert.run(
      "assistant",
      input.assistant,
      input.correction,
      input.provider,
      now,
    );
  })();
}

export function listCoachMessages(limit = 40): CoachMessage[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM coach_messages ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(limit) as Row[];
  return rows.map((row) => ({
    id: Number(row.id),
    role: String(row.role) as CoachMessage["role"],
    content: String(row.content),
    correction: String(row.correction),
    provider: String(row.provider),
    createdAt: String(row.created_at),
  }));
}

export function saveWritingSubmission(
  input: Omit<WritingSubmission, "id" | "submittedAt">,
) {
  const database = getDatabase();
  const submittedAt = new Date().toISOString();
  const result = database
    .prepare(
      `INSERT INTO writing_submissions (
        task_type, prompt, essay, word_count, overall_band, criteria_json,
        strengths_json, improvements_json, rewrite, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskType,
      input.prompt,
      input.essay,
      input.wordCount,
      input.overallBand,
      JSON.stringify(input.criteria),
      JSON.stringify(input.strengths),
      JSON.stringify(input.improvements),
      input.rewrite,
      submittedAt,
    );
  markTodayAreaComplete("Writing");
  return {
    ...input,
    id: Number(result.lastInsertRowid),
    submittedAt,
  };
}

export function listWritingSubmissions(limit = 20) {
  return (
    getDatabase()
      .prepare(
        "SELECT * FROM writing_submissions ORDER BY submitted_at DESC LIMIT ?",
      )
      .all(limit) as Row[]
  ).map(writingFromRow);
}

export function saveMockExam(input: {
  readingAttemptId: number;
  listeningAttemptId: number;
  writingSubmissionId: number;
  overallBand: number;
  startedAt: string;
}) {
  const submittedAt = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `INSERT INTO mock_exams (
        status, reading_attempt_id, listening_attempt_id,
        writing_submission_id, overall_band, started_at, submitted_at
      ) VALUES ('submitted', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.readingAttemptId,
      input.listeningAttemptId,
      input.writingSubmissionId,
      input.overallBand,
      input.startedAt,
      submittedAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    ...input,
    submittedAt,
  };
}

export function listMockExams(limit = 20) {
  return getDatabase()
    .prepare(
      "SELECT * FROM mock_exams ORDER BY submitted_at DESC LIMIT ?",
    )
    .all(limit) as Array<{
    id: number;
    status: string;
    reading_attempt_id: number;
    listening_attempt_id: number;
    writing_submission_id: number;
    overall_band: number;
    started_at: string;
    submitted_at: string;
  }>;
}

export function addMaterial(
  input: Omit<
    SourceMaterial,
    "id" | "createdAt" | "fileName" | "mimeType" | "fileUrl"
  >,
) {
  const createdAt = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `INSERT INTO source_materials
       (title, kind, content, source_url, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.title, input.kind, input.content, input.sourceUrl, createdAt);
  return {
    ...input,
    fileName: "",
    mimeType: "",
    fileUrl: "",
    id: Number(result.lastInsertRowid),
    createdAt,
  };
}

export function addFileMaterial(input: {
  title: string;
  kind: SourceMaterial["kind"];
  content: string;
  sourceUrl: string;
  fileName: string;
  mimeType: string;
  filePath: string;
}) {
  const createdAt = new Date().toISOString();
  const result = getDatabase()
    .prepare(
      `INSERT INTO source_materials (
        title, kind, content, source_url, file_name, mime_type, file_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.kind,
      input.content,
      input.sourceUrl,
      input.fileName,
      input.mimeType,
      input.filePath,
      createdAt,
    );
  const id = Number(result.lastInsertRowid);
  return {
    id,
    title: input.title,
    kind: input.kind,
    content: input.content,
    sourceUrl: input.sourceUrl,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileUrl: `/api/uploads/${id}`,
    createdAt,
  } satisfies SourceMaterial;
}

export function listMaterials(): SourceMaterial[] {
  return (
    getDatabase()
      .prepare("SELECT * FROM source_materials ORDER BY created_at DESC")
      .all() as Row[]
  ).map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    kind: String(row.kind) as SourceMaterial["kind"],
    content: String(row.content),
    sourceUrl: String(row.source_url),
    fileName: String(row.file_name ?? ""),
    mimeType: String(row.mime_type ?? ""),
    fileUrl: row.file_path ? `/api/uploads/${Number(row.id)}` : "",
    createdAt: String(row.created_at),
  }));
}

export function getMaterial(id: number) {
  const row = getDatabase()
    .prepare("SELECT * FROM source_materials WHERE id = ?")
    .get(id) as Row | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    title: String(row.title),
    kind: String(row.kind) as SourceMaterial["kind"],
    content: String(row.content),
    sourceUrl: String(row.source_url),
    fileName: String(row.file_name ?? ""),
    mimeType: String(row.mime_type ?? ""),
    fileUrl: row.file_path ? `/api/uploads/${Number(row.id)}` : "",
    createdAt: String(row.created_at),
  } satisfies SourceMaterial;
}

export function getMaterialFile(id: number) {
  return getDatabase()
    .prepare(
      `SELECT file_name, mime_type, file_path
       FROM source_materials WHERE id = ?`,
    )
    .get(id) as
    | { file_name: string; mime_type: string; file_path: string }
    | undefined;
}

export function listReviewItems(): ReviewItem[] {
  return (
    getDatabase()
      .prepare(
        "SELECT r.*, (SELECT COUNT(*) FROM review_items p WHERE p.prompt=r.prompt AND p.skill=r.skill) AS repeat_count FROM review_items r ORDER BY created_at DESC",
      )
      .all() as Row[]
  ).map((row) => ({
    id: Number(row.id),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    skill: String(row.skill),
    prompt: String(row.prompt),
    answer: String(row.answer),
    resolved: Boolean(row.resolved),
    category: String(row.category || ""),
    mistakeCount: Number(row.repeat_count || row.mistake_count || 1),
    reviewedAt: String(row.reviewed_at || ""),
    createdAt: String(row.created_at),
  }));
}

export function resolveReviewItem(id: number) {
  getDatabase()
    .prepare("UPDATE review_items SET resolved = 1 WHERE id = ?")
    .run(id);
}

export function exportAllData() {
  const database = getDatabase();
  const tables = [
    "settings",
    "study_tasks",
    "vocabulary_words",
    "vocabulary_reviews",
    "practice_sets",
    "practice_attempts",
    "coach_messages",
    "writing_submissions",
    "source_materials",
    "review_items",
    "mock_exams",
    "notion_sync_log",
  ];

  return Object.fromEntries(
    tables.map((table) => [
      table,
      database.prepare(`SELECT * FROM ${table}`).all(),
    ]),
  );
}
