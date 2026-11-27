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
 * Each preset's atmosphere: a faint scene behind the app (rain, sea, hills, trees) drawn in
 * fine lines. Low-contrast on purpose: it sets a mood, then fades away while you write.
 */
const svgUrl = (w: number, h: number, body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}">${body}</svg>`)}")`;

const grain = (c: string, a: number): string =>
  svgUrl(
    160,
    160,
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${String(a)}"/></feComponentTransfer></filter><rect width="160" height="160" fill="${c}" filter="url(#n)"/>`,
  );
const rules = (c: string, a: number, gap: number): string =>
  svgUrl(
    10,
    gap,
    `<path d="M0 ${String(gap - 0.5)} H10" stroke="${c}" stroke-opacity="${String(a)}"/>`,
  );
const dots = (c: string, a: number, gap: number): string =>
  svgUrl(
    gap,
    gap,
    `<circle cx="${String(gap / 2)}" cy="${String(gap / 2)}" r=".9" fill="${c}" fill-opacity="${String(a)}"/>`,
  );
const scatter = (c: string, a: number): string =>
  svgUrl(
    200,
    200,
    `<g fill="${c}" fill-opacity="${String(a)}"><circle cx="20" cy="30" r="1"/><circle cx="140" cy="60" r=".7"/><circle cx="90" cy="150" r="1.2"/><circle cx="170" cy="170" r=".6"/><circle cx="60" cy="95" r=".5"/></g>`,
  );

/** A wide landscape along the bottom of the window, stretched to fit. */
const sceneSvg = (body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" preserveAspectRatio="none">${body}</svg>`)}")`;
const land = (body: string, height = "38%"): string =>
  `${sceneSvg(body)} bottom / 100% ${height} no-repeat`;
const op = (a: number): string => String(Math.min(1, a * 3));
const hills = (c: string, a: number): string =>
  land(
    `<path d="M0 190 C200 120 380 170 560 140 S900 90 1200 150" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a * 0.6)}"/><path d="M0 240 C250 190 450 230 700 205 S1050 190 1200 220" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a)}"/>`,
  );
const sea = (c: string, a: number): string =>
  land(
    `<path d="M0 170 q75 -22 150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a * 0.5)}"/><path d="M0 215 q100 -28 200 0 t200 0 t200 0 t200 0 t200 0 t200 0" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a * 0.8)}"/><path d="M0 260 q60 -18 120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0 t120 0" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a)}"/>`,
    "34%",
  );
const treeline = (c: string, a: number): string => {
  let d = "M0 230";
  for (let x = 0; x < 1200; x += 40) {
    const h = 150 + ((x * 37) % 70);
    d += ` L${String(x + 20)} ${String(h)} L${String(x + 40)} 230`;
  }
  return land(
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a)}"/>`,
    "42%",
  );
};
const peaks = (c: string, a: number): string =>
  land(
    `<path d="M0 260 L180 120 L300 200 L470 70 L640 210 L800 110 L980 220 L1100 150 L1200 200" fill="none" stroke="${c}" stroke-width="1.2" stroke-opacity="${op(a)}"/>`,
    "45%",
  );
const rain = (c: string, a: number): string =>
  svgUrl(
    90,
    120,
    `<g stroke="${c}" stroke-opacity="${op(a)}" stroke-linecap="round"><path d="M10 0 l-6 22"/><path d="M50 40 l-6 22"/><path d="M80 75 l-6 22"/><path d="M30 90 l-6 22"/><path d="M65 5 l-6 18"/></g>`,
  );
const snow = (c: string, a: number): string =>
  svgUrl(
    140,
    140,
    `<g fill="${c}" fill-opacity="${op(a)}"><circle cx="15" cy="20" r="1.6"/><circle cx="90" cy="45" r="1.2"/><circle cx="50" cy="100" r="2"/><circle cx="120" cy="125" r="1.3"/><circle cx="70" cy="10" r="1"/></g>`,
  );
