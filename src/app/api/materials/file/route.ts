import { NextResponse } from "next/server";
import { z } from "zod";

import { importMaterialFile } from "@/server/material-import";

const kindSchema = z.enum([
  "reading",
  "listening",
  "writing",
  "vocabulary",
]);

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const kind = kindSchema.safeParse(formData.get("kind"));
  if (!(file instanceof File) || !kind.success) {
    return NextResponse.json(
      { error: "Choose a file and material type." },
      { status: 400 },
    );
  }

  try {
    const material = await importMaterialFile({
      file,
      kind: kind.data,
      title: String(formData.get("title") ?? "").trim(),
      sourceUrl: String(formData.get("sourceUrl") ?? "").trim(),
    });
    return NextResponse.json({ material });
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error ? caught.message : "The file could not be imported.",
      },
      { status: 400 },
    );
  }
}

