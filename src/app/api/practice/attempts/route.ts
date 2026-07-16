import { NextResponse } from "next/server";
import { z } from "zod";

import { submitPracticeAttempt } from "@/server/store";

const attemptSchema = z.object({
  setId: z.string().min(1),
  answers: z.record(z.string(), z.string()),
  durationSeconds: z.number().min(0).max(24 * 60 * 60),
});

export async function POST(request: Request) {
  const parsed = attemptSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The attempt payload is invalid." },
      { status: 400 },
    );
  }
  const attempt = submitPracticeAttempt(parsed.data);
  return attempt
    ? NextResponse.json({ attempt })
    : NextResponse.json({ error: "Practice set not found." }, { status: 404 });
}

