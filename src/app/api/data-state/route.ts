import { getDataEpoch } from "@/server/data-integrity";
export function GET() { return Response.json({ dataEpoch: getDataEpoch() }, { headers: { "Cache-Control": "no-store" } }); }
