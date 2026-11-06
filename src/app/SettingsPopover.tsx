import { save } from "@tauri-apps/plugin-dialog";
import { commands } from "../contracts";
import { type JSX, useEffect, useRef, useState } from "react";
import {
  type Appearance,
  type EditorWidth,
  FONTS,
  LOOKS,
  LOOK_WIDTH,
  type ReadingLook,
  WIDTHS,
  ZOOM_MAX,
  ZOOM_MIN,
  resolveTheme,
} from "./appearance";
import { FontPicker } from "./FontPicker";
import { DownloadIcon, ImportIcon, pickAndImportFont, useCustomFonts } from "./customFonts";
import { INTERFACE_FONTS } from "./fonts";
import {
  PRESET_THEMES,
  THEME_GROUPS,
  SYSTEM_THEME_ID,
  type ThemeDef,
  makeCustomTheme,
  parseThemeFile,
  isDarkColor,
  themeToFile,
} from "./themes";

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
  project: string;
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
  project,
  customThemes,
  onChange,
  onCustomThemes,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const customFonts = useCustomFonts();
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

  const shown = resolveTheme(value.themeId, customThemes);

  /** Built-in themes stay as they are: the first change makes an editable copy. */
  const editTheme = (change: Partial<Pick<ThemeDef, "name" | "bg" | "text" | "accent">>): void => {
    const edited = { ...shown, ...change };
    edited.dark = isDarkColor(edited.bg);
    if (customThemes.some((t) => t.id === shown.id)) {
      onCustomThemes(customThemes.map((t) => (t.id === shown.id ? edited : t)));
      return;
    }
    const copy = makeCustomTheme(`My ${shown.name}`, edited.bg, edited.text, edited.accent);
    onCustomThemes([...customThemes, copy]);
    choose(copy.id);
  };

  const downloadTheme = async (): Promise<void> => {
    try {
      const dest = await save({
        defaultPath: `${shown.name.replace(/[^\w-]+/g, "-")}.inkspark-theme.json`,
        filters: [{ name: "InkSpark theme", extensions: ["json"] }],
      });
      if (dest === null) {
        return;
      }
      const result = await commands.exportTheme(project, dest, themeToFile(shown));
      setProblem(result.status === "ok" ? "" : "The theme could not be saved there.");
    } catch {
      setProblem("The theme could not be saved there.");
    }
  };

  const importInterfaceFont = async (): Promise<void> => {
    const result = await pickAndImportFont();
    if (result === "failed") {
      setProblem("That file could not be read as a font.");
    } else if (result !== null) {
      setProblem("");
      onChange({ ...value, uiFont: result.value });
    }
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
        title="Settings: theme, zoom, page width and interface font"
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
            {customThemes.map((t) => (
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
                setEditing((v) => !v);
              }}
              aria-expanded={editing}
              title="Customize: change this theme's colours, or import or download a theme"
            >
              <span className="swatch" aria-hidden="true">
                +
              </span>
              Customize
            </button>
          </div>
          {editing && (
            <div className="theme-editor" role="group" aria-label="Customize theme">
              {current !== undefined && (
                <label>
                  Name
                  <input
                    type="text"
                    value={current.name}
                    maxLength={40}
                    onChange={(e) => {
                      editTheme({ name: e.target.value });
                    }}
                  />
                </label>
              )}
              <label>
                Background
                <input
                  type="color"
                  value={shown.bg}
                  onChange={(e) => {
                    editTheme({ bg: e.target.value });
                  }}
                />
              </label>
              <label>
                Text
                <input
                  type="color"
                  value={shown.text}
                  onChange={(e) => {
                    editTheme({ text: e.target.value });
                  }}
                />
              </label>
              <label>
                Accent
                <input
                  type="color"
                  value={shown.accent}
                  onChange={(e) => {
                    editTheme({ accent: e.target.value });
                  }}
                />
              </label>
              <div className="theme-editor-files">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Import theme"
                  title="Import theme: load a theme file"
                  onClick={() => {
                    fileInput.current?.click();
                  }}
                >
                  <ImportIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Download theme"
                  title="Download theme: save this theme as a file"
                  onClick={() => void downloadTheme()}
                >
                  <DownloadIcon />
                </button>
                {current !== undefined && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Delete this theme"
                    title="Delete this theme: go back to following the system"
                    onClick={() => {
                      onCustomThemes(customThemes.filter((t) => t.id !== current.id));
                      choose(SYSTEM_THEME_ID);
                    }}
                  >
                    ×
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
            </div>
          )}
          {THEME_GROUPS.map((group) => (
            <div key={group.name} className="theme-group" role="group" aria-label={group.name}>
              <h3>{group.name}</h3>
              <p className="hint">{group.note}</p>
              <div className="theme-grid">
                {group.ids
                  .flatMap((id) => {
                    const t = PRESET_THEMES.find((p) => p.id === id);
                    return t === undefined ? [] : [t];
                  })
                  .map((t) => (
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
              </div>
            </div>
          ))}
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
          <h2>Page</h2>
          <label>
            Zoom: {value.zoom}%
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              title="Zoom: make the page look bigger on screen. Exports are not affected."
              step={10}
              value={value.zoom}
              onChange={(e) => {
                onChange({ ...value, zoom: Number(e.target.value) });
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
          <h2>Interface</h2>
          <div className="font-field">
            <span>Interface font</span>
            <div className="font-row">
              <FontPicker
                label="Interface font"
                canImport
                options={[...INTERFACE_FONTS, ...customFonts]}
                value={value.uiFont ?? INTERFACE_FONTS[FONTS.indexOf(value.font)]?.value ?? ""}
                onChange={(picked) => {
                  const font = FONTS[INTERFACE_FONTS.findIndex((f) => f.value === picked)];
                  onChange(
                    font === undefined
                      ? { ...value, uiFont: picked }
                      : { ...value, font, uiFont: null },
                  );
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="Import font"
                title="Import font: add a font file and use it"
                onClick={() => void importInterfaceFont()}
              >
                <ImportIcon />
              </button>
            </div>
          </div>
          <p className="hint">Focus mode: ⌘⇧F. Esc leaves it.</p>
        </div>
      )}
    </div>
  );
}
