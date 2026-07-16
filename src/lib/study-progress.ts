export interface ProgressTask {
  estimatedMinutes: number;
  completed: boolean;
}

export interface StudyProgress {
  completedMinutes: number;
  totalMinutes: number;
  percentage: number;
}

export function calculateStudyProgress(
  tasks: readonly ProgressTask[],
): StudyProgress {
  const totalMinutes = tasks.reduce(
    (total, task) => total + task.estimatedMinutes,
    0,
  );
  const completedMinutes = tasks.reduce(
    (total, task) => total + (task.completed ? task.estimatedMinutes : 0),
    0,
  );

  return {
    completedMinutes,
    totalMinutes,
    percentage:
      totalMinutes === 0
        ? 0
        : Math.round((completedMinutes / totalMinutes) * 100),
  };
}
