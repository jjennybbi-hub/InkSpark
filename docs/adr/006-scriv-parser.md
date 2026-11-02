# 006 — Scrivener 3 (.scriv) parser

Status: Accepted · Date: 2026-11-02 · Track: M0-D

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
  - `src/lib.rs`: `read_project` opens files only for reading (`fs::read`, `File::open`,
    `fs::metadata` / `symlink_metadata`, `fs::read_dir`). Missing or unreadable per-item files
    become warnings.
- Fixtures: the Test-author's six hand-written packages in `spikes/scriv-parser/fixtures/`.
  **They are synthetic.** Real Scrivener samples could not be downloaded: gutenberg.org and
  GitHub downloads are blocked in the cloud session (risk R12), so no real project was tested.
- Tests: `golden.rs`, `malformed.rs`, `rtf.rs` (48 unit cases), `source_untouched.rs`,
  `props.rs` (proptest), `perf.rs` (1,000 generated documents), plus one in-crate unit test
  (`src/rtf.rs`) for a truncated `\'e` at end of input.
- Local run: Linux container, 4 vCPU Intel Xeon, Rust 1.97.0, on the Track D worktree branch
  after the review fixes. Where the CI numbers come from (added by the Orchestrator):
  - functional tests: ci.yml `check` job (`cargo test --workspace`, 3 OSes);
  - 2,000-case property tests: ci.yml `check` job, step "scriv-parser property tests";
  - 1,000-document timing: spikes.yml `spike-scriv` job
    (`cargo test --release -p inkspark-spike-scriv -- --ignored --nocapture perf`).
- Commands:
  - `cargo test -p inkspark-spike-scriv`
  - `PROPTEST_CASES=2000 cargo test --release -p inkspark-spike-scriv --test props`
  - `cargo test --release -p inkspark-spike-scriv -- --ignored perf` (5 runs)

## Criteria and results
CI sources, code at `d75546e`: functional and property tests from the `check (macos-15)` job of
CI run 41407643715; the 1,000-document timing from the `spike-scriv` job of Spikes run
41407643939 on both OSes. The ubuntu `check` job of that CI run ran out of disk (fixed in
`9aadafe`, ADR 007), so ubuntu functional results in CI are from the final green run (see M0
report), not from this run.

| Metric | Threshold | ubuntu | macos | Pass |
|---|---|---|---|---|
| Goldens exact (5 fixtures) | all equal | 5/5 (local) | 5/5 (CI `check`) | yes |
| `malformed` → `Err(Xml)`; non-package → `Err(NotAScrivPackage)` | yes | yes (local) | yes (CI `check`) | yes |
| RTF unit cases (`rtf.rs` + in-crate test) | all pass | 48/48 + 1/1 (local) | 48/48 + 1/1 (CI `check`) | yes |
| Panics in proptest, 2,000 cases × 8 properties (+256 fs cases) | 0 | 0, 0.74 s (local, release) | 0; 9/9 property tests, 10.4 s (CI `check`, props step, `PROPTEST_CASES=2000`, debug) | yes |
| 50,000 nested RTF groups (closed, unclosed, inside a destination) | no stack overflow | ok (local) | ok (CI `check`) | yes |
| Sources untouched (bytes, len, permissions, mtimes) | equal | equal (local) | equal (CI `check`) | yes |
| `read_project`, 1,000 docs, release | < 2,000 ms | 50–52 ms, median 51 ms (local); **52 ms** (CI `spike-scriv`) | **65 ms** (CI `spike-scriv`) | yes |

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
**Go.** quick-xml plus the in-house RTF tokenizer meets every criterion. In CI,
`read_project` reads 1,000 documents in 65 ms on macos-15 and 52 ms on ubuntu-24.04 (about 30×
under the 2 s budget). The goldens, malformed-input, RTF, source-untouched and 2,000-case
property tests pass, with no panics and no stack overflow. `rtf-parser 0.4` is not adopted.

Caveat: all fixtures are synthetic, because real Scrivener samples could not be downloaded
(R12). The parser is the M6 importer's base, behind the importer's feature flag, and M6 must
run it against real Scrivener 3 projects before the importer is called compatible.

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
- Hardening against crafted packages:
  - a `UUID` is joined into a path only if it is plain `[0-9A-Za-z-]+`, so a crafted `.scrivx`
    cannot make the reader open files outside `Files/Data`;
  - a symlinked item directory is ignored (warning `ignored symlinked data directory for
    <UUID>`);
  - an item file is read only if `symlink_metadata` says it is a regular file (otherwise
    `ignored non-regular file <UUID>/<file>`) and it is at most 64 MiB (otherwise
    `ignored oversized file <UUID>/<file>`); the read itself is also bounded;
  - an item file that exists but cannot be read gives `unreadable <UUID>/<file>: <error>`.

  These warning strings are not in the fixture README and no fixture covers them (a note for
  the Test-author). For a `Text` item, any of them also leaves `missing content for <UUID>`.
- A `\'h` escape cut off at end of input consumes its dangling digit (`a\'e` gives `a`), as
  the README requires. This is covered by an in-crate unit test; a matching case could be
  added to `tests/rtf.rs` by the Test-author.
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
- M6 (before the importer ships): real Scrivener 3 samples through a CI-side fixture fetch (Literature & Latte sample
  projects, user-provided test projects), with goldens reviewed by hand. Local downloads are
  blocked (R12); no workaround was attempted.
- M6: fuzzing: cargo-fuzz targets for `rtf_to_doc` and `parse_scrivx` (the proptest soups are the seed
  corpus), plus a fuzz target for `read_project` on generated packages.
- M6: comments/annotations, inline images and tables as structured content; detection of
  older (Scrivener 2) packages with a clear "unsupported" error instead of an empty binder.

## Links
- CI run (ci.yml, `check (macos-15)`, functional and 2,000-case property tests, code at
  `d75546e`): https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643715
- Spikes run (`spike-scriv`, 1,000-document timing on ubuntu-24.04 and macos-15):
  https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643939
- Artifacts: none (the numbers are read from the job logs).
