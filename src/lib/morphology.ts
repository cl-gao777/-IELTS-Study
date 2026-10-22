import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(4000);
export const morphologySourceSchema = z.object({ id, title: text, url: z.string().url().refine(value => /^https?:\/\//i.test(value), "来源仅支持 HTTP 或 HTTPS 地址。"), reviewedAt: z.iso.date(), license: text, note: z.string().max(4000).default("") });
export const morphologyExampleSchema = z.object({ id, sentence: text, targetSurface: text, acceptedAnswers: z.array(text).min(1), meaningZh: text }).superRefine((example, ctx) => {
  if (!example.sentence.toLowerCase().includes(example.targetSurface.toLowerCase())) ctx.addIssue({ code: "custom", message: "例句缺少登记的目标词形。" });
  if (!example.acceptedAnswers.some(a => normaliseMorphologyAnswer(a) === normaliseMorphologyAnswer(example.targetSurface))) ctx.addIssue({ code: "custom", message: "答案必须包含例句原词形。" });
});
export const morphologyWordSchema = z.object({
  id, term: text, partOfSpeech: text, meaningZh: text, definitionEn: text,
  level: z.enum(["B2", "C1"]).nullable(), levelSource: z.string().default(""),
  relation: z.enum(["derivation", "etymology", "mnemonic"]),
  segments: z.array(z.object({ surface: text, meaningZh: text })).min(1), explanationZh: text,
  examples: z.array(morphologyExampleSchema).min(2), sourceIds: z.array(id).min(1), illustrative: z.boolean().default(false),
});
export const morphologyLessonSchema = z.object({
  id, version: z.number().int().positive(), status: z.enum(["draft", "published"]),
  kind: z.enum(["root", "prefix", "suffix"]), rank: z.number().int().positive(), form: text, titleZh: text, meaningZh: text,
  variants: z.array(text), overviewZh: text, spellingZh: text, limitsZh: text,
  meaningDistractors: z.array(text).min(3).max(3).optional(),
  words: z.array(morphologyWordSchema).min(3).max(5), sources: z.array(morphologySourceSchema).min(1),
  structureQuestion: z.object({ prompt: text, options: z.array(text).min(2).max(6), answer: text, explanation: text }),
}).superRefine((lesson, ctx) => {
  if (!lesson.structureQuestion.options.includes(lesson.structureQuestion.answer)) ctx.addIssue({code:"custom",message:"构词题答案不在选项中。"});
  if (new Set(lesson.structureQuestion.options).size !== lesson.structureQuestion.options.length) ctx.addIssue({code:"custom",message:"构词题选项重复。"});
  if (lesson.meaningDistractors && (new Set(lesson.meaningDistractors).size!==3 || lesson.meaningDistractors.includes(lesson.meaningZh))) ctx.addIssue({code:"custom",message:"辨义题干扰项重复或包含答案。"});
  if (new Set(lesson.words.map(w=>w.id)).size !== lesson.words.length) ctx.addIssue({code:"custom",message:"关联词ID重复。"});
  if (new Set(lesson.sources.map(source=>source.id)).size !== lesson.sources.length) ctx.addIssue({code:"custom",message:"课程来源ID重复。"});
  for (const word of lesson.words) if (word.sourceIds.some(s=>!lesson.sources.some(source=>source.id===s))) ctx.addIssue({code:"custom",message:"关联词来源缺失。"});
});
export type MorphologyLesson = z.infer<typeof morphologyLessonSchema>;
export type MorphologyWord = z.infer<typeof morphologyWordSchema>;
export type MorphologySource = z.infer<typeof morphologySourceSchema>;
export function normaliseMorphologyAnswer(value: string) { return value.trim().toLocaleLowerCase("en").replace(/[’‘]/g, "'").replace(/\s+/g, " "); }
/** v1/v2 froze the cue on the example; v3 reserves that field for a full translation. */
export function morphologyContextCue(lesson: Pick<MorphologyLesson, "version">, word: MorphologyWord, example: z.infer<typeof morphologyExampleSchema>) {
  return lesson.version >= 3 ? word.meaningZh : example.meaningZh;
}
export function morphologyContextPrompt(example: z.infer<typeof morphologyExampleSchema>, cue = example.meaningZh) {
  const alternatives=[...new Set([example.targetSurface,...example.acceptedAnswers])].sort((a,b)=>b.length-a.length)
    .map(answer=>normaliseMorphologyAnswer(answer).replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+").replace(/'/g,"['’‘]"));
  const expression=new RegExp(`(?<![A-Za-z])(?:${alternatives.join("|")})(?![A-Za-z])`,"gi");
  return example.sentence.replace(expression,"______")+"\n"+cue.replace(expression,"______");
}

/** Only the frozen v3 lesson can identify a full translation; never borrow current content for old history. */
export function morphologySentenceTranslation(lesson: MorphologyLesson, question: MorphologyQuestion) {
  if (lesson.version < 3 || question.kind !== "context") return null;
  const word = lesson.words.find(word => word.id === question.wordId);
  return word?.examples.find(example => example.sentence === question.sentence
    && JSON.stringify(example.acceptedAnswers) === JSON.stringify(question.acceptedAnswers))?.meaningZh ?? null;
}

export interface MorphologyQuestion {
  id: string; kind: "meaning" | "structure" | "context"; prompt: string; options: string[];
  acceptedAnswers: string[]; hint: string; explanation: string; sentence: string; wordId: string | null;
}
export interface MorphologyAnswerResult {
  questionId: string; answer: string; correct: boolean; hintUsed: boolean; gaveUp: boolean;
  firstAttempt: boolean;
  acceptedAnswers: string[]; explanation: string; sentence: string; submittedAt: string; operationId: string;
}
export interface MorphologySessionState {
  lesson: MorphologyLesson; phase: "learn" | "practice" | "results"; questionIndex: number;
  questions: MorphologyQuestion[]; input: string; hintUsed: boolean; results: MorphologyAnswerResult[];
  retry: "initial" | "whole" | "weak"; paused: boolean;
}
export interface MorphologySession { id: string; revision: number; status: "active" | "ended"; state: MorphologySessionState; startedAt: string; updatedAt: string }
export interface MorphologyProgress { lessonId: string; readAt: string | null; completedAt: string | null; completedRuns: number; lastCorrect: number; lastTotal: number }
export interface MorphologyCourseSummary { id: string; version: number; kind: MorphologyLesson["kind"]; rank: number; form: string; titleZh: string; meaningZh: string; wordCount: number; progress: MorphologyProgress | null }
export interface MorphologyHistory { id: string; lessonId: string; lessonVersion: number; lessonTitle: string; retry: MorphologySessionState["retry"]; completedAt: string; correct: number; total: number; independentCorrect: number; independentTotal: number; hintedCorrect: number; hintedTotal: number; firstIndependentCorrect: number; firstIndependentTotal: number }
export interface MorphologyWorkspace { dataEpoch: string; session: MorphologySession | null; todaySeconds: number; totalSeconds: number;
  currentSessionId?: string | null; submission?: { sessionId: string; lessonVersion: number; result: MorphologyAnswerResult } }
export interface MorphologyStatistics { firstIndependentCorrect:number;firstIndependentTotal:number;hintedCorrect:number;hintedTotal:number;repeatedCorrect:number;repeatedTotal:number }
export interface MorphologyCoursesResponse { dataEpoch: string; courses: MorphologyCourseSummary[]; lesson?: MorphologyLesson; history: MorphologyHistory[]; statistics:MorphologyStatistics;todaySeconds: number; totalSeconds: number }

export const morphologyQuestionSchema = z.object({
  id, kind:z.enum(["meaning","structure","context"]), prompt:text, options:z.array(text).max(6),
  acceptedAnswers:z.array(text).min(1).max(30), hint:text, explanation:text, sentence:z.string().max(4000), wordId:id.nullable(),
}).strict();
export const morphologyAnswerResultSchema = z.object({
  questionId:id, answer:z.string().max(2000), correct:z.boolean(),hintUsed:z.boolean(),gaveUp:z.boolean(),firstAttempt:z.boolean(),
  acceptedAnswers:z.array(text).min(1).max(30),explanation:text,sentence:z.string().max(4000),submittedAt:z.iso.datetime(),operationId:z.uuid(),
}).strict();
export const morphologyHistorySchema=z.object({
  id:z.uuid(),lessonId:id,lessonVersion:z.number().int().positive(),lessonTitle:text,retry:z.enum(["initial","whole","weak"]),completedAt:z.iso.datetime(),
  correct:z.number().int().nonnegative(),total:z.number().int().positive(),independentCorrect:z.number().int().nonnegative(),independentTotal:z.number().int().nonnegative(),
  hintedCorrect:z.number().int().nonnegative(),hintedTotal:z.number().int().nonnegative(),firstIndependentCorrect:z.number().int().nonnegative(),firstIndependentTotal:z.number().int().nonnegative(),
}).strict();
export const morphologySessionStateSchema=z.object({
  lesson:morphologyLessonSchema,phase:z.enum(["learn","practice","results"]),questionIndex:z.number().int().nonnegative(),questions:z.array(morphologyQuestionSchema).min(1).max(7),
  input:z.string().max(2000),hintUsed:z.boolean(),results:z.array(morphologyAnswerResultSchema).max(7),retry:z.enum(["initial","whole","weak"]),paused:z.boolean(),
}).strict().superRefine((state,ctx)=>{
  const ids=new Set(state.questions.map(q=>q.id));
  if(ids.size!==state.questions.length||state.questionIndex>=state.questions.length||new Set(state.results.map(r=>r.questionId)).size!==state.results.length||state.results.some(r=>!ids.has(r.questionId)))ctx.addIssue({code:"custom",message:"词根课程题目与作答关联无效。"});
  if(state.phase==="learn"&&state.results.length||state.phase==="results"&&state.results.length!==state.questions.length)ctx.addIssue({code:"custom",message:"词根课程阶段与作答数量不符。"});
});

const binding = { dataEpoch: id, sessionId: z.uuid(), expectedRevision: z.number().int().positive() };
export const morphologySessionInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), dataEpoch: id, operationId: z.uuid(), lessonId: id, lessonVersion: z.number().int().positive(), retry: z.enum(["initial", "whole", "weak"]).default("initial") }).strict(),
  z.object({ action: z.literal("save"), ...binding, input: z.string().max(2000) }).strict(),
  z.object({ action: z.enum(["practice", "hint", "next", "pause", "resume", "end"]), ...binding }).strict(),
]);
export const morphologyAttemptInputSchema = z.object({ ...binding, operationId: z.uuid(), questionId: id, lessonVersion: z.number().int().positive(), answer: z.string().max(2000), gaveUp: z.boolean().default(false) }).strict();
export const morphologyStudyInputSchema = z.object({ dataEpoch: id, sessionId: z.uuid(), segmentId: z.uuid(), seconds: z.number().int().min(0).max(86400), studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+"T00:00:00.000Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;},"计时日期无效。") }).strict();
export type MorphologySessionInput = z.infer<typeof morphologySessionInputSchema>;
export type MorphologyAttemptInput = z.infer<typeof morphologyAttemptInputSchema>;
export type MorphologyStudyInput = z.infer<typeof morphologyStudyInputSchema>;
