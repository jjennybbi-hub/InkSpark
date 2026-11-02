import type { ConsoleMessage, Page } from "@playwright/test";
import { makeFixtureEpub, type FixtureOptions } from "../fixtures/make-epub";
import type { openBook, ReaderHandle, ReaderLocation } from "../src/harness";

export interface ReaderApi {
  openBook: typeof openBook;
}

declare global {
  interface Window {
    /** Set by src/main.ts. */
    __reader?: ReaderApi | undefined;
    /** Set by the tests: the handle of the currently open book. */
    __handle?: ReaderHandle | undefined;
    /** Set by the init script in `trackPageProblems`. */
    __cspViolations?: string[] | undefined;
  }
}

export interface PageProblems {
  cspViolations: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

/** Installs listeners before any page script runs. Call before `page.goto`. */
export async function trackPageProblems(page: Page): Promise<PageProblems> {
  const problems: PageProblems = { cspViolations: [], consoleErrors: [], pageErrors: [] };

  await page.exposeFunction("__inksparkReportCspViolation", (description: string) => {
    problems.cspViolations.push(description);
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      const description = `${event.violatedDirective} blocked ${event.blockedURI}`;
      window.__cspViolations?.push(description);
      const report = (window as unknown as Record<string, unknown>).__inksparkReportCspViolation;
      if (typeof report === "function") {
        void (report as (d: string) => Promise<void>)(description);
      }
    });
  });

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      problems.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error: Error) => {
    problems.pageErrors.push(error.message);
  });
  return problems;
}

/** Violations recorded by the init script in every frame that is still attached. */
export async function frameCspViolations(page: Page): Promise<string[]> {
  const all: string[] = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const found = await frame.evaluate(() => window.__cspViolations ?? []);
      all.push(...found);
    } catch {
      // A frame navigating away between listing and evaluation has nothing to report.
    }
  }
  return all;
}

export async function gotoReader(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__reader !== undefined);
  await page.locator("#reader").waitFor({ state: "attached" });
}

export function fixtureBytes(opts?: FixtureOptions): number[] {
  return Array.from(makeFixtureEpub(opts));
}

export interface OpenResult {
  tocLength: number;
  dir: "ltr" | "rtl";
  openMs: number;
}

/** Opens EPUB bytes in `#reader` and stores the handle on `window.__handle`. */
export async function openInPage(page: Page, bytes: number[]): Promise<OpenResult> {
  return page.evaluate(async (data: number[]) => {
    const reader = window.__reader;
    if (reader === undefined) throw new Error("window.__reader is not defined");
    const container = document.querySelector<HTMLElement>("#reader");
    if (container === null) throw new Error("#reader container is missing");
    window.__handle?.close();
    window.__handle = undefined;
    const input = new Uint8Array(data);
    const start = performance.now();
    const handle = await reader.openBook(container, input);
    const openMs = performance.now() - start;
    window.__handle = handle;
    return { tocLength: handle.toc.length, dir: handle.dir, openMs };
  }, bytes);
}

export async function getLocation(page: Page): Promise<ReaderLocation> {
  return page.evaluate(() => {
    const handle = window.__handle;
    if (handle === undefined) throw new Error("no open book");
    const { fraction, sectionIndex } = handle.getLocation();
    return { fraction, sectionIndex };
  });
}

export async function next(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const handle = window.__handle;
    if (handle === undefined) throw new Error("no open book");
    await handle.next();
  });
}

export async function goToTocItem(page: Page, index: number): Promise<void> {
  await page.evaluate(async (i: number) => {
    const handle = window.__handle;
    if (handle === undefined) throw new Error("no open book");
    await handle.goToTocItem(i);
  }, index);
}

export async function closeBook(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__handle?.close();
    window.__handle = undefined;
  });
}

export interface FrameSummary {
  url: string;
  htmlDir: string | null;
  bodyDir: string | null;
  direction: string;
  writingMode: string;
  imageWidths: number[];
}

/** Summarises every attached content frame (foliate renders sections in iframes). */
export async function contentFrames(page: Page): Promise<FrameSummary[]> {
  const summaries: FrameSummary[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    try {
      const summary = await frame.evaluate(async (): Promise<FrameSummary | null> => {
        const body = document.querySelector("body");
        if (body === null) return null;
        const images = Array.from(document.images);
        await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
        const style = getComputedStyle(body);
        return {
          url: document.URL,
          htmlDir: document.documentElement.getAttribute("dir"),
          bodyDir: body.getAttribute("dir"),
          direction: style.direction,
          writingMode: style.writingMode,
          imageWidths: images.map((img) => img.naturalWidth),
        };
      });
      if (summary !== null) summaries.push(summary);
    } catch {
      // Frames replaced during navigation are skipped; the caller polls.
    }
  }
  return summaries;
}

export function isRtlFrame(frame: FrameSummary): boolean {
  return frame.htmlDir === "rtl" || frame.bodyDir === "rtl";
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}
