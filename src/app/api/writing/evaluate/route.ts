import { NextResponse } from "next/server";
import { parseWritingFeedback, writingDraftSchema, writingFeedbackInstructions } from "@/lib/writing";
import { generateAiText } from "@/server/ai";
import { saveWritingDraft, saveWritingEvaluation } from "@/server/writing-drafts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let draftSaved = false;
  try {
    const parsed = writingDraftSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "草稿格式无效，未请求 AI。" }, { status: 400 });
    const draft = saveWritingDraft(parsed.data);
    draftSaved = true;
    if (draft.essay.trim().length < 40 || !draft.prompt.trim()) {
      return NextResponse.json({ error: "草稿已保存。请填写题目及至少 40 个字符，再请求反馈。", draftSaved }, { status: 400 });
    }
    const result = await generateAiText(writingFeedbackInstructions,
      `Task: ${draft.taskType}\nCategory: ${draft.category}\nLocal image attached: ${Boolean(draft.image)} (image is not transmitted)\nPrompt:\n${draft.prompt}\n\nEssay:\n${draft.essay}`);
    if (!result) {
      return NextResponse.json({ error: "草稿已保存。AI 未配置或暂时不可用，本次没有生成评分。请在 Settings 配置后重试。", draftSaved }, { status: 503 });
    }
    let feedback;
    try { feedback = parseWritingFeedback(result.text); } catch {
      return NextResponse.json({ error: "草稿已保存。AI 返回的反馈格式不完整，请重试；本次没有记录评分。", draftSaved }, { status: 502 });
    }
    return NextResponse.json({ feedback: saveWritingEvaluation(draft, feedback, result.provider), draftSaved });
  } catch {
    return NextResponse.json({ error: draftSaved ? "草稿已保存，反馈服务暂时失败，请重试。" : "无法保存草稿，未请求 AI。请保留页面后重试。", draftSaved }, { status: 500 });
  }
}

