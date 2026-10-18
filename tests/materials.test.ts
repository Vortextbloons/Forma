import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createToolHarness } from "rig/testing";
import { profileDataBytes } from "../src/materials/data.ts";
import { materialPreview } from "../src/materials/preview.ts";
import { runPython } from "../src/materials/python.ts";
import { chartTools } from "../src/tools/chart.ts";
import { materialTools } from "../src/tools/materials.ts";
import { projectTools } from "../src/tools/project.ts";
import { restorePage, updatePage, writePage } from "../src/projects/pages.ts";
import { composePage } from "../src/rendering/compose.ts";
import {
  addFolder,
  createProject,
  importContextFile,
  importContextNote,
  openProject,
  removeContextItem,
  removeFolder,
  replaceContextFile,
  setContextFolder,
} from "../src/projects/store.ts";
import { defaultSettings, effectiveSize, type ContextItem } from "../src/projects/schema.ts";

const runPythonTool = materialTools.find((tool) => tool.name === "run_python")!;
const createTable = materialTools.find((tool) => tool.name === "create_table")!;
const saveSummary = materialTools.find((tool) => tool.name === "save_summary")!;
const createChart = chartTools.find((tool) => tool.name === "create_chart")!;
const readProject = projectTools.find((tool) => tool.name === "read_project")!;
const readContext = projectTools.find((tool) => tool.name === "read_context")!;
const readPageTool = projectTools.find((tool) => tool.name === "read_page")!;

let root: string;
let pythonReady = false;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-materials-"));
  process.env.FORMA_DATA_DIR = join(root, "data");
  pythonReady = await runPython({ code: "print('ready')", timeoutMs: 30_000 })
    .then((result) => result.exitCode === 0)
    .catch(() => false);
});

