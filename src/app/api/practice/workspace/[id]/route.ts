import { z } from "zod";
import { getPracticeWorkspaceState, savePracticeWorkspace } from "@/server/learning-workspace-store";
const schema = z.object({ draft: z.object({ answers: z.record(z.string().max(100), z.string().max(5000)), elapsed: z.number().min(0).max(864000), fontSize: z.number().min(14).max(26), notes: z.string().max(20000), dictationText: z.string().max(10000), dictationReference: z.string().max(10000), isRetry: z.boolean().optional() }), annotations: z.array(z.object({ id: z.string().max(100), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), style: z.enum(["highlight", "underline"]), note: z.string().max(3000) })).max(1000) });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return Response.json(getPracticeWorkspaceState((await context.params).id));
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "笔记过长或练习状态格式有误。" }, { status: 400 });
  const ok = savePracticeWorkspace((await context.params).id, parsed.data.draft, parsed.data.annotations);
  return Response.json(ok ? { saved: true } : { error: "练习不存在" }, { status: ok ? 200 : 404 });
}
