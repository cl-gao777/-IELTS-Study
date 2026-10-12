import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDatabase: () => { throw new Error("Use an isolated test database"); } }));
import { parseVocabularyDelimited, vocabularyRowsToEntries } from "../lib/vocabulary-import";
import { readVocabularyImportFile, validateVocabularyXlsxArchive } from "./vocabulary-import-file";
import { confirmVocabularyImport, createVocabularyImportPreview } from "./vocabulary-import";
import { listVocabularyCatalogEntries, registerVocabularyCourse } from "./vocabulary-courses";

let database: Database.Database;
beforeEach(() => { database = new Database(":memory:"); database.exec("CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY);CREATE TABLE vocabulary_reviews(id INTEGER PRIMARY KEY);"); });
afterEach(() => database.close());
describe("vocabulary file import", () => {
  it("parses BOM, quoted commas/newlines and TSV with optional fields", async () => {
    const rows = parseVocabularyDelimited('\ufeffword,中文,example\r\nnotice,注意,"Notice the label, please."\r\nlook,看,"look\nagain"', ',');
    const entries = vocabularyRowsToEntries(rows);
    expect(entries[0]).toMatchObject({ term: "notice", meaningZh: "注意", example: "Notice the label, please.", status: "new" });
    expect(entries[1].example).toBe("look\nagain");
    expect(await readVocabularyImportFile("minimal.txt", Buffer.from("notice\nlook"))).toEqual([["notice"], ["look"]]);
    expect(await readVocabularyImportFile("词表.csv", Buffer.from("\ufeffword\t中文\nnotice\t注意"))).toEqual([["word", "中文"], ["notice", "注意"]]);
    expect(() => parseVocabularyDelimited('"broken', ',')).toThrow("未闭合");
  });
  it("previews duplicates/invalid rows and confirms catalog membership without changing old words", () => {
    registerVocabularyCourse({ id: "old", title: "Old", description: "", kind: "user-import", version: 1 }, [{ term: "notice", meaningZh: "原释义" }], database);
    const preview = createVocabularyImportPreview("mine.csv", [["word", "中文"], ["NOTICE", "不得覆写"], ["notice", "重复"], ["new", "新"], ["", "缺词"], ["=SUM(A1)", "公式"]], database);
    expect(preview.summary).toEqual({ total: 5, new: 1, existing: 1, duplicate: 1, invalid: 2 });
    expect(preview.readiness).toEqual({ ready: 0, pending: 2 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM vocabulary_words").get()).toEqual({ n: 0 });
    const result = confirmVocabularyImport(preview.previewId, 1, "我的词表", database);
    expect(result).toMatchObject({ added: 1, existing: 1, skipped: 3 });
    expect(result.readiness).toEqual({ ready: 0, pending: 2 });
    expect(listVocabularyCatalogEntries(result.courseId, database).find((entry) => entry.term === "new")?.status).toBe("draft");
    expect(listVocabularyCatalogEntries(result.courseId, database).find((entry) => entry.term === "notice")?.meaningZh).toBe("原释义");
    expect(database.prepare("SELECT COUNT(*) AS n FROM vocabulary_words").get()).toEqual({ n: 0 });
    expect(confirmVocabularyImport(preview.previewId, 1, "我的词表", database)).toEqual(result);
    expect(confirmVocabularyImport(preview.previewId, 1, "我的词表", database, new Date("2099-01-01"))).toEqual(result);
    expect(database.prepare("SELECT COUNT(*) AS n FROM vocabulary_courses").get()).toEqual({ n: 2 });
    expect(() => confirmVocabularyImport(preview.previewId, 1, "Duplicate", database)).toThrow();
    database.prepare("UPDATE vocabulary_import_previews SET revision=revision+2").run();
    expect(() => confirmVocabularyImport(preview.previewId, 1, "我的词表", database)).toThrow();
  });
  it("allows an all-existing word list to become a course without overwriting its published content", () => {
    registerVocabularyCourse({ id: "old", title: "Old", description: "", kind: "builtin", version: 1 }, [{ term: "notice", meaningZh: "注意", definitionEn: "To become aware of something.", partOfSpeech: "verb",
      exercises: ["We notice a small change.", "They notice the unusual sound."].map((sentence, index) => ({ id: `ex-${index}`, status: "published" as const, version: 1, sentence, targetStart: sentence.indexOf("notice"), targetEnd: sentence.indexOf("notice") + 6, targetSurface: "notice", acceptedAnswers: ["notice"], meaningZh: "注意", source: "Original test fixture" })) }], database);
    const preview = createVocabularyImportPreview("mine.txt", [["notice"]], database);
    expect(preview.summary).toMatchObject({ new: 0, existing: 1 }); expect(preview.readiness).toEqual({ ready: 1, pending: 0 });
    const result = confirmVocabularyImport(preview.previewId, preview.revision, "已学词合集", database);
    expect(result).toMatchObject({ added: 0, existing: 1, readiness: { ready: 1, pending: 0 } });
    expect(listVocabularyCatalogEntries(result.courseId, database)[0]).toMatchObject({ status: "published", meaningZh: "注意" });
  });
  it("rejects expired and stale previews without registering a course", () => {
    const preview = createVocabularyImportPreview("mine.txt", [["word"], ["notice"]], database, new Date("2026-01-01"));
    expect(() => confirmVocabularyImport(preview.previewId, 1, "Expired", database, new Date("2026-01-03"))).toThrow("失效");
    expect(() => confirmVocabularyImport(preview.previewId, 2, "Stale", database, new Date("2026-01-01"))).toThrow("失效");
    expect(database.prepare("SELECT COUNT(*) AS n FROM vocabulary_courses").get()).toEqual({ n: 0 });
  });
  it("keeps a literal first word called word or term in a plain one-word-per-line TXT", () => {
    const preview = createVocabularyImportPreview("plain.txt", [["word"], ["term"], ["notice"]], database);
    expect(preview.entries.map((entry) => entry.term)).toEqual(["word", "term", "notice"]);
  });
  it("reads genuine XLSX but rejects formulas and hyperlinks before registering anything", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Words"); sheet.addRows([["word", "中文"], ["notice", "注意"]]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(await readVocabularyImportFile("words.xlsx", bytes)).toEqual([["word", "中文"], ["notice", "注意"]]);
    sheet.getCell("A2").value = { formula: '"notice"', result: "notice" };
    await expect(readVocabularyImportFile("formula.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow("公式");
    sheet.getCell("A2").value = { text: "notice", hyperlink: "https://example.invalid" };
    await expect(readVocabularyImportFile("link.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow("超链接");
    await expect(readVocabularyImportFile("macro.xlsm", bytes)).rejects.toThrow("仅支持");
  });
  it("bounds ZIP expansion, entry count, corrupt archives, file size and row count", async () => {
    const book = new ExcelJS.Workbook(); book.addWorksheet("Words").addRow(["notice"]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer()), corrupt = Buffer.from(bytes);
    const central = corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); corrupt.writeUInt32LE(30 * 1024 * 1024, central + 24);
    expect(() => validateVocabularyXlsxArchive(corrupt)).toThrow("过大");
    const count = Buffer.from(bytes); count.writeUInt16LE(301, count.length - 12);
    expect(() => validateVocabularyXlsxArchive(count)).toThrow("压缩结构");
    expect(() => validateVocabularyXlsxArchive(Buffer.from("invalid"))).toThrow("压缩包");
    await expect(readVocabularyImportFile("large.txt", Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("5 MB");
    expect(() => vocabularyRowsToEntries(Array.from({ length: 5001 }, () => ["notice"]))).toThrow("5000");
  });
});
