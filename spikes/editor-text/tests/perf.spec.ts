import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SampleLang, WritingMode } from "../src/harness";
import { ALL_MODES, openSpike } from "./helpers";

const DOC_CHARS = 50_000;
const SAMPLES = 200;
const SEED = 1;
/** M0 §4.3: p95 input latency must be <= 16 ms in all modes. Recorded, not asserted. */
const THRESHOLD_MS = 16;

const LANG: Record<WritingMode, SampleLang> = {
  ltr: "en",
  rtl: "he",
  "vertical-rl": "ja",
  "vertical-lr": "ja",
};

interface Metric {
  value: number;
  unit: "ms";
  threshold: number;
  comparator: "<=";
  pass: boolean;
}

/** M0 §3.9 shared spike result format. */
interface SpikeResults {
  schemaVersion: 1;
  spike: "editor-text";
  os: string;
  arch: string;
  commit: string;
  timestamp: string;
  engine: string;
  metrics: Record<string, Metric>;
  notes: string[];
}

const metrics: Record<string, Metric> = {};
const notes: string[] = [];

function metric(value: number): Metric {
  return {
    value,
    unit: "ms",
    threshold: THRESHOLD_MS,
    comparator: "<=",
    pass: value <= THRESHOLD_MS,
  };
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

function archLabel(): string {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x86_64";
  return process.arch;
}

// Keep every measurement in one worker so afterAll sees all of them.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await openSpike(page);
});

for (const mode of ALL_MODES) {
  test(`input latency, ${mode}, 50,000-character doc`, async ({ page }) => {
    test.setTimeout(180_000);
    const result = await page.evaluate(
      async ([m, lang, chars, samples, seed]) => {
        const h = window.__spike?.[m];
        const api = window.__spikeApi;
        if (h === undefined || api === undefined) throw new Error(`spike handle missing: ${m}`);
        h.setText(api.generateText(lang, chars, seed));
        const before = h.getText().length;
        h.editor.commands.setTextSelection(h.editor.state.doc.content.size - 1);
        h.editor.view.focus();
        const latency = await api.measureInputLatency(h, samples);
        return { ...latency, before, after: h.getText().length };
      },
      [mode, LANG[mode], DOC_CHARS, SAMPLES, SEED] as const,
    );

    metrics[`inputLatency.${mode}.p50`] = metric(result.p50);
    metrics[`inputLatency.${mode}.p95`] = metric(result.p95);
    notes.push(
      `${mode}: generateText("${LANG[mode]}", ${String(DOC_CHARS)}, ${String(SEED)}) gave ${String(result.before)} chars; ${String(SAMPLES)} samples`,
    );

    expect(Number.isFinite(result.p50)).toBe(true);
    expect(Number.isFinite(result.p95)).toBe(true);
    expect(result.p50).toBeGreaterThanOrEqual(0);
    expect(result.p95).toBeGreaterThanOrEqual(result.p50);
    expect(result.before).toBeGreaterThan(0);
    expect(result.after - result.before).toBe(SAMPLES);
  });
}

test.afterAll(({ browser, browserName }, testInfo) => {
  const os = process.env.RUNNER_OS_LABEL ?? process.platform;
  const missing = ALL_MODES.filter((m) => !(`inputLatency.${m}.p95` in metrics));
  const results: SpikeResults = {
    schemaVersion: 1,
    spike: "editor-text",
    os,
    arch: archLabel(),
    commit: commitSha(),
    timestamp: new Date().toISOString(),
    engine: `${browserName} ${browser.version()}`,
    metrics,
    notes: [
      "Thresholds are recorded, not asserted (M0 §3.8). The p95 metrics decide (M0 §4.3).",
      ...notes,
      ...missing.map((m) => `${m}: no measurement (test failed)`),
    ],
  };
  const spikeRoot =
    testInfo.config.configFile === undefined ? process.cwd() : dirname(testInfo.config.configFile);
  const dir = join(spikeRoot, "results");
  mkdirSync(dir, { recursive: true });
  // One file per engine so the chromium and webkit projects never overwrite each other.
  writeFileSync(join(dir, `${os}-${browserName}.json`), `${JSON.stringify(results, null, 2)}\n`);
});
