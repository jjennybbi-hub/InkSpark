# 004 — FTS5 encyclopedia packs

Status: Accepted (No-go) · Date: 2026-11-02 · Track: M0-C

## Context
InkSpark ships offline reference packs that writers search without a network (PLAN.md
local-first rule; M0.md §5.3):
- an encyclopedia "Lite" pack of ~5k top articles;
- a mid-size pack of ~50k articles;
- larger packs later.

The plan proposes one SQLite file per pack with an FTS5 index, read through `rusqlite`
(`bundled`). This spike measures file size, build time and search latency, and settles the
tokenizer and `detail` settings.

## Hypothesis
A single SQLite FTS5 file (rusqlite `bundled`) holding top-N articles gives an acceptable size
and sub-50 ms search for Lite (5k) and mid-size (50k) packs.

## Method
- **Data: a synthetic corpus, not Wikipedia.** Real Wikipedia text could not be fetched:
  dumps.wikimedia.org is blocked in the cloud session, and per CLAUDE.md the block is reported,
  not worked around. `generate_corpus`:
  - uses a SplitMix64 PRNG (no `rand`);
  - makes body tokens 35 % English stopwords and 0.2 % accented real words (café, naïve,
    Zürich…). The rest are pseudo-words drawn Zipf(s = 1.07) from a 60k vocabulary of 2–3 CV
    syllables;
  - plants one needle `zq{id:06}x` per article;
  - draws article lengths uniformly from [mean/2, 3·mean/2] words, with mean 1,200.

  Raw text is 30.5 MB for 5k articles and 304.1 MB for 50k (MB = 10⁶ bytes everywhere).
- **Schema** (version 1, recorded in a `meta` table):
  - `fts5(title, body, category UNINDEXED, tokenize=…, detail=…)` with `rowid` = article id;
  - `rank` configured as `bm25(10.0, 1.0)`, so the title weighs 10×;
  - optional pieces: external content (`articles` table), FTS5 `prefix=` indexes, a separate
    prefix-indexed `titles` table, and a `thumbnails` BLOB table.
- **Build**:
  - written to `<path>.tmp` in one transaction;
  - then `INSERT INTO fts(fts) VALUES('optimize')`, `VACUUM` and `journal_mode=DELETE`;
  - renamed to `<path>` only on success. On error the temporary file and its journal are
    removed.

  The result is one file with no `-wal`/`-shm`/`-journal`, and `integrity_check` = ok.
- **Search**:
  - the user text is parsed into balanced `"phrases"`, bare terms and `term*` prefixes;
  - each part is emitted as a quoted FTS5 string, so `NEAR`, `AND`, `-`, `:`, `^` and `(` in
    user text are literals;
  - the query runs `ORDER BY rank LIMIT n` with `snippet(fts, -1, '[', ']', '…', 12)`;
  - the connection is `SQLITE_OPEN_READ_ONLY` with `query_only`.
- **Variants**: unicode61/full, porter/full, unicode61/column, unicode61/full +
  `prefix='2 3'`, unicode61/full + a titles table (`prefix='2 3'`), and trigram/full (5k only).
- **`fts-bench --articles 5000,50000 --mean-words 1200`** query sets per variant, all with
  limit 20:
  - **term** (gated): 1,000 1–2-term queries drawn **corpus-weighted (Zipf)** from the
    vocabulary;
  - **rare_term** (context): 1,000 queries drawn uniformly from the vocabulary, so mostly rare
    terms;
  - **prefix** (gated): 200 two-character body prefixes `ab*` of Zipf-drawn words;
  - **prefix3** (context): 200 three-character body prefixes `abc*`;
  - on the titles variant, **title_prefix** and **title_prefix3**: the same prefixes against the
    titles table;
  - **open-to-first-result** = `Encyclopedia::open` plus one needle search.

  `gate_*` metrics in the results JSON are taken from the **chosen variant (unicode61/full)**.
  The per-variant metrics carry the same thresholds for context only.
- **Disclosure: the gated term set changed mid-spike and was then reverted.** The first run
  gated term p95 on Zipf-weighted queries. The second run moved the gate to uniform-vocabulary
  queries, which passed, and kept Zipf as "stress". After review, the Orchestrator ruled that
  corpus-weighted is the natural reading of §5.3. The gate is Zipf again (this run), and the
  uniform set is context, renamed `rare_term`. The same review moved the size-ratio gate from
  the minimum over variants to the chosen variant, and moved units from MiB to MB.
