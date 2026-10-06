import { NextResponse } from "next/server";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import { saveVocabularyEntry } from "@/server/vocabulary";
import { z } from "zod";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = vocabularyInputSchema.extend({ expectedVersion: z.number().int().positive().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "词条内容过长或格式不正确。" }, { status: 400 });
  const { id } = await context.params;
  try {
    const result = saveVocabularyEntry(parsed.data, id, parsed.data.expectedVersion);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "词条不存在。" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_WORD") return NextResponse.json({ error: "个人词库中已经有这个单词，请编辑已有词条。" }, { status: 409 });
    return vocabularyConflictResponse(error);
  }
}
