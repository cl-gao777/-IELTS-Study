import { NextResponse } from "next/server";
import { z } from "zod";
import { getVocabularyCourses, selectVocabularyCourse, VocabularyStudyConflict } from "@/server/vocabulary-courses";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";
import { ensureReadingVocabularyCourses } from "@/server/reading-vocabulary-courses";

export async function GET(request: Request) {
  await ensureReadingVocabularyCourses();
  const query = new URL(request.url).searchParams;
  return NextResponse.json(getVocabularyCourses({ query: query.get("query") ?? "", page: Math.max(1, Number(query.get("page")) || 1), pageSize: Math.max(1, Math.min(100, Number(query.get("pageSize")) || 20)) }), { headers: { "Cache-Control": "no-store" } });
}
const selection = z.object({ restoreVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 2), courseId: z.string().min(1).max(200).nullable(), startRank: z.number().int().min(1).max(1000000).default(1) }).strict();
export async function PUT(request: Request) {
  const parsed = selection.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "课程或起点格式不正确。" }, { status: 400 });
  try { return NextResponse.json(selectVocabularyCourse(parsed.data.courseId, parsed.data.startRank, undefined, parsed.data.restoreVersion)); }
  catch (error) {
    if (error instanceof VocabularyStudyConflict) return NextResponse.json({ error: error.message, study: error.study }, { status: 409 });
    return vocabularyConflictResponse(error);
  }
}
