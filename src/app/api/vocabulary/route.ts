import { NextResponse } from "next/server";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import { listVocabularyEntries, saveVocabularyEntry } from "@/server/vocabulary";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const words = listVocabularyEntries(url.searchParams.get("q") ?? "");
  return NextResponse.json({ words, nextDue: words.find((word) => Date.parse(word.dueAt) <= Date.now()) ?? null });
}

export async function POST(request: Request) {
  const parsed = vocabularyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "请输入有效单词；词条内容过长或格式不正确。" },
      { status: 400 },
    );
  }
  return NextResponse.json(saveVocabularyEntry(parsed.data));
}

