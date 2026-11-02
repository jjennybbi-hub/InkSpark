# 002 — Typst PDF export and preview

Status: Proposed · Date: 2026-11-02 · Track: M0-C

## Context
InkSpark exports manuscripts to print-ready PDF and wants a live, paginated preview while the
writer works (PLAN.md export pipeline; M0.md §5.1). The plan names the `typst` crate as the
engine. This spike checks whether it is fast enough on a full-length novel, whether its output
is deterministic, what it costs in binary size, and what it brings into the dependency and
advisory graph before it may enter `src-tauri`.

## Hypothesis
The `typst` crate with embedded fonts only can compile a ~300-page novel to PDF fast enough for
live preview and export, with an acceptable binary-size cost.

## Method
- Crate `spikes/typst-pdf` (`inkspark-spike-typst`): typst / typst-pdf / typst-kit
  (`embedded-fonts`) / typst-layout 0.15.1. No system font scan, no packages, no file access
  beyond the in-memory `main.typ`, and a fixed `today()` (2026-01-01), so output is
  reproducible.
- `generate_book_markup`: a SplitMix64-seeded novel on 5.5×8.5 in pages, Libertinus Serif 11 pt,
  justified, ~280 words/page, a chapter (level-1 heading on a new page) every 10 pages, a
  footnote in roughly one paragraph in five, page numbers, and an optional Hebrew RTL block.
  The 300-page target lays out to 326 pages.
- `compile_pdf`: `typst::compile::<PagedDocument>` then `typst_pdf::pdf` with
  `timestamp: None`; compile and export are timed separately.
- `typst-bench --pages 300 --size-report target/release/size-baseline --out …`:
  - cold = a fresh `SpikeWorld` plus one compile;
  - warm = `set_main` with one new paragraph inserted mid-book, then compile + export, median of
    5 (the memo cache and font book are kept);
  - export = the cold run's `typst_pdf::pdf` time;
  - size delta = stripped release `typst-bench` minus `size-baseline` (std + serde_json only),
    with the workspace release profile (`lto = "thin"`, `codegen-units = 1`, `strip = true`);
  - peak RSS = `VmHWM` on Linux. It is not measured on macOS, because `getrusage` would need
    `unsafe` or a new dependency.
- Functional tests in `tests/compile.rs` (debug build, small documents, ~2 s): a 10-page spec
  gives 8–12 pages and lopdf agrees; byte-identical PDFs across recompiles and fresh worlds;
  Libertinus Serif present; `#let x = ` → `Err(Compile)`; garbage font bytes → `Err(Font)`;
  RTL Hebrew compiles; `set_main` changes the output. The `#[ignore]` test `bench_300_pages`
  runs in release.
- Local: Linux x86_64 container (Intel Xeon, 4 vCPU, 15 GiB), Rust 1.97.0, branch commit
  `be07662`. Reference only: the decision is made on macos-15 in the `spike-typst` job
  (`.github/workflows/spikes.yml`).

## Criteria and results
| Metric | Threshold | ubuntu (local container) | ubuntu-24.04 CI | macos-15 CI | Pass |
|---|---|---|---|---|---|
| Cold 300-page compile (`cold_compile_ms`) | ≤ 4 000 ms | 445 ms (bin) / 380 ms (test) | pending CI | pending CI | local yes |
| Warm recompile after a one-paragraph edit (`warm_recompile_ms`) | ≤ 600 ms | 163 ms (bin) / 181 ms (test) | pending CI | pending CI | local yes |
| PDF export (`export_ms`) | ≤ 1 000 ms | 110 ms / 119 ms | pending CI | pending CI | local yes |
| Size delta (`size_delta_mb`) | ≤ 30 MB | **43.2 MiB** (45 635 488 − 380 344 B) | pending CI | pending CI | **local no** |

Context, not gated:
- 326 pages; the PDF is 1.59 MB.
- Cold total (world creation + compile + export) is 561 ms.
- Of the warm 163 ms, 57 ms is compile and the rest is export.
- Peak RSS is 614 MiB (Linux `VmHWM`).

Where the size goes (source data sizes, not exact binary attribution):
- typst-assets fonts are ~9.3 MiB of OTF/TTF, embedded with `include_bytes!`.
- ICU data crates (segmenter, locale, collator, properties) are ~16 MiB of source data, partly
  compressed into the binary.
- two-face/syntect syntaxes and themes (code highlighting) are ~3.7 MiB.
- hayagriva/citationberg CSL styles and locales (bibliographies) are ~5 MiB.
- hypher hyphenation patterns are ~1.4 MiB.

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
**Go-with-conditions** (proposed; final after macos-15 CI):
1. Speed passes with a wide margin locally (cold ~9× under budget, warm ~3.5×). Whole-book live
   preview is viable; the chapter-only fallback in M0.md §5.1 is not needed unless macOS
   disagrees.
