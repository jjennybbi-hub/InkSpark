import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  closeBook,
  fixtureBytes,
  goToTocItem,
  gotoReader,
  median,
  openInPage,
  percentile,
} from "./helpers";

// Thresholds from docs/milestones/M0.md §5.2. They are recorded in the results file, not asserted.
const DEFAULT_OPEN_MAX_MS = 1500;
const LARGE_OPEN_MAX_MS = 3000;
const PAGE_TURN_P95_MAX_MS = 150;
const OPEN_RUNS = 3;
const PAGE_TURNS = 50;

interface Metric {
  value: number;
  unit: string;
  threshold: number;
  comparator: "<=";
  pass: boolean;
}

const metrics: Record<string, Metric> = {};
const notes: string[] = [];

function record(name: string, value: number, unit: string, threshold: number): void {
  metrics[name] = {
    value: Math.round(value * 100) / 100,
    unit,
    threshold,
    comparator: "<=",
    pass: Number.isFinite(value) && value <= threshold,
  };
}

function osLabel(): string {
  const fromEnv = process.env.SPIKE_OS;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return process.platform;
  }
}

function archLabel(): string {
  switch (process.arch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    default:
      return process.arch;
  }
}

function commitSha(): string {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const DEFAULT_FIXTURE = fixtureBytes();
const LARGE_FIXTURE = fixtureBytes({ chapters: 100, wordsPerChapter: 3000 });

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await gotoReader(page);
});

test("open time: default fixture", async ({ page }) => {
  const times: number[] = [];
  for (let run = 0; run < OPEN_RUNS; run += 1) {
    const opened = await openInPage(page, DEFAULT_FIXTURE);
    expect(opened.tocLength).toBe(5);
    times.push(opened.openMs);
    await closeBook(page);
  }
  record("openDefaultMs", median(times), "ms", DEFAULT_OPEN_MAX_MS);
});

test("open time: large fixture (100 chapters x 3,000 words)", async ({ page }) => {
  test.setTimeout(180_000);
  const times: number[] = [];
  for (let run = 0; run < OPEN_RUNS; run += 1) {
    const opened = await openInPage(page, LARGE_FIXTURE);
    expect(opened.tocLength).toBe(100);
    times.push(opened.openMs);
    await closeBook(page);
  }
  record("openLargeMs", median(times), "ms", LARGE_OPEN_MAX_MS);
});

test("page turn p95 over 50 turns", async ({ page }) => {
  test.setTimeout(180_000);
  await openInPage(page, LARGE_FIXTURE);
  await goToTocItem(page, 0);
  const turns = await page.evaluate(async (count: number) => {
    const handle = window.__handle;
    if (handle === undefined) throw new Error("no open book");
    const durations: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = performance.now();
      await handle.next();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      durations.push(performance.now() - start);
    }
    return durations;
  }, PAGE_TURNS);
  expect(turns).toHaveLength(PAGE_TURNS);
  record("pageTurnP95Ms", percentile(turns, 95), "ms", PAGE_TURN_P95_MAX_MS);
  notes.push(
    `page turn p50: ${percentile(turns, 50).toFixed(1)} ms over ${String(PAGE_TURNS)} turns`,
  );
});

test.afterAll(({ browser, browserName }) => {
  const os = osLabel();
  if (browserName !== "webkit") {
    notes.push(`${browserName} run: a sanity check only; WebKit decides (M0.md §5.2).`);
  }
  notes.push("Playwright WebKit is not identical to WKWebView/WebKitGTK (M0.md R4).");
  const results = {
    schemaVersion: 1,
    spike: "foliate-view",
    os,
    arch: archLabel(),
    commit: commitSha(),
    timestamp: new Date().toISOString(),
    engine: `${browserName} ${browser.version()}`,
    metrics,
    notes,
  };
  const dir = path.resolve(import.meta.dirname, "../results");
  mkdirSync(dir, { recursive: true });
  // One file per OS and browser project, so chromium and webkit runs do not overwrite each other.
  const file = path.join(dir, `${os}-${browserName}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`, "utf8");
});
