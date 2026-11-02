import { expect, test } from "@playwright/test";
import {
  UNDO,
  getSelection,
  getText,
  openSpike,
  paragraphCount,
  pasteText,
  placeCaret,
  setText,
  settleHistory,
} from "./helpers";

const MODE = "ltr";

test.beforeEach(async ({ page }) => {
  await openSpike(page);
});

test.describe("ltr baseline", () => {
  test("typing puts the text in the doc", async ({ page }) => {
    await setText(page, MODE, "");
    await placeCaret(page, MODE, 1);
    await page.keyboard.type("Hello world");
    await expect.poll(() => getText(page, MODE)).toBe("Hello world");
  });

  test("Ctrl/Cmd+Z undoes typing", async ({ page }) => {
    await setText(page, MODE, "Base");
    await settleHistory(page);
    await placeCaret(page, MODE, 5);
    await page.keyboard.type(" typed");
    await expect.poll(() => getText(page, MODE)).toBe("Base typed");
    await page.keyboard.press(UNDO);
    await expect.poll(() => getText(page, MODE)).toBe("Base");
  });

  test("Shift+ArrowLeft x5 selects 5 characters", async ({ page }) => {
    await setText(page, MODE, "Hello world");
    await placeCaret(page, MODE, 12);
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await expect.poll(() => getSelection(page, MODE)).toEqual({ from: 7, to: 12 });
  });

  test("Enter creates a second paragraph", async ({ page }) => {
    await setText(page, MODE, "Hello world");
    await placeCaret(page, MODE, 6);
    await page.keyboard.press("Enter");
    await expect.poll(() => paragraphCount(page, MODE)).toBe(2);
    expect(await getText(page, MODE)).toBe("Hello\n\n world");
  });

  test("pasting via a clipboard event inserts the text at the caret", async ({ page }) => {
    await setText(page, MODE, "Hello world");
    await placeCaret(page, MODE, 6);
    await pasteText(page, MODE, "-there");
    await expect.poll(() => getText(page, MODE)).toBe("Hello-there world");
  });
});
