import { NextResponse } from "next/server";
import { z } from "zod";
import { getVocabularyStudy, saveVocabularyStudy, VocabularyStudyConflict, loadVocabularyCatalog } from "@/server/vocabulary-courses";
import { ensureVocabularyTables } from "@/server/vocabulary";

export async function GET() {
  ensureVocabularyTables(); loadVocabularyCatalog();
  return NextResponse.json(getVocabularyStudy(), { headers: { "Cache-Control": "no-store" } });
}
const update = z.object({ restoreVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 2),
  dailyGoalSeconds: z.number().int().min(60).max(21600).optional(), paused: z.boolean().optional(),
  focus: z.enum(["general", "ielts-advanced"]).optional(),
  heartbeat: z.object({ id: z.uuid(), seconds: z.number().int().min(0).max(15), cumulative: z.literal(true) }).strict().optional() }).strict();
export async function PUT(request: Request) {
  const parsed = update.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "学习设置版本或格式不正确，请刷新后重试。" }, { status: 400 });
  ensureVocabularyTables();
  loadVocabularyCatalog();
  try { return NextResponse.json(saveVocabularyStudy(parsed.data)); }
  catch (error) {
    if (error instanceof VocabularyStudyConflict) return NextResponse.json({ error: error.message, study: error.study }, { status: 409 });
    throw error;
  }
}
