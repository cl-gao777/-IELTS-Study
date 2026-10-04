import { z } from "zod";
import { MISTAKE_REASONS } from "@/lib/question-types";
import { saveMistakeReason } from "@/server/learning-workspace-store";
export async function POST(request: Request) {
  const parsed = z.object({ attemptId: z.number().int().positive(), questionId: z.string().min(1), reason: z.enum(MISTAKE_REASONS) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "请选择有效错误原因" }, { status: 400 });
  const ok = saveMistakeReason(parsed.data.attemptId, parsed.data.questionId, parsed.data.reason);
  return Response.json(ok ? { saved: true } : { error: "错题不存在" }, { status: ok ? 200 : 404 });
}
