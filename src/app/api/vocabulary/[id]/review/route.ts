import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewModes } from "@/lib/vocabulary";
import { previewVocabularyReview, reviewVocabularyEntry, readVocabularyReviewSubmission } from "@/server/vocabulary";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";
import { vocabularyTargetReviewBindingSchema } from "@/lib/vocabulary-target";
import { getDatabase } from "@/server/db";
import { withVocabularyReadScope, invalidateVocabularyReadScope } from "@/server/vocabulary-read-scope";
import { completeVocabularyTransition } from "@/server/vocabulary-transition";

const reviewSchema = vocabularyTargetReviewBindingSchema.extend({
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
  ratingSource: z.enum(["automatic", "self"]).default("self"),
  continueWithPractice: z.boolean().default(false),
  advance: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const query = new URL(_request.url).searchParams;
  const bindingFields = Object.fromEntries(query.entries());
  for (const field of ["targetVersion", "expectedStateVersion", "restoreVersion", "policyVersion", "exerciseVersion", "membershipVersion", "expectedSessionRevision"])
    if (bindingFields[field] !== undefined) (bindingFields as Record<string, unknown>)[field] = Number(bindingFields[field]);
  const binding = vocabularyTargetReviewBindingSchema.extend({ sessionId: z.uuid().optional(), expectedSessionRevision: z.number().int().positive().optional() }).safeParse(bindingFields);
  if (!binding.success) return NextResponse.json({ error: "预览协议不正确，请同步当前卡片。" }, { status: 400 });
  return withVocabularyReadScope(getDatabase(),()=>{ try { const preview = previewVocabularyReview(id, new Date(), binding.data);
  return preview
    ? NextResponse.json({ preview }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Word not found." }, { status: 404 });
  } catch (error) { invalidateVocabularyReadScope(getDatabase()); return vocabularyConflictResponse(error); } });
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
  return withVocabularyReadScope(getDatabase(),()=>{
    try {
      const {advance,...input}=parsed.data;
      const alreadySaved=Boolean(readVocabularyReviewSubmission(input.submissionId));
      const result = reviewVocabularyEntry(id, input);
      return result ? NextResponse.json(completeVocabularyTransition(result,Boolean(advance),alreadySaved))
        : NextResponse.json({ error: "Word not found." }, { status: 404 });
    } catch (error) { invalidateVocabularyReadScope(getDatabase()); return vocabularyConflictResponse(error); }
  });
}

