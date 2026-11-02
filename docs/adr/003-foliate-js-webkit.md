# 003 — foliate-js EPUB view on WebKit under the Tauri CSP

Status: Accepted · Date: 2026-11-02 · Track: M0-C

## Context
InkSpark's Reader View (PLAN.md §3, M5 `compile/epub`) shows the writer's own EPUB export, and
EPUBs they import, inside the Tauri webview: WKWebView on macOS, WebKitGTK on Linux. PLAN.md
§2 names foliate-js as the renderer, but asks for a spike first (M0.md §5.2). Two things could
go wrong. foliate-js renders sections in blob: iframes, which may not survive the app's strict
CSP. And WebKit pagination may be wrong for RTL and vertical-rl content. This ADR records what
the spike found.

## Hypothesis
Upstream foliate-js, vendored unmodified, renders a reflowable EPUB 3 in WebKit under
InkSpark's Tauri CSP, with correct pagination for LTR, RTL and vertical-rl content, and within
the §5.2 performance thresholds.

## Method
- **Renderer.** foliate-js `78914aef4466eb960965702401634c2cb348e9b1`, vendored unmodified in
  `vendor/foliate-js/` (see `VENDORED.md`). The npm package named `foliate-js` belongs to an
  unrelated publisher and is not used.
- **Harness.** `spikes/foliate-view/src/harness.ts`: `openBook()` creates a `<foliate-view>`,
  opens the bytes as a `File`, and goes to section 0. The location (`fraction`,
  `sectionIndex`) comes from foliate's `relocate` event. foliate's `book.transformTarget` hook
  inlines linked book CSS (see CSP findings). A Vite plugin resolves `view.js`'s lazy
  `import('./pdf.js')` to a stub that rejects PDFs, because pdf.js is not vendored.
- **Fixture.** `spikes/foliate-view/fixtures/make-epub.ts`: a deterministic EPUB 3 built with
  fflate (fixed mtime, `mimetype` stored first). The default book has 5 chapters: English with
  a footnote, English with a 128×64 PNG, Hebrew with `dir="rtl"`, Japanese with
  `writing-mode: vertical-rl` from the linked stylesheet, and English. It also has a nav
  document and one linked stylesheet. The large fixture has 100 chapters × 3,000 words.
- **CSP.** `vite preview` sends `TAURI_CSP` as the `Content-Security-Policy` header.
  `src/csp.test.ts` checks that it equals `app.security.csp` in `src-tauri/tauri.conf.json`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: blob: data:; font-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost`.
  The tests listen for `securitypolicyviolation` in the page and in every frame, and fail on
  any violation, console error or page error.
- **Tests.** `tests/reader.spec.ts` (functional) and `tests/perf.spec.ts` (thresholds recorded
  in `results/<os>-<browser>.json`, not asserted). Playwright 1.63.0, `vite build` +
  `vite preview` (Vite 8.3.5), viewport 1280×720 (Desktop Chrome).
- **Local run** (Linux container, Node 22.23, x86_64): Chromium 153.0.8010.12 only. This is a
  sanity check: WebKit decides, and runs only in CI (`spikes.yml`, `PW_WEBKIT=1`, ubuntu-24.04
  and macos-15). Local numbers are the range over 5 runs (4 at `86ea923`, 1 after the review fixes).

## Criteria and results
Thresholds are from M0.md §5.2. CI columns are from the `spike-foliate` job of Spikes run
41407643939 on `d75546e`: Playwright WebKit 26.6 and Chromium 153.0.8010.12, ubuntu-24.04
(x86_64) and macos-15 (aarch64). macos-15 WebKit decides.

| Metric | Threshold | ubuntu WebKit | macos WebKit | Chromium CI ubuntu / macos (reference) | Local Chromium (reference) | Pass |
|---|---|---|---|---|---|---|
| Functional tests (`reader.spec.ts`, 7 tests) | all pass | 7/7 | 7/7 | 7/7; 7/7 | 7/7 pass (with CSS inlining) | yes |
| Default fixture open (median of 3) | ≤ 1,500 ms | 97 ms | 34 ms | 43.2; 17.9 ms | 38–78 ms | yes |
| Large fixture open, 100 × 3,000 words (median of 3) | ≤ 3,000 ms | 191 ms | 132 ms | 53; 23.2 ms | 46–76 ms | yes |
| Page turn p95 (50 turns, `next()` + 1 frame) | ≤ 150 ms | **181 ms** (p50 113) | 129 ms (p50 103) | 133.6 (p50 101.3); **274.1** (p50 186.2) ms | 133–148 ms (p50 ≈ 101 ms) | macOS yes; ubuntu no |
| CSP relaxation beyond `blob:`/`data:` in img/font/frame | none | none (0 violations) | none (0 violations) | none | none needed with inlining; see CSP findings | yes |

The large fixture opens almost as fast as the default one because `open()` loads only the
first section. Parsing the OPF and building section sizes scales with the book, but section
documents load on navigation. So open time here measures container and package parsing,
not the whole book's layout.

Functional tests per engine (CI: 20/20 Playwright tests passed on each OS, including the 3 perf
tests, whose thresholds are recorded rather than asserted):

| Test | Chromium local | Chromium ubuntu | Chromium macos | WebKit ubuntu | WebKit macos |
|---|---|---|---|---|---|
| opening the default fixture resolves with 5 TOC items | ✓ | ✓ | ✓ | ✓ | ✓ |
| `next()` three times increases the fraction each time | ✓ | ✓ | ✓ | ✓ | ✓ |
| `goToTocItem(2)` moves to section 2 | ✓ | ✓ | ✓ | ✓ | ✓ |
| the RTL chapter renders with `dir=rtl` and `next()` still advances | ✓ | ✓ | ✓ | ✓ | ✓ |
| the vertical chapter's body has `writing-mode: vertical-rl` | ✓ | ✓ | ✓ | ✓ | ✓ |
| the fixture image loads with `naturalWidth > 0` | ✓ | ✓ | ✓ | ✓ | ✓ |
| a full tour causes no CSP violations or console errors | ✓ | ✓ | ✓ | ✓ | ✓ |

### Page-turn timing
The p50 of about 101 ms is almost all foliate's own lock. When the paginator is not
`animated`, `#turnPage` waits a fixed `wait(100)` before it resolves (paginator.js). The page
itself moves well before that. So the measured p95 (133–148 ms on Chromium) sits only
2–17 ms under the 150 ms threshold, and slower runners may cross it without any visible lag.
If WebKit misses the threshold, check whether the gap is this fixed lock before calling it a
renderer problem. A follow-up below measures time to the `relocate` event instead.

