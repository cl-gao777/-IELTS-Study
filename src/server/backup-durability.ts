import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mockStateSchema } from "../lib/mock-exam";
import { officialResourceSchema, validateReadingPassages } from "../lib/official-resources";
import type { PracticeSet } from "../lib/domain";
import { submissionHash } from "./submissions";

type Row = Record<string, string | number | null>;
type Data = Record<string, Row[]>;
export const V5_DURABILITY_TABLES = ["app_data_state", "submission_receipts", "mock_exam_sessions", "practice_workspace_versions", "writing_draft_revisions", "vocabulary_study_time_segments"] as const;
const uuid = z.uuid(), date = z.iso.datetime(), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2);
const readJson = (row: Row, key: string): unknown => JSON.parse(String(row[key]));
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份中的提交快照无效。"); return value as Record<string, unknown>; };

export function migrateDurabilityBackup(data: Data) {
  for (const table of V5_DURABILITY_TABLES) if (!Object.hasOwn(data, table)) data[table] = table === "app_data_state" ? [{ id: 1, data_epoch: randomUUID() }] : [];
}

function checkFrozenSet(value: unknown, kind: "reading" | "listening", data: Data, ids: Set<number>): PracticeSet {
  const raw = record(value);
  if (raw.kind !== kind || typeof raw.id !== "string" || !data.practice_sets.some((row) => row.id === raw.id)
    || typeof raw.title !== "string" || typeof raw.passage !== "string" || typeof raw.transcript !== "string" || typeof raw.instructions !== "string"
    || typeof raw.subtitle !== "string" || typeof raw.audioUrl !== "string" || !Number.isFinite(raw.durationMinutes)
    || !Array.isArray(raw.questions) || !raw.questions.length) throw new Error("模拟考试冻结试卷无效。");
  const questionIds = new Set<string>();
  for (const item of raw.questions) {
    const q = record(item);
    if (typeof q.id !== "string" || !q.id || questionIds.has(q.id) || typeof q.kind !== "string" || typeof q.prompt !== "string"
      || !Array.isArray(q.answers) || !q.answers.length || q.answers.some((answer) => typeof answer !== "string") || typeof q.explanation !== "string") throw new Error("模拟考试冻结题目无效。");
    questionIds.add(q.id);
  }
  if (raw.audioUrl) {
    const match = /^\/api\/uploads\/(\d+)$/.exec(raw.audioUrl);
    if (!match || !ids.has(Number(match[1]))) throw new Error("模拟考试缺少关联音频。");
  }
  if (raw.resource) {
    const resource = officialResourceSchema.parse(raw.resource);
    validateReadingPassages({ kind, questions: raw.questions as PracticeSet["questions"], resource });
    for (const asset of [...resource.questionDocuments, ...resource.answerDocuments, ...resource.audioTracks, ...resource.transcriptDocuments, ...(resource.readingPassages ?? []).flatMap((p) => p.documents)]) {
      if (!ids.has(Number(asset.url.split("/").at(-1)))) throw new Error("模拟考试缺少冻结试卷附件。");
    }
  }
  return raw as unknown as PracticeSet;
}

