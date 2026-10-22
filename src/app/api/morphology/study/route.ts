import { recordMorphologyStudy } from "@/server/morphology";
import { morphologyErrorResponse } from "@/server/morphology-http";
export async function POST(request: Request) {
  try { return Response.json(recordMorphologyStudy(await request.json())); } catch(error) { return morphologyErrorResponse(error); }
}
