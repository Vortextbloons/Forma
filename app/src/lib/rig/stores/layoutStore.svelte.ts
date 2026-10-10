import { clamp } from "../format";

export type ThemePref = "dark" | "light" | "system";

export interface LayoutPrefs {
  theme: ThemePref;
  accent: string;
  radius: number;
}

export const LAYOUT_STORAGE_KEY = "rig:layout:v2";

const DEFAULTS: LayoutPrefs = {
  theme: "dark",
  accent: "#8f8f8f",
  radius: 10,
};

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      theme: themeOr(parsed.theme),
      accent: typeof parsed.accent === "string" && parsed.accent.startsWith("#") ? parsed.accent : DEFAULTS.accent,
      radius: clamp(numberOr(parsed.radius, DEFAULTS.radius), 0, 24),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function themeOr(value: unknown): ThemePref {
  return value === "dark" || value === "light" || value === "system" ? value : DEFAULTS.theme;
}

let prefs = $state<LayoutPrefs>(load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch {

    }
  }, 200);
}

export function setTheme(theme: ThemePref): void {
  prefs.theme = theme;
  persist();
}

export function setAccent(accent: string): void {
  prefs.accent = accent;
  persist();
}

export function setRadius(radius: number): void {
  prefs.radius = clamp(radius, 0, 24);
  persist();
}

export function resetLayoutPrefs(): void {
  try {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {

  }
  Object.assign(prefs, DEFAULTS);
}

function resolveTheme(): "dark" | "light" {
  return prefs.theme === "system"
    ? matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark"
    : prefs.theme;
}

export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme();
  root.style.setProperty("--accent", prefs.accent);
  root.style.setProperty("--radius", `${prefs.radius}px`);
}

let systemListenerRegistered = false;

function ensureSystemListener(): void {
  if (systemListenerRegistered) return;
  systemListenerRegistered = true;
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    applyTheme();
  });
}

applyTheme();
ensureSystemListener();

export const layoutStore = {
  get theme() {
    return prefs.theme;
  },
  get accent() {
    return prefs.accent;
  },
  get radius() {
    return prefs.radius;
  },
  setTheme,
  setAccent,
  setRadius,
  resetLayoutPrefs,
  applyTheme,
};
