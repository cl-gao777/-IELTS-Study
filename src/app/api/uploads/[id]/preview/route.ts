import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import { getPath } from "pdf-parse/worker";
import { getMaterialFile } from "@/server/store";

export const runtime = "nodejs";
type Preview = { image: string; text: string; page: number; total: number };
const cache = new Map<string, Preview>();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const page = Number(new URL(request.url).searchParams.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000) return Response.json({ error: "请输入有效的 PDF 页码。" }, { status: 400 });
  const material = getMaterialFile(Number(id));
  if (!material?.file_path || material.mime_type !== "application/pdf") return Response.json({ error: "找不到 PDF 文件。" }, { status: 404 });
  const key = material.file_path + ":" + page;
  const headers = { "Cache-Control": "private, max-age=3600" };
  const cached = cache.get(key);
  if (cached) return Response.json(cached, { headers });
  let parser: PDFParse | undefined;
  try {
    PDFParse.setWorker(pathToFileURL(getPath()).href);
    parser = new PDFParse({ data: new Uint8Array(await readFile(material.file_path)), isEvalSupported: false });
    const info = await parser.getInfo();
    if (page > info.total) return Response.json({ error: `该 PDF 共 ${info.total} 页。` }, { status: 400 });
    const rendered = await parser.getScreenshot({ partial: [page], desiredWidth: 1200, imageDataUrl: true, imageBuffer: false });
    const text = await parser.getText({ partial: [page], pageJoiner: "" });
    const image = rendered.pages[0]?.dataUrl;
    if (!image) throw new Error("Page rendering failed.");
    const result = { image, text: text.text, page, total: info.total };
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "此 PDF 无法在工作台预览，请使用原文件入口打开。" }, { status: 422 });
  } finally { await parser?.destroy(); }
}
