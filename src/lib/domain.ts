export type StudyArea =
  | "Vocabulary"
  | "Listening"
  | "Reading"
  | "Writing";

export interface StudyTask {
  id: string;
  studyDate: string;
  area: StudyArea;
  title: string;
  detail: string;
  estimatedMinutes: number;
  completed: boolean;
  href: string;
}

export interface VocabularyWord {
  id: string;
  term: string;
  pronunciation: string;
  partOfSpeech: string;
  meaningZh: string;
  definitionEn: string;
  example: string;
  tags: string[];
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string;
}

export type PracticeKind = "reading" | "listening";

export type QuestionKind =
  | "short-answer"
  | "multiple-choice"
  | "true-false-not-given"
  | "yes-no-not-given"
  | "matching-headings"
  | "matching-sentence-endings"
  | "matching-information"
  | "matching-features"
  | "sentence-completion"
  | "summary-completion"
  | "table-completion"
  | "form-completion"
  | "note-completion"
  | "matching"
  | "map-labelling"
  | "flow-chart-completion"
  | "diagram-label-completion";

export interface PracticeQuestion {
  id: string;
  originalQuestionNumber?: number;
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  answers: string[];
  explanation: string;
  evidence?: string;
  imageUrl?: string;
  maxWords?: number;
  /** Shared unordered answer pool: each distinct correct answer earns credit once. */
  answerGroup?: string;
  /** Official variants for each canonical target in answers, in the same order. */
  answerGroupTargets?: string[][];
}

export interface PracticeSet {
  id: string;
  kind: PracticeKind;
  title: string;
  subtitle: string;
  instructions: string;
  passage: string;
  transcript: string;
  audioUrl: string;
  durationMinutes: number;
  questions: PracticeQuestion[];
  resource?: import("./official-resources").OfficialPracticeResource;
}

export interface AttemptAnswer {
  questionId: string;
  submitted: string;
  expected: string[];
  correct: boolean;
}

export interface PracticeAttempt {
  id: number;
  setId: string;
  kind: PracticeKind;
  rawScore: number;
  totalQuestions: number;
  bandScore: number;
  durationSeconds: number;
  answers: AttemptAnswer[];
  submittedAt: string;
}

export interface CoachMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  correction: string;
  provider: string;
  createdAt: string;
}

export interface WritingSubmission {
  id: number;
  taskType: "task-1" | "task-2";
  prompt: string;
  essay: string;
  wordCount: number;
  overallBand: number;
  criteria: {
    taskResponse: number;
    coherenceCohesion: number;
    lexicalResource: number;
    grammarAccuracy: number;
  };
  strengths: string[];
  improvements: string[];
  rewrite: string;
  submittedAt: string;
}

export interface SourceMaterial {
  id: number;
  title: string;
  kind: "reading" | "listening" | "writing" | "vocabulary";
  content: string;
  sourceUrl: string;
  fileName: string;
  mimeType: string;
  fileUrl: string;
  createdAt: string;
}

export interface ReviewItem {
  id: number;
  sourceType: string;
  sourceId: string;
  skill: string;
  prompt: string;
  answer: string;
  resolved: boolean;
  createdAt: string;
  category?: string;
  mistakeCount?: number;
  reviewedAt?: string;
}

export interface DashboardSnapshot {
  date: string;
  displayDate: string;
  tasks: StudyTask[];
  dueVocabulary: number;
  recentAttempts: PracticeAttempt[];
  recentWriting: WritingSubmission[];
  reviewCount: number;
  estimatedBands: {
    listening: number;
    reading: number;
    writing: number;
    overall: number;
  };
  streak: number;
  dailyMinutes: number;
  todayMinutes: number;
  targetBand: number;
  displayName: string;
}
