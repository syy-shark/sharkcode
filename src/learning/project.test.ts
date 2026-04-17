import { describe, expect, it } from "bun:test";
import {
  advanceLearningProject,
  createLearningProjectFromPlan,
  formatLearningProjectCurrent,
  formatLearningProjectHint,
  getCurrentProjectMilestone,
  rememberLearningProject,
} from "./project.ts";
import { createLearningSessionState } from "./state.ts";

describe("learning project", () => {
  it("creates a project with the first milestone in progress", () => {
    const project = createLearningProjectFromPlan({
      title: "个人主页",
      description: "做一个个人主页",
      milestones: [
        {
          title: "确定首页结构",
          objective: "先定义首页有哪些区块",
          hint: "说清首页需要哪些内容模块",
          concepts: ["requirement-clarity"],
        },
        {
          title: "实现首屏布局",
          objective: "完成首屏布局",
          hint: "说明布局和风格",
          concepts: ["ui-expression"],
        },
      ],
    });

    expect(getCurrentProjectMilestone(project)?.title).toBe("确定首页结构");
    expect(project.milestones[0]?.status).toBe("in_progress");
  });

  it("advances to the next milestone", () => {
    const project = createLearningProjectFromPlan({
      title: "个人主页",
      description: "做一个个人主页",
      milestones: [
        {
          title: "确定首页结构",
          objective: "先定义首页有哪些区块",
          hint: "说清首页需要哪些内容模块",
          concepts: ["requirement-clarity"],
        },
        {
          title: "实现首屏布局",
          objective: "完成首屏布局",
          hint: "说明布局和风格",
          concepts: ["ui-expression"],
        },
      ],
    });
    const state = rememberLearningProject(createLearningSessionState(), project);
    const result = advanceLearningProject(state);

    expect(result.sessionState.activeProject?.milestones[0]?.status).toBe("completed");
    expect(result.sessionState.activeProject?.milestones[1]?.status).toBe("in_progress");
  });

  it("formats current milestone and hint", () => {
    const project = createLearningProjectFromPlan({
      title: "个人主页",
      description: "做一个个人主页",
      milestones: [
        {
          title: "确定首页结构",
          objective: "先定义首页有哪些区块",
          hint: "说清首页需要哪些内容模块",
          suggestedPrompt: "请先帮我定义首页结构。",
          concepts: ["requirement-clarity"],
        },
      ],
    });

    expect(formatLearningProjectCurrent(project)).toContain("当前阶段：确定首页结构");
    expect(formatLearningProjectHint(project)).toContain("请先帮我定义首页结构");
  });
});
