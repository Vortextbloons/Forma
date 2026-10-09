




export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = safeParse(value);
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}


export function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}


export function prettyJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    const parsed = safeParse(value);
    if (parsed !== undefined && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`;
}

export function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface DiffLine {
  type: "header" | "hunk" | "add" | "remove" | "context";
  text: string;
}


export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("diff --git") || raw.startsWith("+++") || raw.startsWith("---")) {
      lines.push({ type: "header", text: raw });
    } else if (raw.startsWith("@@")) {
      lines.push({ type: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      lines.push({ type: "add", text: raw });
    } else if (raw.startsWith("-")) {
      lines.push({ type: "remove", text: raw });
    } else {
      lines.push({ type: "context", text: raw });
    }
  }
  return lines;
}
