import { NextResponse } from "next/server";
import { z } from "zod";

import { evaluateWriting } from "@/server/ai";
import { saveWritingSubmission } from "@/server/store";

const writingSchema = z.object({
  taskType: z.enum(["task-1", "task-2"]),
  prompt: z.string().trim().min(1).max(4_000),
  essay: z.string().trim().min(40).max(30_000),
});

export async function POST(request: Request) {
  const parsed = writingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Write at least 40 characters before requesting feedback." },
      { status: 400 },
    );
  }
  const feedback = await evaluateWriting(parsed.data);
  const wordCount = parsed.data.essay.split(/\s+/).filter(Boolean).length;
  const submission = saveWritingSubmission({
    ...parsed.data,
    wordCount,
    overallBand: feedback.overallBand,
    criteria: feedback.criteria,
    strengths: feedback.strengths,
    improvements: feedback.improvements,
    rewrite: feedback.rewrite,
  });
  return NextResponse.json({ submission, provider: feedback.provider });
}

