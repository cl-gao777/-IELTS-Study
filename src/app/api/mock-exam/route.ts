import { NextResponse } from "next/server";
import { z } from "zod";

import { evaluateWriting } from "@/server/ai";
import { calculateMockOverallBand } from "@/lib/practice-scoring";
import {
  saveMockExam,
  saveWritingSubmission,
  submitPracticeAttempt,
} from "@/server/store";

const schema = z.object({
  startedAt: z.string().datetime(),
  reading: z.object({
    setId: z.string().min(1),
    answers: z.record(z.string(), z.string()),
    durationSeconds: z.number().min(0),
  }),
  listening: z.object({
    setId: z.string().min(1),
    answers: z.record(z.string(), z.string()),
    durationSeconds: z.number().min(0),
  }),
  writing: z.object({
    taskType: z.enum(["task-1", "task-2"]),
    prompt: z.string().min(1),
    essay: z.string().min(40),
  }),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Complete all three sections before submission." },
      { status: 400 },
    );
  }

  const listening = submitPracticeAttempt(parsed.data.listening);
  const reading = submitPracticeAttempt(parsed.data.reading);
  if (!listening || !reading) {
    return NextResponse.json(
      { error: "A practice set is missing." },
      { status: 404 },
    );
  }

  const writingFeedback = await evaluateWriting(parsed.data.writing);
  const writing = saveWritingSubmission({
    ...parsed.data.writing,
    wordCount: parsed.data.writing.essay.split(/\s+/).filter(Boolean).length,
    overallBand: writingFeedback.overallBand,
    criteria: writingFeedback.criteria,
    strengths: writingFeedback.strengths,
    improvements: writingFeedback.improvements,
    rewrite: writingFeedback.rewrite,
  });
  const overallBand = calculateMockOverallBand([
    listening.bandScore,
    reading.bandScore,
    writing.overallBand,
  ]);
  const mock = saveMockExam({
    listeningAttemptId: listening.id,
    readingAttemptId: reading.id,
    writingSubmissionId: writing.id,
    overallBand,
    startedAt: parsed.data.startedAt,
  });

  return NextResponse.json({
    mock,
    listening,
    reading,
    writing,
    provider: writingFeedback.provider,
  });
}
