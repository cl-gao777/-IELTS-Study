import { lookupMorphologyAttempt, submitMorphologyAttempt } from "@/server/morphology";
import { morphologyErrorResponse } from "@/server/morphology-http";
import { getDatabase } from "@/server/db";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url=new URL(request.url),id=z.uuid().parse(url.searchParams.get("operationId")),db=getDatabase();
    return Response.json(lookupMorphologyAttempt(id,url.searchParams.get("dataEpoch")??"",db));
  } catch(error) { return morphologyErrorResponse(error); }
}
export async function POST(request: Request) {
  try { return Response.json(submitMorphologyAttempt(await request.json())); } catch(error) { return morphologyErrorResponse(error); }
}
