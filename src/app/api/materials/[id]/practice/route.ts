import { NextResponse } from "next/server";

import { generatePracticeFromMaterial } from "@/server/ai";
import {
  createPracticeSet,
  getMaterial,
} from "@/server/store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const material = getMaterial(Number(id));
  if (
    !material ||
    !["reading", "listening"].includes(material.kind) ||
    material.content.length < 100
  ) {
    return NextResponse.json(
      { error: "This material needs at least 100 characters of reading or listening text." },
      { status: 400 },
    );
  }

  const kind = material.kind as "reading" | "listening";
  const generated = await generatePracticeFromMaterial({
    kind,
    title: material.title,
    content: material.content,
  });
  if (!generated) {
    return NextResponse.json(
      { error: "No AI provider produced a valid objective question set." },
      { status: 503 },
    );
  }

  const setId = `material-${material.id}-${Date.now()}`;
  const set = createPracticeSet({
    id: setId,
    kind,
    title: generated.title,
    subtitle: generated.subtitle,
    instructions: generated.instructions,
    passage: kind === "reading" ? material.content : "",
    transcript: kind === "listening" ? material.content : "",
    audioUrl:
      kind === "listening" && material.mimeType.startsWith("audio/")
        ? material.fileUrl
        : "",
    durationMinutes: kind === "reading" ? 20 : 15,
    questions: generated.questions,
  });
  return NextResponse.json({
    set,
    provider: generated.provider,
    href: `/practice/set/${set.id}`,
  });
}

