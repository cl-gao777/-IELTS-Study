import { enrollMorphologyWord } from "@/server/morphology-enrollment";
import { dataConflictResponse } from "@/server/data-integrity";

export async function POST(request: Request) {
  try { return Response.json(enrollMorphologyWord(await request.json())); }
  catch (error) { return dataConflictResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "关联词暂未加入，请重试。" }, { status: 400 }); }
}
