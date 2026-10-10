import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { readPage } from "../projects/pages.ts";
import { effectiveSize, type EffectiveSize } from "../projects/size.ts";
import type { ProjectFile } from "../projects/schema.ts";
import { collectAssetRefs, composePage } from "./compose.ts";

export type ValidationIssueKind =
  | "missing-asset"
  | "overflow"
  | "clipped-text"
  | "must-include";

export interface ValidationIssue {
  pageId?: string;
  pageIndex?: number;
  kind: ValidationIssueKind;
  message: string;
  detail?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  renderError?: string;
  pages: number;
  checkedAt: string;
}

export async function validateProject(dir: string, project: ProjectFile): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const size = effectiveSize(project.settings);
  const composed = new Map<string, string>();

  const covered = new Set<string>();
  for (const entry of project.outline ?? []) {
    for (const asset of entry.assetIds) covered.add(asset);
  }
  for (const id of project.pages) {
    for (const asset of project.pageMeta[id]?.assets ?? []) covered.add(asset);
  }
  for (const item of project.context) {
    if (item.role !== "must-include" || covered.has(item.id)) continue;
    issues.push({
      kind: "must-include",
      message: `"${item.name}" is marked Must Include but is not assigned to any slide`,
    });
  }

  for (const [index, pageId] of project.pages.entries()) {
    const source = await readPage(dir, pageId).catch(() => undefined);
    if (!source) {
      issues.push({ pageId, pageIndex: index, kind: "missing-asset", message: "Page files are missing" });
      continue;
    }
    for (const ref of collectAssetRefs(source.html, source.css)) {
      if (!(await fileExists(resolve(dir, ref)))) {
        issues.push({
          pageId,
          pageIndex: index,
          kind: "missing-asset",
          message: `Referenced asset "${ref}" was not found in the project`,
          detail: ref,
        });
      }
    }
    const page = await composePage(dir, pageId, size);
    composed.set(pageId, page.html);
  }

  const renderError = await checkLayout(project, size, composed, issues);
  return {
    issues,
    ...(renderError ? { renderError } : {}),
    pages: project.pages.length,
    checkedAt: new Date().toISOString(),
  };
}

export async function validateSinglePage(
  dir: string,
  project: ProjectFile,
  pageId: string,
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const size = effectiveSize(project.settings);
  const source = await readPage(dir, pageId).catch(() => undefined);
  const composed = new Map<string, string>();
  if (!source) {
    issues.push({ pageId, pageIndex: project.pages.indexOf(pageId), kind: "missing-asset", message: "Page files are missing" });
  } else {
    for (const ref of collectAssetRefs(source.html, source.css)) {
      if (!(await fileExists(resolve(dir, ref)))) {
        issues.push({
          pageId,
          pageIndex: project.pages.indexOf(pageId),
          kind: "missing-asset",
          message: `Referenced asset "${ref}" was not found in the project`,
          detail: ref,
        });
      }
    }
    const page = await composePage(dir, pageId, size);
    composed.set(pageId, page.html);
  }
  const renderError = await checkLayout(project, size, composed, issues);
  return {
    issues,
    ...(renderError ? { renderError } : {}),
    pages: 1,
    checkedAt: new Date().toISOString(),
  };
}

export function cssPixelSize(size: EffectiveSize): { width: number; height: number } {
  const factor = size.unit === "mm" ? 96 / 25.4 : size.unit === "in" ? 96 : 1;
  return {
    width: Math.round(size.width * factor),
    height: Math.round(size.height * factor),
  };
}

async function checkLayout(
  project: ProjectFile,
  size: EffectiveSize,
  composed: Map<string, string>,
  issues: ValidationIssue[],
): Promise<string | undefined> {
  if (composed.size === 0) return undefined;
  const viewport = cssPixelSize(size);
  let browser: Awaited<ReturnType<(typeof import("puppeteer"))["default"]["launch"]>>;
  try {
    const puppeteer = (await import("puppeteer")).default;
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.FORMA_CHROME_PATH ? { executablePath: process.env.FORMA_CHROME_PATH } : {}),
      args: ["--disable-gpu", "--no-first-run", "--hide-scrollbars"],
    });
  } catch (error) {
    return `Layout checks are unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    for (const [pageId, html] of composed) {
      const index = project.pages.indexOf(pageId);
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) =>
            image.complete
              ? undefined
              : new Promise<void>((resolveImage) => {
                  image.addEventListener("load", () => resolveImage(), { once: true });
                  image.addEventListener("error", () => resolveImage(), { once: true });
                }),
          ),
        );
      });
      const metrics = await page.evaluate(() => {
        const root =
          document.querySelector<HTMLElement>(".forma-page") ?? document.documentElement;
        const rect = root.getBoundingClientRect();
        const clipped: Array<{ selector: string; heightOver: number; widthOver: number }> = [];
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          const style = getComputedStyle(element);
          if (style.overflowY !== "hidden" && style.overflowX !== "hidden") continue;
          if (!element.textContent?.trim()) continue;
          const heightOver = element.scrollHeight - element.clientHeight;
          const widthOver = element.scrollWidth - element.clientWidth;
          if (heightOver > 2 || widthOver > 2) {
            const name = (element.className || "")
              .toString()
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .join(".");
            clipped.push({
              selector: name ? `${element.tagName.toLowerCase()}.${name}` : element.tagName.toLowerCase(),
              heightOver,
              widthOver,
            });
            if (clipped.length >= 5) break;
          }
        }
        return {
          overflowX: root.scrollWidth - root.clientWidth,
          overflowY: root.scrollHeight - root.clientHeight,
          viewportWidth: Math.round(rect.width),
          viewportHeight: Math.round(rect.height),
          clipped,
        };
      });
      if (metrics.overflowX > 2 || metrics.overflowY > 2) {
        issues.push({
          pageId,
          pageIndex: index,
          kind: "overflow",
          message: "Artwork extends beyond the page boundary",
          detail: `${metrics.overflowX}px horizontal, ${metrics.overflowY}px vertical`,
        });
      }
      for (const clipped of metrics.clipped) {
        issues.push({
          pageId,
          pageIndex: index,
          kind: "clipped-text",
          message: `Text may be clipped inside ${clipped.selector}`,
          detail: `${clipped.heightOver}px vertical, ${clipped.widthOver}px horizontal overflow`,
        });
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}
