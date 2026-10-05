import { z } from "zod";
import type { PracticeSet } from "./domain";

const sourceUrl = z.string().url().refine((url) => {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}, "来源必须为 HTTPS");
const optionalSourceUrl = z.union([sourceUrl, z.literal("")]).default("");
const documentSchema = z.object({
  label: z.string().min(1).max(150),
  url: z.string().regex(/^\/api\/uploads\/\d+$/),
  sourceUrl: optionalSourceUrl,
  page: z.number().int().positive().optional(),
  endPage: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const readingDocumentSchema = documentSchema.extend({
  page: z.number().int().positive(),
  endPage: z.number().int().positive(),
}).refine((document) => document.endPage >= document.page, "阅读页范围的结束页不能早于起始页");

const readingPassageSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  documents: z.array(readingDocumentSchema).min(1),
  questionIds: z.array(z.string().trim().min(1).max(100)).max(80),
});

export const officialResourceSchema = z.object({
  provider: z.string().min(1),
  classification: z.enum(["official-practice", "authentic-practice", "user-supplied"]),
  sourceUrl: optionalSourceUrl,
  licenseUrl: optionalSourceUrl,
  copyright: z.string().min(1),
  verifiedAt: z.string().min(1),
  notes: z.string().default(""),
  issues: z.array(z.string().min(1).max(1000)).max(20).default([]),
  bandEstimateAllowed: z.boolean().optional(),
  collectionYear: z.number().int().min(1980).max(2100).optional(),
  originalFileName: z.string().max(250).optional(),
  originalPath: z.string().max(2000).optional(),
  questionDocuments: z.array(documentSchema).min(1),
  answerDocuments: z.array(documentSchema).default([]),
  audioTracks: z.array(documentSchema).default([]),
  transcriptDocuments: z.array(documentSchema).default([]),
  readingPassages: z.array(readingPassageSchema).min(1).optional(),
}).superRefine((resource, context) => {
  const passages = resource.readingPassages ?? [];
  if (new Set(passages.map((passage) => passage.id)).size !== passages.length) {
    context.addIssue({ code: "custom", message: "阅读篇章 ID 不能重复", path: ["readingPassages"] });
  }
  for (const [passageIndex, passage] of passages.entries()) {
    for (const [documentIndex, document] of passage.documents.entries()) {
      const original = resource.questionDocuments.find((item) => item.url === document.url);
      if (!original || (original.sha256 && document.sha256 && original.sha256 !== document.sha256)) {
        context.addIssue({ code: "custom", message: "阅读篇章缺少关联的原题 PDF", path: ["readingPassages", passageIndex, "documents", documentIndex] });
      }
      if (resource.answerDocuments.some((answer) => answer.url === document.url && document.endPage >= (answer.page ?? 1))) {
        context.addIssue({ code: "custom", message: "阅读页范围不能包含参考答案页", path: ["readingPassages", passageIndex, "documents", documentIndex, "endPage"] });
      }
    }
  }
  if (resource.classification !== "user-supplied" && (!resource.sourceUrl || !resource.licenseUrl)) {
    context.addIssue({ code: "custom", message: "官方资源必须保留来源与版权链接。" });
  }
  for (const document of [...resource.questionDocuments, ...resource.answerDocuments, ...resource.audioTracks, ...resource.transcriptDocuments, ...passages.flatMap((passage) => passage.documents)]) {
    if (resource.classification !== "user-supplied" && !document.sourceUrl) context.addIssue({ code: "custom", message: "官方文件必须保留来源链接。" });
  }
});

export type OfficialPracticeResource = z.infer<typeof officialResourceSchema>;
export type OfficialDocument = z.infer<typeof documentSchema>;
export type ReadingPassage = z.infer<typeof readingPassageSchema>;

/** A Passage filters the view; it must never remove a question from the full Practice Set. */
export function validateReadingPassages(set: Pick<PracticeSet, "kind" | "questions" | "resource">): void {
  const passages = set.resource?.readingPassages;
  if (!passages) return;
  if (set.kind !== "reading") throw new Error("只有阅读练习可以配置阅读篇章");
  const questions = new Map(set.questions.map((question) => [question.id, question]));
  if (questions.size !== set.questions.length) throw new Error("练习题目 ID 不能重复");
  const assigned = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const passage of passages) {
    for (const id of passage.questionIds) {
      const question = questions.get(id);
      if (!question) throw new Error("阅读篇章引用了不存在的题目：" + id);
      if (assigned.has(id)) throw new Error("阅读篇章重复分配题目：" + id);
      assigned.set(id, passage.id);
      if (question.answerGroup) {
        const existing = groups.get(question.answerGroup);
        if (existing && existing !== passage.id) throw new Error("同组多选答案不能跨阅读篇章：" + question.answerGroup);
        groups.set(question.answerGroup, passage.id);
      }
    }
  }
  if (assigned.size !== questions.size) throw new Error("阅读篇章必须覆盖练习中的全部题目");
}

export function parseOfficialResource(value: unknown): OfficialPracticeResource | undefined {
  const result = officialResourceSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function resourceLabel(resource: OfficialPracticeResource) {
  if (resource.classification === "user-supplied") return "用户提供";
  return resource.classification === "authentic-practice" ? "Cambridge authentic practice" : "官方公开练习";
}

export function isOfficialResource(resource: OfficialPracticeResource | undefined) {
  return Boolean(resource && resource.classification !== "user-supplied");
}
