import { readFile } from "node:fs/promises";
import { RuntimeError } from "rig";
import type { DataColumn, DataProfile, DataSheet, DataValueType } from "../projects/schema.ts";

export const DATA_EXTENSIONS = [".csv", ".tsv", ".json", ".xlsx"] as const;

export const DATA_MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function dataFormatForExtension(extension: string): DataProfile["format"] | null {
  const format = extension.toLowerCase().replace(/^\./, "");
  if (format === "csv" || format === "tsv" || format === "json" || format === "xlsx") return format;
  return null;
}

export function dataFormatForMime(mime: string): DataProfile["format"] | null {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  for (const [extension, knownMime] of Object.entries(DATA_MIME_BY_EXTENSION)) {
    if (knownMime === normalized) return dataFormatForExtension(extension);
  }
  return null;
}

const MAX_SCAN_ROWS = 200_000;
const MAX_PREVIEW_ROWS = 5;
const MAX_PREVIEW_COLUMNS = 12;
const MAX_COLUMNS = 40;
const MAX_CELL_CHARS = 80;
const MAX_READ_BYTES = 8 * 1024 * 1024;

export async function profileDataFile(path: string, format: DataProfile["format"]): Promise<DataProfile> {
  return profileDataBytes(await readFile(path), format);
}

export async function profileDataBytes(buffer: Buffer, format: DataProfile["format"]): Promise<DataProfile> {
  if (format === "xlsx") {
    const profile = await profileWorkbook(buffer);
    return { format, sheets: profile.sheets, truncated: profile.truncated };
  }
  if (format === "json") {
    const profile = profileJson(buffer.toString("utf8"));
    return { format, sheets: profile.sheets, truncated: profile.truncated };
  }
  const truncatedRead = buffer.byteLength > MAX_READ_BYTES;
  const bytes = truncatedRead ? buffer.subarray(0, MAX_READ_BYTES) : buffer;
  const profile = profileDelimited(bytes.toString("utf8"), format === "tsv" ? "\t" : ",");
  return { format, sheets: profile.sheets, truncated: profile.truncated || truncatedRead };
}

function profileDelimited(text: string, delimiter: string): { sheets: DataSheet[]; truncated: boolean } {
  const rows = parseRows(text, delimiter);
  if (rows.length === 0) {
    return { sheets: [{ name: "data", rows: 0, columns: [], preview: [] }], truncated: false };
  }
  const [header = [], ...body] = rows;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Array.from({ length: Math.min(columnCount, MAX_COLUMNS) }, (_, index) => ({
    name: cleanCell(header[index]) || `Column ${index + 1}`,
    values: body.slice(0, 2000).map((row) => cleanCell(row[index])),
  }));
  return {
    sheets: [
      {
        name: "data",
        rows: body.length,
        columns: columns.map((column) => ({ name: column.name, type: inferType(column.values) })),
        preview: previewRows(body, 0, columnCount),
      },
    ],
    truncated: rows.length > MAX_SCAN_ROWS,
  };
}

export function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    if (rows.length > MAX_SCAN_ROWS) break;
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      if (row.some((entry) => entry.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.some((entry) => entry.trim() !== "")) rows.push(row);
  }
  return rows;
}

