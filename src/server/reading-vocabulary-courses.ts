import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { officialResourceSchema, type ReadingPassage } from "@/lib/official-resources";
import { extractReadingBody, readingBodySentences, readingTargetLemma } from "@/lib/reading-vocabulary";
import { vocabularyCatalogEntrySchema, type VocabularyCatalogEntry, type VocabularyExercise } from "@/lib/vocabulary-course";
import { getDatabase } from "./db";
import { pdfPreviewService } from "./pdf-preview";
import { listVocabularyCatalogEntries, loadVocabularyCatalog, registerVocabularyCourse } from "./vocabulary-courses";

type Material = { id: number; file_path: string; mime_type: string };
type SetRow = { id: string; title: string; resource_json: string };
export interface ReadingCourseBuildReport { courses: number; candidates: number; files: number; warnings: string[] }
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
let indexing: Promise<ReadingCourseBuildReport | null> | undefined;

/** Also covers future imported Practice Sets after their Passage metadata is saved. */
export async function ensureReadingVocabularyCourses(database = getDatabase()) {
  if (indexing) return indexing;
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='practice_sets'").get()) return null;
  loadVocabularyCatalog(database);
  const courses = new Set((database.prepare("SELECT id FROM vocabulary_courses").all() as { id: string }[]).map((course) => course.id));
  const sets = database.prepare("SELECT id,resource_json FROM practice_sets WHERE kind='reading'").all() as Pick<SetRow, "id" | "resource_json">[];
  const missing = sets.some((set) => {
    const parsed = officialResourceSchema.safeParse(JSON.parse(set.resource_json || "{}"));
    return parsed.success && parsed.data.readingPassages?.some((passage) => !courses.has(`reading:${set.id}:${passage.id}`));
  });
  if (!missing) return null;
  indexing = buildReadingVocabularyCourses(database);
  try { return await indexing; } finally { indexing = undefined; }
}

