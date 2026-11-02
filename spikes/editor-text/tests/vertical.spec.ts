import { expect, test, type Page } from "@playwright/test";
import type { WritingMode } from "../src/harness";
import {
  DOC_END,
  UNDO,
  VERTICAL_MODES,
  coordsAtPos,
  docEndPos,
  editorContent,
  getSelection,
  getText,
  nextFrames,
  openSpike,
  paragraphCount,
  placeCaret,
  setGeneratedText,
  setText,
  settleHistory,
} from "./helpers";

/** Ten characters: fits in one vertical line. */
const LINE_TEXT = "あいうえおかきくけこ";
/** 200 characters in one paragraph: wraps over several vertical lines but fits in the viewport. */
const COLUMN_TEXT = "あいうえおかきくけこさしすせそたちつてと".repeat(10);
const CLICK_SAMPLES = 20;
const CLICK_SEED = 20_260_001;
const LONG_DOC_CHARS = 20_000;
const LONG_DOC_SEED = 7;

/** Deterministic distinct positions in [1, maxPos]. */
function samplePositions(count: number, maxPos: number, seed: number): number[] {
  const out = new Set<number>();
  let state = seed >>> 0;
  while (out.size < count) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    out.add(1 + (state % maxPos));
  }
  return [...out];
}

interface CaretVisibility {
  inside: boolean;
  caret: { left: number; top: number; right: number; bottom: number };
  visible: { left: number; top: number; right: number; bottom: number };
}

/** Whether the caret rect lies inside the part of the editor host that is in the viewport. */
function caretVisibility(page: Page, mode: WritingMode): Promise<CaretVisibility> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    const host = document.querySelector(`[data-testid="editor-${m}"]`);
    if (h === undefined || host === null) throw new Error(`spike handle missing: ${m}`);
    const { left, top, right, bottom } = h.coordsAtPos(h.getSelection().from);
    const box = host.getBoundingClientRect();
    const visible = {
      left: Math.max(0, box.left),
      top: Math.max(0, box.top),
      right: Math.min(window.innerWidth, box.right),
      bottom: Math.min(window.innerHeight, box.bottom),
    };
    const tolerance = 1;
    const inside =
      left >= visible.left - tolerance &&
      right <= visible.right + tolerance &&
      top >= visible.top - tolerance &&
      bottom <= visible.bottom + tolerance;
    return { inside, caret: { left, top, right, bottom }, visible };
  }, mode);
}

/**
 * The first position of the second vertical line of the doc's first paragraph: the first position
 * whose caret rect jumps back up (lower `top`) relative to the previous position.
 */
function secondLineStart(page: Page, mode: WritingMode): Promise<number> {
  return page.evaluate((m) => {
    const h = window.__spike?.[m];
    if (h === undefined) throw new Error(`spike handle missing: ${m}`);
    const end = h.editor.state.doc.firstChild?.content.size ?? 0;
    let prevTop = h.coordsAtPos(1).top;
    for (let pos = 2; pos <= end; pos += 1) {
      const { top } = h.coordsAtPos(pos);
      if (top < prevTop - 1) return pos;
      prevTop = top;
    }
    throw new Error(`paragraph does not wrap onto a second line in ${m}`);
  }, mode);
}

test.beforeEach(async ({ page }) => {
  await openSpike(page);
});

