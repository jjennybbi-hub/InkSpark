# 002 — Typst PDF export and preview

Status: Accepted (verdict conditional) · Date: 2026-11-02 · Track: M0-C

## Context
InkSpark exports manuscripts to print-ready PDF and wants a live, paginated preview while the
writer works (PLAN.md export pipeline; M0.md §5.1). The plan names the `typst` crate as the
engine. This spike checks four things before typst may enter `src-tauri`:
- whether it is fast enough on a full-length novel;
- whether its output is deterministic;
- what it costs in binary size;
- what it brings into the dependency and advisory graph.

## Hypothesis
The `typst` crate with embedded fonts only can compile a ~300-page novel to PDF fast enough for
live preview and export, with an acceptable binary-size cost.

## Method
- Crate `spikes/typst-pdf` (`inkspark-spike-typst`): typst / typst-pdf / typst-kit
  (`embedded-fonts`) / typst-layout 0.15.1. There is no system font scan, no packages, and no
  file access beyond the in-memory `main.typ`. `today()` is fixed at 2026-01-01, so output is
  reproducible.
- `generate_book_markup` writes a SplitMix64-seeded novel:
  - 5.5×8.5 in pages, Libertinus Serif 11 pt, justified, ~280 words/page;
  - a chapter (level-1 heading on a new page) every 10 pages;
  - a footnote in roughly one paragraph in five, page numbers, and an optional Hebrew RTL block.

  The 300-page target lays out to 326 pages.
- `compile_pdf`: `typst::compile::<PagedDocument>` then `typst_pdf::pdf` with
  `timestamp: None`; compile and export are timed separately.
- `typst-bench --pages 300 --size-report target/release/size-baseline --out …`:
  - **cold** = a fresh `SpikeWorld` plus one compile (`cold_compile_ms` is the compile phase);
  - **warm** = `set_main` with one new paragraph inserted mid-book, then compile + export,
    median of 5 runs (the memo cache and font book are kept);
  - **export** = the median export phase over those 5 warm runs; the cold export is a note;
  - **size delta** = stripped release `typst-bench` minus `size-baseline` (std + serde_json
    only), in **MB = 10⁶ bytes**. The bench refuses `--size-report` in debug builds. A context
    metric subtracts the embedded typst-assets font data (9 683 068 bytes, counted from the
    bench world);
  - **peak RSS** = `VmHWM` on Linux. It is not measured on macOS, because `getrusage` would
    need `unsafe` or a new dependency.
- Functional tests in `tests/compile.rs` (debug build, small documents, ~2 s):
  - a 10-page spec gives 8–12 pages and lopdf agrees;
  - PDFs are byte-identical across recompiles and fresh worlds;
  - Libertinus Serif is present;
  - `#let x = ` → `Err(Compile)`, and garbage font bytes → `Err(Font)`;
  - RTL Hebrew compiles, and `set_main` changes the output;
  - the `#[ignore]` test `bench_300_pages` runs in release.
- Local runs: Linux x86_64 container (Intel Xeon, 4 vCPU, 15 GiB), Rust 1.97.0. These numbers
  are reference only; the decision is made on macos-15 in the `spike-typst` job
  (`.github/workflows/spikes.yml`).
  - The first run was on commit `7cd420f` (its results JSON records parent `9d2c811`).
  - The re-measure was on `4d87807`, without and then with the Orchestrator's
    `[profile.release.package.typst*] opt-level = "s"` override (root `Cargo.toml`, `f3b6c0e`).
    The "without" build used the previous root `Cargo.toml` restored temporarily in the working
    tree; it was not committed.
  - The release profile is otherwise `lto = "thin"`, `codegen-units = 1`, `strip = true`.

## Criteria and results
Re-measured locally with the current bench. "opt-s" is the Orchestrator's opt-level override,
now in the root `Cargo.toml`, so it is what CI measures. CI columns are from the `spike-typst`
job of Spikes run 41407643939 on `d75546e` (ubuntu-24.04 x86_64, macos-15 aarch64); macos-15
decides.