afterAll(async () => {
  delete process.env.FORMA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

async function makeProject(name: string): Promise<string> {
  const dir = join(root, name);
  await createProject({ dir, name, prompt: "", mode: "plan", settings: defaultSettings() });
  return dir;
}

async function writeFixture(name: string, contents: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, contents, "utf8");
  return path;
}

function itemOf(project: { context: ContextItem[] }, id: string): ContextItem {
  const item = project.context.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing context item ${id}`);
  return item;
}

async function xlsxFixture(): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0"?><workbook><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/sharedStrings.xml",
    '<?xml version="1.0"?><sst count="4" uniqueCount="4">' +
      "<si><t>Region</t></si><si><t>Amount</t></si><si><t>North</t></si><si><t>South</t></si></sst>",
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>950.5</v></c></row>' +
      "</sheetData></worksheet>",
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("material data profiles", () => {
  it("profiles delimited data with typed columns and a bounded preview", async () => {
    const csv = "Region,Amount,Active,Closed\nNorth,1200,true,2024-01-05\nSouth,950.5,false,2024-02-11\n";
    const profile = await profileDataBytes(Buffer.from(csv), "csv");
    expect(profile.format).toBe("csv");
    expect(profile.sheets).toHaveLength(1);
    const sheet = profile.sheets[0]!;
    expect(sheet.rows).toBe(2);
    expect(sheet.columns).toEqual([
      { name: "Region", type: "text" },
      { name: "Amount", type: "number" },
      { name: "Active", type: "boolean" },
      { name: "Closed", type: "date" },
    ]);
    expect(sheet.preview).toEqual([
      ["North", "1200", "true", "2024-01-05"],
      ["South", "950.5", "false", "2024-02-11"],
    ]);
  });

  it("keeps the preview small for wide and long files", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => `r${index},${index}`).join("\n");
    const profile = await profileDataBytes(Buffer.from(`Name,Count\n${rows}\n`), "csv");
    expect(profile.sheets[0]!.rows).toBe(40);
    expect(profile.sheets[0]!.preview).toHaveLength(5);
  });

  it("profiles JSON arrays and objects of arrays", async () => {
    const arrayProfile = await profileDataBytes(
      Buffer.from(JSON.stringify([{ region: "North", amount: 1200 }, { region: "South", amount: 950 }])),
      "json",
    );
    expect(arrayProfile.sheets[0]!.columns).toEqual([
      { name: "region", type: "text" },
      { name: "amount", type: "number" },
    ]);
    expect(arrayProfile.sheets[0]!.rows).toBe(2);

    const objectProfile = await profileDataBytes(
      Buffer.from(JSON.stringify({ jan: [1, 2], feb: [3, 4] })),
      "json",
    );
    expect(objectProfile.sheets.map((sheet) => sheet.name)).toEqual(["jan", "feb"]);
  });

  it("reads an Excel workbook without extra dependencies", async () => {
    const profile = await profileDataBytes(await xlsxFixture(), "xlsx");
    expect(profile.format).toBe("xlsx");
    const sheet = profile.sheets[0]!;
    expect(sheet.name).toBe("Sales");
    expect(sheet.rows).toBe(2);
    expect(sheet.columns).toEqual([
      { name: "Region", type: "text" },
      { name: "Amount", type: "number" },
    ]);
    expect(sheet.preview).toEqual([
      ["North", "1200"],
      ["South", "950.5"],
    ]);
  });

  it("orders XLSX sheets by workbook relationships and formats date cells", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook><sheets>' +
        '<sheet name="Summary" sheetId="2" r:id="rId2"/>' +
        '<sheet name="Data" sheetId="1" r:id="rId1"/>' +
        "</sheets></workbook>",
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
        "</Relationships>",
    );
    zip.file(
      "xl/styles.xml",
      '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>45292</v></c></row>' +
        "</sheetData></worksheet>",
    );
    zip.file(
      "xl/worksheets/sheet2.xml",
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Label</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>hello</t></is></c></row>' +
        "</sheetData></worksheet>",
    );

    const profile = await profileDataBytes(await zip.generateAsync({ type: "nodebuffer" }), "xlsx");
    expect(profile.sheets.map((sheet) => sheet.name)).toEqual(["Summary", "Data"]);
    expect(profile.sheets[0]!.preview).toEqual([["hello"]]);
    expect(profile.sheets[1]!.columns).toEqual([{ name: "Date", type: "date" }]);
    expect(profile.sheets[1]!.preview).toEqual([["2024-01-01"]]);
  });

  it("profiles JSON and XLSX larger than the read limit without truncating", async () => {
    const jsonBuffer = Buffer.from(
      JSON.stringify(Array.from({ length: 70_000 }, (_, index) => ({ id: index, note: "x".repeat(120) }))),
    );
    expect(jsonBuffer.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const jsonProfile = await profileDataBytes(jsonBuffer, "json");
    expect(jsonProfile.truncated).toBe(false);
    expect(jsonProfile.sheets[0]!.rows).toBe(70_000);

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const rows = Array.from(
      { length: 9_000 },
      (_, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${"y".repeat(900)}</t></is></c></row>`,
    );
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`);
    const workbook = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    expect(workbook.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const workbookProfile = await profileDataBytes(workbook, "xlsx");
    expect(workbookProfile.truncated).toBe(false);
    expect(workbookProfile.sheets[0]!.name).toBe("Data");
    expect(workbookProfile.sheets[0]!.rows).toBe(8_999);
  });
});

describe("materials workspace", () => {
  it("imports data files with a profile instead of pasting contents into the project", async () => {
    const dir = await makeProject("data-import");
    const csv = await writeFixture("sales.csv", "Region,Amount\nNorth,1200\nSouth,950\n");
    await addFolder(dir, "Numbers");
    const { project, item } = await importContextFile(dir, csv, "optional", "Sales", "Numbers");

    expect(item.mime).toBe("text/csv");
    expect(item.folder).toBe("Numbers");
    expect(item.revision).toBe(1);
    expect(item.status).toBe("ready");
    expect(item.data?.sheets[0]!.rows).toBe(2);
    expect(project.folders).toEqual(["Numbers"]);

    const listed = (await createToolHarness(readProject, { cwd: dir }).run({})) as {
      context: Array<{ id: string; data?: { format: string; sheets: Array<{ columns: string[] }> } }>;
      folders: string[];
    };
    expect(listed.folders).toEqual(["Numbers"]);
    expect(listed.context[0]!.data).toMatchObject({ format: "csv" });
    expect(listed.context[0]!.data!.sheets[0]!.columns).toEqual(["Region:text", "Amount:number"]);

    const detail = (await createToolHarness(readContext, { cwd: dir }).run({ id: item.id })) as {
      format: string;
      sheets: Array<{ rows: number; columns: string[]; preview: string[][] }>;
    };
    expect(detail.format).toBe("csv");
    expect(detail.sheets[0]!.columns).toEqual(["Region (text)", "Amount (number)"]);
    expect(detail.sheets[0]!.preview).toEqual([
      ["North", "1200"],
      ["South", "950"],
    ]);
  });

  it("replaces a material, keeps the original version, and flags what depended on it", async () => {
    const dir = await makeProject("replace-material");
    const first = await writeFixture("first.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, first, "optional", "Sales");
    const originalAsset = resolve(dir, item.asset);
    expect(existsSync(originalAsset)).toBe(true);

    const table = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Spend",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      sources: [item.id],
    })) as { contextId: string };
    await writePage(dir, {
      index: 1,
      title: "Numbers",
      html: "<h1>Numbers</h1>",
      css: "",
      assets: [item.id, table.contextId],
    });

    const second = await writeFixture("second.csv", "Region,Amount\nNorth,1500\nWest,700\n");
    const { project } = await replaceContextFile(dir, item.id, second);
    const updated = itemOf(project, item.id);
    expect(updated.revision).toBe(2);
    expect(updated.asset).toBe(`assets/${item.id}.v2.csv`);
    expect(updated.stale).toBe(false);
    expect(updated.data?.sheets[0]!.rows).toBe(2);
    expect(existsSync(originalAsset)).toBe(true);
    expect(existsSync(resolve(dir, updated.asset))).toBe(true);
    expect(itemOf(project, table.contextId).stale).toBe(true);
    expect(project.pageMeta[project.pages[0]!]!.stale).toBe(true);

    const refreshed = await writePage(dir, {
      pageId: project.pages[0]!,
      index: 1,
      title: "Numbers",
      html: "<h1>Numbers, revised</h1>",
      css: "",
      assets: [item.id, table.contextId],
    });
    expect(refreshed.project.pageMeta[project.pages[0]!]!.stale).toBe(true);
  });

  it("leaves results alone when a material just moves between folders", async () => {
    const dir = await makeProject("folders");
    const csv = await writeFixture("filed.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales", "Numbers");
    const table = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Spend",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      sources: [item.id],
    })) as { contextId: string };

    await setContextFolder(dir, item.id, "Archive/Numbers");
    await addFolder(dir, "Temp");
    await removeFolder(dir, "Temp");
    const project = await openProject(dir);
    expect(itemOf(project, item.id).folder).toBe("Archive/Numbers");
    expect(project.folders).toContain("Archive/Numbers");
    expect(project.folders).not.toContain("Temp");
    expect(itemOf(project, table.contextId).stale).toBe(false);

    await removeFolder(dir, "Archive/Numbers");
    const after = await openProject(dir);
    expect(itemOf(after, item.id).folder).toBe("");
    expect(itemOf(after, table.contextId).stale).toBe(false);
  });

  it("keeps slide staleness through metadata edits and restores until artwork is rebuilt", async () => {
    const dir = await makeProject("stale-pages");
    const csv = await writeFixture("stale.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");
    const { pageId } = await writePage(dir, {
      index: 1,
      title: "Numbers",
      html: "<h1>Numbers</h1>",
      css: "",
      assets: [item.id],
    });

    const replacement = await writeFixture("stale-v2.csv", "Region,Amount\nNorth,1500\n");
    await replaceContextFile(dir, item.id, replacement);
    expect((await openProject(dir)).pageMeta[pageId]!.stale).toBe(true);

    const listed = (await createToolHarness(readProject, { cwd: dir }).run({})) as {
      pages: Array<{ id: string; stale?: boolean }>;
    };
    expect(listed.pages.find((page) => page.id === pageId)?.stale).toBe(true);
    const detail = (await createToolHarness(readPageTool, { cwd: dir }).run({ pageId })) as { stale?: boolean };
    expect(detail.stale).toBe(true);

    const titled = await updatePage(dir, pageId, { title: "Numbers, renamed" });
    expect(titled.project.pageMeta[pageId]!.stale).toBe(true);
    await updatePage(dir, pageId, { assets: [item.id] });
    expect((await openProject(dir)).pageMeta[pageId]!.stale).toBe(true);
    await restorePage(dir, pageId);
    expect((await openProject(dir)).pageMeta[pageId]!.stale).toBe(true);

    const cosmetic = await updatePage(dir, pageId, { html: "<h1>Numbers, revised</h1>" });
    expect(cosmetic.project.pageMeta[pageId]!.stale).toBe(true);

    const revision = itemOf(await openProject(dir), item.id).revision;
    const raced = await updatePage(dir, pageId, { acknowledgeSources: { [item.id]: revision - 1 } });
    expect(raced.project.pageMeta[pageId]!.stale).toBe(true);

    const refreshed = await updatePage(dir, pageId, { acknowledgeSources: { [item.id]: revision } });
    expect(refreshed.project.pageMeta[pageId]!.stale).toBeUndefined();
  });

  it("refuses to remove a material that a saved result was built from", async () => {
    const dir = await makeProject("remove-derived-source");
    const csv = await writeFixture("derive.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");
    const table = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Spend",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      sources: [item.id],
    })) as { contextId: string };

    await expect(removeContextItem(dir, item.id)).rejects.toThrow(/still used/i);
    const project = await openProject(dir);
    expect(itemOf(project, item.id).derivedFrom).toEqual([]);
    expect(itemOf(project, table.contextId).derivedFrom).toEqual([item.id]);
    expect(existsSync(resolve(dir, item.asset))).toBe(true);
    expect(project.pageMeta).toEqual({});
  });

  it("keeps a referenced image, its file, and the page export and history when removal is refused", async () => {
    const dir = await makeProject("remove-image");
    const png = join(root, "photo.png");
    await writeFile(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wD/AH0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const { item } = await importContextFile(dir, png, "must-include", "Photo");
    const asset = resolve(dir, item.asset);
    const { pageId } = await writePage(dir, {
      index: 1,
      title: "Cover",
      html: `<img src="${item.asset}">`,
      css: "",
      assets: [item.id],
    });
    await updatePage(dir, pageId, { html: `<img src="${item.asset}" style="width:50%">` });

    await expect(removeContextItem(dir, item.id)).rejects.toThrow(/still used/i);

    const project = await openProject(dir);
    expect(project.context.map((entry) => entry.id)).toContain(item.id);
    expect(existsSync(asset)).toBe(true);
    expect(project.pageMeta[pageId]!.assets).toEqual([item.id]);
    expect(project.pageMeta[pageId]!.stale).toBeUndefined();

    const composed = await composePage(dir, pageId, effectiveSize(project.settings));
    expect(composed.missing).toEqual([]);
    expect(composed.html).toContain("data:image/png;base64");

    const restored = await restorePage(dir, pageId);
    expect(restored.project.pageMeta[pageId]!.assets).toEqual([item.id]);
    expect(existsSync(asset)).toBe(true);
  });

  it("refreshes a result in place, versions its file, and flags its consumers", async () => {
    const dir = await makeProject("refresh-result");
    const csv = await writeFixture("refresh.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");
    const table = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Spend",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      sources: [item.id],
    })) as { contextId: string };
    const originalAsset = resolve(dir, itemOf(await openProject(dir), table.contextId).asset);
    const { pageId } = await writePage(dir, {
      index: 1,
      title: "Numbers",
      html: "<h1>Numbers</h1>",
      css: "",
      assets: [table.contextId],
    });

    const replacement = await writeFixture("refresh-v2.csv", "Region,Amount\nNorth,1500\n");
    await replaceContextFile(dir, item.id, replacement);
    expect(itemOf(await openProject(dir), table.contextId).stale).toBe(true);
    expect((await openProject(dir)).pageMeta[pageId]!.stale).toBe(true);

    const rebuilt = (await createToolHarness(createTable, { cwd: dir }).run({
      resultId: table.contextId,
      name: "Spend",
      columns: ["Region", "Amount"],
      rows: [["North", "1500"]],
      sources: [item.id],
    })) as { contextId: string; asset: string };
    expect(rebuilt.contextId).toBe(table.contextId);
    expect(rebuilt.asset).toBe(`assets/${table.contextId}.v2.html`);

    const project = await openProject(dir);
    const updated = itemOf(project, table.contextId);
    expect(updated.revision).toBe(2);
    expect(updated.asset).toBe(`assets/${table.contextId}.v2.html`);
    expect(updated.stale).toBe(false);
    expect(existsSync(originalAsset)).toBe(true);
    expect(existsSync(resolve(dir, updated.asset))).toBe(true);
    expect(project.pageMeta[pageId]!.stale).toBe(true);

    const refreshed = await updatePage(dir, pageId, {
      html: "<h1>Numbers, refreshed</h1>",
      acknowledgeSources: { [table.contextId]: updated.revision },
    });
    expect(refreshed.project.pageMeta[pageId]!.stale).toBeUndefined();
  });

  it("keeps a refreshed result out of date while its own input is out of date", async () => {
    const dir = await makeProject("refresh-chain");
    const csv = await writeFixture("chain.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");
    const inner = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Inner",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      sources: [item.id],
    })) as { contextId: string };
    const outer = (await createToolHarness(saveSummary, { cwd: dir }).run({
      name: "Outer",
      markdown: "- North leads.",
      sources: [inner.contextId],
    })) as { contextId: string };

    await replaceContextFile(dir, item.id, await writeFixture("chain-v2.csv", "Region,Amount\nNorth,1500\n"));
    const stale = await openProject(dir);
    expect(itemOf(stale, inner.contextId).stale).toBe(true);
    expect(itemOf(stale, outer.contextId).stale).toBe(true);

    const rebuilt = (await createToolHarness(saveSummary, { cwd: dir }).run({
      resultId: outer.contextId,
      name: "Outer",
      markdown: "- Refreshed against the inner table.",
      sources: [inner.contextId],
    })) as { contextId: string };
    expect(rebuilt.contextId).toBe(outer.contextId);
    expect(itemOf(await openProject(dir), outer.contextId).stale).toBe(true);
    expect(itemOf(await openProject(dir), outer.contextId).revision).toBe(2);
  });

  it("refuses to change a result into a different file format", async () => {
    const dir = await makeProject("result-format");
    const csv = await writeFixture("format.csv", "Region,Amount\nNorth,1200\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");
    const summary = (await createToolHarness(saveSummary, { cwd: dir }).run({
      name: "Findings",
      markdown: "- North leads.",
      sources: [item.id],
    })) as { contextId: string };

    await expect(
      createToolHarness(createTable, { cwd: dir }).run({
        resultId: summary.contextId,
        name: "Spend",
        columns: ["Region"],
        rows: [["North"]],
        sources: [item.id],
      }),
    ).rejects.toThrow(/cannot be replaced/i);
    expect(itemOf(await openProject(dir), summary.contextId).revision).toBe(1);
  });

  it("saves tables, summaries, and charts with their sources", async () => {
    const dir = await makeProject("results");
    const csv = await writeFixture("results.csv", "Region,Amount\nNorth,1200\nSouth,950\n");
    const { item } = await importContextFile(dir, csv, "optional", "Sales");

    const tableHtml = (await createToolHarness(createTable, { cwd: dir }).run({
      name: "Spend <by> region",
      columns: ["Region", "Amount"],
      rows: [["North", "1200"]],
      caption: "Source: sales.csv",
      sources: [item.id],
    })) as { contextId: string; html: string };
    expect(tableHtml.html).toContain("<th>Region</th>");
    expect(tableHtml.html).toContain("<caption>Source: sales.csv</caption>");

    const summary = (await createToolHarness(saveSummary, { cwd: dir }).run({
      name: "Findings",
      markdown: "- North leads on spend.",
      sources: [item.id],
    })) as { contextId: string };

    const chart = (await createToolHarness(createChart, { cwd: dir }).run({
      name: "Spend",
      options: {
        xAxis: { type: "category", data: ["North", "South"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [1200, 950] }],
      },
      sources: [item.id],
    })) as { contextId: string };

    const project = await openProject(dir);
    for (const id of [tableHtml.contextId, summary.contextId, chart.contextId]) {
      expect(itemOf(project, id).derivedFrom).toEqual([item.id]);
    }
    expect(project.actions.filter((action) => action.kind === "derive").map((action) => action.outputs[0])).toEqual([
      tableHtml.contextId,
      summary.contextId,
      chart.contextId,
    ]);
    expect(itemOf(project, summary.contextId).status).toBe("ready");
    expect(existsSync(resolve(dir, `assets/${chart.contextId}.chart.json`))).toBe(true);

    const chartRefreshed = (await createToolHarness(createChart, { cwd: dir }).run({
      resultId: chart.contextId,
      name: "Spend",
      options: {
        xAxis: { type: "category", data: ["North", "South"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [1500, 700] }],
      },
      sources: [item.id],
    })) as { contextId: string; asset: string; source: string };
    expect(chartRefreshed.contextId).toBe(chart.contextId);
    expect(chartRefreshed.asset).toBe(`assets/${chart.contextId}.v2.svg`);
    expect(chartRefreshed.source).toBe(`assets/${chart.contextId}.v2.chart.json`);
    expect(existsSync(resolve(dir, `assets/${chart.contextId}.chart.json`))).toBe(true);
    expect(existsSync(resolve(dir, chartRefreshed.source))).toBe(true);
    expect(itemOf(await openProject(dir), chart.contextId).revision).toBe(2);

    const summaryRead = (await createToolHarness(readContext, { cwd: dir }).run({ id: summary.contextId })) as {
      pages?: Array<{ text: string }>;
    };
    expect(summaryRead.pages?.[0]?.text).toContain("North leads on spend");

    const tablePreview = await materialPreview(dir, itemOf(project, tableHtml.contextId));
    expect(tablePreview.kind).toBe("html");
    const summaryPreview = await materialPreview(dir, itemOf(project, summary.contextId));
    expect(summaryPreview).toMatchObject({ kind: "text" });
    const dataPreview = await materialPreview(dir, itemOf(project, item.id));
    expect(dataPreview).toMatchObject({ kind: "table", truncated: false });

    await expect(
      createToolHarness(createTable, { cwd: dir }).run({
        name: "Bad",
        columns: ["Region"],
        rows: [["North"]],
        sources: ["ctx_missing"],
      }),
    ).rejects.toThrow(/unknown material/i);
  });

  it("previews images, notes, and missing files", async () => {
    const dir = await makeProject("previews");
    const png = join(root, "pixel.png");
    await writeFile(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/wD/AH0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const { item: image } = await importContextFile(dir, png, "optional", "Pixel");
    const { item: note } = await importContextNote(dir, "board notes", "content-source", "Notes");
    const project = await openProject(dir);

    expect(await materialPreview(dir, itemOf(project, image.id))).toMatchObject({ kind: "image" });
    expect(await materialPreview(dir, itemOf(project, note.id))).toMatchObject({ kind: "text" });
    await rm(resolve(dir, image.asset));
    expect(await materialPreview(dir, itemOf(project, image.id))).toMatchObject({ kind: "empty" });
  });
});

describe("contained python execution", () => {
  it("preserves printed lines and caps oversized output before returning it", async (ctx) => {
    if (!pythonReady) ctx.skip();
    const lines = await runPython({
      code: "import sys\nprint('alpha')\nprint('beta')\nprint('café', end='')\nprint('err-one', file=sys.stderr)\nprint('err-two', file=sys.stderr)",
    });
    expect(lines.exitCode).toBe(0);
    expect(lines.stdout).toBe("alpha\nbeta\ncafé");
    expect(lines.stderr).toBe("err-one\nerr-two\n");

    const oversized = await runPython({
      code: "import sys\nprint('x' * 5_000_000)\nsys.stderr.write('y' * 5_000_000)",
      maxOutputBytes: 1024,
    });
    expect(oversized.exitCode).toBe(0);
    expect(oversized.stdout).toBe("x".repeat(1024));
    expect(oversized.stderr).toBe("y".repeat(1024));
    expect(oversized.outputTruncated).toBe(true);
  });

  it("runs a script against staged materials and saves what it writes", async (ctx) => {
    if (!pythonReady) ctx.skip();
    const dir = await makeProject("python-run");
    const csv = await writeFixture("run.csv", "Region,Amount\nNorth,1200\nSouth,950\n");
    const { item } = await importContextFile(dir, csv, "optional");

    const result = (await createToolHarness(runPythonTool, { cwd: dir }).run({
      code: [
        "import csv",
        "rows = list(csv.DictReader(open('inputs/run.csv')))",
        "total = sum(float(row['Amount']) for row in rows)",
        "print(f'rows={len(rows)} total={total}')",
        "open('outputs/total.txt', 'w').write(str(total))",
      ].join("\n"),
      materials: [item.id],
    })) as {
      exitCode: number;
      stdout: string;
      results: Array<{ contextId: string; name: string }>;
      inputs: Array<{ material: string; path: string }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rows=2 total=2150.0");
    expect(result.inputs).toEqual([{ material: "run.csv", path: "inputs/run.csv" }]);
    expect(result.results).toEqual([expect.objectContaining({ name: "total.txt" })]);

    const project = await openProject(dir);
    const produced = itemOf(project, result.results[0]!.contextId);
    expect(produced.derivedFrom).toEqual([item.id]);
    expect(produced.mime).toBe("text/plain");
    expect(await readFile(resolve(dir, produced.asset), "utf8")).toBe("2150.0");
    expect(project.actions.at(-1)).toMatchObject({ kind: "run", inputs: [item.id] });
    expect(project.actions.at(-1)!.code).toContain("csv.DictReader");
  });

  it("cannot read host files or reach the network and cannot start subprocesses", async (ctx) => {
    if (!pythonReady) ctx.skip();
    const secret = (await writeFixture("host-secret.txt", "HOST_SENTINEL_9f2c")).replaceAll("\\", "/");
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end("ok");
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()));
    const address = server.address();
    const endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
    try {
      const read = await runPython({ code: `print(open(${JSON.stringify(secret)}).read())` });
      expect(read.exitCode).not.toBe(0);
      expect(read.stdout).not.toContain("HOST_SENTINEL");

      const network = await runPython({
        code: `from pyodide.http import pyfetch\nawait pyfetch(${JSON.stringify(endpoint)})\nprint('reached')`,
      });
      expect(network.exitCode).not.toBe(0);
      expect(network.stdout).not.toContain("reached");

      const raw = await runPython({ code: `import js\nawait js.fetch(${JSON.stringify(endpoint)})` });
      expect(raw.exitCode).not.toBe(0);

      const nestedScript = [
        "(() => new Promise((resolve) => {",
        `  const url = ${JSON.stringify(endpoint)};`,
        "  const source = 'self.fetch(' + JSON.stringify(url) + ').then(() => self.postMessage(\"reached\"), () => self.postMessage(\"blocked\"))';",
        "  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));",
        "  worker.onmessage = (event) => resolve(event.data);",
        "  worker.onerror = () => resolve('blocked');",
        "  setTimeout(() => resolve('timeout'), 8000);",
        "}))()",
      ].join("\n");
      const nested = await runPython({
        code: `import js\nprint('nested', await js.eval(${JSON.stringify(nestedScript)}))`,
      });
      expect(nested.stdout).toContain("nested blocked");
      expect(nested.stdout).not.toContain("reached");

      const subprocess = await runPython({ code: "import subprocess\nsubprocess.run(['cmd'])" });
      expect(subprocess.exitCode).not.toBe(0);

      const native = await runPython({ code: "import ctypes\nctypes.CDLL('msvcrt')" });
      expect(native.exitCode).not.toBe(0);

      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()));
    }
  });

  it("stops a script that runs past the time limit", async (ctx) => {
    if (!pythonReady) ctx.skip();
    const result = await runPython({ code: "while True:\n    pass", timeoutMs: 1_500 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(20_000);
  });
});