const petals = (c: string, a: number): string =>
  svgUrl(
    220,
    220,
    `<g fill="${c}" fill-opacity="${op(a)}"><ellipse cx="30" cy="40" rx="5" ry="2.5" transform="rotate(30 30 40)"/><ellipse cx="160" cy="90" rx="4" ry="2" transform="rotate(-25 160 90)"/><ellipse cx="90" cy="180" rx="5" ry="2.5" transform="rotate(65 90 180)"/></g>`,
  );
const grass = (c: string, a: number): string => {
  let d = "";
  for (let x = 0; x < 1200; x += 9) {
    const h = 230 + ((x * 13) % 40);
    d += `M${String(x)} 300 q3 -30 ${String(((x * 7) % 9) - 4)} ${String(h - 300)} `;
  }
  return land(`<path d="${d}" stroke="${c}" stroke-opacity="${op(a)}" fill="none"/>`, "22%");
};
const shelves = (c: string, a: number): string => {
  let r = "";
  for (let x = 0; x < 1200; x += 26) {
    const h = 140 + ((x * 29) % 90);
    r += `<rect x="${String(x)}" y="${String(300 - h)}" width="${String(18 + ((x * 3) % 6))}" height="${String(h)}"/>`;
  }
  return land(`<g fill="${c}" fill-opacity="${op(a)}">${r}</g>`, "30%");
};

type Atmos = (t: ThemeDef) => string[];
const ATMOS: Record<string, Atmos> = {
  paper: (t) => [grain(t.text, 0.05)],
  sepia: (t) => [hills(t.text, 0.05), grain(t.text, 0.05)],
  parchment: (t) => [grain(t.text, 0.06)],
  lemonade: (t) => [hills(t.accent, 0.08)],
  autumn: (t) => [treeline(t.accent, 0.07), petals(t.accent, 0.06)],
  night: (t) => [hills(t.text, 0.05), scatter(t.text, 0.25)],
  forest: (t) => [treeline(t.accent, 0.08)],
  mocha: (t) => [rain(t.text, 0.06)],
  coffeehouse: (t) => [rain(t.text, 0.05)],
  library: (t) => [shelves(t.accent, 0.06)],
  "terminal-green": (t) => [rules(t.text, 0.05, 4)],
  slate: (t) => [peaks(t.text, 0.05)],
  storm: (t) => [rain(t.text, 0.08), sea(t.accent, 0.06)],
  "midnight-blue": (t) => [peaks(t.text, 0.05), scatter(t.text, 0.35)],
  ocean: (t) => [sea(t.accent, 0.1)],
  winter: (t) => [hills(t.accent, 0.06), snow(t.accent, 0.1)],
  rose: (t) => [petals(t.accent, 0.05)],
  "cherry-blossom": (t) => [petals(t.accent, 0.07)],
  dawn: (t) => [hills(t.accent, 0.08)],
  dusk: (t) => [sea(t.accent, 0.08)],
  lavender: (t) => [hills(t.accent, 0.07), dots(t.accent, 0.12, 24)],
  mint: (t) => [grass(t.accent, 0.05)],
  spring: (t) => [grass(t.accent, 0.06)],
  summer: (t) => [sea(t.accent, 0.07)],
};

/** The theme's atmosphere as CSS background layers, or "none" (custom and high-contrast themes). */
export function themeAtmosphere(theme: ThemeDef): string {
  const make = ATMOS[theme.id];
  return make === undefined ? "none" : [...make(theme)].join(", ");
}

/** A theme's own interface design: lettering, shapes and heading voice. Never the writing. */
export interface ThemeUi {
  /** Interface font stack, from fonts that ship with the operating system. */
  font: string;
  /** Corner roundness of panels and buttons, in px. */
  radius: number;
  /** Button shape: "pill" or the panel corner. */
  pill?: boolean;
  /** Letter spacing for labels, in em. */
  tracking?: number;
  /** Heading style in menus. */
  heads?: "caps" | "small-caps" | "italic" | "plain";
  /** Label weight. */
  weight?: number;
}

