import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RuntimeError } from "rig";
import { loadExtraction } from "../extraction/index.ts";
import { effectiveSize, type EffectiveSize } from "../projects/size.ts";
import type { ProjectFile } from "../projects/schema.ts";
import type { Page } from "puppeteer";
import { launchBrowser, waitForAssets } from "./browser.ts";
import { composePage, type ComposedPage } from "./compose.ts";

export type ValidationIssueKind =
  | "missing-asset"
  | "overflow"
  | "clipped-text"
  | "incomplete"
  | "must-include";

export interface ValidationIssue {
  pageId?: string;
  pageIndex?: number;
  contextId?: string;
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

export async function validateProject(dir: string, project: ProjectFile, expectedPageIds?: string[], expectedCount?: number): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const size = effectiveSize(project.settings);
  const composed = new Map<string, string>();

  if (expectedCount !== undefined && project.pages.length !== expectedCount) {
    issues.push({ kind: "incomplete", message: `Expected ${expectedCount} pages, found ${project.pages.length}.` });
  }
  if (expectedPageIds && (project.pages.length !== expectedPageIds.length || project.pages.some((id, index) => id !== expectedPageIds[index]))) {
    issues.push({ kind: "incomplete", message: "The artwork must match the expected page ids and order.", detail: JSON.stringify({ expectedPageIds, actualPageIds: project.pages }) });
  }

  for (const [index, pageId] of project.pages.entries()) {
    const html = await composeForValidation(dir, pageId, index, size, issues);
    if (html !== undefined) composed.set(pageId, html);
  }

  const rendered = new Map<string, RenderedPage>();
  const renderError = await checkLayout(project, size, composed, issues, rendered);
  for (const item of project.context) {
    if (item.role !== "must-include") continue;
    let included = false;
    if (item.mime.startsWith("image/")) {
      const data = await readFile(resolve(dir, item.asset)).catch(() => undefined);
      const encoded = data?.toString("base64");
      included = !!encoded && [...rendered.values()].some((page) => page.assetUrls.some((url) => url.includes(encoded)));
    } else {
      const extraction = await loadExtraction(dir, item.id);
      const sourceText = normalizeText(extraction?.pages.map((page) => page.text).join(" ") ?? "");
      included = [...rendered.entries()].some(([pageId, page]) => {
        const evidence = normalizeText(project.pageMeta[pageId]?.evidence?.[item.id] ?? "");
        return !!evidence && sourceText.includes(evidence) && normalizeText(page.text).includes(evidence);
      });
    }
    if (!included) issues.push({
      kind: "must-include",
      contextId: item.id,
      message: item.mime.startsWith("image/")
        ? `"${item.name}" is marked Must Include but is not visible in the artwork.`
        : `"${item.name}" is marked Must Include but has no source excerpt visible in the artwork. Supply evidence with its context id and the exact excerpt shown.`,
    });
  }
  return {
    issues,
    ...(renderError ? { renderError } : {}),
    pages: project.pages.length,
    checkedAt: new Date().toISOString(),
  };
}

