import type { Browser, Page } from "puppeteer";

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    ...(process.env.FORMA_CHROME_PATH ? { executablePath: process.env.FORMA_CHROME_PATH } : {}),
    args: ["--disable-gpu", "--no-first-run", "--hide-scrollbars"],
  });
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
