import { NextResponse } from "next/server";
import { z } from "zod";

import {retrieveTutorContext} from "@/server/tutor-context";
import { createCoachReply } from "@/server/ai";
import { listCoachMessages, saveCoachTurn } from "@/server/store";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
});

export async function GET() {
  return NextResponse.json({ messages: listCoachMessages() });
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a message." },
      { status: 400 },
    );
  }

  const reply = await createCoachReply(parsed.data.message,retrieveTutorContext(parsed.data.message));
  saveCoachTurn({
    user: parsed.data.message,
    assistant: reply.answer,
    correction: reply.correction,
    provider: reply.provider,
  });
  return NextResponse.json({ reply });
}

