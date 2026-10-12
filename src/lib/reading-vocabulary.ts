/** Conservative extraction: question instructions and uncertain fragments are excluded. */
export interface ReadingTextPage { page: number; text: string }
export interface ReadingBody { text: string; pages: { page: number; start: number; end: number }[]; warnings: string[] }
const questionBoundary = /^(?:questions?\s*\d+|answer\s*(?:key|sheet|s)?\b|reference\s+answers?\b|答案|参考答案)/i;
const instruction = /^(?:you should spend|reading passage\s*\d+|academic reading|ielts academic|write your answers|choose (?:the|one)|complete the|look at the|do the following|read the following|\d+\s*[-–]\s*\d+\s*$|true\s*false|yes\s*no)/i;
const pageFurniture = /^(?:page\s*\d+|\d+\s*(?:\/\s*\d+)?|©|copyright|all rights reserved|british council|ielts\.org|www\.|https?:\/\/|\s*idp\s*$|test taker)/i;

export function extractReadingBody(input: readonly ReadingTextPage[]): ReadingBody {
  const output: ReadingBody = { text: "", pages: [], warnings: [] };
  let ended = false;
  for (const page of input) {
    if (ended) break;
    const kept: string[] = [];
    for (const line of page.text.replace(/\r/g, "").split("\n")) {
      const text = line.trim();
      if (questionBoundary.test(text)) { ended = true; output.warnings.push(`第 ${page.page} 页在题目边界截断`); break; }
      if (!text) { kept.push("\n"); continue; }
      if (instruction.test(text) || pageFurniture.test(text)) continue;
      // Short headings and paragraph labels are not sentence text.
      if (/^[A-H]$/.test(text) || /^[A-Z\s\d,:;’'\-]{8,}$/.test(text)) continue;
      const words = text.match(/[A-Za-z]+/g) ?? [];
      if (!/[.!?]$/.test(text) && words.length > 1 && words.length < 12 && words.every((word) => /^[A-Z]/.test(word))) continue;
      kept.push(text);
    }
    const cleaned = kept.join(" ").replace(/([a-z])-\s+([a-z])/g, "$1$2")
      .replace(/\s+/g, " ").replace(/^[A-H]\s+(?=[A-Z][a-z])/, "").trim();
    if (!cleaned) continue;
    const continuedWord = /[a-z]-$/.test(output.text) && /^[a-z]/.test(cleaned);
    if (continuedWord) {
      output.text = output.text.slice(0, -1);
      const previous = output.pages.at(-1);
      if (previous) previous.end = output.text.length;
      output.warnings.push(`第 ${page.page} 页连接跨页断词`);
    }
    const separator = output.text && !continuedWord ? " " : "";
    const start = output.text.length + separator.length;
    output.text += separator + cleaned;
    output.pages.push({ page: page.page, start, end: output.text.length });
  }
  return output;
}

export interface ReadingSentence { sentence: string; start: number; end: number; pdfPage: number; endPdfPage: number }
export function readingBodySentences(body: ReadingBody): ReadingSentence[] {
  const sentences: ReadingSentence[] = [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const segment of segmenter.segment(body.text)) {
    const sentence = segment.segment.trim();
    const count = (sentence.match(/[A-Za-z]+/g) ?? []).length;
    if (count < 5 || count > 75 || !/[.!?]["'”’)]?$/.test(sentence)) continue;
    if (/(?:choose (?:the|one)|write your answer|true,? false|not given|which paragraph|complete the table|answer sheet|questions? \d)/i.test(sentence)) continue;
    const start = segment.index + segment.segment.indexOf(sentence);
    const end = start + sentence.length;
    const first = body.pages.find((page) => start >= page.start && start < page.end);
    const last = body.pages.find((page) => end > page.start && end <= page.end);
    if (first && last) sentences.push({ sentence, start, end, pdfPage: first.page, endPdfPage: last.page });
  }
  return sentences;
}

/** Candidate lemmatisation never expands accepted answers: each cloze keeps its actual surface. */
export function readingTargetLemma(surface: string, members: ReadonlySet<string>): string | null {
  const value = surface.toLowerCase();
  if (members.has(value)) return value;
  const candidates = new Set<string>();
  if (value.endsWith("ies")) candidates.add(value.slice(0, -3) + "y");
  if (value.endsWith("ied")) candidates.add(value.slice(0, -3) + "y");
  if (value.endsWith("s") && !value.endsWith("ss")) candidates.add(value.slice(0, -1));
  if (value.endsWith("es")) candidates.add(value.slice(0, -2));
  for (const suffix of ["ed", "ing"]) if (value.endsWith(suffix)) {
    const stem = value.slice(0, -suffix.length); candidates.add(stem); candidates.add(stem + "e");
    if (/(.)\1$/.test(stem)) candidates.add(stem.slice(0, -1));
  }
  const present = [...candidates].filter((term) => members.has(term));
  return present.length === 1 ? present[0] : null;
}