// Rarer faces that ship with macOS; the fonts every app and AI tool reaches for are left out.
const NEW_YORK = `"New York", ui-serif, serif`;
const MARION = `Marion, serif`;
const BIG_CASLON = `"Big Caslon", serif`;
const BODONI_OS = `"Bodoni 72 Oldstyle", "Bodoni 72", serif`;
const BODONI_SC = `"Bodoni 72 Smallcaps", "Bodoni 72", serif`;
const BODONI = `"Bodoni 72", serif`;
const DIDOT = `Didot, serif`;
const STIX = `"STIX Two Text", serif`;
const CLARENDON = `Superclarendon, serif`;
const EUPHEMIA = `"Euphemia UCAS", sans-serif`;
const SUKHUMVIT = `"Sukhumvit Set", sans-serif`;
const GALVJI = `Galvji, sans-serif`;
const KRUNGTHEP = `Krungthep, sans-serif`;
const SANA = `Sana, sans-serif`;
const GENEVA = `Geneva, sans-serif`;
const COURIER = `Courier, monospace`;
const MONACO = `Monaco, monospace`;
const LEGIBLE = `"Atkinson Hyperlegible", sans-serif`;

const THEME_UI: Record<string, ThemeUi> = {
  paper: { font: NEW_YORK, radius: 6, heads: "small-caps" },
  sepia: { font: MARION, radius: 3, heads: "italic" },
  parchment: { font: BIG_CASLON, radius: 2, heads: "small-caps", tracking: 0.03 },
  lemonade: { font: SUKHUMVIT, radius: 12, heads: "plain", weight: 500 },
  autumn: { font: BODONI_OS, radius: 5, heads: "italic" },
  night: { font: STIX, radius: 6, heads: "caps", tracking: 0.02 },
  forest: { font: EUPHEMIA, radius: 4, heads: "caps", tracking: 0.04 },
  mocha: { font: CLARENDON, radius: 8, heads: "italic" },
  coffeehouse: { font: COURIER, radius: 3, heads: "plain" },
  library: { font: BODONI_SC, radius: 2, heads: "small-caps", tracking: 0.04 },
  "terminal-green": { font: MONACO, radius: 0, heads: "caps", tracking: 0.06 },
  slate: { font: GALVJI, radius: 4, heads: "caps", tracking: 0.08 },
  storm: { font: KRUNGTHEP, radius: 2, heads: "caps", tracking: 0.05, weight: 500 },
  "midnight-blue": { font: GALVJI, radius: 10, heads: "caps", tracking: 0.12 },
  ocean: { font: SANA, radius: 14, heads: "plain" },
  winter: { font: GENEVA, radius: 10, heads: "caps", tracking: 0.1 },
  rose: { font: DIDOT, radius: 14, heads: "italic" },
  "cherry-blossom": { font: MARION, radius: 16, heads: "plain" },
  dawn: { font: EUPHEMIA, radius: 12, heads: "plain", tracking: 0.02 },
  dusk: { font: BODONI, radius: 12, heads: "caps", tracking: 0.08 },
  lavender: { font: STIX, radius: 14, heads: "small-caps" },
  mint: { font: SUKHUMVIT, radius: 12, heads: "plain" },
  spring: { font: SANA, radius: 16, heads: "plain", weight: 500 },
  summer: { font: CLARENDON, radius: 18, heads: "caps", tracking: 0.06, weight: 500 },
  "contrast-light": { font: LEGIBLE, radius: 2, heads: "plain", weight: 700 },
  "contrast-dark": { font: LEGIBLE, radius: 2, heads: "plain", weight: 700 },
};

/** The theme's interface design, or undefined for custom themes (they use their family's). */
export function themeUi(theme: ThemeDef): ThemeUi | undefined {
  return THEME_UI[theme.id];
}
