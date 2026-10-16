import { z } from "zod";
import { writingDraftSchema } from "@/lib/writing";
import { createWritingRevision, listWritingDrafts, saveProtectedWritingDraft, assertWritingDraftVersion } from "@/server/writing-drafts";
import { assertDataEpoch, dataConflictResponse, getDataEpoch } from "@/server/data-integrity";
export const runtime = "nodejs";
export function GET() { return Response.json({ drafts: listWritingDrafts(), dataEpoch: getDataEpoch() }); }
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    assertDataEpoch(body?.dataEpoch);
    const parsed = writingDraftSchema.safeParse(body);
    const protocol = z.object({ expectedRevision: z.number().int().nonnegative(), dataEpoch: z.string().min(1) }).safeParse(body);
    if (!parsed.success || !protocol.success) return Response.json({ error: "草稿格式或版本无效，请刷新。" }, { status: 400 });
    return Response.json({ draft: saveProtectedWritingDraft(parsed.data, protocol.data.expectedRevision, protocol.data.dataEpoch) });
  } catch (error) { return dataConflictResponse(error) ?? Response.json({ error: "无法保存草稿。请保留当前页面并重试。" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null); assertDataEpoch(body?.dataEpoch);
    const parsed = z.object({ sourceId: z.string().uuid(), id: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), dataEpoch: z.string().min(1) }).safeParse(body);
    if (!parsed.success) return Response.json({ error: "版本信息无效。" }, { status: 400 });
    assertWritingDraftVersion(parsed.data.sourceId, parsed.data.expectedRevision, parsed.data.dataEpoch);
    return Response.json({ draft: createWritingRevision(parsed.data.sourceId, parsed.data.id) });
  } catch (error) { return dataConflictResponse(error) ?? Response.json({ error: "创建改写版本失败，原草稿已保留。" }, { status: 400 }); }
}