| Metric | Threshold | ubuntu local, no override | ubuntu local, opt-s (current) | ubuntu-24.04 CI | macos-15 CI | Pass |
|---|---|---|---|---|---|---|
| Cold 300-page compile (`cold_compile_ms`) | ≤ 4 000 ms | 368 ms | 393 / 397 ms | 1 697 ms | 281 ms | yes |
| Warm recompile after a one-paragraph edit (`warm_recompile_ms`) | ≤ 600 ms | 169 ms | 165 / 162 ms | 245 ms | 77 ms | yes |
| PDF export, warm median (`export_ms`) | ≤ 1 000 ms | 104 ms | 105 / 105 ms | 149 ms | 54 ms | yes |
| **Size delta (`size_delta_mb`)** | ≤ 30 MB | **45.3 MB** (45 637 200 − 380 344 B) | **42.8 MB** (43 188 160 − 380 328 B) | **42.8 MB** (43 196 192 − 380 328 B) | **40.16 MB** (40 535 664 − 373 376 B) | **no** |
| Size delta without embedded fonts (context) | (30 MB) | 35.6 MB | 33.1 MB | 33.1 MB | 30.5 MB | still over |

CI context: 326 pages and a 1 593 971-byte PDF on both runners (byte-identical sizes). macos-15
cold total (world + compile + export) 362.6 ms, cold export 60.0 ms, warm compile-only median
24.1 ms; the release `bench_300_pages` test gave cold 216.5 ms and warm 71.8 ms. ubuntu-24.04
cold total 1 928.4 ms and peak RSS 611.6 MiB; the ubuntu runner was much slower than the local
container on the cold compile but still 2.4× under budget. Peak RSS on macOS: not measured. The
12 functional tests in `tests/compile.rs` passed in the macos-15 `check` job of CI run
41407643715.

The first local run (before the export-median change) gave cold 445 ms, warm 163 ms, cold
export 110 ms, and a 45.3 MB delta. The release `bench_300_pages` test gave cold 380 ms and
warm 181 ms.

Effect of `opt-level = "s"` on the typst crates, measured locally:
- Size: −2.45 MB (−5.4 %).
- Warm recompile: no measurable change (169 → 163 ms; within noise).
- Warm compile phase: 64 → 55–57 ms.
- Cold compile: about +7 % (368 → ~395 ms).

The lever helps, but not enough to meet the budget.

Context, not gated:
- 326 pages; the PDF is 1.59 MB.
- Cold total (world creation + compile + export) is ~480–510 ms.
- Peak RSS is 612 MiB (Linux `VmHWM`).

Where the size goes (source data sizes, not exact binary attribution):
- typst-assets fonts: 9.68 MB, embedded with `include_bytes!`.
- ICU data crates (segmenter, locale, collator, properties): ~17 MB of source data, partly
  compressed into the binary.
- two-face/syntect syntaxes and themes (code highlighting): ~3.9 MB.
- hayagriva/citationberg CSL styles and locales (bibliographies): ~5 MB.
- hypher hyphenation patterns: ~1.5 MB.

A first attempt to count the font bytes called `typst_kit::fonts::embedded()` a second time from
the bench binary. That grew the binary by ~9.7 MB, so the embedded font data was linked twice.
Any app code must load embedded font data through exactly one path.

Feature findings:
- **Vertical writing is unsupported.** `#set text(dir: ttb)` fails to compile:
  `compile: text direction must be horizontal`. The note test records this, and so does the
  bench's results JSON. Typst has no vertical layout, so vertical (tategaki) export cannot use
  Typst.
- **RTL** (`dir: rtl, lang: "he"`) compiles, both as a whole document and as a block inside the
  novel.
- **Determinism**: with no timestamp and a fixed `today()`, the PDF bytes are identical across
  recompiles of the same world and across fresh worlds.

