import { expect, type Locator, type Page } from "@playwright/test";
import type {
  SampleLang,
  SpikeEditorHandle,
  WritingMode,
  generateText,
  measureInputLatency,
} from "../src/harness";

/** Extra harness functions the page exposes so tests can run them in the browser. */
export interface SpikeApi {
  readonly generateText: typeof generateText;
  readonly measureInputLatency: typeof measureInputLatency;
}

declare global {
  interface Window {
    __spike?: Record<WritingMode, SpikeEditorHandle>;
    __spikeApi?: SpikeApi;
  }
}

export interface EditorSelection {
  from: number;
  to: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const ALL_MODES = [
  "ltr",
  "rtl",
  "vertical-rl",
  "vertical-lr",
] as const satisfies readonly WritingMode[];

export const VERTICAL_MODES = [
  "vertical-rl",
  "vertical-lr",
] as const satisfies readonly WritingMode[];

const IS_MAC = process.platform === "darwin";

export const UNDO = "ControlOrMeta+z";
/** End of document. On macOS the native binding is Cmd+ArrowDown (End only scrolls). */
export const DOC_END = IS_MAC ? "Meta+ArrowDown" : "Control+End";
/**
 * Logical line start/end in an RTL paragraph. On macOS, Home/End scroll the view without moving
 * the caret, so the native Cmd+Arrow bindings are used; they are visual, and in RTL the right edge
 * is the logical start.
 */
export const RTL_LINE_START = IS_MAC ? "Meta+ArrowRight" : "Home";
export const RTL_LINE_END = IS_MAC ? "Meta+ArrowLeft" : "End";

/** ProseMirror history starts a new undo group after 500 ms (`newGroupDelay`). */
const HISTORY_GROUP_DELAY_MS = 500;

/** Loads the spike page and waits until every editor handle and the API are on `window`. */
export async function openSpike(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction((modes) => {
    const spike = window.__spike;
    return spike !== undefined && window.__spikeApi !== undefined && modes.every((m) => m in spike);
  }, ALL_MODES);
  await expect(page.locator('[data-testid^="editor-"]')).toHaveCount(ALL_MODES.length);
}

/** The contenteditable element of the editor for `mode`. */
export function editorContent(page: Page, mode: WritingMode): Locator {
  const host = `[data-testid="editor-${mode}"]`;
  return page.locator(`${host} .ProseMirror, ${host}.ProseMirror`).first();
}

export function getText(page: Page, mode: WritingMode): Promise<string> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    if (h === undefined) throw new Error(`spike handle missing: ${m}`);
    return h.getText();
  }, mode);
}

export function setText(page: Page, mode: WritingMode, text: string): Promise<void> {
  return page.evaluate(
    ([m, t]) => {
      const h = window.__spike?.[m];
      if (h === undefined) throw new Error(`spike handle missing: ${m}`);
      h.setText(t);
    },
    [mode, text] as const,
  );
}

/** Replaces the doc with `generateText(lang, chars, seed)` run in the page; returns the text. */
export function setGeneratedText(
  page: Page,
  mode: WritingMode,
  lang: SampleLang,
  chars: number,
  seed: number,
): Promise<string> {
  return page.evaluate(
    ([m, l, c, s]) => {
      const h = window.__spike?.[m];
      const api = window.__spikeApi;
      if (h === undefined || api === undefined) throw new Error(`spike handle missing: ${m}`);
      const text = api.generateText(l, c, s);
      h.setText(text);
      return text;
    },
    [mode, lang, chars, seed] as const,
  );
}

export function getSelection(page: Page, mode: WritingMode): Promise<EditorSelection> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    if (h === undefined) throw new Error(`spike handle missing: ${m}`);
    const { from, to } = h.getSelection();
    return { from, to };
  }, mode);
}

export function coordsAtPos(page: Page, mode: WritingMode, pos: number): Promise<Rect> {
  return page.evaluate(
    ([m, p]) => {
      const h = window.__spike?.[m];
      if (h === undefined) throw new Error(`spike handle missing: ${m}`);
      const { left, top, right, bottom } = h.coordsAtPos(p);
      return { left, top, right, bottom };
    },
    [mode, pos] as const,
  );
}

/** Number of top-level blocks (paragraphs) in the doc. */
export function paragraphCount(page: Page, mode: WritingMode): Promise<number> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    if (h === undefined) throw new Error(`spike handle missing: ${m}`);
    return h.editor.state.doc.childCount;
  }, mode);
}

/** The last caret position in the doc (end of the last paragraph). */
export function docEndPos(page: Page, mode: WritingMode): Promise<number> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    if (h === undefined) throw new Error(`spike handle missing: ${m}`);
    return h.editor.state.doc.content.size - 1;
  }, mode);
}

/** Focuses the editor by clicking its contenteditable, then puts a collapsed caret at `pos`. */
export async function placeCaret(page: Page, mode: WritingMode, pos: number): Promise<void> {
  await editorContent(page, mode).click();
  await page.evaluate(
    ([m, p]) => {
      const h = window.__spike?.[m];
      if (h === undefined) throw new Error(`spike handle missing: ${m}`);
      h.editor.commands.setTextSelection(p);
      h.editor.view.focus();
    },
    [mode, pos] as const,
  );
  await expect.poll(() => getSelection(page, mode)).toEqual({ from: pos, to: pos });
}

/** Dispatches a paste event carrying `text` as text/plain on the editor's contenteditable. */
export function pasteText(page: Page, mode: WritingMode, text: string): Promise<void> {
  return page.evaluate(
    ([m, t]) => {
      const h = window.__spike?.[m];
      if (h === undefined) throw new Error(`spike handle missing: ${m}`);
      const data = new DataTransfer();
      data.setData("text/plain", t);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      h.editor.view.dom.dispatchEvent(event);
    },
    [mode, text] as const,
  );
}

/** Waits for `count` animation frames in the page. */
export async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }, count);
}

/** Waits long enough that the next edit starts a new undo group. */
export async function settleHistory(page: Page): Promise<void> {
  await page.waitForTimeout(HISTORY_GROUP_DELAY_MS + 100);
}
