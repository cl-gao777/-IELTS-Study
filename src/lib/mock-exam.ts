import { z } from "zod";
import type { PracticeAttempt, PracticeSet, WritingSubmission } from "./domain";

export const mockWritingPrompt = "Some people believe cities should spend more money on public transport than on building new roads. To what extent do you agree or disagree?";
export const mockStages = ["listening", "reading", "writing"] as const;
export type MockStage = typeof mockStages[number];
const answers = z.record(z.string().max(200), z.string().max(2000));
export const mockStateSchema = z.object({
  stage: z.enum(mockStages), paused: z.boolean(), listeningAnswers: answers, readingAnswers: answers,
  essay: z.string().max(200000), durations: z.object({ listening: z.number().int().min(0).max(86400), reading: z.number().int().min(0).max(86400), writing: z.number().int().min(0).max(86400) }).strict(),
  passageId: z.string().max(100), positions: z.record(z.string().max(100), z.number().min(0).max(10000000)),
  zooms: z.record(z.string().max(100), z.number().int().min(100).max(200)), audioTrack: z.number().int().min(0).max(100), audioPosition: z.number().min(0).max(86400),
}).strict();
export type MockState = z.infer<typeof mockStateSchema>;
export interface MockResult { mock: { id: number; overallBand: number }; listening: PracticeAttempt; reading: PracticeAttempt; writing: WritingSubmission; provider: string }
export interface MockSession {
  id: string; dataEpoch: string; revision: number; submissionId: string; startedAt: string; status: "active" | "completed" | "ended";
  state: MockState; listeningSet: PracticeSet; readingSet: PracticeSet; writingPrompt: string; result: MockResult | null;
  writerId: string | null; leaseUntil: string | null;
}
export function initialMockState(passageId = ""): MockState {
  return { stage: "listening", paused: true, listeningAnswers: {}, readingAnswers: {}, essay: "", durations: { listening: 0, reading: 0, writing: 0 }, passageId, positions: {}, zooms: {}, audioTrack: 0, audioPosition: 0 };
}
export function mockPaperDescription(set: Pick<PracticeSet, "questions" | "resource">) {
  const numbers = set.questions.map((q, i) => q.originalQuestionNumber ?? i + 1);
  const complete = numbers.length === 40 && new Set(numbers).size === 40 && numbers.every((n) => n >= 1 && n <= 40);
  return `${numbers.length} 题 · ${complete ? "完整题卷" : "短卷 / 专项或缺题卷"}${set.resource ? " · " + set.resource.provider : " · 内置原创样卷"}`;
}
export function defaultMockPaper(sets: PracticeSet[], kind: "reading" | "listening") {
  const id = kind === "reading" ? "reading-urban-cooling" : "listening-campus-project";
  return sets.find((set) => set.id === id && set.questions.length > 0)?.id ?? sets.find((set) => set.questions.length > 0)?.id ?? "";
}
