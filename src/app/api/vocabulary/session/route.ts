import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewModes } from "@/lib/vocabulary";
import { vocabularyCheckpointSchema } from "@/lib/vocabulary-session";
import { changeVocabularySession, getVocabularySession } from "@/server/vocabulary-session";
import { vocabularyConflictResponse } from "@/server/vocabulary-session-http";

const sessionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), id: z.uuid().optional(), mode: z.enum(reviewModes).default("recall") }).strict(),
  z.object({ action: z.literal("checkpoint"), id: z.uuid(), expectedRevision: z.number().int().positive(), state: vocabularyCheckpointSchema }).strict(),
  z.object({ action: z.literal("end"), id: z.uuid(), expectedRevision: z.number().int().positive() }).strict(),
]);
export async function GET(request: Request) {
  const submissionId = new URL(request.url).searchParams.get("submissionId") ?? undefined;
  if (submissionId && !z.uuid().safeParse(submissionId).success) return NextResponse.json({ error: "提交编号格式不正确。" }, { status: 400 });
  return NextResponse.json(getVocabularySession(submissionId), { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "练习状态格式不正确，请刷新页面后重试。" }, { status: 400 });
  try { return NextResponse.json(changeVocabularySession(parsed.data)); }
  catch (error) { return vocabularyConflictResponse(error); }
}
