import { expect, test, type Page } from "@playwright/test";
import {
  closeBook,
  contentFrames,
  fixtureBytes,
  frameCspViolations,
  getLocation,
  goToTocItem,
  gotoReader,
  isRtlFrame,
  next,
  openInPage,
  trackPageProblems,
  type FrameSummary,
  type PageProblems,
} from "./helpers";

const DEFAULT_FIXTURE = fixtureBytes();

let problems: PageProblems = { cspViolations: [], consoleErrors: [], pageErrors: [] };

test.beforeEach(async ({ page }) => {
  problems = await trackPageProblems(page);
  await gotoReader(page);
});

test.afterEach(async ({ page }) => {
  const inFrames = await frameCspViolations(page);
  expect(problems.cspViolations, "securitypolicyviolation events").toEqual([]);
  expect(inFrames, "securitypolicyviolation events recorded in frames").toEqual([]);
  expect(problems.consoleErrors, "console errors").toEqual([]);
  expect(problems.pageErrors, "uncaught page errors").toEqual([]);
});

/** Visits every TOC item and summarises the content frames shown for it. */
async function scanSections(page: Page, tocLength: number): Promise<FrameSummary[][]> {
  const sections: FrameSummary[][] = [];
  for (let i = 0; i < tocLength; i += 1) {
    await goToTocItem(page, i);
    sections.push(await contentFrames(page));
  }
  return sections;
}

function firstIndexWhere(
  sections: readonly FrameSummary[][],
  predicate: (frame: FrameSummary) => boolean,
): number {
  return sections.findIndex((frames) => frames.some(predicate));
}

test("opening the default fixture resolves with 5 TOC items", async ({ page }) => {
  const opened = await openInPage(page, DEFAULT_FIXTURE);
  expect(opened.tocLength).toBe(5);
  expect(["ltr", "rtl"]).toContain(opened.dir);
});

test("next() three times increases the fraction each time", async ({ page }) => {
  await openInPage(page, DEFAULT_FIXTURE);
  let previous = (await getLocation(page)).fraction;
  for (let turn = 0; turn < 3; turn += 1) {
    await next(page);
    await expect
      .poll(async () => (await getLocation(page)).fraction, {
        message: `fraction after next() #${String(turn + 1)}`,
        timeout: 5_000,
      })
      .toBeGreaterThan(previous);
    previous = (await getLocation(page)).fraction;
  }
});

test("goToTocItem(2) moves to section 2", async ({ page }) => {
  await openInPage(page, DEFAULT_FIXTURE);
  await goToTocItem(page, 2);
  await expect.poll(async () => (await getLocation(page)).sectionIndex).toBe(2);
});

test("the RTL chapter renders with dir=rtl and next() still advances", async ({ page }) => {
  const { tocLength } = await openInPage(page, DEFAULT_FIXTURE);
  const sections = await scanSections(page, tocLength);
  const rtlIndex = firstIndexWhere(sections, isRtlFrame);
  expect(rtlIndex, "a section whose iframe document has dir=rtl").toBeGreaterThanOrEqual(0);

  await goToTocItem(page, rtlIndex);
  const before = await getLocation(page);
  await next(page);
  await expect
    .poll(async () => (await getLocation(page)).fraction, { timeout: 5_000 })
    .toBeGreaterThan(before.fraction);
});

test("the vertical chapter's body has writing-mode vertical-rl", async ({ page }) => {
  const { tocLength } = await openInPage(page, DEFAULT_FIXTURE);
  const sections = await scanSections(page, tocLength);
  const verticalIndex = firstIndexWhere(sections, (frame) => frame.writingMode === "vertical-rl");
  expect(
    verticalIndex,
    `computed writing-mode per section: ${JSON.stringify(
      sections.map((frames) => frames.map((frame) => frame.writingMode)),
    )}`,
  ).toBeGreaterThanOrEqual(0);
});

test("the fixture image loads with naturalWidth > 0", async ({ page }) => {
  const { tocLength } = await openInPage(page, DEFAULT_FIXTURE);
  const sections = await scanSections(page, tocLength);
  const widths = sections.flatMap((frames) => frames.flatMap((frame) => frame.imageWidths));
  expect(widths.length, "at least one <img> in the book").toBeGreaterThanOrEqual(1);
  for (const width of widths) {
    expect(width).toBeGreaterThan(0);
  }
});

test("a full tour causes no CSP violations or console errors", async ({ page }) => {
  const { tocLength } = await openInPage(page, DEFAULT_FIXTURE);
  await scanSections(page, tocLength);
  await goToTocItem(page, 0);
  for (let turn = 0; turn < 5; turn += 1) {
    await next(page);
  }
  await closeBook(page);
  // Assertions run in afterEach; also check here so this test names the failure.
  expect(problems.cspViolations).toEqual([]);
  expect(await frameCspViolations(page)).toEqual([]);
  expect(problems.consoleErrors).toEqual([]);
});
