import type { Page } from "puppeteer";
import type PptxGenJS from "pptxgenjs";

export async function addEditableArtwork(page: Page, slide: PptxGenJS.Slide, viewport: { width: number; height: number }): Promise<void> {
  const elements = await page.evaluate(() => {
    const result: Array<{
      kind: "shape" | "text" | "image";
      index: number;
      x: number; y: number; w: number; h: number;
      fill?: { color: string; transparency: number };
      line?: { color: string; width: number; transparency: number };
      shape?: "rect" | "roundRect" | "ellipse";
      radius?: number;
      text?: string;
      fontFace?: string; fontSize?: number; bold?: boolean; italic?: boolean;
      color?: string; align?: "left" | "center" | "right" | "justify";
      lineSpacing?: number;
      surface?: boolean;
    }> = [];
    function color(value: string) {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3 || !value.startsWith("rgb")) return null;
      return { color: channels.slice(0, 3).map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join(""), transparency: (1 - (channels[3] ?? 1)) * 100 };
    }
    const all = [...document.querySelectorAll<HTMLElement>(".forma-page, .forma-page *")];
    const indices = new Map<HTMLElement, number>();
    all.forEach((element, index) => {
      element.setAttribute("data-forma-export", String(index));
      indices.set(element, index);
    });
    function visit(element: HTMLElement): void {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || !rect.width || !rect.height) return;
      const index = indices.get(element)!;
      const box = { index, x: rect.x / 96, y: rect.y / 96, w: rect.width / 96, h: rect.height / 96 };
      const children = [...element.children] as HTMLElement[];
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const simpleText = children.every((child) => child.tagName === "BR");
      const borders = ["Top", "Right", "Bottom", "Left"].map((side) => ({
        width: style.getPropertyValue(`border-${side.toLowerCase()}-width`),
        color: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
        style: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
      }));
      const border = borders[0]!;
      const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
      const textColor = color(style.color);
      const pseudo = ["::before", "::after"].some((selector) => {
        const content = getComputedStyle(element, selector).content;
        return content !== "none" && content !== "normal";
      });
      const unsupported = !(element instanceof HTMLElement) || ["IMG", "SVG", "CANVAS", "VIDEO", "TABLE", "UL", "OL"].includes(element.tagName.toUpperCase()) ||
        style.transform !== "none" || style.rotate !== "none" || style.scale !== "none" || Number(style.opacity) !== 1 ||
        style.filter !== "none" || style.clipPath !== "none" || style.mixBlendMode !== "normal" || pseudo ||
        (hasText && (!simpleText || style.textShadow !== "none" || style.writingMode !== "horizontal-tb" || style.textDecorationLine !== "none" || textColor?.transparency !== 0));
      if (unsupported) {
        result.push({ kind: "image", ...box });
        return;
      }
      const fill = color(style.backgroundColor);
      const stroke = color(border.color);
      const radius = parseFloat(radii[0]!);
      const surface = style.backgroundImage !== "none" || style.boxShadow !== "none" || radii.some((radius) => radius !== radii[0]) ||
        borders.some((side) => JSON.stringify(side) !== JSON.stringify(border)) || (parseFloat(border.width) > 0 && border.style !== "solid");
      if (surface) {
        result.push({ kind: "image", ...box, surface: true });
      } else if ((fill && fill.transparency < 100) || parseFloat(border.width) > 0) {
        result.push({ kind: "shape", ...box,
          shape: radii[0]!.includes("%") && radius >= 50 ? "ellipse" : radius > 0 ? "roundRect" : "rect",
          radius: Math.min(radius / 96, 1),
          ...(fill ? { fill } : {}),
          ...(stroke && parseFloat(border.width) > 0 ? { line: { ...stroke, width: parseFloat(border.width) * 0.75 } } : {}),
        });
      }
      if (hasText && simpleText) {
        const left = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
        const right = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
        const top = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
        const bottom = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
        result.push({ kind: "text", ...box,
          x: box.x + left / 96, y: box.y + top / 96, w: box.w - (left + right) / 96, h: box.h - (top + bottom) / 96,
          text: element.innerText, fontFace: style.fontFamily.split(",")[0]!.replace(/["']/g, "").trim(),
          fontSize: parseFloat(style.fontSize) * 0.75, bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === "italic",
          color: textColor!.color, align: ["center", "right", "justify"].includes(style.textAlign) ? style.textAlign as "center" | "right" | "justify" : "left",
          ...(style.lineHeight !== "normal" ? { lineSpacing: parseFloat(style.lineHeight) * 0.75 } : {}),
        });
      } else {
        children.sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0)).forEach(visit);
      }
    }
    visit(document.querySelector<HTMLElement>(".forma-page")!);
    return result;
  });
  for (const element of elements) {
    const { x, y, w, h } = element;
    if (element.kind === "shape") {
      slide.addShape(element.shape!, { x, y, w, h, rectRadius: element.radius,
        fill: element.fill ?? { color: "FFFFFF", transparency: 100 },
        line: element.line ?? { color: "FFFFFF", transparency: 100 },
      });
    } else if (element.kind === "text") {
      slide.addText(element.text!, { x, y, w, h, fontFace: element.fontFace, fontSize: element.fontSize,
        color: element.color, bold: element.bold, italic: element.italic, align: element.align,
        lineSpacing: element.lineSpacing, margin: 0, paraSpaceAfter: 0, valign: "top",
      });
    } else {
      const target = `.forma-page[data-forma-export="${element.index}"],.forma-page [data-forma-export="${element.index}"]`;
      const visible = element.surface ? target : `${target},.forma-page[data-forma-export="${element.index}"] *,.forma-page [data-forma-export="${element.index}"] *`;
      const handle = await page.addStyleTag({ content: `html,body{background:transparent!important}.forma-page,.forma-page *{visibility:hidden!important}${visible}{visibility:visible!important}${element.surface ? `${target}{color:transparent!important;text-shadow:none!important}` : ""}` });
      try {
        const shot = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, ...viewport } });
        slide.addImage({ data: `image/png;base64,${Buffer.from(shot).toString("base64")}`, x: 0, y: 0, w: viewport.width / 96, h: viewport.height / 96 });
      } finally {
        await handle.evaluate((style) => style.remove());
        await handle.dispose();
      }
    }
  }
}
