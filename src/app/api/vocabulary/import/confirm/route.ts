import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmVocabularyImport, VocabularyImportConflict } from "@/server/vocabulary-import";
const schema = z.object({ previewId: z.uuid(), expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(200) }).strict();
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(confirmVocabularyImport(input.previewId, input.expectedRevision, input.title));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入确认失败。" }, { status: error instanceof VocabularyImportConflict ? 409 : 400 }); }
}
