import { getMorphologyWorkspace, updateMorphologySession } from "@/server/morphology";
import { morphologyErrorResponse } from "@/server/morphology-http";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(getMorphologyWorkspace()); } catch (error) { return morphologyErrorResponse(error); }
}
export async function PUT(request: Request) {
  try { return Response.json(updateMorphologySession(await request.json())); } catch (error) { return morphologyErrorResponse(error); }
}
