import { NextResponse } from "next/server";

import { resolveReviewItem } from "@/server/store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  resolveReviewItem(Number(id));
  return NextResponse.json({ ok: true });
}