- **Tests** (`tests/fts.rs` with 2,000 articles, plus unit tests; ~1 s in debug):
  - determinism and count;
  - the needle is the first and only hit;
  - limit, phrase, and `cafe` matching `café`;
  - 31 FTS-syntax strings plus a proptest over arbitrary strings never error;
  - `get_article` round-trips (internal and external content);
  - the build leaves a single file that passes `integrity_check`;
  - every variant finds the needle;
  - a read-only file stays byte-identical and unwritable;
  - a missing file errors without being created;
  - a failed build leaves no file;
  - title type-ahead works.
- **Local**: Linux x86_64 container (Intel Xeon, 4 vCPU), Rust 1.97.0, SQLite 3.54.1, commit
  `a0353f8`.
  - The build and query files were on **tmpfs (`/dev/shm`)** with a warm page cache, because the
    container disk was full. Local latencies are therefore optimistic, especially
    open-to-first-result.
  - The full run took 40 minutes; the CI `spike-fts` timeout is 120 minutes.
  - The decision is made on macos-15 in the `spike-fts` job, which builds on the runner's disk.

## Criteria and results
Gates, chosen variant unicode61/full (`gate_*` in the results JSON). CI columns are from the
`spike-fts` job of Spikes run 41407643939 on `d75546e` (ubuntu-24.04 x86_64, macos-15 aarch64,
SQLite 3.54.1), building on the runner's disk; macos-15 decides.

| Metric | Threshold | ubuntu (local container, tmpfs) | ubuntu-24.04 CI | macos-15 CI | Pass |
|---|---|---|---|---|---|
| 50k file / raw text | ≤ 1.5× | **1.749×** (532.0 / 304.1 MB) | **1.749×** (532.0 / 304.1 MB) | **1.749×** (532.0 / 304.1 MB) | **no** |
| 5k Lite file | ≤ 75 MB | 53.6 MB | 53.6 MB | 53.6 MB | yes |
| Term-query p95, corpus-weighted (50k) | ≤ 30 ms | **86.4 ms** (5k: 10.3 ms) | **100.7 ms** (5k: 11.6 ms) | **87.2 ms** (5k: 9.6 ms) | **no** (5k yes) |
| Prefix `ab*` p95 (50k) | ≤ 80 ms | **2 873 ms** (5k: 325 ms) | **2 805 ms** (5k: **323 ms**) | **2 594 ms** (5k: **300 ms**) | **no** (5k also no) |
| Open-to-first-result (50k) | ≤ 150 ms | 0.55 ms (tmpfs, warm) | 0.45 ms | 0.42 ms | yes |
| 50k build | ≤ 180 s | 18.0 s | 21.6 s | 15.5 s | yes |

CI open-to-first-result ran right after the build on the same runner, so the page cache was
warm; a cold-disk open is not measured. Sizes are identical on all three machines (the corpus
and build are deterministic).

CI context for the alternatives (p95, ubuntu-24.04 / macos-15):
- titles table, 50k: title `ab*` 8.7 / 8.2 ms, title `abc*` 0.99 / 0.84 ms, file 534.8 MB
  (1.758×);
- body `prefix='2 3'`, 50k: `ab*` 325 / 291 ms, file 749.1 MB (2.463×); at 5k the file is
  75.4 MB, over the Lite limit;
- unicode61/column, 50k: 1.370×, but term p95 1 273 / 1 244 ms;
- 3-character body prefix `abc*`, 50k: 631 / 603 ms.

All variants, local Linux, as context. p95 values in ms; size is file/raw. Results JSON metric
names are `n<articles>_<variant>_<metric>`. "—" means not measured for that variant.

