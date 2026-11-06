import {
  PRESET_THEMES,
  SYSTEM_THEME_ID,
  type ThemeDef,
  findTheme,
  isDarkColor,
  parseTheme,
} from "./themes";

export type FontChoice = "serif" | "sans" | "mono" | "dyslexia";
export type EditorWidth = "narrow" | "medium" | "wide";

export interface Appearance {
  /** A preset id, a custom theme id, or "system". */
  themeId: string;
  font: FontChoice;
  size: number;
  width: EditorWidth;
}

export const FONTS: readonly FontChoice[] = ["serif", "sans", "mono", "dyslexia"];
export const WIDTHS: readonly EditorWidth[] = ["narrow", "medium", "wide"];
export const SIZE_MIN = 14;
export const SIZE_MAX = 28;
export const DEFAULTS: Appearance = {
  themeId: SYSTEM_THEME_ID,
  font: "serif",
  size: 18,
  width: "medium",
};

const KEY = "inkspark.appearance";
const CUSTOM_KEY = "inkspark.customThemes";

/** Reads the saved choice, ignoring anything that is not valid. */
export function loadAppearance(): Appearance {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) {
      return DEFAULTS;
    }
    const r = raw as Record<string, unknown>;
    // Older saves used `theme` with light/dark/sepia/system.
    const legacy: Record<string, string> = { light: "paper", dark: "night", sepia: "sepia" };
    const wanted = typeof r.themeId === "string" ? r.themeId : legacy[String(r.theme)];
    return {
      themeId: typeof wanted === "string" && wanted !== "" ? wanted : DEFAULTS.themeId,
      font: FONTS.find((f) => f === r.font) ?? DEFAULTS.font,
      size:
        typeof r.size === "number" && r.size >= SIZE_MIN && r.size <= SIZE_MAX
          ? r.size
          : DEFAULTS.size,
      width: WIDTHS.find((w) => w === r.width) ?? DEFAULTS.width,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Remembering the look is a convenience only.
  }
}

export function loadCustomThemes(): ThemeDef[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((item: unknown) => {
      const theme = parseTheme(item);
      const id = (item as { id?: unknown }).id;
      return theme === null ? [] : [typeof id === "string" ? { ...theme, id } : theme];
    });
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: readonly ThemeDef[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(themes));
  } catch {
    // Remembering custom themes is a convenience only.
  }
}

const EMERGENCY: ThemeDef = {
  id: "paper",
  name: "Paper",
  bg: "#fbfbf9",
  text: "#22252b",
  accent: "#3b6ea5",
  dark: false,
};

function resolveTheme(id: string, custom: readonly ThemeDef[]): ThemeDef {
  const fallback = PRESET_THEMES.find((t) => t.id === "paper") ?? PRESET_THEMES[0];
  if (id === SYSTEM_THEME_ID) {
    const dark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return findTheme(dark ? "night" : "paper", []) ?? fallback ?? EMERGENCY;
  }
  return findTheme(id, custom) ?? fallback ?? EMERGENCY;
}

const WIDTH_REM: Record<EditorWidth, string> = { narrow: "34rem", medium: "42rem", wide: "56rem" };

/** Applies the choice as CSS variables on <html>; the stylesheet does the rest. */
export function applyAppearance(a: Appearance, custom: readonly ThemeDef[]): void {
  const theme = resolveTheme(a.themeId, custom);
  const root = document.documentElement;
  root.dataset.font = a.font;
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.style.setProperty("--paper", theme.bg);
  root.style.setProperty("--ink", theme.text);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--on-accent", isDarkColor(theme.accent) ? "#ffffff" : "#000000");
  root.style.setProperty("--text-size", `${String(a.size)}px`);
  root.style.setProperty("--page-width", WIDTH_REM[a.width]);
}
