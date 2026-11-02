import type { JSX } from "react";
import {
  type Appearance,
  type FontChoice,
  type Theme,
  FONTS,
  SIZE_MAX,
  SIZE_MIN,
  THEMES,
} from "./appearance";

const THEME_LABELS: Record<Theme, string> = {
  system: "Follow system",
  light: "Light",
  dark: "Dark",
  sepia: "Sepia",
};

const FONT_LABELS: Record<FontChoice, string> = {
  serif: "Serif",
  sans: "Sans",
  mono: "Mono",
  dyslexia: "Dyslexia-friendly (Atkinson Hyperlegible)",
};

interface Props {
  value: Appearance;
  onChange: (next: Appearance) => void;
}

/** A quiet, inline settings menu: no popups, just a disclosure at the foot of the page list. */
export function AppearanceMenu({ value, onChange }: Props): JSX.Element {
  return (
    <details className="appearance">
      <summary>Settings</summary>
      <label>
        Theme
        <select
          value={value.theme}
          onChange={(e) => {
            const theme = THEMES.find((t) => t === e.target.value);
            if (theme !== undefined) {
              onChange({ ...value, theme });
            }
          }}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {THEME_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Font
        <select
          value={value.font}
          onChange={(e) => {
            const font = FONTS.find((f) => f === e.target.value);
            if (font !== undefined) {
              onChange({ ...value, font });
            }
          }}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {FONT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Text size
        <input
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          value={value.size}
          onChange={(e) => {
            onChange({ ...value, size: Number(e.target.value) });
          }}
        />
      </label>
      <p className="hint">Focus mode: ⌘⇧F. Esc leaves it.</p>
    </details>
  );
}
