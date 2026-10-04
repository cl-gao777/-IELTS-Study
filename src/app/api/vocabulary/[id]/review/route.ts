import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewModes } from "@/lib/vocabulary";
import { reviewVocabularyEntry } from "@/server/vocabulary";

const reviewSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
  mode: z.enum(reviewModes).default("recognition"),
  userAnswer: z.string().max(2000).default(""),
  correct: z.boolean().nullable().default(null),
  durationSeconds: z.number().int().min(0).max(3600).default(0),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rating." }, { status: 400 });
  }
  const { id } = await context.params;
  const word = reviewVocabularyEntry(id, parsed.data);
  return word
    ? NextResponse.json({ word })
    : NextResponse.json({ error: "Word not found." }, { status: 404 });
}

