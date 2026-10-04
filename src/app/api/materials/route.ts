import { NextResponse } from "next/server";
import { z } from "zod";

import { addMaterial, listMaterials } from "@/server/store";

const materialSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(["reading", "listening", "writing", "vocabulary"]),
  content: z.string().trim().min(1).max(500_000),
  sourceUrl: z.string().trim().max(2_000).default(""),
});

export async function GET() {
  return NextResponse.json({ materials: listMaterials() });
}

export async function POST(request: Request) {
  const parsed = materialSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The material is incomplete." },
      { status: 400 },
    );
  }
  return NextResponse.json({ material: addMaterial(parsed.data) });
}

