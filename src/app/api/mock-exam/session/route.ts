import { z } from "zod";
import { mockStateSchema } from "@/lib/mock-exam";
import { dataConflictResponse } from "@/server/data-integrity";
import { claimMockWriter, checkpointMockSession, endMockSession, getMockSession, startMockSession } from "@/server/mock-exam-session";

const identity = { id: z.uuid(), dataEpoch: z.uuid() };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), dataEpoch: z.uuid(), listeningSetId: z.string().min(1), readingSetId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("claim"), ...identity, writerId: z.uuid() }).strict(),
  z.object({ action: z.literal("checkpoint"), ...identity, writerId: z.uuid(), expectedRevision: z.number().int().positive(), state: mockStateSchema, release: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("end"), ...identity, expectedRevision: z.number().int().positive() }).strict(),
]);
export async function GET() { return Response.json(getMockSession()); }
export async function PUT(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "会话请求格式不完整，请刷新页面。", code: "REFRESH_REQUIRED" }, { status: 409 });
    const input = parsed.data;
    if (input.action === "end") { endMockSession(input); return Response.json({ session: null }); }
    const session = input.action === "start" ? startMockSession(input) : input.action === "claim" ? claimMockWriter(input) : checkpointMockSession(input);
    return Response.json({ session });
  } catch (error) { return dataConflictResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "会话保存失败" }, { status: 400 }); }
}
export const POST = PUT;