| Corpus / variant | File (MB) | Size | Build (s) | Term p95 | Rare-term p95 | Prefix `ab*` p95 | Prefix `abc*` p95 | Title `ab*` / `abc*` p95 |
|---|---|---|---|---|---|---|---|---|
| 5k unicode61/full (chosen) | 53.6 | 1.756× | 1.7 | 10.3 | 0.76 | 326 | 73.6 | — |
| 5k porter/full | 53.5 | 1.753× | 1.6 | 11.8 | 1.57 | 343 | 76.9 | — |
| 5k unicode61/column | 42.0 | 1.377× | 1.2 | 126 | 1.75 | 292 | 173 | — |
| 5k unicode61/full prefix 2,3 | **75.4 (> 75: fails Lite)** | 2.471× | 2.2 | 10.6 | 0.72 | 70.3 | 24.4 | — |
| 5k unicode61/full + titles table | 53.9 | 1.767× | 1.4 | 10.7 | 0.74 | (as chosen) | (as chosen) | 0.75 / 0.11 |
| 5k trigram/full | 107.4 | 3.522× | 2.9 | 53.6 | 2.23 | n/a (needs ≥ 3 chars) | 26.7 | — |
| 50k unicode61/full (chosen) | 532.0 | 1.749× | 18.0 | 86.4 | 0.85 | 2 873 | 639 | — |
| 50k porter/full | 531.1 | 1.746× | 17.3 | 88.8 | 1.54 | 2 813 | 639 | — |
| 50k unicode61/column | 416.8 | 1.370× | 14.4 | 1 208 | 8.36 | 2 343 | 1 566 | — |
| 50k unicode61/full prefix 2,3 | 749.1 | 2.463× | 25.1 | 87.1 | 0.83 | 265 | 134 | — |
| 50k unicode61/full + titles table | 534.8 | 1.758× | 16.6 | 83.4 | 0.84 | (as chosen) | (as chosen) | **7.4 / 0.85** |

Linear extrapolation to 300k (×6 of 50k):
- unicode61/full: ≈ 3.2 GB, build ≈ 108 s;
- unicode61/column: ≈ 2.5 GB;
- prefix 2,3: ≈ 4.5 GB;
- + titles table: ≈ 3.2 GB.

What the numbers say:
- **Size.** With `detail=full`, about 1.0× of the file is the stored, uncompressed article text
  and about 0.75× is the index. Only `detail=column` gets under 1.5×, and it makes
  corpus-weighted term queries 14× slower (1.2 s p95 at 50k) and removes phrase search.
- **Term latency.** Rare terms are fast (< 1 ms p95 at 50k). Corpus-frequent terms match
  nearly every article, and bm25 scores every match before `LIMIT`, so p95 grows roughly
  linearly with corpus size (10 → 86 ms from 5k to 50k). The configured `rank` column already
  halved the 5k figure versus `bm25() AS r ORDER BY r`.
- **Prefix latency.** A 2-character body prefix expands to ~600 terms covering nearly every
  article. Three characters cut p95 ~4.5× (p50 ~35×), but 50k p95 is still 639 ms. A body
  `prefix='2 3'` index removes the expansion but not the ranking (265 ms), and pushes Lite over
  75 MB. A separate prefix-indexed **titles table** answers 2- and 3-character type-ahead in
  7.4 / 0.85 ms p95 at 50k for +0.5 % file size.
- **Trigram** cannot serve 2-character prefixes (FTS5 trigram matches substrings of 3 or more
  characters) and is 3.5× raw. Its size is recorded for future CJK packs.

## Decision
**User decision (2026-11-02):** take the revised design ("Proposed path to Go-with-conditions" below). M7-B builds it and must re-measure every condition against the gates before the encyclopedia ships.

**No-go for the design as measured**, confirmed in CI on both OSes. It fails three gates:
- the 50k size ratio: 1.75× vs 1.5× (1.749× on every machine);
- corpus-weighted term p95 at 50k: 87 ms (macos-15) / 101 ms (ubuntu-24.04) vs 30 ms;
- prefix `ab*` p95 at 50k: 2.6 s (macos-15) / 2.8 s (ubuntu-24.04) vs 80 ms. Even the 5k Lite
  pack fails it: 300 ms / 323 ms.

The tokenizer and detail choice still stands: unicode61 `remove_diacritics 2`, `detail=full`.
- porter brings no size or speed benefit and stems proper nouns;
- column trades phrase search and common-term speed for size;
- trigram is reserved for CJK.

**Proposed path to Go-with-conditions** (needs an Orchestrator/user decision, plus a
re-measure gate before M7-B). Each condition must be implemented in the spike and re-measured
against the same thresholds before it counts:
1. **Size**: compress the stored article text. Use an external-content or contentless FTS5
   table plus a compressed `body` BLOB, decompressed in `get_article` and for snippets.
   - This needs an approved compression dependency, e.g. `zstd` (BSD-3/MIT) or `miniz_oxide`
     (MIT/Zlib/Apache).
   - Expected ≈ 0.75× index + ~0.35–0.45× compressed text ≈ 1.1–1.2×, not yet measured.
