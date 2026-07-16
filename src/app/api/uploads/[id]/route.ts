import { readFile } from "node:fs/promises";

import { getMaterialFile } from "@/server/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const material = getMaterialFile(Number(id));
  if (!material?.file_path) {
    return new Response("File not found.", { status: 404 });
  }

  try {
    const bytes = await readFile(material.file_path);
    return new Response(bytes, {
      headers: {
        "Content-Type": material.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(material.file_name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("File not found.", { status: 404 });
  }
}

