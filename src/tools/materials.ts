import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { runPython } from "../materials/python.ts";
import { contextAssetFormat, importContextAsset, openProject, recordAction, saveGeneratedMaterial, updateProject } from "../projects/store.ts";
import type { ProjectFile } from "../projects/schema.ts";

const MAX_ROWS = 2_000;
const MAX_COLUMNS = 50;
const MAX_STDOUT_CHARS = 6_000;
const MAX_STDERR_CHARS = 2_000;

const runPythonInput = z.object({
  code: z
    .string()
    .min(1)
    .describe(
      "Python 3 script to run in an isolated sandbox. Read staged materials from inputs/<name>; write result files into outputs/. No network, no subprocesses, and no access to the computer's files.",
    ),
  materials: z
    .array(z.string())
    .default([])
    .describe("Material ids (from read_project) to copy into inputs/ for this script"),
  timeoutMs: z.number().int().positive().max(120_000).optional().describe("Wall-clock limit in milliseconds (default 20000)"),
});

const createTableInput = z.object({
  name: z.string().trim().min(1).describe("Table name, for example Marketing spend by quarter"),
  columns: z.array(z.string()).min(1).max(MAX_COLUMNS).describe("Column headings"),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.boolean()])))
    .max(MAX_ROWS)
    .default([])
    .describe("Row values, aligned with columns (strings; numbers and booleans are accepted)"),
  caption: z.string().optional().describe("Short caption shown under the table"),
  resultId: z
    .string()
    .optional()
    .describe("Existing table result id (from read_project) to refresh in place so pages keep the same reference; omit to save a new result"),
  sources: z
    .array(z.string())
    .default([])
    .describe("Material ids this table was built from, so the result is linked to its sources"),
});

const saveSummaryInput = z.object({
  name: z.string().trim().min(1).describe("Summary name, for example Q3 findings"),
  markdown: z.string().min(1).describe("Markdown summary text"),
  resultId: z
    .string()
    .optional()
    .describe("Existing summary result id (from read_project) to refresh in place so pages keep the same reference; omit to save a new result"),
  sources: z.array(z.string()).default([]).describe("Material ids this summary was written from"),
});

export const materialTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  runPythonTool(),
  createTableTool(),
  saveSummaryTool(),
];

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function existingIds(dir: string, ids: string[]): Promise<ProjectFile> {
  const project = await openProject(dir);
  const known = new Set(project.context.map((item) => item.id));
  for (const id of ids) {
    if (!known.has(id)) {
      throw new RuntimeError(`Unknown material "${id}"`, { details: { contextIds: [...known] } });
    }
  }
  return project;
}

function materialFileName(item: { name: string; asset: string }): string {
  const extension = extname(item.asset);
  if (extension && item.name.toLowerCase().endsWith(extension.toLowerCase())) return item.name;
  return `${item.name}${extension}`;
}

function runPythonTool(): RigTool<typeof runPythonInput, unknown> {
  return {
    name: "run_python",
    description:
      "Run a Python 3 script in an isolated sandbox to analyse materials. Each requested material is copied to inputs/<file name>; the script may read those files and must write any result files into outputs/. The sandbox is a throwaway browser with no network, no subprocesses, and no access to the computer's files. Printed output is limited, so write large results to outputs/files instead of printing them. Files written to outputs/ are saved as project materials linked to their sources, and the exact script is kept with the run so the user can inspect it. Example: { code: \"import csv\\nrows=list(csv.DictReader(open('inputs/sales.csv')))\\nprint(len(rows))\\nopen('outputs/total.txt','w').write(str(sum(float(r['amount']) for r in rows)))\", materials: [\"ctx_ab12cd34ef56\"] }.",
    input: runPythonInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await existingIds(dir, input.materials);
      const items = input.materials.map((id) => project.context.find((item) => item.id === id)!);
      const inputs = await Promise.all(
        items.map(async (item) => ({
          name: materialFileName(item),
          data: await readFile(resolve(dir, item.asset)),
        })),
      );
      const result = await runPython({
        code: input.code,
        inputs,
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      });
      const saved: Array<{ contextId: string; name: string; asset: string; bytes: number }> = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const output of result.outputs) {
        let format: { extension: string; mime: string };
        try {
          format = contextAssetFormat(output.name, "");
        } catch (error) {
          skipped.push({ name: output.name, reason: error instanceof Error ? error.message : String(error) });
          continue;
        }
        const { item } = await importContextAsset(dir, {
          name: output.name,
          extension: format.extension,
          mime: format.mime,
          data: output.data,
          role: "optional",
          derivedFrom: input.materials,
        });
        saved.push({ contextId: item.id, name: item.name, asset: item.asset, bytes: output.data.byteLength });
      }
      await updateProject(dir, (current) => {
        recordAction(current, {
          kind: "run",
          label: `Ran Python on ${items.length} material${items.length === 1 ? "" : "s"}`,
          inputs: input.materials,
          outputs: saved.map((entry) => entry.contextId),
          detail: `${result.exitCode === 0 && !result.timedOut ? "Finished" : result.timedOut ? "Stopped after the time limit" : `Exit code ${result.exitCode}`} in ${result.durationMs} ms.`,
          code: input.code,
        });
      });
      return {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputTruncated: result.outputTruncated,
        durationMs: result.durationMs,
        inputs: result.inputs.map((entry, index) => ({
          material: items[index]?.name ?? entry.name,
          path: `inputs/${entry.staged}`,
        })),
        stdout: result.stdout.slice(0, MAX_STDOUT_CHARS),
        stderr: result.stderr.slice(0, MAX_STDERR_CHARS),
        results: saved,
        skipped: skipped.length > 0 ? skipped : undefined,
      };
    },
  };
}