function profileJson(text: string): { sheets: DataSheet[]; truncated: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RuntimeError(`This JSON file could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sheets = sheetsForJson(parsed);
  return { sheets, truncated: false };
}

function sheetsForJson(value: unknown): DataSheet[] {
  if (Array.isArray(value)) return [sheetForArray(value, "data")];
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const nested = entries.filter(([, entry]) => Array.isArray(entry));
    if (nested.length > 0 && nested.length === entries.length) {
      return nested.slice(0, 10).map(([name, entry]) => sheetForArray(entry as unknown[], name));
    }
    const rows = entries.map(([key, entry]) => [key, cellText(entry)]);
    return [
      {
        name: "data",
        rows: entries.length,
        columns: [
          { name: "field", type: "text" },
          { name: "value", type: "unknown" },
        ],
        preview: previewRows(rows, 0, 2),
      },
    ];
  }
  return [
    {
      name: "data",
      rows: 0,
      columns: [{ name: "value", type: "unknown" }],
      preview: [[cellText(value)]],
    },
  ];
}

function sheetForArray(entries: unknown[], name: string): DataSheet {
  const objects = entries.filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry));
  if (objects.length === entries.length && entries.length > 0) {
    const keys: string[] = [];
    for (const entry of entries.slice(0, 500)) {
      for (const key of Object.keys(entry as Record<string, unknown>)) {
        if (!keys.includes(key) && keys.length < MAX_COLUMNS) keys.push(key);
      }
    }
    const rows = entries.map((entry) => keys.map((key) => cellText((entry as Record<string, unknown>)[key])));
    const columns: DataColumn[] = keys.map((key, index) => ({
      name: key,
      type: inferType(rows.slice(0, 2000).map((row) => row[index] ?? "")),
    }));
    return { name, rows: entries.length, columns, preview: previewRows(rows, 0, keys.length) };
  }
  const rows = entries.map((entry) => [cellText(entry)]);
  return {
    name,
    rows: entries.length,
    columns: [{ name: "value", type: inferType(rows.map((row) => row[0] ?? "")) }],
    preview: previewRows(rows, 0, 1),
  };
}

interface ZipArchive {
  file(path: string): { async(type: "string"): Promise<string> } | null;
  files: Record<string, unknown>;
}

interface SheetRef {
  name: string;
  path: string;
}

async function profileWorkbook(buffer: Buffer): Promise<{ sheets: DataSheet[]; truncated: boolean }> {
  const { default: JSZip } = await import("jszip");
  const archive = (await JSZip.loadAsync(buffer).catch((error: unknown) => {
    throw new RuntimeError(`This Excel file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  })) as unknown as ZipArchive;
  const shared = await sharedStrings(archive);
  const styles = await cellStyles(archive);
  const refs = await workbookSheets(archive);
  const fallback = Object.keys(archive.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));
  const names = await sheetNames(archive);
  const sheetFiles =
    refs.length > 0
      ? refs
      : fallback.map((path, index) => ({ name: names[index] ?? `Sheet ${index + 1}`, path }));
  if (sheetFiles.length === 0) throw new RuntimeError("This Excel file has no worksheets.");
  const sheets: DataSheet[] = [];
  for (const [index, sheet] of sheetFiles.slice(0, 10).entries()) {
    const xml = await archive.file(sheet.path)?.async("string");
    if (xml === undefined) continue;
    sheets.push(profileSheet(xml, shared, styles, sheet.name || `Sheet ${index + 1}`));
  }
  return { sheets, truncated: sheetFiles.length > 10 };
}

function sheetNumber(path: string): number {
  return Number(/sheet(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

async function sharedStrings(archive: ZipArchive): Promise<string[]> {
  const file = archive.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("string");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1]!)).join(""),
  );
}

async function sheetNames(archive: ZipArchive): Promise<string[]> {
  const file = archive.file("xl/workbook.xml");
  if (!file) return [];
  const xml = await file.async("string");
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1]!));
}

async function workbookSheets(archive: ZipArchive): Promise<SheetRef[]> {
  const file = archive.file("xl/workbook.xml");
  if (!file) return [];
  const xml = await file.async("string");
  const rels = new Map<string, string>();
  const relsFile = archive.file("xl/_rels/workbook.xml.rels");
  if (relsFile) {
    const relsXml = await relsFile.async("string");
    for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = match[0];
      const id = /\bId="([^"]*)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
      if (id && target) rels.set(id, target);
    }
  }
  const sheets: SheetRef[] = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = match[0];
    const name = decodeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? "");
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    const target = id ? rels.get(id) : undefined;
    if (target) sheets.push({ name, path: worksheetPath(target) });
  }
  return sheets;
}

function worksheetPath(target: string): string {
  const clean = target.replace(/^\/?(?:xl\/)?/, "");
  return `xl/${clean}`;
}

type DateStyle = "date" | "time" | "datetime" | null;

