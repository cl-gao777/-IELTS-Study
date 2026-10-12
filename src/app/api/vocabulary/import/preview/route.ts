import { NextResponse } from "next/server";
import { readVocabularyImportFile } from "@/server/vocabulary-import-file";
import { createVocabularyImportPreview } from "@/server/vocabulary-import";
import { loadVocabularyCatalog } from "@/server/vocabulary-courses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择 TXT、CSV 或 XLSX 词表。");
    if (file.size > 5 * 1024 * 1024) throw new Error("词表文件不能超过 5 MB。");
    const rows = await readVocabularyImportFile(file.name, Buffer.from(await file.arrayBuffer()));
    loadVocabularyCatalog();
    return NextResponse.json(createVocabularyImportPreview(file.name, rows));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入预览失败。" }, { status: 400 }); }
}