In CI, ubuntu WebKit gave p50 113 ms and p95 181 ms: about 100 ms of each turn is the fixed lock,
so the real work is about 13 ms at p50 and the p95 tail is runner jitter on top of the lock.
macOS Chromium (p95 274 ms) is a reference only and was not investigated; macOS WebKit, which
decides, gave p95 129 ms.

### CSP findings
1. **Linked book CSS is blocked (the one real finding).** foliate's loader turns every EPUB
   resource into a blob: URL and rewrites `<link rel="stylesheet">` hrefs to them. The app's
   `style-src 'self' 'unsafe-inline'` does not match blob:. The section documents are blob:
   iframes, which inherit the page's policy, so every linked stylesheet is blocked.
   - Before the harness inlined CSS, all 7 reader tests failed on Chromium with
     `style-src-elem blocked blob` (44 violations in one run). The vertical chapter rendered
     `horizontal-tb`, because its `writing-mode` lives in the stylesheet.
   - Almost every real EPUB uses linked CSS, so this cannot be ignored.
2. **Mitigation used: inline the CSS, CSP unchanged.** `src/inline-styles.ts` listens to
   foliate's public `book.transformTarget` `data` events. It keeps each stylesheet's
   processed text, then replaces the section's `<link>` elements with `<style>` elements
   holding the same CSS. `'unsafe-inline'` (already in the CSP) allows those. `url()`
   references inside the CSS are already blob: URLs, which img-src and font-src allow. With
   this, all tests pass with zero violations.
   - Known gap: `@import` inside book CSS still points at a blob: stylesheet and stays
     blocked.
   - Known gap: foliate demotes a section that is not valid XHTML to `text/html`
     (epub.js:821-826). The harness serializes those with `XMLSerializer`, so `<`, `>` and
     `&` in the inlined CSS arrive escaped as `&lt;`, `&gt;` and `&amp;` inside a raw-text
     `<style>`. This breaks child combinators (`a > b`) and similar rules. Upstream damages
     a section's own inline `<style>` blocks in the same way, because it also serializes
     with `XMLSerializer`. The fixture is valid XHTML, so it does not hit this. M5 follow-up
     below.
   - Alternate stylesheets (`rel="alternate stylesheet"`) are not inlined.
   - If inlining throws, the section loads unmodified (its CSS is then blocked, as upstream).
3. **Considered and rejected: add `blob:` to style-src.** As a local experiment only,
   `blob:` was added to style-src in `csp.ts`; the change was not committed and the Tauri
   config was not touched. With it and no inlining, all 10 tests passed on Chromium (default open 59 ms,
   large 136 ms, p95 131 ms). This keeps foliate's behaviour unchanged, including
   `@import`. But it is a style-src relaxation outside the §5.2 allowance, and the
   Orchestrator rejected it (M0.md §11).