## Decision
**Go-with-conditions; the size condition awaits a user decision.** Typst stays the planned PDF
engine, but it may not enter `src-tauri` until every condition below is met.

**Speed: pass, widely.** On macos-15: cold compile 281 ms (14× under the 4 000 ms budget), warm
recompile 77 ms (8× under 600 ms), export 54 ms (18× under 1 000 ms). Whole-book live preview is
viable, and the chapter-only fallback in M0.md §5.1 is not needed.

**Size: fail.** The delta is 40.16 MB on macos-15 and 42.8 MB on ubuntu-24.04 (opt-s applied),
against a 30 MB budget. Without the embedded fonts it is still 30.5 MB on macOS. The macos-15
figure is for one architecture (aarch64); the universal .app carries two, so its growth is
likely larger (not measured). There is no further cheap lever: the remaining weight is ICU,
syntect and hayagriva data, which typst-library depends on unconditionally.

Conditions:
1. **Size (user decision)**: the user accepts about 40 MB of app-size growth for real print
   PDF, or a later spike finds a smaller path (for example a sidecar or a slimmer typst build).
   Until then the 30 MB budget stands and typst does not enter `src-tauri`. Keep opt-s for the
   typst crates.
2. **Fonts**: do not embed `typst_kit::fonts::embedded()`. Bundle only Libertinus Serif
   (OFL-1.1) as a resource with `OFL.txt`; add any other font only after its own license review
   (see Dependencies).
3. **Advisories**: resolve the 7 advisory ignores in `deny.toml` (below) before typst enters
   `src-tauri`. In particular the quick-xml 0.38 DoS advisories (via hayagriva → citationberg)
   must be fixed upstream, or proven unreachable from the app's entry points with a written
   justification. Re-check at each typst release and before M-export work starts.

**Vertical PDF is unsupported**: `#set text(dir: ttb)` fails to compile on both runners. Vertical
text is preview/EPUB-only (ADR 001), so this does not block the verdict.

## Consequences
- PLAN: Typst stays the planned PDF engine, subject to the conditions above. Vertical text has
  no PDF path; with ADR 001 it is preview/EPUB-only.
- App size: accepting typst means about 40 MB more per architecture (macos-15 measurement).
- Next-milestone contracts: an `export_pdf` command that takes manuscript markup plus a font
  list and returns bytes or a typed error (`Compile` / `Export` / `Font`). It needs a long-lived
  `World` per open project, so warm recompiles keep the comemo cache.
- Memory: ~610 MiB peak RSS for a 300-page cold compile. Preview should keep one world per
  project and cap the comemo cache (`comemo::evict`) between compiles.
- Requests to the Orchestrator:
  - the user's size decision above (condition 1);
  - a `deny.toml` license clarification for typst-assets (below);
  - keeping the advisory ignores scoped to the spike.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| typst | 0.15.1 | Apache-2.0 | compiler (`compile::<PagedDocument>`) |
| typst-pdf | 0.15.1 | Apache-2.0 | PDF export |
| typst-layout | 0.15.1 | Apache-2.0 | `PagedDocument` type (not re-exported by `typst`; already a transitive dependency) |
| typst-kit | 0.15.1 (`embedded-fonts` only) | Apache-2.0 | `FontStore` and embedded fonts |
| typst-assets (transitive) | 0.15.1 | crate metadata Apache-2.0; **bundled data under other licenses** | embedded fonts, ICC profiles, HTML/MathML data |
| comemo (transitive) | 0.5.1 | MIT OR Apache-2.0 | incremental memoization |
| thiserror | 2 | MIT OR Apache-2.0 | typed errors |
| serde_json | 1 | MIT OR Apache-2.0 | results JSON, size baseline |
| lopdf (dev) | 0.46 | MIT | independent page count in tests |

Third-party licenses inside typst-assets 0.15.1 (complete list from its `NOTICE`). These matter
for redistribution:
- Libertinus Serif (`fonts/LibertinusSerif-*.otf`): **OFL-1.1**. It may be bundled with
  software, but not sold on its own; the copyright notice and license must ship with each copy;
  Reserved Font Names apply ("Linux Libertine", "Biolinum", "STIX Fonts").
