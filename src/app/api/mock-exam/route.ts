import { z } from "zod";
import { evaluateWriting } from "@/server/ai";
import { dataConflictResponse, assertDataEpoch } from "@/server/data-integrity";
import { beginSubmission, completeSubmission, failSubmission, lookupSubmission, renewSubmissionLease, type SubmissionInput } from "@/server/submissions";
import { completeMockSession, frozenMockSubmission } from "@/server/mock-exam-session";
import { initializeWritingTables } from "@/server/writing-drafts";
import { getDatabase } from "@/server/db";
import { saveMockExam, saveWritingSubmission, submitPracticeAttempt } from "@/server/store";
import type { MockResult } from "@/lib/mock-exam";

const schema = z.object({ sessionId: z.uuid(), submissionId: z.uuid(), dataEpoch: z.uuid(), writerId: z.uuid() }).strict();
export async function POST(request: Request) {
  let claimInput: SubmissionInput | undefined, leaseId: string | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "页面协议已更新，请保留草稿并刷新。", code: "REFRESH_REQUIRED" }, { status: 409 });
    const input = parsed.data;
    const { record, state, snapshot } = frozenMockSubmission(input);
    const receipt = lookupSubmission(input.submissionId, input.dataEpoch);
    if (receipt.status === "completed") return Response.json(receipt.result);
    claimInput = { submissionId: input.submissionId, kind: "mock", scopeId: input.sessionId, dataEpoch: input.dataEpoch,
      payload: { startedAt: record.started_at, listening: { setId: snapshot.listeningSet.id, answers: state.listeningAnswers, durationSeconds: state.durations.listening }, reading: { setId: snapshot.readingSet.id, answers: state.readingAnswers, durationSeconds: state.durations.reading }, writing: { taskType: "task-2", prompt: snapshot.writingPrompt, essay: state.essay } } };
    const claim = beginSubmission(claimInput);
    if (claim.status === "completed") return Response.json(claim.result);
    if (!claim.acquired || !claim.leaseId) return Response.json({ status: "processing", submissionId: input.submissionId }, { status: 202 });
    leaseId = claim.leaseId;
    heartbeat = setInterval(() => { try { renewSubmissionLease(input.submissionId, claim.leaseId!, input.dataEpoch); } catch { /* Completion performs the authoritative restore check. */ } }, 30000);
    const feedback = await evaluateWriting({ taskType: "task-2", prompt: snapshot.writingPrompt, essay: state.essay });
    assertDataEpoch(input.dataEpoch);
    initializeWritingTables();
    const result = completeSubmission(claimInput, leaseId, () => {
      const listening = submitPracticeAttempt({ setId: snapshot.listeningSet.id, answers: state.listeningAnswers, durationSeconds: state.durations.listening, snapshot: snapshot.listeningSet });
      const reading = submitPracticeAttempt({ setId: snapshot.readingSet.id, answers: state.readingAnswers, durationSeconds: state.durations.reading, snapshot: snapshot.readingSet });
      if (!listening || !reading) throw new Error("题卷快照无法评分。");
      const now = new Date().toISOString(), db = getDatabase();
      db.prepare(`INSERT INTO writing_drafts(id,group_id,version,task_type,category,prompt,image,essay,elapsed_seconds,time_limit_minutes,status,updated_at)
        VALUES(?,?,1,'task-2','Opinion',?,'',?, ?,40,'completed',?)`).run(input.sessionId, input.sessionId, snapshot.writingPrompt, state.essay, state.durations.writing, now);
      const content = { taskType: "task-2" as const, prompt: snapshot.writingPrompt, essay: state.essay, wordCount: state.essay.trim().split(/\s+/).filter(Boolean).length,
        overallBand: feedback.overallBand, criteria: feedback.criteria, strengths: feedback.strengths, improvements: feedback.improvements, rewrite: feedback.rewrite };
      const writing = feedback.provider === "local-fallback" ? { ...content, id: 0, submittedAt: now } : saveWritingSubmission(content);
      const mock = saveMockExam({ listeningAttemptId: listening.id, readingAttemptId: reading.id, writingSubmissionId: writing.id || null, overallBand: 0, startedAt: record.started_at });
      const saved = { mock, listening, reading, writing, provider: feedback.provider } satisfies MockResult;
      completeMockSession(input.sessionId, saved);
      return saved;
    });
    return Response.json(result);
  } catch (error) {
    if (claimInput && leaseId) { try { failSubmission(claimInput.submissionId, leaseId, claimInput.dataEpoch, error instanceof Error ? error.message : "提交失败"); } catch { /* Restore already invalidated this claim. */ } }
    return dataConflictResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "模拟考试提交失败，草稿仍保留。" }, { status: 400 });
  } finally { if (heartbeat) clearInterval(heartbeat); }
}
