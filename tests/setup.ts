import { afterAll } from "vitest";
import { closeOcrWorker } from "../src/extraction/ocr.ts";
import { closeBrowser } from "../src/rendering/browser.ts";

afterAll(async () => {
  await closeBrowser();
  await closeOcrWorker();
});