interface RenderedPage {
  text: string;
  assetUrls: string[];
  screenshot?: Uint8Array;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function renderArtworkPreview(dir: string, project: ProjectFile, pageId?: string): Promise<{ data: Buffer; issues: ValidationIssue[] }> {
  const size = effectiveSize(project.settings);
  const ids = pageId ? [pageId] : project.pages;
  const composed = new Map<string, string>();
  for (const id of ids) composed.set(id, (await composePage(dir, id, size)).html);
  const issues: ValidationIssue[] = [];
  const rendered = new Map<string, RenderedPage>();
  const error = await checkLayout(project, size, composed, issues, rendered, true);
  if (error) throw new RuntimeError(error);
  if (pageId) return { data: Buffer.from(rendered.get(pageId)!.screenshot!), issues };
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const viewport = cssPixelSize(size);
  const columns = Math.min(3, ids.length);
  const width = 480;
  const height = Math.round(width * viewport.height / viewport.width);
  const canvas = createCanvas(columns * width, Math.ceil(ids.length / columns) * (height + 30));
  const context = canvas.getContext("2d");
  context.fillStyle = "#eeeeee";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '16px "Segoe UI", sans-serif';
  for (const [index, id] of ids.entries()) {
    const x = (index % columns) * width;
    const y = Math.floor(index / columns) * (height + 30);
    context.drawImage(await loadImage(Buffer.from(rendered.get(id)!.screenshot!)), x, y, width, height);
    context.fillStyle = "#222222";
    context.fillText(`${index + 1}: ${id}`, x + 8, y + height + 21);
  }
  return { data: await canvas.encode("png"), issues };
}

export async function validateSinglePage(
  dir: string,
  project: ProjectFile,
  pageId: string,
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const size = effectiveSize(project.settings);
  const composed = new Map<string, string>();
  const html = await composeForValidation(dir, pageId, project.pages.indexOf(pageId), size, issues);
  if (html !== undefined) composed.set(pageId, html);
  const renderError = await checkLayout(project, size, composed, issues);
  return {
    issues,
    ...(renderError ? { renderError } : {}),
    pages: 1,
    checkedAt: new Date().toISOString(),
  };
}

async function composeForValidation(
  dir: string,
  pageId: string,
  pageIndex: number,
  size: EffectiveSize,
  issues: ValidationIssue[],
): Promise<string | undefined> {
  let page: ComposedPage;
  try {
    page = await composePage(dir, pageId, size);
  } catch {
    issues.push({ pageId, pageIndex, kind: "missing-asset", message: "Page files are missing" });
    return undefined;
  }
  for (const ref of page.missing) {
    issues.push({
      pageId,
      pageIndex,
      kind: "missing-asset",
      message: `Referenced asset "${ref}" was not found in the project`,
      detail: ref,
    });
  }
  return page.html;
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
  rendered?: Map<string, RenderedPage>,
  capture = false,
): Promise<string | undefined> {
  if (composed.size === 0) return undefined;
  const viewport = cssPixelSize(size);
  let page: Page | undefined;
  try {
    let browser: Awaited<ReturnType<typeof launchBrowser>>;
    try {
      browser = await launchBrowser();
    } catch (error) {
      return `Layout checks are unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
    page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    for (const [pageId, html] of composed) {
      const index = project.pages.indexOf(pageId);
      await page.setContent(html, { waitUntil: "load" });
      await waitForAssets(page);
      const metrics = await page.evaluate(() => {
        const root =
          document.querySelector<HTMLElement>(".forma-page") ?? document.documentElement;
        const rect = root.getBoundingClientRect();
        function visible(element: Element, bounds = element.getBoundingClientRect()): boolean {
          if (bounds.width <= 0 || bounds.height <= 0 || bounds.right <= rect.left || bounds.left >= rect.right || bounds.bottom <= rect.top || bounds.top >= rect.bottom) return false;
          for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
            if (style.overflowX === "hidden" || style.overflowY === "hidden" || style.overflow === "clip") {
              const clip = parent.getBoundingClientRect();
              if (bounds.right <= clip.left || bounds.left >= clip.right || bounds.bottom <= clip.top || bounds.top >= clip.bottom) return false;
            }
          }
          return true;
        }
        const visibleText: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (node.parentElement && visible(node.parentElement, range.getBoundingClientRect())) visibleText.push(node.textContent ?? "");
        }
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
          text: visibleText.join(" "),
          assetUrls: [root, ...root.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
            const style = getComputedStyle(element);
            if (!visible(element)) return [];
            return [element instanceof HTMLImageElement && element.naturalWidth > 0 ? element.currentSrc : "", style.backgroundImage, element instanceof SVGImageElement ? element.href.baseVal : ""].filter(Boolean);
          }),
          overflowX: root.scrollWidth - root.clientWidth,
          overflowY: root.scrollHeight - root.clientHeight,
          viewportWidth: Math.round(rect.width),
          viewportHeight: Math.round(rect.height),
          clipped,
        };
      });
      rendered?.set(pageId, {
        text: metrics.text,
        assetUrls: metrics.assetUrls,
        ...(capture ? { screenshot: await page.screenshot({ type: "png" }) } : {}),
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
  } catch (error) {
    return `Layout checks failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await page?.close().catch(() => undefined);
  }
  return undefined;
}
