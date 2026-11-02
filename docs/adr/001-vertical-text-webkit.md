# 001 — Vertical and RTL text in TipTap on WebKit

Status: Proposed · Date: 2026-11-02 · Track: M0-B

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
- **Hosts** have a fixed size and scroll their own content: horizontal hosts are 960×160 px;
  vertical hosts are 960×320 px, so a 10-character test line fits one vertical line and a
  200-character paragraph wraps over about 12 lines that stay inside the host. Font 16 px,
  line-height 1.8, system UI fonts with Noto/Hiragino fallbacks.
- **Text**: `generateText(lang, chars, seed)` builds deterministic EN/JA/AR/HE text from a
  seeded mulberry32 PRNG over fixed word pools, cut to exactly `chars` code units, paragraphs
  separated by `"\n\n"`. `setText` replaces the doc without adding an undo step (it models
  opening a file); typed edits go through the normal history.
- **Tests** (written first by the Test-author, M0.md §4.2): `baseline`, `rtl`, `vertical` (run
  for both vertical modes) and `perf` specs drive real Playwright keyboard and mouse input, plus
  vitest/jsdom unit tests for the harness. On macOS the tests use the native Cmd+Arrow bindings
  for line start/end and end of document.
- **Latency** (`measureInputLatency`, as specified): per sample, `insertContent("a")` on a
  50,000-character doc with the caret at the end, then await one `requestAnimationFrame`; the
  time from before the dispatch to after the frame callback; 200 samples; p50/p95.
- **Engines**: Playwright 1.63.0. Local: Chromium 153.0.8010.12 headless, Linux x86_64
  container, Node 22.23. CI (`spikes.yml`, job `spike-editor`): Chromium and WebKit on
  ubuntu-24.04 and macos-15 with `PW_WEBKIT=1`. Results go to
  `spikes/editor-text/results/<os>-<browser>.json` (M0.md §3.9).
- **Commit**: local numbers are from `65dc6e4`.
- **Decides**: WebKit on macos-15 (closest to WKWebView). Ubuntu WebKit is a second data point;
  local Chromium is a sanity check only and does not count toward the verdict.

## Criteria and results
Functional tests: ✓ pass, ✗ fail. WebKit columns are filled in by the Orchestrator from the
`spike-editor` CI job.

| Test | Threshold | Chromium (local, Linux) | ubuntu WebKit | macos WebKit | Pass |
|---|---|---|---|---|---|
| ltr: typing inserts | pass | ✓ | pending CI | pending CI | pending CI |
| ltr: Ctrl/Cmd+Z undoes typing | pass | ✓ | pending CI | pending CI | pending CI |
| ltr: Shift+ArrowLeft ×5 selects 5 | pass | ✓ | pending CI | pending CI | pending CI |
| ltr: Enter creates a paragraph | pass | ✓ | pending CI | pending CI | pending CI |
| ltr: paste event inserts at caret | pass | ✓ | pending CI | pending CI | pending CI |
| rtl he/ar: typing inserts at caret | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| rtl he/ar: ArrowLeft is logical +1 | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| rtl he/ar: line start/end keys | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| rtl he/ar: mixed number run order | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: insertText Japanese (P0 typing) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: ArrowDown +1, ArrowUp −1 (P0 arrows) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: next-line arrow (P0 arrows) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: click centre of `coordsAtPos(k)`, 20 k (P0 click-to-caret) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: Shift+ArrowDown selects 1 (P0 selection) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: Backspace deletes 1 (P0) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: Enter splits (P0) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: 20,000 chars, end of doc, caret in viewport (P0 caret visible) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| vertical-rl / lr: undo restores (P0 undo) | pass | ✓ / ✓ | pending CI | pending CI | pending CI |
| harness unit tests (vitest, jsdom; 38 tests) | pass | ✓ (Node) | — | — | ✓ |

Input latency, 50,000-character doc, 200 samples (ms, p50 / p95). Two local runs:

| Mode | Threshold (p95) | Chromium (local) | ubuntu WebKit | macos WebKit | Pass |
|---|---|---|---|---|---|
| ltr | ≤ 16 | 16.7 / 20.5; 16.7 / 18.1 | pending CI | pending CI | pending CI |
| rtl | ≤ 16 | 16.7 / 21.2; 16.7 / 19.8 | pending CI | pending CI | pending CI |
| vertical-rl | ≤ 16 | 16.7 / 20.2; 16.7 / 26.9 | pending CI | pending CI | pending CI |
| vertical-lr | ≤ 16 | 16.7 / 17.6; 16.7 / 21.2 | pending CI | pending CI | pending CI |

**The latency metric as specified is bounded below by the frame interval.** Each sample starts
inside the previous sample's `requestAnimationFrame` callback, so the next callback is one full
vsync later: p50 is exactly 16.7 ms (60 Hz) in every mode, whatever the editor does, and p95 is
one frame plus scheduling jitter. A p95 ≤ 16 ms threshold therefore fails by construction on a
60 Hz clock and says nothing about the editor. As a diagnostic only (scratch script, same page
and doc, not part of the committed suite), the synchronous cost of `insertContent("a")` plus a
forced layout and `coordsAtPos` was, in local Chromium: ltr 0.7 / 0.9 ms, rtl 0.7 / 0.9 ms,
vertical-rl 0.8 / 1.0 ms, vertical-lr 0.9 / 1.6 ms (p50 / p95). That is well inside one frame.
The Orchestrator is asked to amend the latency criterion before the verdict (see Follow-ups).

## Decision
**Pending CI.** The rule below is fixed before the WebKit numbers are known (M0.md §4.3); macos-15
WebKit decides.

- **Go** if all of:
  - every baseline and RTL test passes on both WebKit runners (ubuntu-24.04 and macos-15);
  - every vertical P0 test passes for `vertical-rl` on macos-15 WebKit: typing, arrows in all
    four directions (ArrowDown/ArrowUp within a line, ArrowLeft to the next line), click-to-caret,
    Shift-selection, Backspace, Enter, undo, caret visible after end of document;
  - p95 input latency ≤ 16 ms in all modes (subject to the amendment requested above).
- **Go-with-conditions** if there are at most 3 vertical P0 failures, each fixable by a
  ProseMirror plugin or keymap estimated at ≤ 2 days, listed here with its fix. The
  `verticalWriting` flag then stays off until M8-A.
- **No-go** if there are more failures, or click-to-caret is broken. Vertical writing then
  becomes preview/export-only (EPUB CSS) and PLAN §1's writing-direction line is updated.
- `vertical-lr` results are recorded but do not decide the verdict.

Local Chromium: all 35 browser tests and all 38 harness unit tests pass in both runs; it is a
sanity check that the harness and tests are correct, not evidence for WebKit.

## Consequences
- If Go: M1 builds the editor on TipTap 3 with `writing-mode` set on the editor host, the same
  way as this harness. Vertical writing stays behind the `verticalWriting` flag until it is
  re-checked in the real app on the user's Mac (risk R4: Playwright WebKit is not exactly
  WKWebView).
- Vertical PDF is out of scope here: Typst has no vertical layout (see ADR 002).
- No contract changes are needed for M1 from this spike. The spike package is never a
  dependency of `src` or `src-tauri`.

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
- Orchestrator (M0, before the verdict): amend the latency criterion so it measures editor work,
  not vsync. Options: time from dispatch to the end of synchronous work plus a forced layout
  (as in the diagnostic above), or count frames where that work exceeds a frame budget.
- Orchestrator (M0): fill in the WebKit columns and the CI run link, record the verdict, and flip
  the status to Accepted.
- M1/M8-A: re-check vertical typing, IME composition (not covered here; `insertText` bypasses
  the IME) and click-to-caret in the real WKWebView app on the user's Mac.
- If Go-with-conditions: list each failing P0 with its plugin/keymap fix and estimate here.

## Links
- CI run: _to be added by the Orchestrator_ (`spikes.yml`, job `spike-editor`)
- Artifacts: `spike-editor-ubuntu-24.04`, `spike-editor-macos-15` (results JSON and Playwright
  report)
