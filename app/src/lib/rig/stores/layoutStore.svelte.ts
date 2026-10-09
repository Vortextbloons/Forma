




import { clamp } from "../format";

export type ThemePref = "dark" | "light" | "system";

export interface LayoutPrefs {
  sidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  showRightPanel: boolean;
  showBottomPanel: boolean;
  theme: ThemePref;
  accent: string;
  radius: number;
}



export const LAYOUT_STORAGE_KEY = "rig:layout:v2";

const DEFAULTS: LayoutPrefs = {
  sidebarWidth: 280,
  rightPanelWidth: 360,
  bottomPanelHeight: 220,
  showRightPanel: true,
  showBottomPanel: false,
  theme: "system",
  accent: "#8f8f8f",
  radius: 10,
};

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      sidebarWidth: clamp(numberOr(parsed.sidebarWidth, DEFAULTS.sidebarWidth), 180, 420),
      rightPanelWidth: clamp(numberOr(parsed.rightPanelWidth, DEFAULTS.rightPanelWidth), 240, 560),
      bottomPanelHeight: clamp(numberOr(parsed.bottomPanelHeight, DEFAULTS.bottomPanelHeight), 120, 600),
      showRightPanel: booleanOr(parsed.showRightPanel, DEFAULTS.showRightPanel),
      showBottomPanel: booleanOr(parsed.showBottomPanel, DEFAULTS.showBottomPanel),
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

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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

export function setSidebarWidth(width: number): void {
  prefs.sidebarWidth = clamp(width, 180, 420);
  persist();
}

export function setRightPanelWidth(width: number): void {
  prefs.rightPanelWidth = clamp(width, 240, 560);
  persist();
}

export function setBottomPanelHeight(height: number): void {
  prefs.bottomPanelHeight = clamp(height, 120, 600);
  persist();
}

export function toggleRightPanel(): void {
  prefs.showRightPanel = !prefs.showRightPanel;
  persist();
}

export function toggleBottomPanel(): void {
  prefs.showBottomPanel = !prefs.showBottomPanel;
  persist();
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
  get sidebarWidth() {
    return prefs.sidebarWidth;
  },
  get rightPanelWidth() {
    return prefs.rightPanelWidth;
  },
  get bottomPanelHeight() {
    return prefs.bottomPanelHeight;
  },
  get showRightPanel() {
    return prefs.showRightPanel;
  },
  get showBottomPanel() {
    return prefs.showBottomPanel;
  },
  get theme() {
    return prefs.theme;
  },
  get accent() {
    return prefs.accent;
  },
  get radius() {
    return prefs.radius;
  },
  setSidebarWidth,
  setRightPanelWidth,
  setBottomPanelHeight,
  toggleRightPanel,
  toggleBottomPanel,
  setTheme,
  setAccent,
  setRadius,
  resetLayoutPrefs,
  applyTheme,
};
