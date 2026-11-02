# 001 — Vertical and RTL text in TipTap on WebKit

Status: Accepted · Date: 2026-11-02 · Track: M0-B

## Context
PLAN §1 promises writing in any direction: left-to-right, right-to-left (Hebrew, Arabic) and
vertical Japanese/Chinese (`vertical-rl`, plus `vertical-lr` for Mongolian-style layouts). The
editor is TipTap/ProseMirror (PLAN §3) inside a Tauri webview, which is WKWebView on macOS and
WebKitGTK on Linux. ProseMirror relies on the browser for caret movement, hit testing and
selection, and vertical writing is the least-tested path in WebKit's editing code. If a writer
cannot type, move the caret, click, select and undo in vertical text, vertical writing has to
become a preview/export-only feature. This spike decides that before M1 builds the editor
(M0.md §4).

## Hypothesis
TipTap 3 / ProseMirror on WebKit supports `writing-mode: vertical-rl` and `vertical-lr` well
enough for a writer to type, move the caret, select and undo, with the same quality as RTL and
the horizontal baseline.

## Method
- **Page** (`spikes/editor-text`): one Vite page renders four TipTap editors, one per mode
  (`ltr`, `rtl`, `vertical-rl`, `vertical-lr`), with `StarterKit` (which includes the
  ProseMirror history). `applyWritingMode` sets `dir` and inline `writing-mode` on the host,
  plus `text-orientation: mixed` for the vertical modes; the contenteditable inherits them.
- **Hosts** assume the 1280×720 viewport of Playwright's "Desktop Chrome" and "Desktop Safari"
  profiles. The four editors sit in a 2×2 grid of fixed 616×330 px hosts that scroll their own
  content (ltr and rtl on top, vertical-rl and vertical-lr below), so the whole page fits the
  viewport and the window never scrolls; window scroll is not a variable in any test. A vertical
  line is 304 px long, so the 10-character test line stays on one line (checked: one line box) and
  the 200-character paragraph wraps over 11 lines (checked) inside the host. Font 16 px,
  line-height 1.8, system UI fonts with Noto/Hiragino fallbacks. The editor border is `#8a8a82`
  (about 3.5:1 against white). Each editor has a readable label such as "Vertical, right-to-left
  editor".
- **Readiness**: `window.__spike` is set only after `document.fonts.ready`, every editor's
  TipTap `create` event and two animation frames, so no test starts on a page that is still
  loading fonts or reflowing.
- **Text**: `generateText(lang, chars, seed)` builds deterministic EN/JA/AR/HE text from a
  seeded mulberry32 PRNG over fixed word pools, cut to `chars` code units minus trailing
  whitespace, paragraphs separated by `"\n\n"`. The Japanese pool includes Latin and digit
  tokens (`2026年`, `TipTapで`, `WebKit`, `3月の`, `10時に`) so `text-orientation: mixed` is
  exercised in the long vertical docs. `setText` replaces the doc without adding an undo step (it models
  opening a file); typed edits go through the normal history.
- **Tests** (written first by the Test-author, M0.md §4.2): `baseline`, `rtl`, `vertical` (run
  for both vertical modes) and `perf` specs drive real Playwright keyboard and mouse input, plus
  vitest/jsdom unit tests for the harness. On macOS the tests use the native Cmd+Arrow bindings
  for line start/end and end of document.
- **Latency** (`measureInputLatency`, M0.md §4.1 as amended in `50f9d30`): 200 samples on a
  50,000-character doc with the caret at the end. Each sample is the time from just before
  `insertContent("a")` to just after a forced synchronous layout (`coordsAtPos` of the caret, then
  `getBoundingClientRect` of the editor DOM). The harness then awaits one
  `requestAnimationFrame` before the next sample; that wait is not timed. p95 ≤ 16 ms means the
  per-keystroke work fits in one 60 Hz frame. WebKit coarsens `performance.now()` (to about
  1 ms, as a timing-attack mitigation), so WebKit numbers are quantized and sub-millisecond
  differences there are noise.
- **Engines**: Playwright 1.63.0. Local: Chromium 153.0.8010.12 headless, Linux x86_64
  container, Node 22.23. CI (`spikes.yml`, job `spike-editor`): Chromium and WebKit on
  ubuntu-24.04 and macos-15 with `PW_WEBKIT=1`. Results go to
  `spikes/editor-text/results/<os>-<browser>.json` (M0.md §3.9).
