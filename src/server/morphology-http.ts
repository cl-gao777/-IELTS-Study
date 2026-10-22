import "server-only";
import { ZodError } from "zod";
import { dataConflictResponse } from "./data-integrity";
import { MorphologyConflict } from "./morphology";

export function morphologyErrorResponse(error: unknown) {
  const restored = dataConflictResponse(error);
  if (restored) return restored;
  if (error instanceof MorphologyConflict) return Response.json({ error: error.message, code: error.code }, { status: 409 });
  if (error instanceof ZodError) return Response.json({ error: "课程请求格式不完整，请刷新后重试。" }, { status: 400 });
  if (error instanceof Error && error.message === "请先输入答案，或选择想不起来。") return Response.json({ error: error.message }, { status: 400 });
  console.error("Morphology request failed", error);
  return Response.json({ error: "课程暂时无法读取或保存，请保留回答后重试。" }, { status: 500 });
}
