import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The public manifest contains no personal documents or learner records. */
export async function GET() {
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), "src", "data", "vocabulary-source-manifest.json");
  const manifest = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
  return NextResponse.json(manifest, { headers: { "Cache-Control": "no-store" } });
}
