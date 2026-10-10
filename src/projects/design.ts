import { z } from "zod";
import type { EffectiveSize } from "./size.ts";

export const DESIGN_FONTS = ["Segoe UI", "Bahnschrift", "Georgia", "Trebuchet MS", "Arial", "Times New Roman"] as const;

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color");

export const designProfileSchema = z.object({
  colors: z.object({
    background: color.default("#ffffff"),
    surface: color.default("#f1f5f9"),
    text: color.default("#172033"),
    muted: color.default("#64748b"),
    accent: color.default("#2563eb"),
  }).default({}),
  fonts: z.object({
    heading: z.enum(DESIGN_FONTS).default("Segoe UI"),
    body: z.enum(DESIGN_FONTS).default("Segoe UI"),
  }).default({}),
  headingSize: z.number().min(16).max(240).default(72),
  bodySize: z.number().min(12).max(120).default(32),
  smallSize: z.number().min(8).max(80).default(24),
  spacing: z.number().min(4).max(160).default(32),
  radius: z.number().min(0).max(80).default(12),
  direction: z.string().trim().default(""),
});

export type DesignProfile = z.infer<typeof designProfileSchema>;

export function defaultDesignProfile(): DesignProfile {
  return designProfileSchema.parse({});
}

export function designStyles(profile: DesignProfile, size: EffectiveSize): string {
  const length = (value: number) => `${value * size.width / 1920}${size.unit}`;
  return `.forma-page {
  --forma-background: ${profile.colors.background};
  --forma-surface: ${profile.colors.surface};
  --forma-text: ${profile.colors.text};
  --forma-muted: ${profile.colors.muted};
  --forma-accent: ${profile.colors.accent};
  --forma-font-heading: "${profile.fonts.heading}", ${profile.fonts.heading === "Georgia" || profile.fonts.heading === "Times New Roman" ? "serif" : "sans-serif"};
  --forma-font-body: "${profile.fonts.body}", ${profile.fonts.body === "Georgia" || profile.fonts.body === "Times New Roman" ? "serif" : "sans-serif"};
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
.forma-page :where(small, .forma-caption) { font-size: var(--forma-small-size); color: var(--forma-muted); }
.forma-page :where(.forma-surface) { background: var(--forma-surface); padding: var(--forma-spacing); border-radius: var(--forma-radius); }
.forma-page :where(.forma-accent) { color: var(--forma-accent); }`;
}

export const DESIGN_INSTRUCTIONS = "Use the shared design profile on every page. The document supplies --forma-background, --forma-surface, --forma-text, --forma-muted, --forma-accent, --forma-font-heading, --forma-font-body, --forma-heading-size, --forma-body-size, --forma-small-size, --forma-spacing, and --forma-radius. Use var(--forma-...) for colors, fonts, text sizes, spacing, and corner radii; do not redefine these variables or hardcode competing values. The base stylesheet styles headings and body text and provides forma-heading, forma-caption, forma-surface, and forma-accent classes. Use calc() with the shared size and spacing variables for hierarchy and layout variations. Preserve these tokens during refinements and follow the profile's visual direction. Style and density guide composition; the profile supplies the shared visual identity.";
