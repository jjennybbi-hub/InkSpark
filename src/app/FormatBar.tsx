import { type Editor, useEditorState } from "@tiptap/react";
import { type JSX, type ReactNode, useState } from "react";

const FONT_FAMILIES: readonly { label: string; value: string }[] = [
  { label: "Page font", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans", value: "system-ui, -apple-system, Helvetica, Arial, sans-serif" },
  { label: "Mono", value: "ui-monospace, Menlo, Consolas, monospace" },
];
const SIZES = ["12", "14", "16", "18", "20", "24", "28", "32", "40"];

interface BtnProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function Btn({ label, active, disabled, onClick, children }: BtnProps): JSX.Element {
  // The wrapper carries the tooltip, so it still shows while the button is disabled.
  return (
    <span className="fmt-tip-target" data-tip={label}>
      <button
        type="button"
        className="fmt-btn"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={onClick}
      >
        {children}
      </button>
    </span>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function UndoIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function RedoIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}

interface Tip {
  text: string;
  x: number;
  y: number;
}

/** Text formatting only. App appearance lives in the settings popover. */
export function FormatBar({ editor }: { editor: Editor | null }): JSX.Element {
  const [tip, setTip] = useState<Tip | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const attrs = (e?.getAttributes("textStyle") ?? {}) as Record<string, unknown>;
      return {
        bold: e?.isActive("bold") ?? false,
        italic: e?.isActive("italic") ?? false,
        underline: e?.isActive("underline") ?? false,
        strike: e?.isActive("strike") ?? false,
        h1: e?.isActive("heading", { level: 1 }) ?? false,
        h2: e?.isActive("heading", { level: 2 }) ?? false,
        h3: e?.isActive("heading", { level: 3 }) ?? false,
        bullet: e?.isActive("bulletList") ?? false,
        ordered: e?.isActive("orderedList") ?? false,
        quote: e?.isActive("blockquote") ?? false,
        left: e?.isActive({ textAlign: "left" }) ?? false,
        center: e?.isActive({ textAlign: "center" }) ?? false,
        right: e?.isActive({ textAlign: "right" }) ?? false,
        canUndo: e?.can().undo() ?? false,
        canRedo: e?.can().redo() ?? false,
        family: typeof attrs.fontFamily === "string" ? attrs.fontFamily : "",
        size: typeof attrs.fontSize === "string" ? attrs.fontSize.replace("px", "") : "",
        color: typeof attrs.color === "string" ? attrs.color : "",
      };
    },
  });
  const s = state ?? {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    h1: false,
    h2: false,
    h3: false,
    bullet: false,
    ordered: false,
    quote: false,
    left: false,
    center: false,
    right: false,
    canUndo: false,
    canRedo: false,
    family: "",
    size: "",
    color: "",
  };
  const chain = (): ReturnType<Editor["chain"]> | null => editor?.chain().focus() ?? null;
  const heading = s.h1 ? "1" : s.h2 ? "2" : s.h3 ? "3" : "0";
  const off = editor === null;

  return (
    <div
      className="format-bar"
      role="toolbar"
      aria-label="Text formatting"
      onPointerOver={(e) => {
        const target = (e.target as Element).closest("[data-tip]");
        const text = target?.getAttribute("data-tip") ?? "";
        if (target === null || text === "") {
          setTip(null);
          return;
        }
        const box = target.getBoundingClientRect();
        setTip({ text, x: box.left + box.width / 2, y: box.bottom + 6 });
      }}
      onPointerLeave={() => {
        setTip(null);
      }}
    >
      <Btn label="Undo (⌘Z)" disabled={off || !s.canUndo} onClick={() => chain()?.undo().run()}>
        <UndoIcon />
      </Btn>
      <Btn label="Redo (⌘⇧Z)" disabled={off || !s.canRedo} onClick={() => chain()?.redo().run()}>
        <RedoIcon />
      </Btn>
      <span className="fmt-sep" aria-hidden="true" />
      <select
        aria-label="Heading level"
        data-tip="Heading level"
        value={heading}
        disabled={off}
        onChange={(e) => {
          const level = Number(e.target.value);
          if (level === 1 || level === 2 || level === 3) {
            chain()?.setHeading({ level }).run();
          } else {
            chain()?.setParagraph().run();
          }
        }}
      >
        <option value="0">Text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <select
        aria-label="Font family"
        data-tip="Font family"
        value={s.family}
        disabled={off}
        onChange={(e) => {
          if (e.target.value === "") {
            chain()?.unsetFontFamily().run();
          } else {
            chain()?.setFontFamily(e.target.value).run();
          }
        }}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
        {s.family !== "" && !FONT_FAMILIES.some((f) => f.value === s.family) && (
          <option value={s.family}>Custom</option>
        )}
      </select>
      <select
        aria-label="Font size"
        data-tip="Font size"
        value={s.size}
        disabled={off}
        onChange={(e) => {
          if (e.target.value === "") {
            chain()?.unsetFontSize().run();
          } else {
            chain()?.setFontSize(`${e.target.value}px`).run();
          }
        }}
      >
        <option value="">Size</option>
        {SIZES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
        {s.size !== "" && !SIZES.includes(s.size) && <option value={s.size}>{s.size}</option>}
      </select>
      <span className="fmt-sep" aria-hidden="true" />
      <Btn
        label="Bold (⌘B)"
        active={s.bold}
        disabled={off}
        onClick={() => chain()?.toggleBold().run()}
      >
        <b>B</b>
      </Btn>
      <Btn
        label="Italic (⌘I)"
        active={s.italic}
        disabled={off}
        onClick={() => chain()?.toggleItalic().run()}
      >
        <i>I</i>
      </Btn>
      <Btn
        label="Underline (⌘U)"
        active={s.underline}
        disabled={off}
        onClick={() => chain()?.toggleUnderline().run()}
      >
        <u>U</u>
      </Btn>
      <Btn
        label="Strikethrough"
        active={s.strike}
        disabled={off}
        onClick={() => chain()?.toggleStrike().run()}
      >
        <s>S</s>
      </Btn>
      <label className="fmt-color" data-tip="Text color">
        <span aria-hidden="true">A</span>
        <input
          type="color"
          aria-label="Text color"
          value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#000000"}
          disabled={off}
          onChange={(e) => chain()?.setColor(e.target.value).run()}
        />
      </label>
      <label className="fmt-color" data-tip="Highlight color">
        <span aria-hidden="true">▮</span>
        <input
          type="color"
          aria-label="Highlight color"
          defaultValue="#fff176"
          disabled={off}
          onChange={(e) => chain()?.setHighlight({ color: e.target.value }).run()}
        />
      </label>
      <Btn
        label="Clear text color and highlight"
        disabled={off}
        onClick={() => chain()?.unsetColor().unsetHighlight().run()}
      >
        ⌫
      </Btn>
      <span className="fmt-sep" aria-hidden="true" />
      <Btn
        label="Bulleted list"
        active={s.bullet}
        disabled={off}
        onClick={() => chain()?.toggleBulletList().run()}
      >
        •≡
      </Btn>
      <Btn
        label="Numbered list"
        active={s.ordered}
        disabled={off}
        onClick={() => chain()?.toggleOrderedList().run()}
      >
        1.
      </Btn>
      <Btn
        label="Quote"
        active={s.quote}
        disabled={off}
        onClick={() => chain()?.toggleBlockquote().run()}
      >
        ❝
      </Btn>
      <span className="fmt-sep" aria-hidden="true" />
      <Btn
        label="Align left"
        active={s.left}
        disabled={off}
        onClick={() => chain()?.setTextAlign("left").run()}
      >
        ⇤
      </Btn>
      <Btn
        label="Align center"
        active={s.center}
        disabled={off}
        onClick={() => chain()?.setTextAlign("center").run()}
      >
        ↔
      </Btn>
      <Btn
        label="Align right"
        active={s.right}
        disabled={off}
        onClick={() => chain()?.setTextAlign("right").run()}
      >
        ⇥
      </Btn>
      {tip !== null && (
        <span className="fmt-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>
      )}
    </div>
  );
}
