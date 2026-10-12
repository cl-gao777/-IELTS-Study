import { NextResponse } from "next/server";
import { z } from "zod";
import { assessmentDraftSchema } from "@/lib/vocabulary-assessment";
import { checkpointVocabularyAssessment, readVocabularyAssessment, startVocabularyAssessment, submitVocabularyAssessment, VocabularyAssessmentConflict } from "@/server/vocabulary-assessment";
import { listVocabularyCatalogEntries, loadVocabularyCatalog } from "@/server/vocabulary-courses";
const identity = z.object({ id: z.uuid(), expectedRevision: z.number().int().positive() });
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "测评保存失败。", ...(error instanceof VocabularyAssessmentConflict ? { assessment: readVocabularyAssessment() } : {}) }, { status: error instanceof VocabularyAssessmentConflict ? 409 : 400 });
}
export async function GET() { return NextResponse.json({ assessment: readVocabularyAssessment() }); }
export async function POST(request: Request) {
  try {
    const input = z.discriminatedUnion("action", [z.object({ action: z.literal("start") }).strict(), identity.extend({ action: z.literal("submit") }).strict()]).parse(await request.json());
    if (input.action === "start") { loadVocabularyCatalog(); return NextResponse.json({ assessment: startVocabularyAssessment(listVocabularyCatalogEntries()) }); }
    return NextResponse.json({ assessment: submitVocabularyAssessment(input.id, input.expectedRevision) });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const input = identity.extend(assessmentDraftSchema.shape).strict().parse(await request.json());
    return NextResponse.json({ assessment: checkpointVocabularyAssessment(input.id, input.expectedRevision, { answers: input.answers, currentIndex: input.currentIndex }) });
  } catch (error) { return failure(error); }
}
