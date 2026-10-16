import { lookupSubmission } from "@/server/submissions";
import { dataConflictResponse } from "@/server/data-integrity";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(lookupSubmission((await context.params).id, new URL(request.url).searchParams.get("dataEpoch") ?? ""), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return dataConflictResponse(error) ?? Response.json({ error: "提交状态暂时无法查询。" }, { status: 500 }); }
}
