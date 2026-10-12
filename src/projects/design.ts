import { z } from "zod";
import type { EffectiveSize } from "./size.ts";

export const DESIGN_FONTS = ["Segoe UI", "Bahnschrift", "Georgia", "Trebuchet MS", "Arial", "Times New Roman", "Impact", "Cambria", "Candara", "Consolas", "Courier New", "Verdana", "Palatino Linotype", "Franklin Gothic Medium", "Garamond"] as const;

export const designFontSchema = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N} _-]+$/u, "Use a local font family name");
export const designColorNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, "Use a lowercase name with letters, numbers, or hyphens");

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color");

export const designProfileSchema = z.object({
  colors: z.object({
    background: color.default("#ffffff"),
    surface: color.default("#f1f5f9"),
    text: color.default("#172033"),
    muted: color.default("#64748b"),
    accent: color.default("#2563eb"),
  }).catchall(color).refine((colors) => Object.keys(colors).every((name) => designColorNameSchema.safeParse(name).success), "Use lowercase color names with letters, numbers, or hyphens").default({}).describe("Core palette plus any additional named colors needed by the design. Additional colors become --forma-color-NAME variables."),
  fonts: z.object({
    heading: designFontSchema.default("Segoe UI"),
    body: designFontSchema.default("Segoe UI"),
    utility: designFontSchema.optional().describe("Optional third font for captions, labels, or data"),
  }).default({}),
  headingSize: z.number().min(16).max(600).default(72),
  bodySize: z.number().min(12).max(240).default(32),
  smallSize: z.number().min(8).max(120).default(24),
  spacing: z.number().min(4).max(320).default(32),
  radius: z.number().min(0).max(320).default(12),
  direction: z.string().trim().default(""),
});

export type DesignProfile = z.infer<typeof designProfileSchema>;

export function defaultDesignProfile(): DesignProfile {
  return designProfileSchema.parse({});
}

export const BUILT_IN_THEMES = [
  { id: "builtin-studio", name: "Studio", style: "balance", density: "balanced", designProfile: designProfileSchema.parse({ colors: { background: "#ffffff", surface: "#eef2f6", text: "#182435", muted: "#5e6d80", accent: "#2459c4" }, direction: "Clear hierarchy, generous whitespace, and restrained blue accents." }) },
  { id: "builtin-ink", name: "Ink", style: "editorial", density: "balanced", designProfile: designProfileSchema.parse({ colors: { background: "#faf9f6", surface: "#eeede8", text: "#202020", muted: "#66645f", accent: "#92344a" }, fonts: { heading: "Georgia", body: "Segoe UI" }, radius: 0, direction: "Editorial typography, crisp rules, and deliberate alignment." }) },
  { id: "builtin-signal", name: "Signal", style: "bold", density: "concise", designProfile: designProfileSchema.parse({ colors: { background: "#12243a", surface: "#203952", text: "#f4f8fc", muted: "#b0c1d3", accent: "#ffbd59" }, fonts: { heading: "Bahnschrift", body: "Segoe UI" }, headingSize: 88, radius: 8, direction: "Large confident headlines, dark blue surfaces, and warm amber emphasis." }) },
] as const;

export function designStyles(profile: DesignProfile, size: EffectiveSize): string {
  const length = (value: number) => `${value * size.width / 1920}${size.unit}`;
  const fontStack = (font: string) => `"${font}", ${["Georgia", "Times New Roman", "Cambria", "Palatino Linotype", "Garamond"].includes(font) ? "serif" : ["Consolas", "Courier New"].includes(font) ? "monospace" : "sans-serif"}`;
  const additionalColors = Object.entries(profile.colors).filter(([name]) => !["background", "surface", "text", "muted", "accent"].includes(name)).map(([name, value]) => `  --forma-color-${name}: ${value};`).join("\n");
  return `.forma-page {
  --forma-background: ${profile.colors.background};
  --forma-surface: ${profile.colors.surface};
  --forma-text: ${profile.colors.text};
  --forma-muted: ${profile.colors.muted};
  --forma-accent: ${profile.colors.accent};
${additionalColors}
  --forma-font-heading: ${fontStack(profile.fonts.heading)};
  --forma-font-body: ${fontStack(profile.fonts.body)};
  --forma-font-utility: ${fontStack(profile.fonts.utility ?? profile.fonts.body)};
  --forma-heading-size: ${length(profile.headingSize)};
  --forma-body-size: ${length(profile.bodySize)};
  --forma-small-size: ${length(profile.smallSize)};
  --forma-spacing: ${length(profile.spacing)};
  --forma-radius: ${length(profile.radius)};
  background: var(--forma-background);
  color: var(--forma-text);
  font-family: var(--forma-font-body);
  font-size: var(--forma-body-size);
  line-height: 1.4;
}
.forma-page :where(h1, h2, h3, h4, h5, h6, .forma-heading) { margin: 0; font-family: var(--forma-font-heading); font-size: var(--forma-heading-size); line-height: 1.1; }
.forma-page :where(p, ul, ol) { margin: 0; }
.forma-page :where(small, .forma-caption) { font-family: var(--forma-font-utility); font-size: var(--forma-small-size); color: var(--forma-muted); }
.forma-page :where(.forma-surface) { background: var(--forma-surface); padding: var(--forma-spacing); border-radius: var(--forma-radius); }
.forma-page :where(.forma-accent) { color: var(--forma-accent); }`;
}

export const DESIGN_INSTRUCTIONS = "The approved design profile supplies a shared visual identity, not a page template. Use --forma-background, --forma-surface, --forma-text, --forma-muted, --forma-accent, --forma-font-heading, --forma-font-body, --forma-font-utility, --forma-heading-size, --forma-body-size, --forma-small-size, --forma-spacing, and --forma-radius as anchors. Additional named colors in the profile are available as --forma-color-NAME. Use these colors and fonts consistently so theme changes reach every page; propose an expanded palette when more shared colors are needed. You may freely vary composition, hierarchy, type sizes and weights, spacing, corners, borders, shadows, gradients, overlays, textures, and SVG artwork to suit each page. Derive colors with color-mix() and sizes with calc() where useful; the base sizes and radius are starting points, not limits on individual elements. Do not redefine the shared variables. Follow the approved visual direction and preserve content and requested page scope during refinements.";
