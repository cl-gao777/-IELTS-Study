import { NextResponse } from "next/server";

import { toggleStudyTask } from "@/server/store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const task = toggleStudyTask(id);
  return task
    ? NextResponse.json({ task })
    : NextResponse.json({ error: "Task not found." }, { status: 404 });
}

