import { NextResponse } from "next/server";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import { listVocabularyEntries, saveVocabularyEntry } from "@/server/vocabulary";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const all = listVocabularyEntries(url.searchParams.get("query") ?? url.searchParams.get("q") ?? "");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize")) || 30));
  const words = url.searchParams.has("page") || url.searchParams.has("pageSize") ? all.slice((page - 1) * pageSize, page * pageSize) : all;
  return NextResponse.json({ words, total: all.length, page, pageSize, nextDue: all.find((word) => Date.parse(word.dueAt) <= Date.now()) ?? null }, { headers: { "Cache-Control": "no-store" } });
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

