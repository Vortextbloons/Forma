import type { Browser, Page } from "puppeteer";

let browserPromise: Promise<Browser> | undefined;
let browserKey: string | undefined;

function chromeKey(): string {
  return process.env.FORMA_CHROME_PATH ?? "";
}

export function launchBrowser(): Promise<Browser> {
  const key = chromeKey();
  if (browserPromise && browserKey !== key) {
    const stale = browserPromise;
    browserPromise = undefined;
    browserKey = undefined;
    void stale.then((browser) => browser.close()).catch(() => undefined);
  }
  if (!browserPromise) {
    browserKey = key;
    browserPromise = (async () => {
      const puppeteer = (await import("puppeteer")).default;
      const browser = await puppeteer.launch({
        headless: true,
        ...(key ? { executablePath: key } : {}),
        args: ["--disable-gpu", "--no-first-run", "--hide-scrollbars"],
      });
      browser.on("disconnected", () => {
        if (browserKey === key) {
          browserPromise = undefined;
          browserKey = undefined;
        }
      });
      return browser;
    })().catch((error: unknown) => {
      browserPromise = undefined;
      browserKey = undefined;
      throw error;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  browserKey = undefined;
  if (!pending) return;
  const browser = await pending.catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

export async function renderPage(
  page: Page,
  html: string,
  viewport: { width: number; height: number },
  deviceScaleFactor = 1,
): Promise<void> {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor });
  await page.setContent(html, { waitUntil: "load" });
  await waitForAssets(page);
}

export async function waitForAssets(page: Page): Promise<void> {
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
}
