import { expect, test } from "@playwright/test";
import {
  RTL_LINE_END,
  RTL_LINE_START,
  getSelection,
  getText,
  openSpike,
  placeCaret,
  setText,
} from "./helpers";

const MODE = "rtl";

interface RtlSample {
  readonly lang: string;
  /** A short single-line paragraph. */
  readonly line: string;
  /** Text typed into an empty doc: an RTL run, an LTR number run, then RTL again. */
  readonly mixed: string;
  /** Characters typed at the caret. */
  readonly insert: string;
}

const SAMPLES: readonly RtlSample[] = [
  { lang: "he", line: "שלום עולם", mixed: "מחיר 2024 שקלים", insert: "אב" },
  { lang: "ar", line: "مرحبا بالعالم", mixed: "السعر 2024 ريال", insert: "يب" },
];

test.beforeEach(async ({ page }) => {
  await openSpike(page);
});

for (const sample of SAMPLES) {
  test.describe(`rtl (${sample.lang})`, () => {
    test("typing inserts at the caret", async ({ page }) => {
      await setText(page, MODE, sample.line);
      await placeCaret(page, MODE, 1 + 4);
      await page.keyboard.type(sample.insert);
      const expected = sample.line.slice(0, 4) + sample.insert + sample.line.slice(4);
      await expect.poll(() => getText(page, MODE)).toBe(expected);
      const caret = 1 + 4 + sample.insert.length;
      await expect.poll(() => getSelection(page, MODE)).toEqual({ from: caret, to: caret });
    });

    test("ArrowLeft moves the logical position forward by 1", async ({ page }) => {
      await setText(page, MODE, sample.line);
      await placeCaret(page, MODE, 3);
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => getSelection(page, MODE)).toEqual({ from: 4, to: 4 });
    });

    test("line start and end keys reach the line edges", async ({ page }) => {
      await setText(page, MODE, sample.line);
      const end = 1 + sample.line.length;
      await placeCaret(page, MODE, 4);
      await page.keyboard.press(RTL_LINE_END);
      await expect.poll(() => getSelection(page, MODE)).toEqual({ from: end, to: end });
      await page.keyboard.press(RTL_LINE_START);
      await expect.poll(() => getSelection(page, MODE)).toEqual({ from: 1, to: 1 });
    });

    test("a mixed LTR number run keeps its logical order", async ({ page }) => {
      await setText(page, MODE, "");
      await placeCaret(page, MODE, 1);
      await page.keyboard.type(sample.mixed);
      await expect.poll(() => getText(page, MODE)).toBe(sample.mixed);
    });
  });
}