2. **Prefix**: type-ahead goes to the separate prefix-indexed titles table, which is measured:
   7.4 ms p95 at 50k locally, 8.2 ms (macos-15) and 8.7 ms (ubuntu-24.04) in CI. Body prefix search requires ≥ 3 characters and is not part of type-ahead.
   This changes the meaning of the prefix gate from "body `ab*`" to "title type-ahead `ab*`",
   which is a decision for the Orchestrator/user, not this spike.
3. **Common-term queries**: bound bm25-over-everything. Options:
   - rank title matches first;
   - stop with an SQLite progress handler at a time budget and return the best hits so far;
   - skip ranking for terms above a document-frequency cap.

   The bound must be re-measured against the 30 ms corpus-weighted gate.
4. **Real data**: re-measure size and latency on real Wikipedia text in a CI-side step
   (M7-B). The synthetic vocabulary, word lengths and Zipf tail only approximate English.

## Consequences
- M7-B (encyclopedia packs) cannot start on this design. It is blocked on the decision about
  the proposed path, and then on the re-measure gate.
- Pack format v1 (M7-B contract, if the path above is accepted):
  - a single read-only `.sqlite`, journal_mode DELETE, with a `meta` table (`schema_version`,
    `tokenizer`, `detail`, `external_content`, `prefix_index`, `title_index`);
  - `fts` with a configured `rank`;
  - a `titles` table for type-ahead;
  - an optional `thumbnails` table.

  The app opens packs `SQLITE_OPEN_READ_ONLY` and never writes them, so deleting a pack never
  touches projects (data-safety invariant 3).
- Packs on read-only media (bundled resources, signed app bundles, mounted images) should be
  opened as `file:…?immutable=1` URIs in M7-B. That skips locking and change detection, which
  read-only locations may not support. The spike uses plain `SQLITE_OPEN_READ_ONLY`.
- Next-milestone contracts: `encyclopedia_search(pack, query, limit) -> Hit[]`,
  `encyclopedia_titles(pack, prefix, limit) -> Hit[]` and `encyclopedia_article(pack, id)`.
  The escaping rules above are the only way user text reaches `MATCH`.
- Pack builds stay a build-time tool, not part of the app. At ~18 s per 50k the build budget is
  not a concern; 300k takes ≈ 2 minutes.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| rusqlite (`bundled`) | 0.41.1 | MIT | SQLite + FTS5 access |
| libsqlite3-sys (bundled SQLite 3.54.1) | 0.39.1 | MIT (SQLite itself is public domain) | statically linked SQLite with FTS5 |
| thiserror | 2 | MIT OR Apache-2.0 | typed errors |
| serde_json | 1 | MIT OR Apache-2.0 | results JSON |
| proptest (dev) | 1 | MIT OR Apache-2.0 | `search(arbitrary)` property test |

No license exceptions are needed; `cargo deny check` passes.

## Follow-ups
- Orchestrator/user, before M7-B: decide whether to take the proposed path to
  Go-with-conditions (including the change of the prefix gate to title type-ahead and a
  compression dependency). Until then the encyclopedia feature has no approved design.
- Before M7-B (re-measure gate): implement conditions 1–3 in the spike and re-run `fts-bench`.
- M7-B:
  - a real-data run on Wikipedia text in CI (blocked locally: dumps.wikimedia.org);
  - `immutable=1` opening for read-only media;
  - a cold-disk open-to-first-result measurement on macOS;
  - thumbnail sizing (`thumbnail_bytes` is implemented but not benchmarked).
- CJK packs: trigram (or an ICU tokenizer) sizing on real CJK text.

## Links
- CI run (Spikes, jobs `spike-fts (ubuntu-24.04)` and `spike-fts (macos-15)`, code at
  `d75546e`): https://github.com/jjennybbi-hub/InkSpark/actions/runs/41407643939
- Artifacts: `spike-fts-ubuntu-24.04`, `spike-fts-macos-15` (`results/<os>.json`).
- Local results file: `spikes/fts5-encyclopedia/results/linux-local.json` (not committed).