- New Computer Modern except NewCM10-Regular (`fonts/NewCM*.otf`): GUST Font License 1.0
  (LPPL-1.3c based).
- NewCM10-Regular (`fonts/NewCM10-Regular.otf`): **GPL-3.0-or-later with Font Exception and
  Distribution Exception**.
- DejaVu Sans Mono (`fonts/DejaVu*.ttf`): Bitstream Vera / Arev font licenses (DejaVu changes
  are public domain).
- Foxit fonts (`fonts/Foxit*.pfb`): BSD-3-Clause-style (PDFium Authors).
- ICC profiles (`icc/*-v4.icc`): CC0-1.0.
- HTML data derived from the WHATWG HTML and Fetch specs (`html/data.rs`): CC-BY-4.0, with
  portions incorporated into source code under BSD-3-Clause.
- MathML data derived from W3C MathML Core (`mathml/data.rs`): W3C Document License.

`cargo deny check` passes today only because the crate declares Apache-2.0 as a whole, so the
OFL-1.1 exception M0.md §3.5 expected is not triggered. **Request:** add a
`[[licenses.clarify]]` for typst-assets so cargo-deny sees the real licenses. The CC-BY-4.0
attribution and the W3C notice must also ship with the app if typst is accepted.

Advisories reached only through typst 0.15.1 (ignored in `deny.toml`; no fixed release yet):
| Advisory | Crate | Path | Kind |
|---|---|---|---|
| RUSTSEC-2025-0141 | bincode 1 | typst → syntect | unmaintained |
| RUSTSEC-2024-0320 | yaml-rust | typst → syntect | unmaintained |
| RUSTSEC-2024-0449 | unsafe-libyaml | typst → hayagriva → serde_yaml | unmaintained |
| RUSTSEC-2026-0206 | rustybuzz | typst / krilla text shaping | unmaintained |
| RUSTSEC-2026-0192 | ttf-parser | typst / fontdb font parsing | unmaintained |
| RUSTSEC-2026-0194 | quick-xml 0.38 | typst → hayagriva → citationberg (CSL) | **DoS on untrusted XML** |
| RUSTSEC-2026-0195 | quick-xml 0.38 | typst → hayagriva → citationberg (CSL) | **DoS on untrusted XML** |

The spike never loads bibliographies or CSL files. The quick-xml advisories are vulnerabilities,
not just maintenance notices. They block typst from entering `src-tauri` until either:
- upstream moves to a fixed quick-xml (the scriv spike already uses 0.42); or
- the app proves it can never feed user XML into hayagriva.

## Follow-ups
- User (via the Orchestrator), before M-export: accept about 40 MB of app-size growth, or ask
  for a spike on a smaller path. Record the answer here.
- Before typst enters `src-tauri` (export milestone):
  - bundle Libertinus Serif only, as a resource with `OFL.txt`;
  - resolve the 7 advisory ignores against the then-current typst;
  - add the `deny.toml` `[[licenses.clarify]]` for typst-assets;
  - add a font-license review per bundled font.
- Export milestone: measure the size growth of the universal macOS .app (not measured here);
  peak-memory measurement on macOS (getrusage via a safe wrapper crate, if one is approved); a
  comemo eviction policy for long sessions.
- Vertical writing: no PDF path; preview/EPUB only (ADR 001).

## Links
- CI run (Spikes, jobs `spike-typst (ubuntu-24.04)` and `spike-typst (macos-15)`, code at
  `d75546e`): https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643939
- Functional tests: `check (macos-15)` job of CI run
  https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643715
- Artifacts: `spike-typst-ubuntu-24.04`, `spike-typst-macos-15` (`results/<os>.json`).
- Local results file: `spikes/typst-pdf/results/linux-local.json` (not committed).
