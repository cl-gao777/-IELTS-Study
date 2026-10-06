import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewModes } from "@/lib/vocabulary";
import { previewVocabularyReview, reviewVocabularyEntry } from "@/server/vocabulary";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";

const reviewSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
  mode: z.enum(reviewModes),
  userAnswer: z.string().max(2000).default(""),
  durationSeconds: z.number().int().min(0).max(3600).default(0),
  expectedVersion: z.number().int().positive(),
  sessionId: z.uuid(),
  expectedSessionRevision: z.number().int().positive(),
  submissionId: z.uuid(),
  confirmedTypo: z.boolean().default(false),
  gaveUp: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const preview = previewVocabularyReview(id);
  return preview
    ? NextResponse.json({ preview }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Word not found." }, { status: 404 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "练习协议已更新或作答格式不正确，请刷新页面后重试。" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const result = reviewVocabularyEntry(id, parsed.data);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "Word not found." }, { status: 404 });
  } catch (error) {
    return vocabularyConflictResponse(error);
  }
}

