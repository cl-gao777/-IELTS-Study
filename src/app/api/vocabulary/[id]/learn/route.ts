import { NextResponse } from "next/server";
import { z } from "zod";
import { learnVocabularyEntry } from "@/server/vocabulary";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";
import { getDatabase } from "@/server/db";
import { withVocabularyReadScope, invalidateVocabularyReadScope } from "@/server/vocabulary-read-scope";
import { completeVocabularyTransition } from "@/server/vocabulary-transition";

const learnSchema = z.object({ expectedVersion: z.number().int().positive(), sessionId: z.uuid(), expectedSessionRevision: z.number().int().positive(),
  operationId: z.uuid().optional(), restoreVersion: z.number().int().positive().optional(), targetId: z.string().min(1).max(200).optional(),
  targetVersion: z.number().int().positive().optional(), expectedStateVersion: z.number().int().nonnegative().optional(), advance: z.boolean().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = learnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "练习协议已更新，请刷新页面后重试。" }, { status: 400 });
  const { id } = await context.params;
  return withVocabularyReadScope(getDatabase(),()=>{
    try {
      const {advance,...input}=parsed.data;
      const alreadySaved=input.operationId ? Boolean(getDatabase().prepare("SELECT 1 FROM vocabulary_target_operations WHERE operation_id=?").get(input.operationId))
        : Boolean(getDatabase().prepare("SELECT 1 FROM vocabulary_learning_state WHERE word_id=? AND learning_started_at IS NOT NULL").get(id));
      const result = learnVocabularyEntry(id, input);
      return result ? NextResponse.json(completeVocabularyTransition(result,Boolean(advance),alreadySaved)) : NextResponse.json({ error: "词条不存在。" }, { status: 404 });
    } catch (error) { invalidateVocabularyReadScope(getDatabase()); return vocabularyConflictResponse(error); }
  });
}
