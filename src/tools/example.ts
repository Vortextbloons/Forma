import { defineTool } from "rig";
import { z } from "zod";







export default defineTool({
  name: "project_summary",
  description: "Returns a short summary of this rig project (scaffold example).",
  input: z.object({
    includeToolList: z.boolean().optional().describe("Include the tool list in the summary"),
  }),
  execute: async (input, ctx) => {
    ctx.logger.info(`[project_summary] running for ${ctx.session.id}`);
    ctx.progress.report({ message: "collecting project facts", current: 1, total: 2 });
    const summary = {
      project: ctx.workspace.root,
      workspace: ctx.workspace.dir,
      isWorktree: ctx.workspace.isWorktree,
      session: ctx.session.id,
      tools: input.includeToolList === true ? ["read", "grep", "question", "todo", "project_summary"] : undefined,
    };
    ctx.progress.report({ message: "done", current: 2, total: 2 });
    await ctx.artifacts.emit({
      type: "json",
      title: "project summary",
      content: summary,
    });
    return { summary };
  },
});
