import { Editor, type JSONContent } from "@tiptap/core";
import type { DocxBlock, DocxDocument, DocxRun } from "../contracts";
import type { Appearance } from "./appearance";
import { editorExtensions } from "./editorExtensions";

/** CSS pixels to Word's half-points: 1px is 0.75pt. */
function halfPoints(px: number): number {
  return Math.round(px * 1.5);
}

function sizeOf(value: unknown): number | null {
  const match = typeof value === "string" ? /^([\d.]+)px$/.exec(value.trim()) : null;
  return match?.[1] === undefined ? null : halfPoints(Number(match[1]));
}

function fontOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // System font keywords mean nothing to Word, so use the first real font name in the list.
  const first = value
    .split(",")
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .find((name) => name !== "" && !/^(system-ui|-apple-system|ui-)/.test(name));
  return first ?? null;
}

/** Returns six hex digits for #rgb, #rrggbb or rgb(), and null for anything else. */
export function hexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const v = value.trim();
  if (/^#[\da-f]{6}$/i.test(v)) {
    return v.slice(1).toUpperCase();
  }
  if (/^#[\da-f]{3}$/i.test(v)) {
    return v.slice(1).replace(/./g, "$&$&").toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb === null) {
    return null;
  }
  return rgb
    .slice(1, 4)
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function toRuns(nodes: readonly JSONContent[] | undefined): DocxRun[] {
  const runs: DocxRun[] = [];
  for (const node of nodes ?? []) {
    const run: DocxRun = {
      text: node.type === "hardBreak" ? "\n" : (node.text ?? ""),
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      font: null,
      halfPoints: null,
      color: null,
      highlight: null,
    };
    let href: unknown = null;
    for (const mark of node.marks ?? []) {
      const attrs = mark.attrs ?? {};
      if (mark.type === "bold") run.bold = true;
      if (mark.type === "italic") run.italic = true;
      if (mark.type === "underline") run.underline = true;
      if (mark.type === "strike") run.strike = true;
      if (mark.type === "code") run.code = true;
      if (mark.type === "link") href = attrs.href;
      if (mark.type === "highlight") run.highlight = hexColor(attrs.color ?? "#ffff00");
      if (mark.type === "textStyle") {
        run.font = fontOf(attrs.fontFamily);
        run.halfPoints = sizeOf(attrs.fontSize);
        run.color = hexColor(attrs.color);
      }
    }
    runs.push(run);
    // A Word link needs more plumbing; keeping the address beside the words loses nothing.
    if (typeof href === "string" && href !== "") {
      runs.push({ ...run, text: ` (${href})` });
    }
  }
  return runs;
}

const PLAIN: DocxBlock = {
  heading: 0,
  align: null,
  list: null,
  quote: false,
  code: false,
  rule: false,
  pageBreak: false,
  runs: [],
};

function alignOf(node: JSONContent): string | null {
  const align: unknown = node.attrs?.textAlign;
  return typeof align === "string" && align !== "left" ? align : null;
}

function blocksOf(root: JSONContent): DocxBlock[] {
  const out: DocxBlock[] = [];
  let nextList = 0;
  const walk = (nodes: readonly JSONContent[] | undefined, base: DocxBlock, level: number) => {
    let inherited = base;
    for (const node of nodes ?? []) {
      switch (node.type) {
        case "paragraph":
          out.push({ ...inherited, align: alignOf(node), runs: toRuns(node.content) });
          break;
        case "heading":
          out.push({
            ...inherited,
            heading: Number(node.attrs?.level ?? 1),
            align: alignOf(node),
            runs: toRuns(node.content),
          });
          break;
        case "codeBlock":
          out.push({ ...inherited, code: true, runs: toRuns(node.content) });
          break;
        case "horizontalRule":
          out.push({ ...inherited, rule: true });
          break;
        case "blockquote":
          walk(node.content, { ...inherited, quote: true }, level);
          break;
        case "bulletList":
        case "orderedList": {
          const list = { id: nextList, ordered: node.type === "orderedList", level };
          nextList += 1;
          for (const item of node.content ?? []) {
            walk(item.content, { ...inherited, list }, level + 1);
          }
          break;
        }
        default:
          break;
      }
      // Only the first paragraph of a list item carries its bullet or number.
      if (node.type !== "bulletList" && node.type !== "orderedList" && inherited.list !== null) {
        inherited = { ...inherited, list: null };
      }
    }
  };
  walk(root.content, PLAIN, 0);
  return out;
}

/** Reads saved page text with the editor's own rules, so Word shows what the writer sees. */
export function pageToBlocks(markdown: string): DocxBlock[] {
  const editor = new Editor({ extensions: editorExtensions(), content: markdown });
  try {
    return blocksOf(editor.getJSON());
  } finally {
    editor.destroy();
  }
}

function isBlank(page: string): boolean {
  return page.trim() === "";
}

/** One Word document from any number of pages; each later page starts on a new sheet. */
export function buildDocx(pages: readonly string[], look: Appearance): DocxDocument {
  const blocks = pages
    .filter((p) => !isBlank(p))
    .flatMap((page, index) =>
      pageToBlocks(page).map((block, i) =>
        i === 0 && index > 0 ? { ...block, pageBreak: true } : block,
      ),
    );
  return { font: fontOf(look.textFont) ?? "Arial", halfPoints: halfPoints(look.size), blocks };
}

/** One Markdown text from any number of pages, separated by a horizontal line. */
export function buildMarkdown(pages: readonly string[]): string {
  const text = pages
    .filter((p) => !isBlank(p))
    .map((p) => p.trim())
    .join("\n\n---\n\n");
  return `${text}\n`;
}

/** A suggested file name: the characters file systems reject are dropped. */
export function fileNameFrom(title: string): string {
  const clean = title.replace(/[/\\:*?"<>|]/g, "").trim();
  return clean === "" ? "Untitled" : clean;
}