- **Commit**: functional results and the latency numbers from the five-run check are from
  `006dc72`; the first amended-latency runs are from `9764091`; the superseded rAF-based latency
  numbers are from `65dc6e4`.
- **CI**: Spikes run 41407643939 on `d75546e` (see Links).
- **Decides**: WebKit on macos-15 (closest to WKWebView). Ubuntu WebKit is a second data point;
  local Chromium is a sanity check only and does not count toward the verdict.

## Criteria and results
Functional tests: ✓ pass, ✗ fail. CI numbers are from the `spike-editor` job of Spikes run
41407643939 on `d75546e`: Playwright WebKit 26.6 and Chromium 153.0.8010.12, on ubuntu-24.04
(x86_64) and macos-15 (aarch64). For vertical rows the cell is `vertical-rl / vertical-lr`. The
Pass column is macos-15 WebKit, which decides (for vertical rows, `vertical-rl` decides).

| Test | Threshold | Chromium local | Chromium ubuntu | Chromium macos | WebKit ubuntu | WebKit macos | Pass |
|---|---|---|---|---|---|---|---|
| ltr: typing inserts | pass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ltr: Ctrl/Cmd+Z undoes typing | pass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ltr: Shift+ArrowLeft ×5 selects 5 | pass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ltr: Enter creates a paragraph | pass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ltr: paste event inserts at caret | pass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rtl he/ar: typing inserts at caret | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| rtl he/ar: ArrowLeft is logical +1 | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| rtl he/ar: line start/end keys | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| rtl he/ar: mixed number run order | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| vertical: insertText Japanese (P0 typing) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| vertical: ArrowDown +1, ArrowUp −1 (P0 arrows) | pass | ✓ / ✓ | ✓ / ✓ | ✗ / ✗ | ✗ / ✗ | ✗ / ✗ | ✗ |
| vertical: next-line arrow (P0 arrows) | pass | ✓ / ✓ | ✓ / ✓ | ✗ / ✓ | ✗ / ✓ | ✗ / ✓ | ✗ |
| vertical: previous-line arrow (P0 arrows) | pass | ✓ / ✓ | ✓ / ✓ | ✗ / ✓ | ✗ / ✓ | ✗ / ✓ | ✗ |
| vertical: click centre of `coordsAtPos(k)`, 20 k (P0 click-to-caret) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✗ (20/20 missed) / ✗ (17/20) | ✗ (19/20 missed) / ✗ (17/20) | ✗ |
| vertical: Shift+ArrowDown selects 1 (P0 selection) | pass | ✓ / ✓ | ✓ / ✓ | ✗ / ✗ | ✗ / ✗ | ✗ / ✗ | ✗ |
| vertical: Backspace deletes 1 (P0) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| vertical: Enter splits (P0) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| vertical: 20,000 chars, end of doc, caret in viewport (P0 caret visible) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✗ / ✗ | ✗ / ✗ | ✗ |
| vertical: undo restores (P0 undo) | pass | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ |
| harness unit tests (vitest, jsdom; 38 tests) | pass | ✓ (Node) | — | — | — | — | ✓ |

Totals (74 Playwright tests per OS, 37 per engine): ubuntu-24.04 64 pass / 10 fail (all WebKit);
macos-15 58 pass / 16 fail (10 WebKit, 6 Chromium). The 10 WebKit failures are the same tests on
both runners: 6 in `vertical-rl`, 4 in `vertical-lr`.

Input latency (amended definition), 50,000-character doc, 200 samples, p50 / p95 in ms. Local
Chromium: the first two runs (`9764091`) give p50 / p95, and the five-run check (`006dc72`) gives
p95 for each run. WebKit values are quantized to 1 ms (see Method).

| Mode | Threshold (p95) | Chromium local | Chromium CI ubuntu / macos | WebKit ubuntu | WebKit macos | Pass |
|---|---|---|---|---|---|---|
| ltr | ≤ 16 | 0.6 / 1.4; 0.7 / 2.1. p95 ×5: 1.9, 1.5, 1.5, 1.1, 1.6 | 0.9 / 1.2; 0.6 / 1.4 | 2 / 4 | 1 / 2 | ✓ |
| rtl | ≤ 16 | 0.8 / 1.7; 0.7 / 2.0. p95 ×5: 1.8, 1.6, 1.7, 1.4, 1.9 | 1.0 / 1.4; 0.9 / 1.8 | 2 / 5 | 1 / 2 | ✓ |
| vertical-rl | ≤ 16 | 0.9 / 2.3; 0.9 / 2.2. p95 ×5: 1.7, 1.4, 1.3, 1.5, 1.9 | 1.2 / 1.6; 0.7 / 1.7 | 3 / 6 | 2 / 2 | ✓ |
| vertical-lr | ≤ 16 | 0.9 / 2.1; 0.9 / 2.6. p95 ×5: 1.8, 1.2, 0.9, 1.0, 1.8 | 1.1 / 1.6; 0.8 / 1.8 | 3 / 5 | 1 / 3 | ✓ |

