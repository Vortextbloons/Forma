import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { importContextAsset } from "../projects/store.ts";

const createChartInput = z.object({
  name: z.string().trim().min(1).describe("Chart name, for example Quarterly revenue"),
  width: z.number().int().positive().max(4096).default(1200).describe("SVG width in pixels"),
  height: z.number().int().positive().max(4096).default(800).describe("SVG height in pixels"),
  options: z.record(z.unknown()).describe("ECharts options object with chart data and styling as plain JSON"),
});

export const chartTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  createChartTool(),
];

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

function assertJsonOnly(value: unknown, path: string): void {
  if (typeof value === "function" || typeof value === "undefined" || typeof value === "symbol" || typeof value === "bigint") {
    throw new RuntimeError(`Chart option at "${path}" must be plain JSON data and styling, without executable callbacks.`);
  }
  if (typeof value === "string") {
    if (value.includes("://") || /^\s*(\/\/|data:)/i.test(value)) {
      throw new RuntimeError(`Chart option at "${path}" must not reference external assets. Pass data and styling inline instead.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonOnly(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new RuntimeError(`Chart option at "${path}" must be a plain JSON object.`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonOnly(entry, `${path}.${key}`);
    }
  }
}

function createChartTool(): RigTool<typeof createChartInput, unknown> {
  return {
    name: "create_chart",
    description:
      "Render chart data and styling to a static SVG asset with ECharts. Pass a complete ECharts options object as plain JSON (any chart type, data, colors, fonts); animation is disabled and the SVG is saved as a project asset. Example: { name: \"Quarterly revenue\", width: 1200, height: 800, options: { xAxis: { type: \"category\", data: [\"Q1\", \"Q2\", \"Q3\", \"Q4\"] }, yAxis: { type: \"value\" }, series: [{ type: \"bar\", data: [120, 200, 150, 80], itemStyle: { color: \"#8032a8\" } }] } }. Reference the returned asset path in artwork and record the context id in the page assets.",
    input: createChartInput,
    async execute(input, ctx) {
      assertJsonOnly(input.options, "options");
      const echarts = await import("echarts");
      const chart = echarts.init(null, null, {
        renderer: "svg",
        ssr: true,
        width: input.width,
        height: input.height,
      });
      let svg: string;
      try {
        chart.setOption({ ...(input.options as Record<string, unknown>), animation: false } as never);
        svg = chart.renderToSVGString();
      } catch (error) {
        throw new RuntimeError(`The chart could not be rendered: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        chart.dispose();
      }
      if (!svg.startsWith("<svg")) {
        throw new RuntimeError("The chart could not be rendered: ECharts returned an empty result. Check the options object.");
      }
      const { item } = await importContextAsset(dirOf(ctx), {
        name: input.name,
        extension: ".svg",
        mime: "image/svg+xml",
        data: svg,
        role: "optional",
      });
      return { contextId: item.id, name: item.name, asset: item.asset };
    },
  };
}