/** Private content never goes into a source file, telemetry, or an external service. */
export async function buildReadingVocabularyCourses(database = getDatabase(), setId?: string): Promise<ReadingCourseBuildReport> {
  loadVocabularyCatalog(database);
  const catalog = listVocabularyCatalogEntries(undefined, database);
  const members = new Map<string, VocabularyCatalogEntry>();
  for (const entry of catalog) {
    members.set(entry.term.toLowerCase(), entry);
    for (const exercise of entry.exercises) for (const answer of exercise.acceptedAnswers)
      if (/^[a-z]+$/i.test(answer)) members.set(answer.toLowerCase(), entry);
  }
  const known = new Set(members.keys());
  const rows = database.prepare(`SELECT id,title,resource_json FROM practice_sets WHERE kind='reading' ${setId ? "AND id=?" : ""} ORDER BY id`).all(...(setId ? [setId] : [])) as SetRow[];
  const mappings: { set: SetRow; passage: ReadingPassage }[] = [];
  const report: ReadingCourseBuildReport = { courses: 0, candidates: 0, files: 0, warnings: [] };
  const requests = new Map<number, { material: Material; pages: Set<number>; expected: Set<string> }>();
  for (const set of rows) {
    const resource = officialResourceSchema.safeParse(JSON.parse(set.resource_json || "{}"));
    if (!resource.success || !resource.data.readingPassages) continue;
    for (const passage of resource.data.readingPassages) {
      mappings.push({ set, passage });
      for (const document of passage.documents) {
        const id = Number(document.url.split("/").at(-1));
        const material = database.prepare("SELECT id,file_path,mime_type FROM source_materials WHERE id=?").get(id) as Material | undefined;
        if (!material?.file_path || material.mime_type !== "application/pdf") { report.warnings.push(`${set.title} / ${passage.label} 缺少可用原文 PDF`); continue; }
        const request = requests.get(id) ?? { material, pages: new Set<number>(), expected: new Set<string>() };
        for (let page = document.page; page <= document.endPage; page++) request.pages.add(page);
        if (document.sha256) request.expected.add(document.sha256);
        requests.set(id, request);
      }
    }
  }
  const extracted = new Map<number, { sha: string; pages: Map<number, string> }>();
  const jobs = [...requests.values()]; let index = 0;
  // Limit extraction to two local parsers; each physical file is read only once.
  await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, async () => {
    while (index < jobs.length) {
      const request = jobs[index++];
      try {
        const sha = digest(await readFile(request.material.file_path));
        if ([...request.expected].some((expected) => expected !== sha)) throw new Error("文件校验值与分篇记录不一致");
        const pages = await pdfPreviewService.text(request.material.file_path, [...request.pages]);
        extracted.set(request.material.id, { sha, pages: new Map(pages.map((page) => [page.page, page.text])) });
        report.files++;
      } catch (error) {
        report.warnings.push(`材料 ${request.material.id} 提取失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    }
  }));
  for (const { set, passage } of mappings) {
    const courseId = `reading:${set.id}:${passage.id}`;
    const passageTitle = passage.label.trim() === set.title.trim() ? set.title : `${set.title} · ${passage.label}`;
    const candidates = new Map<string, { entry: VocabularyCatalogEntry; contexts: VocabularyExercise[] }>();
    for (const document of passage.documents) {
      const materialId = Number(document.url.split("/").at(-1)); const source = extracted.get(materialId);
      if (!source) continue;
      const pages = Array.from({ length: document.endPage - document.page + 1 }, (_, at) => ({ page: document.page + at, text: source.pages.get(document.page + at) ?? "" }));
      const body = extractReadingBody(pages);
      for (const sentence of readingBodySentences(body)) {
        for (const token of sentence.sentence.matchAll(/[A-Za-z]+(?:['’][a-z]+)?/g)) {
          const lemma = readingTargetLemma(token[0], known); const entry = lemma ? members.get(lemma) : null;
          if (!entry || (entry.courseIds.includes("general") && entry.rank <= 500)) continue;
          const item = candidates.get(entry.id) ?? { entry, contexts: [] };
          if (item.contexts.length >= 2 || item.contexts.some((exercise) => exercise.sentence === sentence.sentence)) continue;
          const targetStart = token.index!;
          const exercise = {
            id: `reading:${digest(`${courseId}:${source.sha}:${sentence.start}:${targetStart}`).slice(0, 32)}`,
            version: 1, status: "draft" as const, sentence: sentence.sentence,
            targetStart, targetEnd: targetStart + token[0].length, targetSurface: token[0], acceptedAnswers: [token[0]],
            meaningZh: entry.meaningZh, source: `${passageTitle} · PDF 第 ${sentence.pdfPage}${sentence.endPdfPage !== sentence.pdfPage ? `–${sentence.endPdfPage}` : ""} 页（原句待核对）`,
            sourceReference: { materialId: String(materialId), fileSha256: source.sha, passageId: passage.id,
              pdfPage: sentence.pdfPage, endPdfPage: sentence.endPdfPage, textVersion: "reading-body-v1" as const,
              start: sentence.start, end: sentence.end, quote: sentence.sentence },
          };
          item.contexts.push(exercise); candidates.set(entry.id, item);
        }
      }
    }
    const selected = [...candidates.values()].sort((left, right) => Number(!left.entry.courseIds.includes("academic")) - Number(!right.entry.courseIds.includes("academic")) || left.entry.rank - right.entry.rank).slice(0, 40);
    const course = { id: courseId, title: passageTitle.slice(0, 200), kind: "user-import" as const, version: 1,
      description: `本地阅读词汇，${selected.length} 个词。原文与题目已按篇分离，原句带文件 SHA、页码和位置。提取原句须核对后才用于练习；已发布的公共原创题仍可学习。` };
    const entries = selected.map(({ entry, contexts }) => {
      // Re-read before merging so earlier Passage registrations aren't overwritten.
      const row = database.prepare("SELECT data_json FROM vocabulary_catalog_entries WHERE id=?").get(entry.id) as { data_json: string };
      const current = vocabularyCatalogEntrySchema.parse(JSON.parse(row.data_json));
      const ids = new Set(current.exercises.map((exercise) => exercise.id));
      const added = contexts.filter((exercise) => !ids.has(exercise.id)); report.candidates += added.length;
      return { ...current, exercises: [...current.exercises, ...added] };
    });
    registerVocabularyCourse(course, entries, database, true); report.courses++;
  }
  return report;
}