**What fails, and how.** On WebKit the vertical arrow keys move the caret physically rather than
logically: in `vertical-rl` the next-line and previous-line keys move the wrong way (the tests
got −1 where they expected ≥ +1), and ArrowDown/ArrowUp within a line and Shift+ArrowDown do not
give ±1 (for example, the caret ended at 11 where 4 was expected). Clicking the centre of
`coordsAtPos(k)` lands away from `k` for 17–20 of 20 positions. Every logged miss is 17–21
positions off, about one vertical line (a 304 px line holds about 19 characters at 16 px), so
the click lands on the neighbouring line: ProseMirror's `coordsAtPos` and WebKit's hit testing
disagree in vertical text. After a
20,000-character document and End-of-doc, the caret is not scrolled into the viewport. macOS
Chromium also fails 6 vertical arrow/selection tests (within-line arrows in both modes, next- and
previous-line in `vertical-rl`, Shift+ArrowDown in both modes), so the arrow problem is not
WebKit-only; ubuntu Chromium passes everything.

**Stability.** The Test-author's first full run (before the 2×2 layout and the readiness wait,
with other agents compiling at the same time) had 7 failures: perf vertical-rl and vertical-lr;
vertical-rl insertText, ArrowDown/ArrowUp and next-line; and the 20,000-character caret-visible
test in both modes. Three reruns were green. After the fixes above, `npm run spike:editor` passed
37/37 in 5 consecutive runs, and 37/37 in one more run with a busy loop on each of the 4 CPUs.
CPU load and window scroll are the likely causes; the failures did not reproduce.

**ProseMirror quirk (recorded, not a failure).** In Chromium, `coordsAtPos` at the end of a
paragraph returns a rect shifted 20 px to the right of the rest of its vertical line (in both
vertical modes); the cause was not investigated. No current test samples that position. Check it
again when M1 builds caret UI on `coordsAtPos`.

**Why the definition changed.** M0.md first defined a sample as the time from before
`insertContent("a")` to after the next `requestAnimationFrame` callback. Each sample then started
inside the previous sample's frame callback, so the next callback was one full refresh later: the
metric was floored at the frame interval (16.7 ms at 60 Hz), whatever the editor did, and a
p95 ≤ 16 ms threshold could never pass. Under that definition local Chromium gave (p50 / p95,
two runs, commit `65dc6e4`): ltr 16.7 / 20.5 and 16.7 / 18.1; rtl 16.7 / 21.2 and 16.7 / 19.8;
vertical-rl 16.7 / 20.2 and 16.7 / 26.9; vertical-lr 16.7 / 17.6 and 16.7 / 21.2. The p50 equals
one refresh in every mode, and the p95 is one refresh plus scheduling jitter. Track B reported
this, and the Orchestrator amended §4.1 (`50f9d30`) to time only the editor's synchronous work
plus a forced layout. These old numbers are kept for the record only and do not count toward the
verdict.

## Decision
**No-go for editable vertical writing on WebKit. Go for LTR and RTL.**

The rule below was fixed before the WebKit numbers were known (M0.md §4.3); macos-15 WebKit
decides.

- **Go** if all of:
  - every baseline and RTL test passes on both WebKit runners (ubuntu-24.04 and macos-15);
  - every vertical P0 test passes for `vertical-rl` on macos-15 WebKit: typing, arrows in all
    four directions (arrows: within-line ArrowDown/ArrowUp, next-line and previous-line arrows),
    click-to-caret, Shift-selection, Backspace, Enter, undo, caret visible after end of document;
  - p95 input latency ≤ 16 ms in all modes (amended definition, see Method).
- **Go-with-conditions** if there are at most 3 vertical P0 failures, each fixable by a
  ProseMirror plugin or keymap estimated at ≤ 2 days, listed here with its fix. The
  `verticalWriting` flag then stays off until M8-A.
