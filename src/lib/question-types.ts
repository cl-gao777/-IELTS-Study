import { z } from "zod";
import type { PracticeQuestion, QuestionKind } from "./domain";
import { answerGroupTargetIssues, groupedAnswerIssues } from "./practice-scoring";

export const QUESTION_TYPES = {
  "true-false-not-given": { label: "True / False / Not Given", mode: "choice", options: ["TRUE", "FALSE", "NOT GIVEN"] },
  "yes-no-not-given": { label: "Yes / No / Not Given", mode: "choice", options: ["YES", "NO", "NOT GIVEN"] },
  "multiple-choice": { label: "Multiple Choice · 单选", mode: "choice" },
  "matching-headings": { label: "Matching Headings · 标题匹配", mode: "matching" },
  "matching-sentence-endings": { label: "Matching Sentence Endings · 句尾匹配", mode: "matching" },
  "matching-information": { label: "Matching Information · 信息匹配", mode: "matching" },
  "matching-features": { label: "Matching Features · 特征匹配", mode: "matching" },
  "sentence-completion": { label: "Sentence Completion · 句子填空", mode: "text" },
  "summary-completion": { label: "Summary Completion · 摘要填空", mode: "text" },
  "short-answer": { label: "Short Answer · 简答", mode: "text" },
  "table-completion": { label: "Table Completion · 表格填空", mode: "text" },
  "form-completion": { label: "Form Completion · 表单填空", mode: "text" },
  "note-completion": { label: "Note Completion · 笔记填空", mode: "text" },
  matching: { label: "Matching · 匹配", mode: "matching" },
  "map-labelling": { label: "Map / Diagram Labelling · 图示标注", mode: "text" },
  "flow-chart-completion": { label: "Flow-chart Completion · 流程图填空", mode: "text" },
  "diagram-label-completion": { label: "Diagram Label Completion · 图解填空", mode: "text" },
} as const;

export const questionKinds = Object.keys(QUESTION_TYPES) as [QuestionKind, ...QuestionKind[]];
export function questionOptions(question: PracticeQuestion): readonly string[] {
  const descriptor = QUESTION_TYPES[question.kind];
  return question.options?.length ? question.options : "options" in descriptor ? descriptor.options : [];
}
export const questionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  originalQuestionNumber: z.number().int().min(1).max(1000).optional(),
  kind: z.enum(questionKinds),
  prompt: z.string().trim().min(1).max(5000),
  options: z.array(z.string().trim().min(1).max(2000)).max(40).optional(),
  answers: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
  explanation: z.string().max(10000).default(""),
  evidence: z.string().max(10000).default(""),
  imageUrl: z.string().max(2000).refine((value) => !value || /^\/api\/uploads\/\d+$/.test(value), "请选择本地资料库图片 /api/uploads/ID").default(""),
  maxWords: z.number().int().min(1).max(50).optional(),
  answerGroup: z.string().trim().min(1).max(100).optional(),
  answerGroupTargets: z.array(z.array(z.string().trim().min(1).max(2000)).min(1).max(20)).min(1).max(20).optional(),
}).superRefine((question, context) => {
  for (const message of answerGroupTargetIssues(question)) {
    context.addIssue({ code: "custom", message, path: ["answerGroupTargets"] });
  }
  const options = questionOptions(question);
  if (question.maxWords && question.answers.some((answer) => answer.trim().split(/\s+/).length > question.maxWords!)) {
    context.addIssue({ code: "custom", message: "参考答案超过了所设的最多词数，请调整答案或限制", path: ["maxWords"] });
  }
  if (QUESTION_TYPES[question.kind].mode !== "text" && options.length < 2) {
    context.addIssue({ code: "custom", message: "选择 / 匹配题至少需要两个选项", path: ["options"] });
  }
  if (options.length && !question.answers.every((answer) => options.some((option) => option.toLowerCase() === answer.toLowerCase()))) {
    context.addIssue({ code: "custom", message: "答案必须与选项文本一致；多个可接受答案用 | 分隔", path: ["answers"] });
  }
});
export const manualPracticeSchema = z.object({
  durationMinutes: z.number().int().min(1).max(180).default(20),
  questions: z.array(questionSchema).max(80),
}).refine((value) => new Set(value.questions.map((question) => question.id)).size === value.questions.length, "题目 ID 不能重复")
  .superRefine((value, context) => {
    for (const issue of groupedAnswerIssues(value.questions)) {
      context.addIssue({ code: "custom", message: issue.message, path: ["questions", issue.index, "answerGroup"] });
    }
  });

export const MISTAKE_REASONS = ["Vocabulary", "定位失败", "同义替换未识别", "句子理解错误", "推理错误", "Not Given 判断错误", "粗心", "时间不足"] as const;
