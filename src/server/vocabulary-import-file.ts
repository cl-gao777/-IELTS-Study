import "server-only";
import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { parseVocabularyDelimited, VOCABULARY_IMPORT_LIMIT } from "@/lib/vocabulary-import";

export const MAX_VOCABULARY_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 25 * 1024 * 1024;

/** Inspect and bounded-inflate every ZIP member before the spreadsheet parser allocates it. */
export function validateVocabularyXlsxArchive(bytes: Buffer) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new Error("Excel 文件不是有效的 XLSX 压缩包。");
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count > 300 || count < 1 || start + size > end) throw new Error("不支持此 Excel 压缩结构。");
  let at = start, total = 0; const names = new Set<string>();
  for (let item = 0; item < count; item++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("Excel 压缩目录损坏。");
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), compressed = bytes.readUInt32LE(at + 20), expanded = bytes.readUInt32LE(at + 24);
    const nameSize = bytes.readUInt16LE(at + 28), extraSize = bytes.readUInt16LE(at + 30), commentSize = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
    if (at + 46 + nameSize + extraSize + commentSize > end || flags & 1 || ![0, 8].includes(method) || [compressed, expanded, local].includes(0xffffffff)) throw new Error("不支持加密、ZIP64 或异常压缩的 Excel 文件。");
    const name = bytes.toString("utf8", at + 46, at + 46 + nameSize);
    if (names.has(name) || name.includes("\\") || name.split("/").includes("..") || name.startsWith("/") || /vbaProject|externalLinks|embeddings\//i.test(name)) throw new Error("Excel 含不允许的宏、外部链接或嵌入文件。");
    names.add(name);
    if (expanded > 16 * 1024 * 1024 || expanded > MAX_EXPANDED_BYTES - total || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("Excel 解压后过大或文件结构损坏。");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start) throw new Error("Excel 压缩内容越界。");
    let content: Buffer;
    try { content = method === 0 ? bytes.subarray(dataStart, dataStart + compressed) : inflateRawSync(bytes.subarray(dataStart, dataStart + compressed), { maxOutputLength: Math.max(1, Math.min(16 * 1024 * 1024, MAX_EXPANDED_BYTES - total)) }); }
    catch { throw new Error("Excel 解压后超过安全限制或文件损坏。"); }
    if (content.length !== expanded) throw new Error("Excel 压缩大小校验失败。");
    total += content.length;
    if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY|<f(?:\s|>)/i.test(content.toString("utf8"))) throw new Error("Excel 公式或外部实体不能导入，请先转换为纯文本值。");
    at += 46 + nameSize + extraSize + commentSize;
  }
  if (at !== start + size || !names.has("xl/workbook.xml")) throw new Error("Excel 工作簿结构无效。");
}

export async function readVocabularyImportFile(fileName: string, bytes: Buffer): Promise<string[][]> {
  if (!bytes.length || bytes.length > MAX_VOCABULARY_IMPORT_BYTES) throw new Error("词表文件须为 1 字节至 5 MB。");
  const extension = fileName.toLowerCase().split(".").at(-1);
  if (extension === "xlsx") {
    validateVocabularyXlsxArchive(bytes);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheets = book.worksheets.filter((sheet) => sheet.actualRowCount > 0);
    if (sheets.length !== 1) throw new Error("请使用只包含一个非空工作表的 Excel 词表。");
    const sheet = sheets[0];
    if (sheet.rowCount > VOCABULARY_IMPORT_LIMIT + 1 || sheet.columnCount > 50) throw new Error("Excel 最多支持 5000 个词条、50 列。");
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = Array.from({ length: sheet.columnCount }, (_, at) => {
        const cell = row.getCell(at + 1), value = cell.value;
        if (value === null || value === undefined) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
        if ("richText" in value) return value.richText.map((part) => part.text).join("");
        throw new Error("Excel 含公式、日期或超链接，请先转换为纯文本值。");
      });
      if (values.some((value) => value.length > 10000)) throw new Error("Excel 单元格过长。");
      if (values.some((value) => value.trim())) rows.push(values);
    });
    return rows;
  }
  if (!["txt", "csv", "tsv"].includes(extension || "")) throw new Error("仅支持 TXT、CSV、TSV 和 XLSX 词表。");
  let text: string;
  try { text = new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("词表编码无法识别，请另存为 UTF-8 CSV 或 TXT。"); }
  if (text.includes("\0")) throw new Error("词表包含异常二进制字符。");
  return parseVocabularyDelimited(text, extension === "tsv" || text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",");
}
