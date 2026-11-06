import { PRESET_THEMES, SYSTEM_THEME_ID, type ThemeDef, findTheme, parseTheme } from "./themes";

export type FontChoice = "serif" | "sans" | "mono" | "dyslexia";
export type EditorWidth = "narrow" | "medium" | "wide";

/** A reading look sets line spacing, paragraph spacing and page width together. */
export type ReadingLook = "compact" | "open" | "relaxed";

export interface Appearance {
  /** A preset id, a custom theme id, or "system". */
  themeId: string;
  /** The app's menus and labels. */
  font: FontChoice;
  /** An imported interface font, used instead of `font` when set. */
  uiFont: string | null;
  /** How much bigger the page looks, in percent. Display only: never saved into the writing or exports. */
  zoom: number;
  width: EditorWidth;
  look: ReadingLook;
}

export const FONTS: readonly FontChoice[] = ["serif", "sans", "mono", "dyslexia"];
export const WIDTHS: readonly EditorWidth[] = ["narrow", "medium", "wide"];
export const LOOKS: readonly ReadingLook[] = ["compact", "open", "relaxed"];
/** Each look's starting width; the width menu can still change it afterwards. */
export const LOOK_WIDTH: Record<ReadingLook, EditorWidth> = {
  compact: "wide",
  open: "medium",
  relaxed: "narrow",
};
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const DEFAULTS: Appearance = {
  themeId: SYSTEM_THEME_ID,
  font: "serif",
  uiFont: null,
  zoom: 100,
  width: "medium",
  look: "open",
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
      uiFont: typeof r.uiFont === "string" && r.uiFont !== "" ? r.uiFont : null,
      zoom:
        typeof r.zoom === "number" && r.zoom >= ZOOM_MIN && r.zoom <= ZOOM_MAX
          ? r.zoom
          : DEFAULTS.zoom,
      width: WIDTHS.find((w) => w === r.width) ?? DEFAULTS.width,
      look: LOOKS.find((l) => l === r.look) ?? DEFAULTS.look,
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

export function resolveTheme(id: string, custom: readonly ThemeDef[]): ThemeDef {
  const fallback = PRESET_THEMES.find((t) => t.id === "paper") ?? PRESET_THEMES[0];
  if (id === SYSTEM_THEME_ID) {
    const dark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return findTheme(dark ? "night" : "paper", []) ?? fallback ?? EMERGENCY;
  }
  return findTheme(id, custom) ?? fallback ?? EMERGENCY;
}

/**
 * Measured in characters of the writing font, so a line holds about the same amount of text at
 * any size. `ch` is the width of a zero, wider than an average letter, so lines hold a bit more.
 */
const WIDTH_CH: Record<EditorWidth, string> = { narrow: "50ch", medium: "62ch", wide: "78ch" };
const LOOK_SPACING: Record<ReadingLook, { line: string; paragraph: string }> = {
  compact: { line: "1.4", paragraph: "0.4em" },
  open: { line: "1.7", paragraph: "0.6em" },
  relaxed: { line: "2", paragraph: "1em" },
};

/** Applies the choice as CSS variables on <html>; the stylesheet does the rest. */
export function applyAppearance(a: Appearance, custom: readonly ThemeDef[]): void {
  const theme = resolveTheme(a.themeId, custom);
  const root = document.documentElement;
  root.dataset.font = a.font;
  root.style.colorScheme = theme.dark ? "dark" : "light";
  root.style.setProperty("--paper", theme.bg);
  root.style.setProperty("--ink", theme.text);
  root.style.setProperty("--accent", theme.accent);
  if (a.uiFont === null) {
    root.style.removeProperty("--font-body");
  } else {
    root.style.setProperty("--font-body", a.uiFont);
  }
  root.style.setProperty("--zoom", String(a.zoom / 100));
  root.style.setProperty("--page-width", WIDTH_CH[a.width]);
  root.style.setProperty("--line-spacing", LOOK_SPACING[a.look].line);
  root.style.setProperty("--paragraph-spacing", LOOK_SPACING[a.look].paragraph);
}
