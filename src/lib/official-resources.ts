import { z } from "zod";

const sourceUrl = z.string().url().refine((url) => {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}, "来源必须为 HTTPS");
const optionalSourceUrl = z.union([sourceUrl, z.literal("")]).default("");
const documentSchema = z.object({
  label: z.string().min(1).max(150),
  url: z.string().regex(/^\/api\/uploads\/\d+$/),
  sourceUrl: optionalSourceUrl,
  page: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
}).superRefine((resource, context) => {
  if (resource.classification === "user-supplied") return;
  if (!resource.sourceUrl || !resource.licenseUrl) {
    context.addIssue({ code: "custom", message: "官方资源必须保留来源与版权链接。" });
  }
  for (const document of [...resource.questionDocuments, ...resource.answerDocuments, ...resource.audioTracks, ...resource.transcriptDocuments]) {
    if (!document.sourceUrl) context.addIssue({ code: "custom", message: "官方文件必须保留来源链接。" });
  }
});

export type OfficialPracticeResource = z.infer<typeof officialResourceSchema>;
export type OfficialDocument = z.infer<typeof documentSchema>;

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
