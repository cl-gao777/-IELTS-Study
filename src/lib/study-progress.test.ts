import { describe, expect, it } from "vitest";

import { calculateStudyProgress } from "./study-progress";

describe("calculateStudyProgress", () => {
  it("weights progress by the study minutes completed", () => {
    const progress = calculateStudyProgress([
      { estimatedMinutes: 20, completed: true },
      { estimatedMinutes: 15, completed: true },
      { estimatedMinutes: 40, completed: false },
    ]);

    expect(progress).toEqual({
      completedMinutes: 35,
      totalMinutes: 75,
      percentage: 47,
    });
  });
});
