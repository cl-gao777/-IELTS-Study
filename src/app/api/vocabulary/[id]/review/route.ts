import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewVocabularyWord } from "@/server/store";

const reviewSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rating." }, { status: 400 });
  }
  const { id } = await context.params;
  const word = reviewVocabularyWord(id, parsed.data.rating);
  return word
    ? NextResponse.json({ word })
    : NextResponse.json({ error: "Word not found." }, { status: 404 });
}

