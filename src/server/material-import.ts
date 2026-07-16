import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";

import type { SourceMaterial } from "@/lib/domain";

import { addFileMaterial } from "./store";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function safeExtension(fileName: string) {
  return path
    .extname(fileName)
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 12);
}

async function extractText(buffer: Buffer, file: File) {
  const extension = path.extname(file.name).toLocaleLowerCase("en");
  if (
    file.type.startsWith("text/") ||
    [".txt", ".md", ".csv", ".tsv", ".json"].includes(extension)
  ) {
    return buffer.toString("utf8");
  }
  if (file.type === "application/pdf" || extension === ".pdf") {
    return (await pdf(buffer)).text.trim();
  }
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    return (await mammoth.extractRawText({ buffer })).value.trim();
  }
  if (file.type.startsWith("audio/")) {
    return "Audio source saved. Add or paste a transcript to turn it into an editable listening exercise.";
  }
  if (file.type.startsWith("image/")) {
    return "Image source saved. Paste any relevant text or questions into the content field for editing.";
  }
  return "Binary source saved without automatic text extraction.";
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
  const uploadDirectory = path.join(process.cwd(), "data", "uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const storedName = `${randomUUID()}${safeExtension(input.file.name)}`;
  const storedPath = path.join(uploadDirectory, storedName);
  await writeFile(storedPath, buffer);
  const content = await extractText(buffer, input.file);

  return addFileMaterial({
    title: input.title || input.file.name,
    kind: input.kind,
    content,
    sourceUrl: input.sourceUrl,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    filePath: storedPath,
  });
}
