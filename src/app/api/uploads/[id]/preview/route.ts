import { getMaterialFile } from "@/server/store";
import { PdfPreviewError, pdfPreviewService } from "@/server/pdf-preview";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const search = new URL(request.url).searchParams;
  const metadata = search.get("metadata") === "1";
  const page = Number(search.get("page") || 1);
  if (!metadata && (!Number.isInteger(page) || page < 1 || page > 1000)) return Response.json({ error: "请输入有效的 PDF 页码。" }, { status: 400 });
  const materialId = Number(id);
  if (!Number.isSafeInteger(materialId) || materialId < 1) return Response.json({ error: "找不到 PDF 文件。" }, { status: 404 });
  const material = getMaterialFile(materialId);
  if (!material?.file_path || material.mime_type !== "application/pdf") return Response.json({ error: "找不到 PDF 文件。" }, { status: 404 });
  try {
    const result = metadata
      ? await pdfPreviewService.metadata(material.file_path)
      : await pdfPreviewService.page(material.file_path, page);
    // Revalidate browser copies after a restore; the server cache uses file identity.
    return Response.json(result, { headers: { "Cache-Control": "private, no-cache" } });
  } catch (error) {
    if (error instanceof PdfPreviewError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "此 PDF 无法在工作台预览，请使用原文件入口打开。" }, { status: 422 });
  }
}
