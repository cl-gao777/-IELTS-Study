import { NextResponse } from "next/server";
import { catalogReviewSchema, publishVocabularyCatalogReview, queryVocabularyCatalogEntries } from "@/server/vocabulary-catalog-review";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";
import { VocabularySessionConflict } from "@/server/vocabulary-session-store";
import { z } from "zod";
import { getVocabularyStudy, requireVocabularyStudyVersion, VocabularyStudyConflict } from "@/server/vocabulary-courses";

const reviewRequest = catalogReviewSchema.extend({ restoreVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ ...queryVocabularyCatalogEntries({ courseId: params.get("courseId") ?? undefined,
    query: params.get("query") ?? "", status: params.get("status") ?? "all",
    page: Math.max(1, Number(params.get("page")) || 1), pageSize: Math.max(1, Math.min(100, Number(params.get("pageSize")) || 20)) }), restoreVersion: getVocabularyStudy().restoreVersion }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  const parsed = reviewRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "资料、题面或词条版本格式不正确。" }, { status: 400 });
  try {
    const { restoreVersion, ...review } = parsed.data;
    requireVocabularyStudyVersion(restoreVersion);
    return NextResponse.json({ entry: publishVocabularyCatalogReview(review) });
  }
  catch (error) {
    if (error instanceof VocabularySessionConflict || error instanceof VocabularyStudyConflict) return vocabularyConflictResponse(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "词汇资料发布失败。" }, { status: 400 });
  }
}
