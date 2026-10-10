export interface ExtractedPage {
  page: number;
  text: string;
  source: "text" | "ocr";
}

export interface ExtractionResult {
  kind: "text" | "ocr" | "mixed";
  pages: ExtractedPage[];
}

export function extractionKind(pages: ExtractedPage[]): ExtractionResult["kind"] {
  const hasText = pages.some((page) => page.source === "text");
  const hasOcr = pages.some((page) => page.source === "ocr");
  if (hasText && hasOcr) return "mixed";
  return hasOcr ? "ocr" : "text";
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
