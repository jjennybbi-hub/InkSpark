export interface FontOption {
  label: string;
  value: string;
}

/** Fonts for the writing. A font missing from a computer falls back to the next in its list. */
export const TEXT_FONTS: readonly FontOption[] = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "System sans", value: "system-ui, -apple-system, Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Avenir", value: "Avenir, 'Avenir Next', Helvetica, sans-serif" },
  { label: "Atkinson Hyperlegible", value: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Palatino", value: "Palatino, 'Palatino Linotype', serif" },
  { label: "Baskerville", value: "Baskerville, 'Baskerville Old Face', serif" },
  { label: "Garamond", value: "Garamond, 'EB Garamond', serif" },
  { label: "Menlo", value: "ui-monospace, Menlo, Consolas, monospace" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

export const DEFAULT_TEXT_FONT = "Arial, Helvetica, sans-serif";

/** Interface font choices, with the same font lists as shell.css. */
export const INTERFACE_FONTS: readonly FontOption[] = [
  {
    label: "Serif",
    value:
      "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
  },
  { label: "Sans", value: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" },
  { label: "Mono", value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  { label: "Atkinson Hyperlegible", value: "'Atkinson Hyperlegible', system-ui, sans-serif" },
];