function createTableTool(): RigTool<typeof createTableInput, unknown> {
  return {
    name: "create_table",
    description:
      "Save a table as a project material and return the HTML to place in artwork. Use it for tabular material-to-result work: the saved table is reviewable in Materials, linked to the materials it was built from, and marked for refresh when those materials change. Pass resultId with an existing table id to refresh it in place instead of leaving a stale duplicate. Values are shown as text; numbers and booleans are accepted. Example: { name: \"Spend by quarter\", columns: [\"Quarter\", \"Spend\"], rows: [[\"Q1\", \"120\"], [\"Q2\", \"200\"]], sources: [\"ctx_ab12cd34ef56\"] }.",
    input: createTableInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await existingIds(dir, input.sources);
      const html = tableHtml(input);
      const { item } = await saveGeneratedMaterial(dir, {
        ...(input.resultId ? { id: input.resultId } : {}),
        name: input.name,
        extension: ".html",
        mime: "text/html",
        data: html,
        derivedFrom: input.sources,
      });
      await updateProject(dir, (current) => {
        recordAction(current, {
          kind: "derive",
          label: `${input.resultId ? "Rebuilt" : "Built"} table "${input.name}"`,
          inputs: input.sources,
          outputs: [item.id],
          detail: `${input.rows.length} row${input.rows.length === 1 ? "" : "s"} · ${input.columns.length} column${input.columns.length === 1 ? "" : "s"}`,
        });
      });
      return { contextId: item.id, name: item.name, asset: item.asset, html };
    },
  };
}

function tableHtml(input: z.infer<typeof createTableInput>): string {
  const head = input.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = input.rows
    .map((row) => `<tr>${input.columns.map((_, index) => `<td>${escapeHtml(String(row[index] ?? ""))}</td>`).join("")}</tr>`)
    .join("\n      ");
  const caption = input.caption ? `\n      <caption>${escapeHtml(input.caption)}</caption>` : "";
  return `<table class="forma-table">
      <thead><tr>${head}</tr></thead>
      <tbody>
      ${body}
      </tbody>${caption}
    </table>`;
}

function saveSummaryTool(): RigTool<typeof saveSummaryInput, unknown> {
  return {
    name: "save_summary",
    description:
      "Save a written summary as a project material linked to the materials it was written from. Use it when the user asks for a summary they can review, reuse, or drop into artwork instead of only reading chat. Pass resultId with an existing summary id to refresh it in place instead of leaving a stale duplicate. Example: { name: \"Sales findings\", markdown: \"- Revenue grew 12%...\", sources: [\"ctx_ab12cd34ef56\"] }.",
    input: saveSummaryInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await existingIds(dir, input.sources);
      const { item } = await saveGeneratedMaterial(dir, {
        ...(input.resultId ? { id: input.resultId } : {}),
        name: input.name,
        extension: ".md",
        mime: "text/markdown",
        data: `${input.markdown.trim()}\n`,
        derivedFrom: input.sources,
      });
      await updateProject(dir, (current) => {
        recordAction(current, {
          kind: "derive",
          label: `${input.resultId ? "Rewrote" : "Wrote"} summary "${input.name}"`,
          inputs: input.sources,
          outputs: [item.id],
        });
      });
      return { contextId: item.id, name: item.name, asset: item.asset };
    },
  };
}