for (const mode of VERTICAL_MODES) {
  /** The key that moves to the next line: lines advance leftwards in rl and rightwards in lr. */
  const nextLineKey = mode === "vertical-rl" ? "ArrowLeft" : "ArrowRight";
  /** The key that moves to the previous line: the opposite direction. */
  const previousLineKey = mode === "vertical-rl" ? "ArrowRight" : "ArrowLeft";

  test.describe(mode, () => {
    test("Japanese inserted via keyboard.insertText appears in the doc", async ({ page }) => {
      await setText(page, mode, "");
      await placeCaret(page, mode, 1);
      await page.keyboard.insertText("縦書きのテスト");
      await expect.poll(() => getText(page, mode)).toBe("縦書きのテスト");
    });

    test("ArrowDown gives +1 and ArrowUp -1 within a line", async ({ page }) => {
      await setText(page, mode, LINE_TEXT);
      await placeCaret(page, mode, 3);
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => getSelection(page, mode)).toEqual({ from: 4, to: 4 });
      await page.keyboard.press("ArrowUp");
      await expect.poll(() => getSelection(page, mode)).toEqual({ from: 3, to: 3 });
    });

    test(`${nextLineKey} moves to the next line`, async ({ page }) => {
      await setText(page, mode, COLUMN_TEXT);
      await placeCaret(page, mode, 3);
      await page.keyboard.press(nextLineKey);
      await expect
        .poll(async () => (await getSelection(page, mode)).from - 3)
        .toBeGreaterThanOrEqual(1);
    });

    test(`${previousLineKey} moves to the previous line`, async ({ page }) => {
      await setText(page, mode, COLUMN_TEXT);
      const start = (await secondLineStart(page, mode)) + 2;
      await placeCaret(page, mode, start);
      await page.keyboard.press(previousLineKey);
      await expect
        .poll(async () => start - (await getSelection(page, mode)).from)
        .toBeGreaterThanOrEqual(1);
    });

    test("clicking the centre of coordsAtPos(k) puts the caret at k or k+1", async ({ page }) => {
      await setText(page, mode, COLUMN_TEXT);
      await placeCaret(page, mode, 1);
      await editorContent(page, mode).scrollIntoViewIfNeeded();
      const misses: { k: number; from: number; to: number }[] = [];
      for (const k of samplePositions(CLICK_SAMPLES, COLUMN_TEXT.length - 1, CLICK_SEED)) {
        const rect = await coordsAtPos(page, mode, k);
        await page.mouse.click((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        await nextFrames(page);
        const { from, to } = await getSelection(page, mode);
        if (from !== to || (from !== k && from !== k + 1)) misses.push({ k, from, to });
      }
      expect(misses, "positions where the click did not land at k or k+1").toEqual([]);
    });

    test("Shift+ArrowDown selects exactly 1 character", async ({ page }) => {
      await setText(page, mode, LINE_TEXT);
      await placeCaret(page, mode, 3);
      await page.keyboard.press("Shift+ArrowDown");
      await expect.poll(() => getSelection(page, mode)).toEqual({ from: 3, to: 4 });
    });

    test("Backspace deletes 1 character", async ({ page }) => {
      await setText(page, mode, LINE_TEXT);
      await placeCaret(page, mode, 4);
      await page.keyboard.press("Backspace");
      await expect.poll(() => getText(page, mode)).toBe(LINE_TEXT.slice(0, 2) + LINE_TEXT.slice(3));
      await expect.poll(() => getSelection(page, mode)).toEqual({ from: 3, to: 3 });
    });

    test("Enter splits the paragraph", async ({ page }) => {
      await setText(page, mode, LINE_TEXT);
      await placeCaret(page, mode, 4);
      await page.keyboard.press("Enter");
      await expect.poll(() => paragraphCount(page, mode)).toBe(2);
      expect(await getText(page, mode)).toBe(`${LINE_TEXT.slice(0, 3)}\n\n${LINE_TEXT.slice(3)}`);
    });

    test("after a 20,000-character setText and End-of-doc the caret is in the viewport", async ({
      page,
    }) => {
      await setGeneratedText(page, mode, "ja", LONG_DOC_CHARS, LONG_DOC_SEED);
      await placeCaret(page, mode, 1);
      await page.keyboard.press(DOC_END);
      const end = await docEndPos(page, mode);
      await expect.poll(() => getSelection(page, mode)).toEqual({ from: end, to: end });
      await expect.poll(() => caretVisibility(page, mode)).toMatchObject({ inside: true });
    });

    test("undo restores the prior doc", async ({ page }) => {
      await setText(page, mode, LINE_TEXT);
      await settleHistory(page);
      await placeCaret(page, mode, 6);
      await page.keyboard.insertText("追加");
      await expect
        .poll(() => getText(page, mode))
        .toBe(LINE_TEXT.slice(0, 5) + "追加" + LINE_TEXT.slice(5));
      await page.keyboard.press(UNDO);
      await expect.poll(() => getText(page, mode)).toBe(LINE_TEXT);
    });
  });
}
