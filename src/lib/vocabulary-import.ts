import { normaliseVocabularyAnswer, vocabularyInputSchema, type VocabularyInput } from "./vocabulary";

export const VOCABULARY_IMPORT_LIMIT = 5000;
export type VocabularyImportRow = VocabularyInput & { row: number; status: "new" | "existing" | "duplicate" | "invalid"; issues: string[] };
export interface VocabularyImportPreview {
  previewId: string; revision: number; fileName: string; expiresAt: string;
  summary: { total: number; new: number; existing: number; duplicate: number; invalid: number };
  readiness: { ready: number; pending: number };
  confirmation?: VocabularyImportConfirmation;
  confirmedTitle?: string;
  entries: VocabularyImportRow[];
}
export interface VocabularyImportConfirmation { courseId: string; added: number; skipped: number; existing: number; readiness: { ready: number; pending: number } }
const aliases: Record<string, keyof VocabularyInput> = {
  term: "term", word: "term", vocabulary: "term", 单词: "term", 词语: "term", 词条: "term",
  meaning: "meaningZh", meaningzh: "meaningZh", translation: "meaningZh", 释义: "meaningZh", 中文: "meaningZh", 中文释义: "meaningZh",
  definition: "definitionEn", definitionen: "definitionEn", 英文释义: "definitionEn",
  pos: "partOfSpeech", partofspeech: "partOfSpeech", 词性: "partOfSpeech",
  lemma: "lemma", 原形: "lemma", ipa: "ipa", 音标: "ipa", pronunciation: "pronunciation",
  example: "example", 例句: "example", sourcesentence: "sourceSentence", 来源句: "sourceSentence",
  sourcematerial: "sourceMaterial", 来源: "sourceMaterial", notes: "notes", 备注: "notes", tags: "tags", 标签: "tags",
  collocations: "collocations", 搭配: "collocations", synonyms: "synonyms", antonyms: "antonyms", wordfamily: "wordFamily",
};
const listFields = new Set(["tags", "collocations", "synonyms", "antonyms", "wordFamily"]);
const headerKey = (text: string) => text.trim().toLowerCase().replace(/[\s_\-]/g, "");
export const normalizedImportTerm = normaliseVocabularyAnswer;

/** RFC-style quoted CSV/TSV, including escaped quotes and embedded newlines. */
export function parseVocabularyDelimited(text: string, delimiter: "," | "\t") {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ""; closed = false; if (row.length > 50) throw new Error("词表最多支持 50 列。"); };
  const pushRow = () => { pushCell(); if (row.some((value) => value.trim())) rows.push(row); row = []; if (rows.length > VOCABULARY_IMPORT_LIMIT + 1) throw new Error("每次最多导入 5000 个词条。"); };
  const source = text.replace(/^\ufeff/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === delimiter) pushCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[i + 1] === "\n") i++; pushRow(); }
    else { if (closed && char.trim()) throw new Error("CSV 引号后的内容无效，请检查文件格式。"); if (!closed) cell += char; }
    if (cell.length > 10000) throw new Error("单元格过长，请缩短内容后重试。");
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  if (cell || row.length) pushRow();
  return rows;
}

export function vocabularyRowsToEntries(rows: string[][], existingTerms: ReadonlySet<string> = new Set(), explicitHeader?: boolean): VocabularyImportRow[] {
  if (!rows.length) throw new Error("词表没有可导入内容。");
  const headers = rows[0].map((value) => aliases[headerKey(value)]);
  const hasHeader = explicitHeader ?? headers.includes("term");
  const data = hasHeader ? rows.slice(1) : rows;
  if (!data.length || data.length > VOCABULARY_IMPORT_LIMIT) throw new Error("词表需要包含 1–5000 个词条。");
  const seen = new Set<string>();
  return data.map((cells, index) => {
    const input: Record<string, unknown> = {};
    const fields = hasHeader ? headers : ["term", "meaningZh"];
    fields.forEach((field, at) => { if (field) input[field] = listFields.has(field) ? (cells[at] || "").split(/[;；|]/).map((item) => item.trim()).filter(Boolean) : cells[at] || ""; });
    const result = vocabularyInputSchema.safeParse(input);
    const term = String(input.term || "").trim();
    const issues = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    if (cells.some((value) => /^[=+@]/.test(value.trim()) || /^-[^A-Za-z]/.test(value.trim()))) issues.push("公式或公式前缀不能作为词表内容导入。");
    const value = result.success ? result.data : { ...vocabularyInputSchema.parse({ term: term.slice(0, 100) || "（空词条）" }), term };
    const key = normalizedImportTerm(term);
    const status = issues.length ? "invalid" : seen.has(key) ? "duplicate" : existingTerms.has(key) ? "existing" : "new";
    if (key && status !== "invalid") seen.add(key);
    return { ...value, row: index + (hasHeader ? 2 : 1), status, issues };
  });
}

export function summarizeVocabularyImport(entries: VocabularyImportRow[]): VocabularyImportPreview["summary"] {
  return entries.reduce((summary, row) => ({ ...summary, [row.status]: summary[row.status] + 1 }), { total: entries.length, new: 0, existing: 0, duplicate: 0, invalid: 0 });
}
