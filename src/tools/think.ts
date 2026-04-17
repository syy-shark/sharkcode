import { tool } from "ai";
import { z } from "zod";

export const thinkTool = tool({
  description:
    "Think through a complex problem step by step before taking action. " +
    "Use this to plan multi-step changes, analyze trade-offs, or reason about " +
    "the best approach. Your thought will be recorded but no action is taken.",
  inputSchema: z.object({
    thought: z
      .string()
      .describe("Your step-by-step analysis, reasoning, or plan"),
  }),
  execute: async () => {
    return "Thinking noted. Continue with your plan.";
  },
});
