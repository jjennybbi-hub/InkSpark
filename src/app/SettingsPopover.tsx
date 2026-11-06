import { type JSX, useEffect, useRef, useState } from "react";
import {
  type Appearance,
  type EditorWidth,
  type FontChoice,
  FONTS,
  LOOKS,
  LOOK_WIDTH,
  type ReadingLook,
  SIZE_MAX,
  SIZE_MIN,
  WIDTHS,
} from "./appearance";
import {
  PRESET_THEMES,
  SYSTEM_THEME_ID,
  type ThemeDef,
  makeCustomTheme,
  parseThemeFile,
  themeToFile,
} from "./themes";

const FONT_LABELS: Record<FontChoice, string> = {
  serif: "Serif",
  sans: "Sans",
  mono: "Mono",
  dyslexia: "Dyslexia-friendly (Atkinson Hyperlegible)",
};

const WIDTH_LABELS: Record<EditorWidth, string> = {
  narrow: "Narrow",
  medium: "Medium",
  wide: "Wide",
};

const LOOK_LABELS: Record<ReadingLook, string> = {
  compact: "Compact",
  open: "Open",
  relaxed: "Relaxed",
};

interface Props {
  value: Appearance;
  customThemes: readonly ThemeDef[];
  onChange: (next: Appearance) => void;
  onCustomThemes: (next: ThemeDef[]) => void;
}

function Swatch({ theme }: { theme: ThemeDef }): JSX.Element {
  return (
    <span
      className="swatch"
      aria-hidden="true"
      style={{ background: theme.bg, color: theme.text, borderColor: theme.accent }}
    >
      Aa
    </span>
  );
}

/** App appearance only. It floats over the page, so opening it moves nothing. */
export function SettingsPopover({
  value,
  customThemes,
  onChange,
  onCustomThemes,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [bg, setBg] = useState("#fbfbf9");
  const [text, setText] = useState("#22252b");
  const [accent, setAccent] = useState("#3b6ea5");
  const [problem, setProblem] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (themeId: string): void => {
    onChange({ ...value, themeId });
  };

  const saveNew = (): void => {
    const theme = makeCustomTheme(name, bg, text, accent);
    onCustomThemes([...customThemes, theme]);
    choose(theme.id);
    setCreating(false);
    setName("");
  };

  const exportTheme = (theme: ThemeDef): void => {
    const url = URL.createObjectURL(new Blob([themeToFile(theme)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${theme.name.replace(/[^\w-]+/g, "-")}.inkspark-theme.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTheme = async (file: File): Promise<void> => {
    const theme = parseThemeFile(await file.text());
    if (theme === null) {
      setProblem("That file is not an InkSpark theme.");
      return;
    }
    setProblem("");
    onCustomThemes([...customThemes, theme]);
    choose(theme.id);
  };

  const current = customThemes.find((t) => t.id === value.themeId);

  return (
    <div className="settings" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        ⚙
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Settings">
          <h2>Theme</h2>
          <div className="theme-grid" role="group" aria-label="Theme">
            <button
              type="button"
              className="theme-btn"
              aria-pressed={value.themeId === SYSTEM_THEME_ID}
              onClick={() => {
                choose(SYSTEM_THEME_ID);
              }}
            >
              <span className="swatch" aria-hidden="true">
                ◐
              </span>
              Follow system
            </button>
            {[...PRESET_THEMES, ...customThemes].map((t) => (
              <button
                key={t.id}
                type="button"
                className="theme-btn"
                aria-pressed={value.themeId === t.id}
                onClick={() => {
                  choose(t.id);
                }}
              >
                <Swatch theme={t} />
                {t.name}
              </button>
            ))}
            <button
              type="button"
              className="theme-btn"
              onClick={() => {
                setCreating((v) => !v);
              }}
            >
              <span className="swatch" aria-hidden="true">
                +
              </span>
              New theme
            </button>
          </div>
          {creating && (
            <div className="new-theme">
              <label>
                Name
                <input
                  type="text"
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </label>
              <label>
                Background
                <input
                  type="color"
                  value={bg}
                  onChange={(e) => {
                    setBg(e.target.value);
                  }}
                />
              </label>
              <label>
                Text
                <input
                  type="color"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              </label>
              <label>
                Accent
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => {
                    setAccent(e.target.value);
                  }}
                />
              </label>
              <button type="button" onClick={saveNew}>
                Save theme
              </button>
            </div>
          )}
          <div className="theme-files">
            {current !== undefined && (
              <button
                type="button"
                onClick={() => {
                  exportTheme(current);
                }}
              >
                Export this theme
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                fileInput.current?.click();
              }}
            >
              Import theme
            </button>
            {current !== undefined && (
              <button
                type="button"
                onClick={() => {
                  onCustomThemes(customThemes.filter((t) => t.id !== current.id));
                  choose(SYSTEM_THEME_ID);
                }}
              >
                Delete this theme
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              aria-label="Theme file"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file !== undefined) {
                  void importTheme(file);
                }
              }}
            />
          </div>
          {problem !== "" && <p className="hint">{problem}</p>}
          <h2>Reading look</h2>
          <div className="look-grid" role="group" aria-label="Reading look">
            {LOOKS.map((look) => (
              <button
                key={look}
                type="button"
                className="theme-btn"
                aria-pressed={value.look === look}
                onClick={() => {
                  onChange({ ...value, look, width: LOOK_WIDTH[look] });
                }}
              >
                {LOOK_LABELS[look]}
              </button>
            ))}
          </div>
          <h2>Interface</h2>
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
            Size
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
          <label>
            Editor width
            <select
              value={value.width}
              onChange={(e) => {
                const width = WIDTHS.find((w) => w === e.target.value);
                if (width !== undefined) {
                  onChange({ ...value, width });
                }
              }}
            >
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {WIDTH_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Focus mode: ⌘⇧F. Esc leaves it.</p>
        </div>
      )}
    </div>
  );
}
