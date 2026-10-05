import "server-only";

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import { getPath } from "pdf-parse/worker";

export type PdfPagePreview = {
  image: string;
  text: string;
  page: number;
  total: number;
  width: number;
  height: number;
};

export type PdfPreviewMetadata = {
  total: number;
  pages: { page: number; width: number; height: number }[];
};

export class PdfPreviewError extends Error {
  constructor(message: string, public readonly status: 400 | 404) {
    super(message);
  }
}

class AsyncLruCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly sizeOf: (value: T) => number,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;

    const promise = Promise.resolve().then(load).then((value) => {
      const bytes = this.sizeOf(value);
      if (bytes <= this.maxBytes && this.maxEntries > 0) {
        while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
          const oldestKey = this.entries.keys().next().value;
          if (oldestKey === undefined) break;
          this.bytes -= this.entries.get(oldestKey)!.bytes;
          this.entries.delete(oldestKey);
        }
        this.entries.set(key, { value, bytes });
        this.bytes += bytes;
      }
      return value;
    });
    this.pending.set(key, promise);
    try { return await promise; }
    finally { this.pending.delete(key); }
  }
}

async function fileIdentity(filePath: string) {
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new PdfPreviewError("找不到 PDF 文件。", 404);
    // Restore creates new attachment paths; replacements also change this identity.
    return JSON.stringify([filePath, file.size, file.mtimeMs, file.ctimeMs, file.dev, file.ino]);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw new PdfPreviewError("找不到 PDF 文件。", 404);
    }
    throw error;
  }
}

async function withParser<T>(filePath: string, read: (parser: PDFParse) => Promise<T>) {
  const data = new Uint8Array(await readFile(filePath));
  PDFParse.setWorker(pathToFileURL(getPath()).href);
  const parser = new PDFParse({ data, isEvalSupported: false });
  try { return await read(parser); }
  finally { await parser.destroy(); }
}

function validDimensions(width: number, height: number) {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

function screenshotDimensions(data: Uint8Array) {
  const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PDF page image.");
  }
  // PDFParse reports fractional viewport sizes; PNG stores the actual canvas pixels.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!validDimensions(width, height)) throw new Error("Invalid PDF page image dimensions.");
  return { width, height };
}

type CacheLimits = {
  previewEntries: number;
  previewBytes: number;
  metadataEntries: number;
  metadataBytes: number;
};

export function createPdfPreviewService(limits: Partial<CacheLimits> = {}) {
  const previews = new AsyncLruCache<PdfPagePreview>(
    limits.previewEntries ?? 20,
    limits.previewBytes ?? 64 * 1024 * 1024,
    // Count UTF-16 storage conservatively, including the image data URL and text.
    (preview) => 2 * (preview.image.length + preview.text.length) + 256,
  );
  const metadata = new AsyncLruCache<PdfPreviewMetadata>(
    limits.metadataEntries ?? 64,
    limits.metadataBytes ?? 4 * 1024 * 1024,
    (info) => info.pages.length * 128 + 128,
  );

  return {
    async metadata(filePath: string): Promise<PdfPreviewMetadata> {
      const key = await fileIdentity(filePath);
      return metadata.get(key, () => withParser(filePath, async (parser) => {
        const info = await parser.getInfo({ parsePageInfo: true });
        if (!Number.isInteger(info.total) || info.total < 1 || info.pages.length !== info.total) {
          throw new Error("Invalid PDF page metadata.");
        }
        const pages = info.pages.map((page, index) => {
          if (page.pageNumber !== index + 1 || !validDimensions(page.width, page.height)) {
            throw new Error("Invalid PDF page dimensions.");
          }
          return { page: page.pageNumber, width: page.width, height: page.height };
        });
        return { total: info.total, pages };
      }));
    },

    async page(filePath: string, page: number): Promise<PdfPagePreview> {
      if (!Number.isInteger(page) || page < 1 || page > 1000) {
        throw new PdfPreviewError("请输入有效的 PDF 页码。", 400);
      }
      const key = `${await fileIdentity(filePath)}:${page}`;
      return previews.get(key, () => withParser(filePath, async (parser) => {
        const info = await parser.getInfo();
        if (page > info.total) throw new PdfPreviewError(`该 PDF 共 ${info.total} 页。`, 400);
        const rendered = await parser.getScreenshot({ partial: [page], desiredWidth: 1200, imageDataUrl: true, imageBuffer: false });
        const screenshot = rendered.pages[0];
        if (!screenshot?.dataUrl || screenshot.pageNumber !== page || !validDimensions(screenshot.width, screenshot.height)) {
          throw new Error("Page rendering failed.");
        }
        const dimensions = screenshotDimensions(screenshot.data);
        const text = await parser.getText({ partial: [page], pageJoiner: "" });
        return {
          image: screenshot.dataUrl,
          text: text.text,
          page,
          total: info.total,
          ...dimensions,
        };
      }));
    },
  };
}

export const pdfPreviewService = createPdfPreviewService();
