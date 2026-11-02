# 006 — Scrivener 3 (.scriv) parser

Status: Proposed · Date: 2026-11-02 · Track: M0-D

## Context
InkSpark imports Scrivener 3 projects (PLAN.md importer milestone, M6). A `.scriv` package is a
directory with one `.scrivx` XML binder and per-item `Files/Data/<UUID>/{content.rtf,
synopsis.txt, notes.rtf}`. The importer must read the binder tree, labels, status and text,
must never modify the source (data-safety invariant 2), and must never panic or overflow the
stack on hostile input. This spike (M0.md §6.2) decides whether quick-xml plus a small in-house
RTF tokenizer is enough, or whether an existing RTF crate should be used.

## Hypothesis
quick-xml 0.42 plus a ~400-line iterative RTF tokenizer (encoding_rs for `\'hh` code pages)
reads a Scrivener 3 project exactly as specified in `spikes/scriv-parser/fixtures/README.md`,
read-only and panic-free, and parses a 1,000-document project in under 2 s (release). It is
better than `rtf-parser 0.4` (MIT) for this job.

## Method
- Crate `inkspark-spike-scriv` (`spikes/scriv-parser`), `#![forbid(unsafe_code)]`.
  - `src/scrivx.rs`: event-driven quick-xml walk with an explicit context stack (no recursion).
    End-tag names are checked; end of input with open elements, a non-`ScrivenerProject` root,
    unknown entities and text outside the root are `ScrivError::Xml`.
  - `src/rtf.rs`: byte-level tokenizer. Formatting is saved on a `Vec` stack per `{`; ignored
    destinations (`{\*\…}` except `\Scrv_fn`, `\fonttbl`, `\colortbl`, `\stylesheet`, `\info`,
    `\pict`) are skipped with a depth counter, so 50,000 nested groups cost no stack.
  - `src/lib.rs`: `read_project` opens files only with `std::fs::read` / `fs::metadata` /
    `fs::read_dir` (read-only). Missing or unreadable per-item files become warnings.
- Fixtures: the Test-author's six hand-written packages in `spikes/scriv-parser/fixtures/`.
  **They are synthetic.** Real Scrivener samples could not be downloaded: gutenberg.org and
  GitHub downloads are blocked in the cloud session (risk R12), so no real project was tested.
- Tests: `golden.rs`, `malformed.rs`, `rtf.rs` (48 unit cases), `source_untouched.rs`,
  `props.rs` (proptest), `perf.rs` (1,000 generated documents).
- Local run: Linux container, 4 vCPU Intel Xeon, Rust 1.97.0, commit `0014176` on the Track D
  worktree branch. CI numbers (macos-15 `check` job, which runs `cargo test --workspace`) are
  added by the Orchestrator.
- Commands:
  - `cargo test -p inkspark-spike-scriv`
  - `PROPTEST_CASES=2000 cargo test --release -p inkspark-spike-scriv --test props`
  - `cargo test --release -p inkspark-spike-scriv -- --ignored perf` (5 runs)

## Criteria and results
| Metric | Threshold | ubuntu | macos | Pass |
|---|---|---|---|---|
| Goldens exact (5 fixtures) | all equal | 5/5 (local) | pending CI | local yes |
| `malformed` → `Err(Xml)`; non-package → `Err(NotAScrivPackage)` | yes | yes (local) | pending CI | local yes |
| RTF unit cases (`rtf.rs`) | all pass | 48/48 (local) | pending CI | local yes |
| Panics in proptest, 2,000 cases × 8 properties (+256 fs cases) | 0 | 0, 1.06 s (local, release) | pending CI | local yes |
| 50,000 nested RTF groups (closed, unclosed, inside a destination) | no stack overflow | ok (local) | pending CI | local yes |
| Sources untouched (bytes, len, permissions, mtimes) | equal | equal (local) | pending CI | local yes |
| `read_project`, 1,000 docs, release | < 2,000 ms | 44–53 ms, median 47 ms (local) | pending CI | local yes |

### rtf-parser 0.4 evaluation (not adopted)
`rtf-parser 0.4.3` (MIT) was built in a throwaway crate outside the repo and run on the same
fixtures and edge cases:

| Case | in-house | rtf-parser 0.4.3 |
|---|---|---|
| Paragraph structure | `Vec<Vec<Run>>` per README | `get_text()` concatenates paragraphs with no separator |
| `{\info{\title …}}` | ignored | title and author leak into the text |
| `{\pict … 0102ab}` | ignored | hex data leaks into the text |
| `{\*\Scrv_fn …}` footnote | kept inline | dropped |
| `\'93 \'94 \'80` (cp1252) | `“ ” €` | Latin-1 control chars U+0093/U+0094/U+0080 |
| `Na\u239?ve r\u233?sum\u233?` | `Naïve résumé` | `Na` (rest of the paragraph lost) |
| Surrogate pair `\u-10179?\u-8704?` | 😀 | empty |
| Unclosed groups / truncated `\'e` | tolerated | `Err(InvalidLastChar)` |
| Stray `}` after the document | ignored | `Err(MalformedPainterStack)` |
| 50,000 nested groups | ok | ok |
| Dependency footprint | encoding_rs | pulls wasm-bindgen, js-sys, web-sys, tsify, serde |

It is worse on every Scrivener-relevant case, so the in-house tokenizer stays.

## Decision
**Go-with-conditions** (pending the macos-15 `check` run):
1. The parser is used as the M6 importer's base, behind the importer's feature flag.
2. Before the importer is accepted, it is run against real Scrivener 3 projects (see
   follow-ups); the synthetic fixtures alone are not enough to claim compatibility.

## Consequences
- Unsupported, by design for M0, and listed for M6:
  - images in RTF (`\pict` is dropped; `\binN` raw data is not special-cased);
  - tables (cell text is kept, but `\trowd`/`\cell`/`\row` boundaries are lost);
  - comments and annotations: Scrivener-specific `{\*\Scrv_…}` destinations other than
    `\Scrv_fn` are ignored like any unknown destination, and the separate comment files are not
    read;
  - snapshots (`Snapshots/`), `content.styles`, document templates, keywords, custom
    metadata, collections;
  - multi-byte code pages (`\ansicpg932/936/949/950`): only single-byte Windows code pages
    and Mac Roman are decoded; anything else falls back to cp1252.
- Binder nesting is capped at 512 levels (`ScrivError::Xml`), because the derived
  `Drop`/`Clone`/`Serialize` of `BinderItem` recurse. Real projects are far below this.
- A `UUID` attribute that is empty, `.`/`..`, or contains `/`, `\`, `:` or NUL is never joined
  into a path, so a crafted `.scrivx` cannot make the reader open files outside `Files/Data`.
- A per-item file that exists but cannot be read gives the warning
  `unreadable <UUID>/<file>: <error>`; this string is not covered by the fixture README.
- No contract changes are needed in M0. M6 needs an `ImportReport` contract (warnings,
  counts) via the Orchestrator.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| quick-xml | 0.42.0 | MIT | `.scrivx` binder parsing (already in the stub's Cargo.toml) |
| encoding_rs | 0.8.44 | (Apache-2.0 OR MIT) AND BSD-3-Clause | `\'hh` and raw-byte code-page decoding |
| serde, serde_json | 1 | MIT OR Apache-2.0 | golden JSON shape |
| thiserror | 2 | MIT OR Apache-2.0 | `ScrivError` |
| proptest (dev) | 1.12.0 | MIT OR Apache-2.0 | property tests |

`rtf-parser` was evaluated outside the workspace and not added.

## Follow-ups
- M6: real Scrivener 3 samples through a CI-side fixture fetch (Literature & Latte sample
  projects, user-provided test projects), with goldens reviewed by hand. Local downloads are
  blocked (R12); no workaround was attempted.
- M6: cargo-fuzz targets for `rtf_to_doc` and `parse_scrivx` (the proptest soups are the seed
  corpus), plus a fuzz target for `read_project` on generated packages.
- M6: comments/annotations, inline images and tables as structured content; detection of
  older (Scrivener 2) packages with a clear "unsupported" error instead of an empty binder.

## Links
- CI run: pending (Orchestrator adds the macos-15 `check` link).
- Artifacts: none (runs inside `check` via `cargo test --workspace`).
