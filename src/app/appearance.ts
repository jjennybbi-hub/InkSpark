export type Theme = "system" | "light" | "dark" | "sepia";
export type FontChoice = "serif" | "sans" | "mono" | "dyslexia";

export interface Appearance {
  theme: Theme;
  font: FontChoice;
  size: number;
}

export const THEMES: readonly Theme[] = ["system", "light", "dark", "sepia"];
export const FONTS: readonly FontChoice[] = ["serif", "sans", "mono", "dyslexia"];
export const SIZE_MIN = 14;
export const SIZE_MAX = 28;
export const DEFAULTS: Appearance = { theme: "system", font: "serif", size: 18 };

const KEY = "inkspark.appearance";

/** Reads the saved choice, ignoring anything that is not valid. */
export function loadAppearance(): Appearance {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) {
      return DEFAULTS;
    }
    const r = raw as Record<string, unknown>;
    return {
      theme: THEMES.find((t) => t === r.theme) ?? DEFAULTS.theme,
      font: FONTS.find((f) => f === r.font) ?? DEFAULTS.font,
      size:
        typeof r.size === "number" && r.size >= SIZE_MIN && r.size <= SIZE_MAX
          ? r.size
          : DEFAULTS.size,
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

/** Applies the choice through attributes on <html>; the CSS variables do the rest. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.dataset.font = a.font;
  root.style.setProperty("--text-size", `${String(a.size)}px`);
}
