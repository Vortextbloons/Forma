import { z } from "zod";
import { RuntimeError, type RigTool } from "rig";

const renderMathInput = z.object({
  tex: z.string().min(1).describe("LaTeX math expression without surrounding $ or \\[ \\] delimiters"),
  display: z.enum(["inline", "display"]).default("inline").describe("inline for math within text, display for a standalone block"),
});

export const mathTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  renderMathTool(),
];

function renderMathTool(): RigTool<typeof renderMathInput, unknown> {
  return {
    name: "render_math",
    description:
      "Render a LaTeX math expression to static KaTeX HTML. Use inline for equations within text and display for standalone statements; paste the returned html into the page source. Fractions, matrices, integrals, and symbols are supported.",
    input: renderMathInput,
    async execute(input) {
      const { renderToString } = await import("katex");
      try {
        const html = renderToString(input.tex, {
          displayMode: input.display === "display",
          output: "htmlAndMathml",
          trust: false,
          throwOnError: true,
        });
        return { display: input.display, html };
      } catch (error) {
        throw new RuntimeError(
          `The math could not be rendered: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
