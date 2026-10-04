import { manualPracticeSchema } from "@/lib/question-types";
import { createMaterialPractice } from "@/server/learning-workspace-store";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = manualPracticeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join("；") }, { status: 400 });
  const set = createMaterialPractice(Number((await context.params).id), parsed.data.questions, parsed.data.durationMinutes);
  return set ? Response.json({ href: `/practice/set/${set.id}` }) : Response.json({ error: "只支持阅读或听力资料。" }, { status: 400 });
}
