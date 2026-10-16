import { assertDataEpoch, dataConflictResponse } from "@/server/data-integrity";
import { z } from "zod";
import { MISTAKE_REASONS } from "@/lib/question-types";
import { saveMistakeReason } from "@/server/learning-workspace-store";
export async function POST(request: Request) {
  try {
  const body = await request.json().catch(() => null); assertDataEpoch(body?.dataEpoch);
  const parsed = z.object({ attemptId: z.number().int().positive(), questionId: z.string().min(1), reason: z.enum(MISTAKE_REASONS) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "请选择有效错误原因" }, { status: 400 });
  const ok = saveMistakeReason(parsed.data.attemptId, parsed.data.questionId, parsed.data.reason);
  return Response.json(ok ? { saved: true } : { error: "错题不存在" }, { status: ok ? 200 : 404 });
  } catch (error) { return dataConflictResponse(error) ?? Response.json({ error: "保存失败" }, { status: 500 }); }
}
