import { describe, expect, it } from "bun:test";
import { calculateAccuracy, formatLearningProgress, getLearningLevelForXp } from "./progress.ts";
import { createDefaultLearningProfile } from "./profile.ts";

describe("learning progress", () => {
  it("maps xp to Chinese learning levels", () => {
    expect(getLearningLevelForXp(0)).toBe("入门");
    expect(getLearningLevelForXp(500)).toBe("基础");
    expect(getLearningLevelForXp(20000)).toBe("导师");
  });

  it("calculates quiz accuracy", () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
    expect(calculateAccuracy(10, 7)).toBe(70);
  });

  it("formats progress summary", () => {
    const profile = createDefaultLearningProfile();
    const text = formatLearningProgress(profile);

    expect(text).toContain("学习进度");
    expect(text).toContain("当前等级：入门");
    expect(text).toContain("已答小测：0");
  });
});
