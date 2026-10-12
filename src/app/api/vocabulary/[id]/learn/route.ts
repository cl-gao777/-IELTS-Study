import { NextResponse } from "next/server";
import { z } from "zod";
import { learnVocabularyEntry } from "@/server/vocabulary";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";

const learnSchema = z.object({ expectedVersion: z.number().int().positive(), sessionId: z.uuid(), expectedSessionRevision: z.number().int().positive(),
  operationId: z.uuid().optional(), restoreVersion: z.number().int().positive().optional(), targetId: z.string().min(1).max(200).optional(),
  targetVersion: z.number().int().positive().optional(), expectedStateVersion: z.number().int().nonnegative().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = learnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "练习协议已更新，请刷新页面后重试。" }, { status: 400 });
  const { id } = await context.params;
  try {
    const result = learnVocabularyEntry(id, parsed.data);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "词条不存在。" }, { status: 404 });
  } catch (error) { return vocabularyConflictResponse(error); }
}