export function validateDurabilityBackup(data: Data, files: { materialId: number }[]) {
  if (data.app_data_state.length !== 1 || data.app_data_state[0].id !== 1 || !uuid.safeParse(data.app_data_state[0].data_epoch).success) throw new Error("备份数据恢复标识无效。");
  const epoch = data.app_data_state[0].data_epoch;
  for (const row of data.practice_workspace_versions) {
    if (typeof row.set_id !== "string" || !data.practice_sets.some((set) => set.id === row.set_id) || !count.safeParse(row.revision).success
      || !uuid.safeParse(row.run_id).success || !uuid.safeParse(row.submission_id).success || ![0, 1].includes(Number(row.completed)) || typeof row.completed !== "number") throw new Error("练习草稿版本无效。");
  }
  for (const row of data.writing_draft_revisions) if (!data.writing_drafts.some((draft) => draft.id === row.draft_id) || !count.safeParse(row.revision).success) throw new Error("作文草稿版本无效。");
  for (const row of data.vocabulary_study_time_segments) {
    if (!uuid.safeParse(row.id).success || !z.number().int().positive().safeParse(row.restore_version).success || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.study_date))
      || !z.number().int().min(0).max(15).safeParse(row.seconds).success || !date.safeParse(row.created_at).success || !date.safeParse(row.updated_at).success) throw new Error("词汇计时片段无效。");
  }
  const ids = new Set(files.map((file) => file.materialId)); let active = 0;
  for (const row of data.mock_exam_sessions) {
    if (!uuid.safeParse(row.id).success || !uuid.safeParse(row.submission_id).success || row.data_epoch !== epoch || !count.safeParse(row.revision).success || Number(row.revision) < 1
      || !["active", "completed", "ended"].includes(String(row.status)) || !date.safeParse(row.started_at).success || !date.safeParse(row.updated_at).success
      || (row.writer_id !== null && !uuid.safeParse(row.writer_id).success) || (row.lease_until !== null && !date.safeParse(row.lease_until).success)
      || (row.writer_id === null) !== (row.lease_until === null)) throw new Error("模拟考试会话无效。");
    if (row.status === "active") active++;
    const state = mockStateSchema.parse(readJson(row, "state_json")), snapshot = record(readJson(row, "snapshot_json"));
    if (Object.keys(snapshot).sort().join(",") !== "listeningSet,readingSet,writingPrompt" || typeof snapshot.writingPrompt !== "string" || !snapshot.writingPrompt) throw new Error("模拟考试题面快照无效。");
    const listening = checkFrozenSet(snapshot.listeningSet, "listening", data, ids), reading = checkFrozenSet(snapshot.readingSet, "reading", data, ids);
    for (const [set, answers] of [[listening, state.listeningAnswers], [reading, state.readingAnswers]] as const) if (Object.keys(answers).some((id) => !set.questions.some((q) => q.id === id))) throw new Error("模拟考试答案题号无效。");
    if (state.passageId && !reading.resource?.readingPassages?.some((p) => p.id === state.passageId)) throw new Error("模拟考试阅读篇章无效。");
    if (row.status === "completed" || (row.status === "ended" && row.result_json !== null)) {
      const result = record(readJson(row, "result_json")), mock = record(result.mock);
      if (!data.mock_exams.some((exam) => exam.id === mock.id)) throw new Error("模拟考试结果关联无效。");
      const receipt = data.submission_receipts.find((entry) => entry.id === row.submission_id && entry.scope_id === row.id && entry.kind === "mock" && entry.status === "completed");
      if (!receipt || submissionHash(readJson(receipt, "result_json")) !== submissionHash(result)) throw new Error("模拟考试结果与提交审计不一致。");
    } else if (row.result_json !== null) throw new Error("未完成考试不应包含成绩。");
  }
  if (active > 1) throw new Error("备份含多个活动模拟考试。");
  for (const row of data.submission_receipts) {
    if (!uuid.safeParse(row.id).success || !uuid.safeParse(row.scope_id).success || row.data_epoch !== epoch || !["practice", "mock"].includes(String(row.kind))
      || !["processing", "completed", "failed"].includes(String(row.status)) || !date.safeParse(row.updated_at).success
      || typeof row.error !== "string" || row.request_hash !== submissionHash(readJson(row, "request_json"))) throw new Error("提交审计记录无效。");
    if (row.status === "processing" && (!uuid.safeParse(row.lease_id).success || !date.safeParse(row.lease_until).success || !z.number().int().positive().safeParse(row.owner_pid).success)) throw new Error("提交执行锁无效。");
    if (row.status !== "processing" && (row.lease_id !== null || row.lease_until !== null || row.owner_pid !== null)) throw new Error("已结束提交保留了执行锁。");
    if (row.status === "completed") {
      const result = record(readJson(row, "result_json"));
      const request = record(readJson(row, "request_json"));
      if (row.kind === "practice") {
        const attempt = data.practice_attempts.find((entry) => entry.id === record(result.attempt).id);
        if (!attempt || request.setId !== attempt.set_id) throw new Error("练习提交结果关联无效。");
      } else {
        const session = data.mock_exam_sessions.find((entry) => entry.id === row.scope_id && entry.submission_id === row.id);
        const exam = data.mock_exams.find((entry) => entry.id === record(result.mock).id);
        const reading = record(result.reading), listening = record(result.listening), writing = record(result.writing);
        if (!session || !exam || reading.id !== exam.reading_attempt_id || listening.id !== exam.listening_attempt_id
          || (writing.id === 0 ? exam.writing_submission_id !== null : writing.id !== exam.writing_submission_id)
          || record(request.reading).setId !== data.practice_attempts.find((entry) => entry.id === reading.id)?.set_id
          || record(request.listening).setId !== data.practice_attempts.find((entry) => entry.id === listening.id)?.set_id
          || submissionHash(readJson(session, "result_json")) !== submissionHash(result)) throw new Error("模拟提交结果关联无效。");
      }
    } else if (row.result_json !== null) throw new Error("未完成提交不应包含评分结果。");
  }
}
