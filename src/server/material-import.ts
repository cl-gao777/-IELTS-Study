import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import mammoth from "mammoth";
import { getPath } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

import type { SourceMaterial } from "@/lib/domain";
import { htmlToPlainText } from "@/lib/material-text";

import { addFileMaterial } from "./store";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function safeExtension(fileName: string) {
  return path
    .extname(fileName)
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 12);
}

export async function extractMaterialText(buffer: Buffer, file: File) {
  const extension = path.extname(file.name).toLocaleLowerCase("en");
  if ([".html", ".htm"].includes(extension) || file.type === "text/html") return htmlToPlainText(buffer.toString("utf8"));
  if (
    file.type.startsWith("text/") ||
    [".txt", ".md", ".csv", ".tsv", ".json"].includes(extension)
  ) {
    return buffer.toString("utf8");
  }
  if (file.type === "application/pdf" || extension === ".pdf") {
    // Use the package's local worker, never a CDN. A separate Uint8Array avoids
    // transferring a pooled Node Buffer's backing store on modern Node/Windows.
    PDFParse.setWorker(pathToFileURL(getPath()).href);
    const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
    try { return (await parser.getText({ pageJoiner: "\n\n" })).text.trim(); }
    finally { await parser.destroy(); }
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    return (await mammoth.extractRawText({ buffer })).value.trim();
  }
  if (file.type.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".ogg", ".webm"].includes(extension)) {
    return "";
  }
  if (file.type.startsWith("image/")) {
    return "Image source saved. Paste any relevant text or questions into the content field for editing.";
  }
  throw new Error("支持 TXT、Markdown、HTML、PDF、DOCX、图片和 MP3/WAV/M4A 音频。");
}

export async function importMaterialFile(input: {
  file: File;
  title: string;
  kind: SourceMaterial["kind"];
  sourceUrl: string;
}) {
  if (input.file.size <= 0 || input.file.size > MAX_FILE_SIZE) {
    throw new Error("File size must be between 1 byte and 25 MB.");
  }
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const content = await extractMaterialText(buffer, input.file);
  const configuredUploadDirectory =
    process.env.UPLOAD_DIR?.trim() || "./data/uploads";
  const uploadDirectory = path.isAbsolute(configuredUploadDirectory)
    ? configuredUploadDirectory
    : path.join(
        /* turbopackIgnore: true */ process.cwd(),
        configuredUploadDirectory,
      );
  await mkdir(uploadDirectory, { recursive: true });
  const storedName = `${randomUUID()}${safeExtension(input.file.name)}`;
  const storedPath = path.join(uploadDirectory, storedName);
  await writeFile(storedPath, buffer);
  const audioMime: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".webm": "audio/webm" };
  const mimeType = audioMime[safeExtension(input.file.name)] || input.file.type || "application/octet-stream";
  try { return addFileMaterial({
    title: input.title || input.file.name,
    kind: mimeType.startsWith("audio/") ? "listening" : input.kind,
    content,
    sourceUrl: input.sourceUrl,
    fileName: input.file.name,
    mimeType,
    filePath: storedPath,
  }); } catch (error) { await unlink(storedPath).catch(() => undefined); throw error; }
}
