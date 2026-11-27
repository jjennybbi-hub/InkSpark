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
  { id: "autumn", name: "Autumn", bg: "#f6e6d2", text: "#4a2a17", accent: "#c4561d", dark: false },
  { id: "winter", name: "Winter", bg: "#eaf1f7", text: "#1f2d3d", accent: "#4a7fb0", dark: false },
  { id: "spring", name: "Spring", bg: "#eef7e4", text: "#27391f", accent: "#5f9e3a", dark: false },
  { id: "summer", name: "Summer", bg: "#fff6d9", text: "#3d3318", accent: "#e08a00", dark: false },
  { id: "dusk", name: "Dusk", bg: "#2d2540", text: "#eadff2", accent: "#e59ac0", dark: true },
  { id: "dawn", name: "Dawn", bg: "#fdeee3", text: "#47303a", accent: "#d9697a", dark: false },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    bg: "#101b33",
    text: "#d8e2f5",
    accent: "#6fa3ff",
    dark: true,
  },
  {
    id: "parchment",
    name: "Parchment",
    bg: "#efe2bd",
    text: "#3b2f1a",
    accent: "#8a5a1c",
    dark: false,
  },
  {
    id: "terminal-green",
    name: "Terminal Green",
    bg: "#0b130d",
    text: "#6fe38a",
    accent: "#b6ff9f",
    dark: true,
  },
  {
    id: "cherry-blossom",
    name: "Cherry Blossom",
    bg: "#fdeef3",
    text: "#4b2a37",
    accent: "#d6527f",
    dark: false,
  },
  {
    id: "coffeehouse",
    name: "Coffeehouse",
    bg: "#3a2a22",
    text: "#f0e1d0",
    accent: "#e0a46b",
    dark: true,
  },
  { id: "library", name: "Library", bg: "#1f2a22", text: "#e4dcc3", accent: "#c9a24b", dark: true },
  {
    id: "lemonade",
    name: "Lemonade",
    bg: "#fbf9e4",
    text: "#38391c",
    accent: "#9aa21a",
    dark: false,
  },
  { id: "storm", name: "Storm", bg: "#3a4048", text: "#e8ecf0", accent: "#9fc2e0", dark: true },
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

export interface ThemeGroup {
  name: string;
  /** What the research says, stated plainly. Not every group has a proven benefit. */
  note: string;
  ids: readonly string[];
}

