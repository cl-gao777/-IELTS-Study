import type { PracticeAttempt } from "./domain";
export interface PassageAnnotation { id: string; start: number; end: number; style: "highlight" | "underline"; note: string }
export interface PracticeDraft { answers: Record<string, string>; elapsed: number; fontSize: number; notes: string; dictationText: string; dictationReference: string; isRetry?: boolean }
export interface PracticeWorkspaceState { draft: PracticeDraft; annotations: PassageAnnotation[]; attempt: PracticeAttempt | null; reasons: Record<string, string>; dataEpoch: string; revision: number; runId: string; submissionId: string }
export const emptyPracticeDraft: PracticeDraft = { answers: {}, elapsed: 0, fontSize: 17, notes: "", dictationText: "", dictationReference: "" };
export interface MaterialMetadata { tags: string[]; difficulty: string; section: string; notes: string; provenance: string }
export const emptyMaterialMetadata: MaterialMetadata = { tags: [], difficulty: "未分类", section: "", notes: "", provenance: "用户自有或获准使用" };
