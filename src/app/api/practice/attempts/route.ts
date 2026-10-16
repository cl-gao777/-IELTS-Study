import { z } from "zod";
import { submitPracticeAttempt } from "@/server/store";
import { assertPracticeRun, completePracticeRun } from "@/server/learning-workspace-store";
import { assertDataEpoch, dataConflictResponse } from "@/server/data-integrity";
import { beginSubmission, completeSubmission, failSubmission } from "@/server/submissions";
const schema = z.object({ setId: z.string().min(1), answers: z.record(z.string(), z.string()), durationSeconds: z.number().min(0).max(86400), dataEpoch: z.string().min(1), runId: z.string().uuid(), submissionId: z.string().uuid() });
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    assertDataEpoch(body?.dataEpoch);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "提交格式无效。" }, { status: 400 });
    const data = parsed.data;
    assertPracticeRun(data.setId, data.runId, data.submissionId, data.dataEpoch);
    const input = { kind: "practice" as const, scopeId: data.runId, submissionId: data.submissionId, dataEpoch: data.dataEpoch, payload: { setId: data.setId, answers: data.answers, durationSeconds: data.durationSeconds } };
    const claim = beginSubmission(input);
    if (claim.status === "completed") return Response.json(claim.result);
    if (!claim.acquired) return Response.json({ status: "processing" }, { status: 202 });
    try {
      const result = completeSubmission(input, claim.leaseId!, () => {
        assertPracticeRun(data.setId, data.runId, data.submissionId, data.dataEpoch);
        const attempt = submitPracticeAttempt(data);
        if (!attempt) throw new Error("练习不存在");
        completePracticeRun(data.setId);
        return { attempt };
      });
      return Response.json(result);
    } catch (error) { failSubmission(data.submissionId, claim.leaseId!, data.dataEpoch, "提交未完成，请查询后重试。"); throw error; }
  } catch (error) { return dataConflictResponse(error) ?? Response.json({ error: "评分未完成，答案已保留，请查询后重试。" }, { status: 500 }); }
}
