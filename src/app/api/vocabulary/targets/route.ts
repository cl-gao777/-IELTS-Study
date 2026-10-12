import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureVocabularyTables } from "@/server/vocabulary";
import { changeVocabularyTargetDisposition, readVocabularyTargetManagement } from "@/server/vocabulary-targets";
import { getVocabularySession } from "@/server/vocabulary-session";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";
import { getDatabase } from "@/server/db";
import { vocabularyDispositionOperationSchema } from "@/lib/vocabulary-target";
import { loadPrivateVocabularyCatalog } from "@/server/vocabulary-courses";

export async function GET(request: Request) {
  ensureVocabularyTables();
  const operationId = new URL(request.url).searchParams.get("operationId");
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (operationId && !z.uuid().safeParse(operationId).success) return NextResponse.json({ error: "操作编号格式不正确。" }, { status: 400 });
  const session = getVocabularySession(), database = getDatabase();
  const operation = operationId ? database.prepare("SELECT operation_id AS operationId,action FROM vocabulary_target_operations WHERE operation_id=?").get(operationId) ?? null : undefined;
  return NextResponse.json({ ...session, ...readVocabularyTargetManagement(database, courseId), ...(operationId ? { operation } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  const parsed = vocabularyDispositionOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "暂停协议或用法版本不正确，请刷新后重试。" }, { status: 400 });
  ensureVocabularyTables();
  loadPrivateVocabularyCatalog();
  try { changeVocabularyTargetDisposition(parsed.data); return NextResponse.json({ ...getVocabularySession(), ...readVocabularyTargetManagement(getDatabase(), new URL(request.url).searchParams.get("courseId")) }); }
  catch (error) { return vocabularyConflictResponse(error); }
}