export const THEME_GROUPS: readonly ThemeGroup[] = [
  {
    name: "Dark text on light",
    note: "Best for proofreading in studies.",
    ids: ["paper", "sepia", "parchment", "lemonade"],
  },
  {
    name: "Blue, for ideas",
    note: "Linked to creative tasks; evidence is mixed.",
    ids: ["ocean", "winter", "slate", "storm", "midnight-blue"],
  },
  {
    name: "Red tints, for detail",
    note: "Linked to detail work; evidence is mixed.",
    ids: ["rose", "cherry-blossom", "dawn"],
  },
  {
    name: "Dark, for dim rooms",
    note: "A comfort choice.",
    ids: ["night", "forest", "mocha", "coffeehouse", "library", "terminal-green"],
  },
  {
    name: "High contrast",
    note: "For accessibility.",
    ids: ["contrast-light", "contrast-dark"],
  },
  {
    name: "Seasons and moods",
    note: "For atmosphere.",
    ids: ["spring", "summer", "autumn", "mint", "lavender", "dusk"],
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

/** A theme's design family: how the interface around the page feels, beyond its colours. */
export type ThemeStyle = "paper" | "focus" | "contrast" | "soft";

const STYLE_OF: Record<string, ThemeStyle> = {
  paper: "paper",
  sepia: "paper",
  parchment: "paper",
  lemonade: "paper",
  autumn: "paper",
  "contrast-light": "contrast",
  "contrast-dark": "contrast",
  rose: "soft",
  "cherry-blossom": "soft",
  dawn: "soft",
  lavender: "soft",
  mint: "soft",
  spring: "soft",
  summer: "soft",
  ocean: "soft",
  winter: "soft",
  dusk: "soft",
};

/** Presets use their own family; other themes (custom ones) follow light or dark. */
export function themeStyle(theme: ThemeDef): ThemeStyle {
  return STYLE_OF[theme.id] ?? (theme.dark ? "focus" : "paper");
}

/*
 * Each preset's own small picture, drawn in its accent colour (ACC is replaced). Shown only on
 * the theme cards in Settings, never in the writing space. Plain shapes, nothing downloaded.
 */
const MOTIFS: Record<string, string> = {
  paper: `<path d="M20 180 L150 50 L165 65 L35 195 Z" fill="ACC"/><path d="M150 50 L175 25 L190 40 L165 65 Z" fill="ACC" opacity=".6"/><path d="M10 190 q60 -20 120 0 t110 0" stroke="ACC" stroke-width="2" fill="none"/>`,
  night: `<path d="M140 40 a60 60 0 1 0 50 90 a48 48 0 1 1 -50 -90z" fill="ACC"/><circle cx="40" cy="40" r="3" fill="ACC"/><circle cx="70" cy="90" r="2" fill="ACC"/><circle cx="30" cy="150" r="2.5" fill="ACC"/>`,
  sepia: `<rect x="40" y="60" width="120" height="90" rx="4" fill="none" stroke="ACC" stroke-width="5"/><circle cx="100" cy="105" r="28" fill="none" stroke="ACC" stroke-width="5"/><rect x="60" y="45" width="30" height="15" fill="ACC"/>`,
  forest: `<path d="M50 180 L80 100 L110 180Z M30 180 L65 60 L100 180Z M100 180 L140 70 L180 180Z" fill="ACC"/><rect x="62" y="180" width="6" height="15" fill="ACC"/><rect x="137" y="180" width="6" height="15" fill="ACC"/>`,
  ocean: `<path d="M0 120 q25 -25 50 0 t50 0 t50 0 t50 0 M0 150 q25 -25 50 0 t50 0 t50 0 t50 0 M0 180 q25 -25 50 0 t50 0 t50 0 t50 0" stroke="ACC" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  rose: `<circle cx="100" cy="90" r="20" fill="ACC"/><circle cx="75" cy="80" r="22" fill="ACC" opacity=".7"/><circle cx="125" cy="80" r="22" fill="ACC" opacity=".7"/><circle cx="100" cy="60" r="22" fill="ACC" opacity=".7"/><path d="M100 110 q-5 40 0 80" stroke="ACC" stroke-width="5" fill="none"/><path d="M100 150 q25 -20 40 -5 q-20 15 -40 5" fill="ACC"/>`,
  lavender: `<path d="M100 195 V60" stroke="ACC" stroke-width="4"/><g fill="ACC"><ellipse cx="92" cy="70" rx="6" ry="10"/><ellipse cx="108" cy="80" rx="6" ry="10"/><ellipse cx="92" cy="92" rx="6" ry="10"/><ellipse cx="108" cy="104" rx="6" ry="10"/><ellipse cx="92" cy="116" rx="6" ry="10"/><ellipse cx="100" cy="55" rx="5" ry="9"/></g>`,
  slate: `<path d="M20 170 L80 70 L120 130 L150 90 L190 170Z" fill="ACC"/><path d="M80 70 L95 95 L70 95Z" fill="#fff" opacity=".5"/>`,
  mocha: `<path d="M50 90 h90 v50 a40 40 0 0 1 -40 40 h-10 a40 40 0 0 1 -40 -40z" fill="ACC"/><path d="M140 100 a20 20 0 0 1 0 40" stroke="ACC" stroke-width="8" fill="none"/><path d="M80 75 q-10 -15 0 -30 M105 75 q-10 -15 0 -30" stroke="ACC" stroke-width="4" fill="none"/>`,
  mint: `<path d="M100 190 C40 150 40 70 100 20 C160 70 160 150 100 190Z" fill="ACC"/><path d="M100 185 V40" stroke="#fff" stroke-width="3" opacity=".6"/>`,
  autumn: `<path d="M100 20 L115 70 L160 55 L130 95 L170 120 L120 125 L125 170 L100 140 L75 170 L80 125 L30 120 L70 95 L40 55 L85 70Z" fill="ACC"/><path d="M100 140 V195" stroke="ACC" stroke-width="4"/>`,
  winter: `<g stroke="ACC" stroke-width="6" stroke-linecap="round"><path d="M100 20 V180 M30 60 L170 140 M30 140 L170 60"/><path d="M85 35 L100 50 L115 35 M85 165 L100 150 L115 165"/></g>`,
  spring: `<g fill="ACC"><circle cx="100" cy="70" r="18"/><circle cx="125" cy="90" r="18"/><circle cx="115" cy="120" r="18"/><circle cx="85" cy="120" r="18"/><circle cx="75" cy="90" r="18"/></g><circle cx="100" cy="98" r="12" fill="#fff" opacity=".7"/><path d="M100 135 V195" stroke="ACC" stroke-width="5"/>`,
  summer: `<circle cx="100" cy="100" r="38" fill="ACC"/><g stroke="ACC" stroke-width="7" stroke-linecap="round"><path d="M100 20 V45 M100 155 V180 M20 100 H45 M155 100 H180 M43 43 L60 60 M140 140 L157 157 M43 157 L60 140 M140 60 L157 43"/></g>`,
  dusk: `<circle cx="100" cy="140" r="50" fill="ACC"/><rect x="0" y="140" width="200" height="60" fill="ACC" opacity=".35"/><path d="M20 160 H180 M40 175 H160" stroke="ACC" stroke-width="4"/>`,
  dawn: `<path d="M30 160 a70 70 0 0 1 140 0Z" fill="ACC"/><g stroke="ACC" stroke-width="5" stroke-linecap="round"><path d="M100 60 V75 M45 85 L55 95 M155 85 L145 95"/></g><path d="M10 175 H190" stroke="ACC" stroke-width="5"/>`,
  "midnight-blue": `<g fill="ACC"><path d="M100 30 l8 24 h25 l-20 15 l8 24 l-21 -15 l-21 15 l8 -24 l-20 -15 h25z"/><circle cx="40" cy="130" r="4"/><circle cx="160" cy="150" r="5"/><circle cx="70" cy="175" r="3"/><circle cx="150" cy="40" r="3"/></g>`,
  parchment: `<path d="M50 40 h100 v120 a20 20 0 0 1 -20 20 h-100 a20 20 0 0 0 20 -20z" fill="none" stroke="ACC" stroke-width="5"/><path d="M70 70 H135 M70 95 H135 M70 120 H120" stroke="ACC" stroke-width="4"/>`,
  "terminal-green": `<path d="M30 60 L80 100 L30 140" stroke="ACC" stroke-width="10" fill="none" stroke-linecap="square"/><rect x="95" y="130" width="70" height="12" fill="ACC"/>`,
  "cherry-blossom": `<path d="M10 190 Q80 120 190 100" stroke="ACC" stroke-width="5" fill="none"/><g fill="ACC"><circle cx="70" cy="140" r="12"/><circle cx="120" cy="115" r="14"/><circle cx="165" cy="100" r="10"/><circle cx="140" cy="160" r="6" opacity=".6"/><circle cx="60" cy="80" r="5" opacity=".6"/></g>`,
  coffeehouse: `<g fill="ACC"><ellipse cx="70" cy="100" rx="22" ry="32" transform="rotate(30 70 100)"/><ellipse cx="135" cy="110" rx="22" ry="32" transform="rotate(-25 135 110)"/></g><path d="M58 80 q20 20 24 40 M125 90 q18 20 20 40" stroke="#000" stroke-width="3" opacity=".35" fill="none"/>`,
  library: `<g fill="ACC"><rect x="30" y="60" width="22" height="120"/><rect x="56" y="80" width="18" height="100"/><rect x="78" y="50" width="26" height="130"/><rect x="118" y="70" width="20" height="110" transform="rotate(12 128 180)"/></g><path d="M20 182 H180" stroke="ACC" stroke-width="5"/>`,
  lemonade: `<ellipse cx="100" cy="100" rx="60" ry="45" fill="ACC"/><ellipse cx="100" cy="100" rx="45" ry="32" fill="#fff" opacity=".45"/><path d="M100 70 V130 M70 100 H130 M78 80 L122 120 M78 120 L122 80" stroke="ACC" stroke-width="3"/>`,
  storm: `<path d="M50 100 a30 30 0 0 1 40 -40 a35 35 0 0 1 65 15 a25 25 0 0 1 -5 50 h-95 a25 25 0 0 1 -5 -25z" fill="ACC"/><path d="M110 125 L90 160 H110 L95 195 L135 150 H115 L130 125Z" fill="ACC"/>`,
  "contrast-light": `<path d="M20 180 L180 20" stroke="ACC" stroke-width="16"/><rect x="25" y="25" width="60" height="60" fill="ACC"/>`,
  "contrast-dark": `<path d="M20 180 L180 20" stroke="ACC" stroke-width="16"/><circle cx="145" cy="150" r="30" fill="ACC"/>`,
};

/** The theme's picture as a CSS image, or "none" for custom themes. */
export function themeMotif(theme: ThemeDef): string {
  const shapes = MOTIFS[theme.id];
  if (shapes === undefined) {
    return "none";
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${shapes.replaceAll("ACC", theme.accent)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
