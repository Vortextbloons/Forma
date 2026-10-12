import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RuntimeError, type QuestionInteraction, type RigTool, type ToolContext } from "rig";
import { formaEnv, projectRuns } from "../forma/runtime.ts";
import { FORMA_EVENTS } from "../forma/events.ts";
import { designProfileSchema, type DesignProfile } from "../projects/design.ts";
import { updateProject } from "../projects/store.ts";

export interface DesignProposal {
  name: string;
  rationale: string;
  profile: DesignProfile;
}

const proposalInput = z.object({
  name: z.string().trim().min(1),
  rationale: z.string().min(1).describe("Explain how the palette and typography fit this project's brief"),
  profile: designProfileSchema,
});

const questionInput = z.object({
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).max(5).default([]),
  multiple: z.boolean().default(false),
});

async function ask(ctx: ToolContext, question: Omit<QuestionInteraction, "id" | "sessionId" | "createdAt" | "kind"> & { designProposal?: DesignProposal }): Promise<string | string[]> {
  const host = formaEnv()?.host;
  if (!host) throw new RuntimeError("No interaction host is connected.");
  ctx.signal.throwIfAborted();
  const answer = await host.requestInteraction({
    ...question,
    kind: "question",
    id: randomUUID(),
    sessionId: ctx.session.id,
    createdAt: new Date().toISOString(),
  });
  ctx.signal.throwIfAborted();
  if (projectRuns.get(ctx.session.id)?.aborted) throw new RuntimeError("The request was stopped.");
  return answer;
}

export const designTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  {
    name: "ask_question",
    description: "Ask the user about the project, audience, content, goals, or design. Waits for a suggested choice, a custom answer, or Let AI decide. Ask only when the answer affects the work.",
    input: questionInput,
    async execute(input: z.infer<typeof questionInput>, ctx) {
      const answer = await ask(ctx, {
        question: input.question,
        options: [...input.options.map((option) => ({ ...option, value: option.label })), { label: "Let AI decide", value: "Let AI decide" }],
        multiple: input.multiple,
        allowCustom: true,
      });
      return { answer };
    },
  },
  {
    name: "propose_design",
    description: "Preview a complete shared palette, typography, sizes, spacing, and corners for the user to approve or iterate on. Does not change the project until explicitly approved. On feedback, revise and call this tool again. On rejection, keep the current design.",
    input: proposalInput,
    async execute(input: z.infer<typeof proposalInput>, ctx) {
      const answer = await ask(ctx, {
        question: `Use ${input.name} for this project?`,
        designProposal: input,
        options: [{ label: "Approve design", value: "approve" }, { label: "Keep current design", value: "reject" }],
        allowCustom: true,
        placeholder: "Describe what you want changed…",
      });
      const response = Array.isArray(answer) ? answer.join("\n") : answer;
      if (response !== "approve") return { approved: false, feedback: response, instruction: response === "reject" ? "Keep the current design. Do not propose again unless asked." : "Revise the proposal using this feedback and call propose_design again. Do not apply it without approval." };
      const dir = ctx.workspace.dir || ctx.workspace.root;
      const project = await updateProject(dir, (current) => {
        current.settings.designProfile = input.profile;
        current.settings.designApproved = true;
        current.settings.designName = input.name;
        current.settingsRevision += 1;
      });
      formaEnv()?.events.emit(FORMA_EVENTS.designChanged, { settings: project.settings, settingsRevision: project.settingsRevision }, ctx.session.id);
      return { approved: true, profile: input.profile, instruction: "The shared tokens now apply to every page. Use this design for artwork and inspect existing pages when needed." };
    },
  },
];
