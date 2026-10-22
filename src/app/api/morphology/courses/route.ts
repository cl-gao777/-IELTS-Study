import { getMorphologyCourses } from "@/server/morphology";
import { morphologyErrorResponse } from "@/server/morphology-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json(getMorphologyCourses(new URL(request.url).searchParams.get("lessonId") ?? undefined)); }
  catch (error) { return morphologyErrorResponse(error); }
}
