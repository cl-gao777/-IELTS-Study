export interface ObjectiveQuestionAnswer {
  id: string;
  answers: string[];
  maxWords?: number;
  answerGroup?: string;
  answerGroupTargets?: string[][];
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

/** Validate aliases for one slot; cross-slot consistency is checked below. */
export function answerGroupTargetIssues(question: ObjectiveQuestionAnswer): string[] {
  const targets = question.answerGroupTargets;
  if (targets === undefined) return [];
  if (!question.answerGroup?.trim()) return ["答案别名组必须同时指定 answerGroup。"];
  if (targets.length !== question.answers.length) return ["别名组数量必须与 answers 中的正确目标数量一致。"];
  const seen = new Map<string, number>();
  const issues: string[] = [];
  targets.forEach((aliases, targetIndex) => {
    const normalized = aliases.map(normalizeAnswer);
    if (!normalized.length || normalized.some((alias) => !alias)) issues.push("每个正确目标必须至少包含一个非空别名。");
    if (!normalized.includes(normalizeAnswer(question.answers[targetIndex]))) issues.push("每个别名组必须包含对应的 canonical answer。");
    for (const alias of normalized) {
      if (seen.has(alias) && seen.get(alias) !== targetIndex) issues.push("不同正确目标的别名不能重叠，否则无法确定唯一得分目标。");
      seen.set(alias, targetIndex);
    }
    if (question.maxWords && aliases.some((alias) => alias.trim().split(/\s+/).filter(Boolean).length > question.maxWords!)) {
      issues.push("官方别名超过了所设的最多词数，请调整答案或限制。");
    }
  });
  return [...new Set(issues)];
}

/**
 * Grouped answers enumerate distinct canonical targets. Optional answerGroupTargets
 * lists official aliases for each target; an alias never earns an additional mark.
 * All slots in a group share the same targets and word limit. The number of targets
 * equals the number of numbered slots, preserving one mark per question number.
 */
export function groupedAnswerIssues(questions: readonly ObjectiveQuestionAnswer[]) {
  const groups = new Map<string, number[]>();
  const issues: { index: number; message: string }[] = [];
  questions.forEach((question, index) => {
    for (const message of answerGroupTargetIssues(question)) issues.push({ index, message });
    if (question.answerGroup === undefined) return;
    const indices = groups.get(question.answerGroup) ?? [];
    indices.push(index);
    groups.set(question.answerGroup, indices);
  });
  for (const [group, indices] of groups) {
    if (issues.some((issue) => indices.includes(issue.index))) continue;
    const first = questions[indices[0]];
    const expected = new Set(first.answers.map(normalizeAnswer));
    let message = "";
    if (!group.trim() || indices.length < 2) {
      message = "乱序答案组至少包含两个编号，且必须有非空组名。";
    } else if (expected.has("") || expected.size !== first.answers.length || expected.size !== indices.length) {
      message = "乱序组 answers 必须列出互不重复的正确选项，选项数须等于本组编号数；不能在此列同义答案。";
    } else if (indices.some((index) => {
      const normalized = questions[index].answers.map(normalizeAnswer);
      return normalized.length !== expected.size || new Set(normalized).size !== normalized.length || normalized.some((answer) => !expected.has(answer));
    })) {
      message = "同一乱序组内每个编号必须使用相同的完整正确选项列表。";
    } else if (indices.some((index) => questions[index].maxWords !== first.maxWords)) {
      message = "同一乱序组内每个编号必须使用相同的最多词数限制。";
    } else if (first.maxWords && first.answers.some((answer) => answer.trim().split(/\s+/).filter(Boolean).length > first.maxWords!)) {
      message = "乱序组参考答案超过了最多词数限制。";
    } else if (indices.some((index) => Boolean(questions[index].answerGroupTargets) !== Boolean(first.answerGroupTargets))) {
      message = "同一乱序组必须为每个编号提供相同的官方别名组。";
    } else if (first.answerGroupTargets) {
      const targetAliases = new Map(first.answers.map((answer, index) => [normalizeAnswer(answer), new Set(first.answerGroupTargets![index].map(normalizeAnswer))]));
      if (indices.some((index) => questions[index].answers.some((answer, targetIndex) => {
        const expectedAliases = targetAliases.get(normalizeAnswer(answer))!;
        const aliases = new Set(questions[index].answerGroupTargets![targetIndex].map(normalizeAnswer));
        return aliases.size !== expectedAliases.size || [...aliases].some((alias) => !expectedAliases.has(alias));
      }))) message = "同一乱序组的每个正确目标必须使用相同的完整官方别名列表。";
    }
    if (message) for (const index of indices) issues.push({ index, message });
  }
  return issues;
}

export function scoreObjectiveAnswers(
  submitted: Record<string, string>,
  questions: readonly ObjectiveQuestionAnswer[],
) {
  const groupIssues = groupedAnswerIssues(questions);
  if (groupIssues.length) throw new Error(groupIssues[0].message);
  const credited = new Map<string, Set<string>>();
  const details = questions.map((question) => {
    const submittedAnswer = submitted[question.id] ?? "";
    const normalized = normalizeAnswer(submittedAnswer);
    const withinLimit = !question.maxWords || submittedAnswer.trim().split(/\s+/).filter(Boolean).length <= question.maxWords;
    const targetIndex = question.answerGroupTargets
      ? question.answerGroupTargets.findIndex((aliases) => aliases.some((answer) => normalizeAnswer(answer) === normalized))
      : question.answers.findIndex((answer) => normalizeAnswer(answer) === normalized);
    let correct = Boolean(normalized) && withinLimit && targetIndex >= 0;
    if (correct && question.answerGroup) {
      const used = credited.get(question.answerGroup) ?? new Set<string>();
      const target = normalizeAnswer(question.answers[targetIndex]);
      correct = !used.has(target);
      if (correct) used.add(target);
      credited.set(question.answerGroup, used);
    }

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
  // Conversion only applies to a full forty-question test, never a short drill.
  if (total !== 40 || !Number.isFinite(correct)) {
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
