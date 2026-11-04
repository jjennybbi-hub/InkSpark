export interface ThemeDef {
  id: string;
  name: string;
  /** Page background. */
  bg: string;
  /** Text colour. */
  text: string;
  /** Accent colour (focus rings, selection, links). */
  accent: string;
  dark: boolean;
}

export const PRESET_THEMES: readonly ThemeDef[] = [
  { id: "paper", name: "Paper", bg: "#fbfbf9", text: "#22252b", accent: "#3b6ea5", dark: false },
  { id: "night", name: "Night", bg: "#23211e", text: "#e6e0d4", accent: "#8fb4e3", dark: true },
  { id: "sepia", name: "Sepia", bg: "#f1e4c8", text: "#4a3722", accent: "#9a5b24", dark: false },
  { id: "forest", name: "Forest", bg: "#1e2b23", text: "#dce8dc", accent: "#7fbf8f", dark: true },
  { id: "ocean", name: "Ocean", bg: "#e6f0f6", text: "#17324a", accent: "#1f77b4", dark: false },
  { id: "rose", name: "Rose", bg: "#fbeeee", text: "#4a2330", accent: "#b84a62", dark: false },
  {
    id: "lavender",
    name: "Lavender",
    bg: "#f1edf8",
    text: "#2f2748",
    accent: "#7456b8",
    dark: false,
  },
  { id: "slate", name: "Slate", bg: "#2b313a", text: "#dfe4ea", accent: "#8aa4c8", dark: true },
  { id: "mocha", name: "Mocha", bg: "#2e2420", text: "#eadccf", accent: "#d19a66", dark: true },
  { id: "mint", name: "Mint", bg: "#e8f5ee", text: "#183a2a", accent: "#2f9e6a", dark: false },
  {
    id: "contrast-light",
    name: "High contrast light",
    bg: "#ffffff",
    text: "#000000",
    accent: "#0000cc",
    dark: false,
  },
  {
    id: "contrast-dark",
    name: "High contrast dark",
    bg: "#000000",
    text: "#ffffff",
    accent: "#ffff00",
    dark: true,
  },
];

/** "system" is not a palette: it resolves to Paper or Night with the operating system. */
export const SYSTEM_THEME_ID = "system";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Whether a colour is dark enough that light text belongs on it. */
export function isDarkColor(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 128;
}

export function makeCustomTheme(name: string, bg: string, text: string, accent: string): ThemeDef {
  const clean = name.trim().slice(0, 40) || "Custom";
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    bg,
    text,
    accent,
    dark: isDarkColor(bg),
  };
}

/** Validates untrusted data (storage or an imported file) into a theme, or null. */
export function parseTheme(raw: unknown): ThemeDef | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || !isHex(r.bg) || !isHex(r.text) || !isHex(r.accent)) {
    return null;
  }
  return makeCustomTheme(r.name, r.bg, r.text, r.accent);
}

export function parseThemeFile(json: string): ThemeDef | null {
  try {
    return parseTheme(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The small file a custom theme is exported as. */
export function themeToFile(theme: ThemeDef): string {
  const { name, bg, text, accent } = theme;
  return `${JSON.stringify({ inkspark: "theme", version: 1, name, bg, text, accent }, null, 2)}\n`;
}

export function findTheme(id: string, custom: readonly ThemeDef[]): ThemeDef | undefined {
  return [...PRESET_THEMES, ...custom].find((t) => t.id === id);
}