2. The size delta is over budget (43 MiB vs 30 MB on Linux x86_64). Before typst enters
   `src-tauri`, it must come under budget on macos-15. Planned levers, in order:
   - stop embedding all typst-assets fonts and ship only the fonts we use as bundled resources
     (−9 MiB), which also fixes the licensing problem in condition 4;
   - try `opt-level = "s"` for the typst crates through a `[profile.release.package]` override
     (Orchestrator-owned root `Cargo.toml`).

   If it is still over budget, the Orchestrator either raises the budget explicitly in this ADR
   or rejects typst. Note that the universal macOS build ships two architectures, so the
   delta in the .app roughly doubles.
3. Advisories: typst 0.15.1 brings in RUSTSEC advisories with no fixed version (see below).
   They are ignored in `deny.toml` only because the spike crate is never a dependency of the
   app. **typst cannot enter `src-tauri` while any of these ignores is needed for the app's
   graph.** In particular, quick-xml 0.38 (DoS on untrusted XML) has to be fixed upstream, or
   proven unreachable from the app's entry points with a written justification, before typst
   enters `src-tauri`. Re-check at each typst release and before M-export work starts.
4. Fonts: only fonts whose licenses allow bundling, with their license texts shipped (see
   Dependencies).
5. Vertical writing must use a different export path. That decision belongs to the vertical
   writing work (ADR 001 / PLAN), not to Typst.

## Consequences
- PLAN: Typst stays the PDF engine. Vertical-writing export needs a non-Typst path, or it is
  out of scope for PDF.
- Next-milestone contracts: an `export_pdf` command that takes manuscript markup plus a font
  list and returns bytes or a typed error (`Compile` / `Export` / `Font`). It needs a long-lived
  `World` per open project, so warm recompiles keep the comemo cache.
- Memory: ~600 MiB peak RSS for a 300-page cold compile. Preview should keep one world per
  project and cap the comemo cache (`comemo::evict`) between compiles.
- Requests to the Orchestrator:
  - the size levers above (profile override in the root `Cargo.toml`);
  - a `deny.toml` license clarification for typst-assets (below);
  - keeping the advisory ignores scoped to the spike.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| typst | 0.15.1 | Apache-2.0 | compiler (`compile::<PagedDocument>`) |
| typst-pdf | 0.15.1 | Apache-2.0 | PDF export |
| typst-layout | 0.15.1 | Apache-2.0 | `PagedDocument` type (not re-exported by `typst`; already a transitive dependency) |
| typst-kit | 0.15.1 (`embedded-fonts` only) | Apache-2.0 | `FontStore` and embedded fonts |
| typst-assets (transitive) | 0.15.1 | crate metadata Apache-2.0; **font files under other licenses** | embedded fonts |
| comemo (transitive) | 0.5.1 | MIT OR Apache-2.0 | incremental memoization |
| thiserror | 2 | MIT OR Apache-2.0 | typed errors |
| serde_json | 1 | MIT OR Apache-2.0 | results JSON, size baseline |
| lopdf (dev) | 0.46 | MIT | independent page count in tests |

Font licenses inside typst-assets 0.15.1 (from its `NOTICE`). These matter for redistribution:
- Libertinus Serif: **OFL-1.1**. It may be bundled with software, but not sold on its own; the
  copyright notice and license must ship with each copy; Reserved Font Names apply.
- New Computer Modern: GUST Font License (LPPL-1.3c based).
- NewCM10-Regular: **GPL-3.0-or-later with Font Exception and Distribution Exception**.
- DejaVu Sans Mono: Bitstream Vera license (DejaVu changes are public domain).
- Foxit `.pfb` files: BSD-style (PDFium).

`cargo deny check` passes today only because the crate declares Apache-2.0 as a whole. The
OFL-1.1 exception M0.md §3.5 expected is not triggered. **Request:** add a
`[[licenses.clarify]]` for typst-assets so cargo-deny sees the real font licenses, and do not
ship `typst_kit::fonts::embedded()` in the app. Instead, bundle Libertinus Serif (OFL-1.1) as
resource files with `OFL.txt`, and add any other font only after its own license review.

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
not just maintenance notices, so they block typst from entering `src-tauri` until upstream
moves to a fixed quick-xml (the scriv spike already uses 0.42) or the app proves it can never
feed user XML into hayagriva.

## Follow-ups
- M0: fill in the ubuntu-24.04 and macos-15 columns from the `spike-typst` job and record the
  final verdict. Owner: Orchestrator.
- Before typst enters `src-tauri` (export milestone):
  - meet the size budget (font resources, `opt-level = "s"`);
  - re-check the advisories against the then-current typst;
  - add the deny.toml license clarification;
  - add a font-license review per bundled font.
- Export milestone: peak-memory measurement on macOS (getrusage via a safe wrapper crate, if one
  is approved) and comemo eviction policy for long sessions.
- Vertical writing: choose a non-Typst export path (ADR 001 follow-up).

## Links
- CI: `spike-typst (ubuntu-24.04)`, `spike-typst (macos-15)` in `.github/workflows/spikes.yml`.
  Artifacts `spike-typst-ubuntu-24.04` and `spike-typst-macos-15` (`results/<os>.json`). Run
  URLs pending CI.
- Local results file: `spikes/typst-pdf/results/linux-local.json` (not committed).
