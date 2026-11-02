/**
 * Build-time feature flags (M0 §3.4, docs/feature-flags.md).
 *
 * Every flag defaults to `false` until its milestone accepts the feature. Override at build or
 * dev time with `VITE_INKSPARK_FLAGS`, e.g. `VITE_INKSPARK_FLAGS="readerView,-dictation"`.
 */

export interface FlagDefinition {
  readonly default: false;
  readonly description: string;
  readonly milestone: string;
}

export const FLAG_DEFINITIONS = {
  verticalWriting: {
    default: false,
    description: "Vertical writing modes in the editor",
    milestone: "M8",
  },
  readerView: { default: false, description: "foliate-js Reader View", milestone: "M5" },
  dictation: { default: false, description: "macOS dictation", milestone: "M1" },
  readAloud: { default: false, description: "macOS read-aloud", milestone: "M4" },
  scrivenerImport: { default: false, description: "Scrivener importer", milestone: "M6" },
  encyclopedia: { default: false, description: "Pack encyclopedia search", milestone: "M7" },
} as const satisfies Record<string, FlagDefinition>;

export type FlagName = keyof typeof FLAG_DEFINITIONS;
export type Flags = Readonly<Record<FlagName, boolean>>;

export interface FlagOverrides {
  enabled: FlagName[];
  disabled: FlagName[];
  unknown: string[];
}

const FLAG_NAMES = Object.keys(FLAG_DEFINITIONS) as readonly FlagName[];

function isFlagName(name: string): name is FlagName {
  return Object.hasOwn(FLAG_DEFINITIONS, name);
}

/**
 * Parses a comma-separated override list. `name` enables a flag and `-name` disables it; a later
 * entry for the same flag wins, so `enabled` and `disabled` never share a name. Whitespace is
 * ignored. Unknown names are collected, never thrown.
 */
export function parseFlagOverrides(raw: string | undefined): FlagOverrides {
  const state = new Map<FlagName, boolean>();
  const unknown: string[] = [];
  for (const token of (raw ?? "").split(",")) {
    const trimmed = token.trim();
    const disable = trimmed.startsWith("-");
    const name = (disable ? trimmed.slice(1) : trimmed).trim();
    if (name === "") {
      continue;
    }
    if (isFlagName(name)) {
      // Re-insert so iteration order follows the last mention.
      state.delete(name);
      state.set(name, !disable);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }
  const enabled: FlagName[] = [];
  const disabled: FlagName[] = [];
  for (const [name, on] of state) {
    (on ? enabled : disabled).push(name);
  }
  return { enabled, disabled, unknown };
}

/** Defaults plus overrides, as a frozen object. */
export function resolveFlags(raw: string | undefined): Flags {
  const { enabled, disabled } = parseFlagOverrides(raw);
  const resolved = {} as Record<FlagName, boolean>;
  for (const name of FLAG_NAMES) {
    resolved[name] = FLAG_DEFINITIONS[name].default;
  }
  for (const name of enabled) {
    resolved[name] = true;
  }
  for (const name of disabled) {
    resolved[name] = false;
  }
  return Object.freeze(resolved);
}

export const flags: Flags = resolveFlags(import.meta.env.VITE_INKSPARK_FLAGS);

export function isEnabled(name: FlagName): boolean {
  return flags[name];
}
