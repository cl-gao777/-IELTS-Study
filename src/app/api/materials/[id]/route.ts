import { z } from "zod";
import { getMaterialMetadata, updateMaterial } from "@/server/learning-workspace-store";
import { getMaterial } from "@/server/store";
const schema = z.object({ title: z.string().trim().min(1).max(300), content: z.string().max(500000), sourceUrl: z.string().max(2000), metadata: z.object({ tags: z.array(z.string().trim().max(80)).max(30), difficulty: z.string().max(100), section: z.string().max(100), notes: z.string().max(20000), provenance: z.string().max(2000) }) });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  const material = getMaterial(id);
  return material ? Response.json({ material, metadata: getMaterialMetadata(id) }) : Response.json({ error: "资料不存在" }, { status: 404 });
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "资料格式错误，请检查标题与内容长度。" }, { status: 400 });
  const material = updateMaterial(Number((await context.params).id), parsed.data);
  return material ? Response.json({ material }) : Response.json({ error: "资料不存在" }, { status: 404 });
}