const BUILTIN_DATE_STYLES = new Map<number, DateStyle>([
  [14, "date"], [15, "date"], [16, "date"], [17, "date"],
  [18, "time"], [19, "time"], [20, "time"], [21, "time"], [22, "datetime"],
  [27, "date"], [28, "date"], [29, "date"], [30, "date"], [31, "date"],
  [32, "date"], [33, "date"], [34, "date"], [35, "date"], [36, "date"],
  [45, "time"], [46, "time"], [47, "time"],
  [50, "date"], [51, "date"], [52, "date"], [53, "date"], [54, "date"],
  [55, "date"], [56, "date"], [57, "date"], [58, "date"],
]);

async function cellStyles(archive: ZipArchive): Promise<DateStyle[]> {
  const file = archive.file("xl/styles.xml");
  if (!file) return [];
  const xml = await file.async("string");
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const tag = match[0];
    const id = Number(/\bnumFmtId="(\d+)"/.exec(tag)?.[1]);
    const code = /\bformatCode="([^"]*)"/.exec(tag)?.[1];
    if (Number.isFinite(id) && code !== undefined) custom.set(id, decodeXml(code));
  }
  const section = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...section.matchAll(/<xf\b[^>]*\/?>/g)].map((match) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(match[0])?.[1] ?? "0");
    const code = custom.get(id);
    if (code !== undefined) {
      const cleaned = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\./g, "");
      const hasDate = /[ymd]/i.test(cleaned);
      const hasTime = /[hs]/i.test(cleaned);
      if (hasDate && hasTime) return "datetime";
      if (hasTime) return "time";
      if (hasDate) return "date";
      return null;
    }
    return BUILTIN_DATE_STYLES.get(id) ?? null;
  });
}

function excelSerialToText(serial: number, kind: DateStyle): string {
  const time = (serial - 25569) * 86_400_000;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  if (kind === "date") return iso.slice(0, 10);
  if (kind === "time") return iso.slice(11, 19);
  return `${iso.slice(0, 10)}T${iso.slice(11, 19)}`;
}

function profileSheet(xml: string, shared: string[], styles: DateStyle[], name: string): DataSheet {
  const grid: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (grid.length > MAX_SCAN_ROWS) break;
    const row: string[] = [];
    for (const cellMatch of rowMatch[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const columnIndex = reference ? columnLetters(reference) : row.length;
      row[columnIndex] = cellValue(attributes, body, shared, styles);
    }
    grid.push(row.map((entry) => entry ?? ""));
  }
  const [header, ...body] = grid;
  if (!header || header.length === 0) return { name, rows: body.length, columns: [], preview: [] };
  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const columns: DataColumn[] = Array.from({ length: Math.min(columnCount, MAX_COLUMNS) }, (_, index) => ({
    name: cleanCell(header[index]) || `Column ${index + 1}`,
    type: inferType(body.slice(0, 2000).map((row) => cleanCell(row[index]))),
  }));
  return { name, rows: body.length, columns, preview: previewRows(body, 0, columnCount) };
}

function cellValue(attributes: string, body: string, shared: string[], styles: DateStyle[]): string {
  const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
  if (type === "inlineStr") {
    return [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]!)).join("");
  }
  const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (raw === undefined) return "";
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "true" : "false";
  if (type === undefined) {
    const style = styles[Number(/\bs="(\d+)"/.exec(attributes)?.[1] ?? "-1")];
    if (style) {
      const value = Number(raw);
      if (Number.isFinite(value)) return excelSerialToText(value, style);
    }
  }
  return decodeXml(raw);
}

function columnLetters(reference: string): number {
  let index = 0;
  for (const char of reference) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function previewRows(rows: string[][], offset: number, columnCount: number): string[][] {
  const width = Math.min(columnCount, MAX_PREVIEW_COLUMNS);
  return rows.slice(offset, offset + MAX_PREVIEW_ROWS).map((row) =>
    Array.from({ length: width }, (_, index) => truncate(cleanCell(row[index]))),
  );
}

function cleanCell(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS - 1)}…` : value;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$|^\d{1,2}\/\d{1,2}\/\d{4}$/;

function inferType(values: string[]): DataValueType {
  const present = values.map((value) => value.trim()).filter((value) => value !== "");
  if (present.length === 0) return "unknown";
  if (present.every((value) => Number.isFinite(Number(value)) && value !== "")) return "number";
  if (present.every((value) => value === "true" || value === "false")) return "boolean";
  if (present.every((value) => DATE_PATTERN.test(value))) return "date";
  return "text";
}
