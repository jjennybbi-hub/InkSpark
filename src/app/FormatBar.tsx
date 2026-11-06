import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { type JSX, type ReactNode, useState } from "react";
import { FontPicker } from "./FontPicker";
import { ReadAloud } from "./ReadAloud";
import { DEFAULT_TEXT_FONT, TEXT_FONTS } from "./fonts";

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

function ClearFormatIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="M4 7V4h16v3" />
      <path d="M5 20h6" />
      <path d="M13 4 8 20" />
      <path d="m15 15 5 5" />
      <path d="m20 15-5 5" />
    </svg>
  );
}

function HighlighterIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

interface Tip {
  text: string;
  x: number;
  y: number;
}

/** Text formatting only. App appearance lives in the settings popover. */
export function FormatBar({
  editor,
  textFont = DEFAULT_TEXT_FONT,
  pageKey = null,
}: {
  editor: Editor | null;
  /** The page's font: what text without a font of its own appears in. */
  textFont?: string | undefined;
  /** Reading aloud stops when the page changes. */
  pageKey?: string | null;
}): JSX.Element {
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
        // Browsers may rewrite the quotes in a font name; the menu values use single quotes.
        family: typeof attrs.fontFamily === "string" ? attrs.fontFamily.replace(/"/g, "'") : "",
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
    family: "",
    size: "",
    color: "",
  };
  const chain = (): ReturnType<Editor["chain"]> | null => editor?.chain().focus() ?? null;
  const heading = s.h1 ? "1" : s.h2 ? "2" : s.h3 ? "3" : "0";
  const off = editor === null;

  if (editor === null) {
    return <></>;
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state: st }) => e.isEditable && !st.selection.empty}
    >
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
        <FontPicker
          label="Font family"
          options={TEXT_FONTS}
          value={s.family === "" ? textFont : s.family}
          onChange={(font) => {
            // The page's own font needs no marking, so a later change of it still applies here.
            if (font === textFont) {
              chain()?.unsetFontFamily().run();
            } else {
              chain()?.setFontFamily(font).run();
            }
          }}
        />
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
          <HighlighterIcon />
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
          <ClearFormatIcon />
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
        <span className="fmt-sep" aria-hidden="true" />
        <ReadAloud pageKey={pageKey} />
        {tip !== null && (
          <span className="fmt-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </span>
        )}
      </div>
    </BubbleMenu>
  );
}
