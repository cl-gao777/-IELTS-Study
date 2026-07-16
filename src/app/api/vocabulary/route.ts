import { NextResponse } from "next/server";
import { z } from "zod";

import {
  addVocabularyWord,
  getNextDueVocabulary,
  listVocabulary,
} from "@/server/store";

const wordSchema = z.object({
  term: z.string().trim().min(1).max(100),
  pronunciation: z.string().trim().max(100).default(""),
  partOfSpeech: z.string().trim().max(50).default(""),
  meaningZh: z.string().trim().min(1).max(300),
  definitionEn: z.string().trim().min(1).max(600),
  example: z.string().trim().min(1).max(800),
  tags: z.array(z.string().trim().max(40)).max(10).default([]),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json({
    words: listVocabulary(url.searchParams.get("q") ?? ""),
    nextDue: getNextDueVocabulary(),
  });
}

export async function POST(request: Request) {
  const parsed = wordSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The vocabulary entry is incomplete." },
      { status: 400 },
    );
  }
  return NextResponse.json({ word: addVocabularyWord(parsed.data) });
}