- **No-go** if there are more failures, or click-to-caret is broken. Vertical writing then
  becomes preview/export-only (EPUB CSS) and PLAN §1's writing-direction line is updated.
- `vertical-lr` results are recorded but do not decide the verdict.

Measured: `vertical-rl` has 6 P0 failures on macos-15 WebKit (within-line arrows, next-line
arrow, previous-line arrow, click-to-caret, Shift+ArrowDown, caret in viewport), and the same 6
on ubuntu WebKit; `vertical-lr` adds 4 more on each runner (within-line arrows, click-to-caret,
Shift+ArrowDown, caret in viewport). That is 10 P0 failures per WebKit runner, and click-to-caret
is broken, so both No-go conditions hold. Typing, Backspace, Enter and undo work in vertical
text; navigation and hit testing do not. All baseline (LTR) and RTL tests pass on every engine
and OS, and p95 input latency passes everywhere (WebKit ≤ 6 ms, Chromium ≤ 1.8 ms), so LTR/RTL
editing is Go.

Local Chromium: all 37 browser tests and all 38 harness unit tests pass in every run; it is a
sanity check that the harness and tests are correct, not evidence for WebKit.

## Consequences
- M1 builds the editor on TipTap 3 for LTR and RTL, with `dir` set on the editor host the same
  way as this harness.
- Per M0.md §4.3, vertical writing becomes preview/export-only: vertical text is shown in
  preview and written to EPUB with CSS `writing-mode`, but is not edited in vertical layout.
  PLAN §1's writing-direction line must be updated to say so.
- The `verticalWriting` flag stays off. M8-A may reopen editable vertical writing only with a
  custom caret/keymap layer (logical arrow mapping, own hit testing, own scroll-into-view) and a
  new spike that passes this ADR's P0 tests on macos-15 WebKit.
- Because macOS Chromium also fails 6 vertical arrow tests, browser-native vertical caret
  movement cannot be relied on in any engine; a future custom layer should not assume Chromium
  behaviour as the reference.
- Vertical PDF is out of scope here: Typst has no vertical layout (see ADR 002).
- No contract changes are needed for M1 from this spike. The spike package is never a
  dependency of `src` or `src-tauri`.
- From `9aadafe`, the CI `npm run spike:editor` step is `continue-on-error`: the vertical
  failures are this spike's recorded finding, and the results JSON and Playwright report are
  still uploaded. The step stays visibly failed in the log.

## Dependencies added
All in `spikes/editor-text/package.json`; none reach the shipped app in M0.

| Name | Version | License | Reason |
|---|---|---|---|
| @tiptap/core | ^3.32.0 (3.32.2) | MIT | Editor under test (PLAN §3) |
| @tiptap/pm | ^3.32.0 (3.32.2) | MIT | ProseMirror packages for TipTap (prosemirror-view 1.42.9, -model 1.25.12, -history 1.5.1, all MIT) |
| @tiptap/starter-kit | ^3.32.0 (3.32.2) | MIT | Document/paragraph/text schema, keymaps and undo history |
| @playwright/test | 1.63.0 | Apache-2.0 | Real keyboard/mouse input on Chromium and WebKit |
| @types/node | ^22.19.0 (22.20.5) | MIT | Types for the Playwright specs (results file) |
| vite, vitest, jsdom | ^8.3.5, ^5.0.5, ^30.1.3 | MIT | Spike page build and unit tests (same versions as the root, ADR 007) |

## Follow-ups
- Orchestrator/PLAN: update PLAN §1's writing-direction line to "LTR and RTL editing; vertical
  text in preview and EPUB export".
- M1: re-check RTL typing and IME composition (not covered here; `insertText` bypasses the IME)
  in the real WKWebView app on the user's Mac (risk R4: Playwright WebKit is not exactly
  WKWebView).
- M5/EPUB: vertical-rl preview and EPUB CSS export need their own acceptance tests.
- M8-A (optional): a new spike for a custom vertical caret/keymap layer, judged by the P0 tests
  in `spikes/editor-text/tests/vertical.spec.ts`.
- M1: re-check the Chromium `coordsAtPos` end-of-paragraph quirk only if caret UI is built on
  `coordsAtPos` in vertical text.

## Links
- CI run (Spikes, job `spike-editor`, code at `d75546e`):
  https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643939
- Artifacts: `spike-editor-ubuntu-24.04`, `spike-editor-macos-15` (results JSON and Playwright
  report)
