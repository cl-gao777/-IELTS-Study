import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const pdf = vi.hoisted(() => ({
  constructor: vi.fn(), worker: vi.fn(), info: vi.fn(), screenshot: vi.fn(), text: vi.fn(), destroy: vi.fn(), material: vi.fn(),
}));
vi.mock("./store", () => ({ getMaterialFile: pdf.material }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    static setWorker = pdf.worker;
    constructor(options: unknown) { pdf.constructor(options); }
    getInfo = pdf.info;
    getScreenshot = pdf.screenshot;
    getText = pdf.text;
    destroy = pdf.destroy;
  },
}));

import { createPdfPreviewService, PdfPreviewError } from "./pdf-preview";
import { GET } from "../app/api/uploads/[id]/preview/route";

let directory: string;
let file: string;

function screenshot(page: number) {
  const data = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.write("IHDR", 12);
  data.writeUInt32BE(1200, 16);
  data.writeUInt32BE(1552, 20);
  return { pages: [{ data, dataUrl: "data:image/png;base64," + "A".repeat(100), pageNumber: page, width: 1200, height: 1552.94 }] };
}

function request(query = "", id = "42") {
  return GET(new Request(`http://localhost/api/uploads/${id}/preview${query}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(path.join(tmpdir(), "ielts-pdf-preview-test-"));
  file = path.join(directory, "private.pdf");
  writeFileSync(file, "%PDF-original");
  pdf.info.mockResolvedValue({
    total: 100,
    info: { title: "private metadata" },
    pages: Array.from({ length: 100 }, (_, i) => ({ pageNumber: i + 1, width: 612, height: 792, links: [{ url: "https://private.example" }] })),
  });
  pdf.screenshot.mockImplementation(async ({ partial }: { partial: number[] }) => screenshot(partial[0]));
  pdf.text.mockResolvedValue({ text: "Original reading text." });
  pdf.destroy.mockResolvedValue(undefined);
  pdf.material.mockReturnValue({ file_path: file, mime_type: "application/pdf" });
});

afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe("local PDF preview service", () => {
  it("returns only physical page dimensions for metadata, without rendering or exposing PDF metadata", async () => {
    const result = await createPdfPreviewService().metadata(file);
    expect(result.total).toBe(100);
    expect(result.pages[0]).toEqual({ page: 1, width: 612, height: 792 });
    expect(Object.keys(result)).toEqual(["total", "pages"]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(pdf.info).toHaveBeenCalledWith({ parsePageInfo: true });
    expect(pdf.screenshot).not.toHaveBeenCalled();
    expect(pdf.text).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("merges simultaneous page requests and reports the PNG's actual integer pixel size", async () => {
    let finish!: (value: ReturnType<typeof screenshot>) => void;
    pdf.screenshot.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const service = createPdfPreviewService();
    const first = service.page(file, 2);
    const second = service.page(file, 2);
    await vi.waitFor(() => expect(pdf.screenshot).toHaveBeenCalledOnce());
    finish(screenshot(2));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ page: 2, total: 100, width: 1200, height: 1552, text: "Original reading text." });
    expect(pdf.constructor).toHaveBeenCalledOnce();
    expect(pdf.constructor.mock.calls[0][0]).toMatchObject({ isEvalSupported: false });
    expect(pdf.constructor.mock.calls[0][0].data).toBeInstanceOf(Uint8Array);
    expect(pdf.worker.mock.calls[0][0]).toMatch(/^file:/);
    expect(pdf.screenshot).toHaveBeenCalledWith({ partial: [2], desiredWidth: 1200, imageDataUrl: true, imageBuffer: false });
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("keeps only 20 rendered pages by default", async () => {
    const service = createPdfPreviewService();
    for (let page = 1; page <= 21; page++) await service.page(file, page);
    await service.page(file, 21);
    expect(pdf.screenshot).toHaveBeenCalledTimes(21);
    await service.page(file, 1);
    expect(pdf.screenshot).toHaveBeenCalledTimes(22);
  });

  it("touches cache hits so the least recently used page is evicted", async () => {
    const service = createPdfPreviewService({ previewEntries: 2 });
    for (const page of [1, 2, 1, 3, 1]) await service.page(file, page);
    expect(pdf.screenshot).toHaveBeenCalledTimes(3);
    await service.page(file, 2);
    expect(pdf.screenshot).toHaveBeenCalledTimes(4);
  });

  it("enforces the image-and-text memory budget independently of the page limit", async () => {
    const service = createPdfPreviewService({ previewBytes: 600 });
    for (const page of [1, 2, 2, 1]) await service.page(file, page);
    expect(pdf.screenshot).toHaveBeenCalledTimes(3);
    const oversized = createPdfPreviewService({ previewBytes: 128 });
    await oversized.page(file, 3);
    await oversized.page(file, 3);
    expect(pdf.screenshot).toHaveBeenCalledTimes(5);
  });

  it("keeps a separate bounded metadata cache and merges concurrent metadata requests", async () => {
    const otherFile = path.join(directory, "other.pdf");
    writeFileSync(otherFile, "%PDF-other");
    const service = createPdfPreviewService({ metadataEntries: 1 });
    await Promise.all([service.metadata(file), service.metadata(file)]);
    expect(pdf.info).toHaveBeenCalledOnce();
    await service.page(file, 1);
    await service.metadata(otherFile);
    await service.metadata(file);
    await service.page(file, 1);
    expect(pdf.info).toHaveBeenCalledTimes(4);
    expect(pdf.screenshot).toHaveBeenCalledOnce();
    const oversized = createPdfPreviewService({ metadataBytes: 128 });
    await oversized.metadata(file);
    await oversized.metadata(file);
    expect(pdf.info).toHaveBeenCalledTimes(6);
  });

  it("does not return stale cached data after an attachment replacement preserving mtime", async () => {
    const service = createPdfPreviewService();
    await service.page(file, 1);
    await service.metadata(file);
    const before = statSync(file);
    writeFileSync(file, "%PDF-replaced-file-with-different-bytes");
    utimesSync(file, before.atime, before.mtime);
    await service.page(file, 1);
    await service.metadata(file);
    expect(pdf.screenshot).toHaveBeenCalledTimes(2);
    expect(pdf.info).toHaveBeenCalledTimes(4);
  });

  it("destroys the worker after failure and allows retry instead of caching the rejection", async () => {
    const service = createPdfPreviewService();
    pdf.screenshot.mockRejectedValueOnce(new Error("private parse detail"));
    await expect(service.page(file, 1)).rejects.toThrow("private parse detail");
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(await service.page(file, 1)).toMatchObject({ page: 1 });
    expect(pdf.screenshot).toHaveBeenCalledTimes(2);
    expect(pdf.destroy).toHaveBeenCalledTimes(2);
  });

  it("rejects a page beyond the physical page count and still destroys its parser", async () => {
    pdf.info.mockResolvedValueOnce({ total: 3 });
    await expect(createPdfPreviewService().page(file, 4)).rejects.toMatchObject({ status: 400, message: "该 PDF 共 3 页。" });
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(pdf.screenshot).not.toHaveBeenCalled();
  });

  it("reports a missing attachment without trying to construct a parser", async () => {
    await expect(createPdfPreviewService().metadata(path.join(directory, "missing.pdf"))).rejects.toBeInstanceOf(PdfPreviewError);
    expect(pdf.constructor).not.toHaveBeenCalled();
  });
});

describe("PDF preview route contract", () => {
  it("preserves existing preview fields and adds pixel dimensions", async () => {
    const response = await request("?page=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 2, total: 100, image: expect.any(String), text: "Original reading text.", width: 1200, height: 1552 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("serves metadata without rendering or leaking private paths", async () => {
    const response = await request("?metadata=1");
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.pages[99]).toEqual({ page: 100, width: 612, height: 792 });
    expect(JSON.stringify(result)).not.toContain(file);
    expect(pdf.screenshot).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.2", "1001", "abc"])("rejects invalid page %s before opening an attachment", async (page) => {
    const response = await request(`?page=${page}`);
    expect(response.status).toBe(400);
    expect(pdf.material).not.toHaveBeenCalled();
    expect(pdf.constructor).not.toHaveBeenCalled();
  });

  it("uses 404 for missing materials, non-PDF materials, and invalid material identifiers", async () => {
    pdf.material.mockReturnValueOnce(undefined);
    expect((await request()).status).toBe(404);
    pdf.material.mockReturnValueOnce({ file_path: file, mime_type: "audio/mpeg" });
    expect((await request()).status).toBe(404);
    expect((await request("", "invalid")).status).toBe(404);
  });

  it("returns a generic 422 after parser failure, preserving no private path or error detail", async () => {
    pdf.info.mockRejectedValueOnce(new Error(`Failed reading ${file}`));
    const response = await request("?metadata=1");
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).not.toContain(file);
    expect(text).not.toContain("Failed reading");
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
});
