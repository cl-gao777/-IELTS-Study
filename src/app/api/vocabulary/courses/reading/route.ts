import { NextResponse } from "next/server";
import { buildReadingVocabularyCourses } from "@/server/reading-vocabulary-courses";

export async function POST() {
  try { return NextResponse.json(await buildReadingVocabularyCourses(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "阅读课程提取失败。" }, { status: 400 }); }
}