4. **What already works.**
   - `frame-src 'self' blob:` covers the section iframes. foliate sandboxes them with
     `allow-same-origin allow-scripts`.
   - `img-src blob:` covers images, and `font-src blob:` covers embedded fonts.
   - zip.js runs with `useWebWorkers: false` and reads from a Blob, so it needs no
     `worker-src` or `connect-src` change, and no WASM.
   - Nothing needs `unsafe-eval`.
5. **Book scripts.** The iframes are sandboxed with `allow-same-origin allow-scripts`, so the
   only thing that stops scripts inside a book is `script-src 'self'`, which does not match
   blob:. That is the behaviour we want, but the fixture has no scripts, so it is not tested
   yet (follow-up below).

## Decision
**Go-with-conditions.** All 7 functional tests pass on both WebKit runners with zero CSP
violations, console errors or page errors. macos-15 WebKit meets every threshold (open 34 ms and
132 ms, page-turn p95 129 ms). ubuntu-24.04 WebKit meets the open thresholds but its page-turn
p95 is 181 ms against 150 ms; the cause is mostly foliate's fixed 100 ms wait (p50 113 ms), not
rendering.

Conditions:
1. CSP unchanged; book CSS inlined via `transformTarget` (M0.md §11). The Reader View
   inlines linked book CSS exactly as the harness does. Adding `blob:` to `style-src` was
   considered and rejected (CSP finding 3).
2. M5 measures page turns to the `relocate` event (as well as to `next()` resolving), and the
   Linux page-turn target is re-checked then.
3. epubcheck validation of the fixture (and of InkSpark's own EPUB export) is added as a
   follow-up.
4. foliate-js stays vendored unmodified at a pinned commit, without pdf.js.
5. Vertical-rl and foliate are re-checked in the real app (WKWebView/WebKitGTK) behind the
   `readerView` flag (M0.md R4).

## Consequences
- PLAN.md: the Reader View (M5) keeps foliate-js, with a "book CSS inlining" step
  (`spikes/foliate-view/src/inline-styles.ts` is the reference).
- The Tauri CSP stays as it is (M0.md §11); no contract change is needed.
- PDF input is out of scope for foliate in InkSpark. Vendoring pdf.js would need its own ADR,
  covering size, licenses, worker-src and fetches of cmaps and fonts.
- Playwright WebKit is not WKWebView or WebKitGTK (M0.md R4). The in-app check in M5 confirms
  the verdict.
- The Linux page-turn number is a known miss until M5 re-measures it; it is not a release gate
  for M1–M4, which do not use the Reader View.
- The Reader View is also the editable-vertical substitute: with ADR 001 No-go, vertical text
  is read in preview/EPUB, and foliate renders vertical-rl correctly on both WebKit runners.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| foliate-js (vendored, `vendor/foliate-js/`) | `78914aef4466eb960965702401634c2cb348e9b1` | MIT | EPUB renderer for the Reader View |
| zip.js (inside foliate-js `vendor/zip.js`) | 2.8.22 | BSD-3-Clause | foliate's EPUB unzip (upstream bundle) |
| fflate (inside foliate-js `vendor/fflate.js`) | 0.8.2 | MIT | foliate's MOBI decompression (upstream bundle) |
| fflate (npm, spike `dependencies`) | ^0.8.3 | MIT | builds the deterministic EPUB fixture |
| @playwright/test (npm, spike dev) | 1.63.0 | Apache-2.0 | browser tests on Chromium and WebKit |

## Follow-ups
- **CI (M0/M5):** validate the generated fixture with epubcheck in CI. Maven was blocked
  locally, so this did not run here.
- **M5:** test a book with a `<script>`, and confirm it is blocked in the section iframe and
  causes no console error the Reader View cannot handle.
- **M5:** for sections foliate demotes to `text/html`, serialize with `outerHTML` (not
  `XMLSerializer`) and escape `</style` in inlined CSS, so `<`, `>` and `&` survive.
- **M5:** test `@import` in book CSS, and either inline it recursively or document the gap.
- **M5:** measure page turns to the `relocate` event as well as to `next()` resolving,
  because foliate's fixed 100 ms lock inflates the current metric, and re-check the Linux
  target (ubuntu WebKit p95 was 181 ms against 150 ms).
- **M5:** run real EPUBs (Gutenberg or Standard Ebooks samples) in CI. Real data is blocked
  locally (M0.md R12).

## Links
- CI run (Spikes, job `spike-foliate`, code at `d75546e`):
  https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643939
- Artifacts: `spike-foliate-ubuntu-24.04`, `spike-foliate-macos-15` (results JSON and
  Playwright report).
- Local results file: `spikes/foliate-view/results/linux-chromium.json` (not committed).
