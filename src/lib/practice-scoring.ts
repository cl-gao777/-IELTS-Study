export interface ObjectiveQuestionAnswer {
  id: string;
  answers: string[];
}

export interface ObjectiveAnswerDetail {
  id: string;
  submitted: string;
  expected: string[];
  correct: boolean;
}

export function normalizeAnswer(answer: string) {
  return answer
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[“”‘’"'.,!?;:()[\]{}]/g, "")
    .replace(/\s+/g, " ");
}

export function scoreObjectiveAnswers(
  submitted: Record<string, string>,
  questions: readonly ObjectiveQuestionAnswer[],
) {
  const details = questions.map((question) => {
    const submittedAnswer = submitted[question.id] ?? "";
    const normalized = normalizeAnswer(submittedAnswer);
    const correct = question.answers.some(
      (answer) => normalizeAnswer(answer) === normalized,
    );

    return {
      id: question.id,
      submitted: submittedAnswer,
      expected: question.answers,
      correct,
    } satisfies ObjectiveAnswerDetail;
  });

  return {
    correct: details.filter((detail) => detail.correct).length,
    total: questions.length,
    details,
  };
}

type ObjectiveSkill = "reading" | "listening";

const READING_BANDS: ReadonlyArray<[minimumRawScore: number, band: number]> = [
  [39, 9],
  [37, 8.5],
  [35, 8],
  [33, 7.5],
  [30, 7],
  [27, 6.5],
  [23, 6],
  [19, 5.5],
  [15, 5],
  [13, 4.5],
  [10, 4],
  [8, 3.5],
  [6, 3],
  [4, 2.5],
  [2, 2],
  [1, 1],
  [0, 0],
];

const LISTENING_BANDS: ReadonlyArray<[minimumRawScore: number, band: number]> = [
  [39, 9],
  [37, 8.5],
  [35, 8],
  [32, 7.5],
  [30, 7],
  [26, 6.5],
  [23, 6],
  [18, 5.5],
  [16, 5],
  [13, 4.5],
  [11, 4],
  [8, 3.5],
  [6, 3],
  [4, 2.5],
  [2, 2],
  [1, 1],
  [0, 0],
];

export function calculateAcademicBand(
  correct: number,
  total: number,
  skill: ObjectiveSkill,
) {
  if (total <= 0) {
    return 0;
  }

  const scaledRawScore = Math.max(
    0,
    Math.min(40, Math.round((correct / total) * 40)),
  );
  const table = skill === "reading" ? READING_BANDS : LISTENING_BANDS;

  return table.find(([minimum]) => scaledRawScore >= minimum)?.[1] ?? 0;
}

export function calculateMockOverallBand(bands: readonly number[]) {
  const available = bands.filter(
    (band) => Number.isFinite(band) && band >= 0 && band <= 9,
  );
  if (!available.length) return 0;
  const average =
    available.reduce((total, band) => total + band, 0) / available.length;
  return Math.round(average * 2) / 2;
}
