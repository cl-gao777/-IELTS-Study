import { NextResponse } from "next/server";

import { backupToNotion, notionStatus } from "@/server/notion";

export async function GET() {
  return NextResponse.json(notionStatus());
}

export async function POST() {
  const result = await backupToNotion();
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

