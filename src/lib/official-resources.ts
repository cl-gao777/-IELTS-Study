import { z } from "zod";

const sourceUrl = z.string().url().refine((url) => new URL(url).protocol === "https:", "来源必须为 HTTPS");
const documentSchema = z.object({
  label: z.string().min(1).max(150),
  url: z.string().regex(/^\/api\/uploads\/\d+$/),
  sourceUrl,
  page: z.number().int().positive().optional(),
});

export const officialResourceSchema = z.object({
  provider: z.string().min(1),
  classification: z.enum(["official-practice", "authentic-practice"]),
  sourceUrl,
  licenseUrl: sourceUrl,
  copyright: z.string().min(1),
  verifiedAt: z.string().min(1),
  notes: z.string().default(""),
  bandEstimateAllowed: z.boolean().optional(),
  questionDocuments: z.array(documentSchema).min(1),
  answerDocuments: z.array(documentSchema).default([]),
  audioTracks: z.array(documentSchema).default([]),
  transcriptDocuments: z.array(documentSchema).default([]),
});

export type OfficialPracticeResource = z.infer<typeof officialResourceSchema>;
export type OfficialDocument = z.infer<typeof documentSchema>;

export function parseOfficialResource(value: unknown): OfficialPracticeResource | undefined {
  const result = officialResourceSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function resourceLabel(resource: OfficialPracticeResource) {
  return resource.classification === "authentic-practice" ? "Cambridge authentic practice" : "官方公开练习";
}
