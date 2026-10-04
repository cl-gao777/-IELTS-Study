import { z } from "zod";
import { dictationWords } from "@/lib/dictation";
import { saveDictation } from "@/server/learning-workspace-store";
const schema = z.object({ setId: z.string().min(1), expected: z.string().trim().min(1).max(10000), submitted: z.string().max(10000), startSeconds: z.number().nonnegative().optional(), endSeconds: z.number().nonnegative().optional() }).refine((value) => dictationWords(value.expected).length <= 500 && dictationWords(value.submitted).length <= 500, "每次听写最多 500 个词；请选择较短片段");
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "请选择参考 Transcript" }, { status: 400 });
  const result = saveDictation(parsed.data);
  return result ? Response.json(result) : Response.json({ error: "听力练习不存在" }, { status: 404 });
}
