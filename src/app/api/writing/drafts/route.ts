import { NextResponse } from "next/server";
import { z } from "zod";
import { writingDraftSchema } from "@/lib/writing";
import { createWritingRevision, listWritingDrafts, saveWritingDraft } from "@/server/writing-drafts";

export const runtime = "nodejs";
export function GET() { return NextResponse.json({ drafts: listWritingDrafts() }); }

export async function PUT(request: Request) {
  try {
    const parsed = writingDraftSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "草稿格式无效，请检查题型、计时或图片大小。" }, { status: 400 });
    return NextResponse.json({ draft: saveWritingDraft(parsed.data) });
  } catch {
    return NextResponse.json({ error: "无法保存草稿。请保留当前页面并重试。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = z.object({ sourceId: z.string().uuid(), id: z.string().uuid() }).safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "版本信息无效。" }, { status: 400 });
    return NextResponse.json({ draft: createWritingRevision(parsed.data.sourceId, parsed.data.id) });
  } catch {
    return NextResponse.json({ error: "创建改写版本失败，原草稿已保留。" }, { status: 400 });
  }
}
