# 004 — FTS5 encyclopedia packs

Status: Proposed · Date: 2026-11-02 · Track: M0-C

## Context
InkSpark ships offline reference packs (an encyclopedia "Lite" pack of ~5k top articles, a
mid-size pack of ~50k, and later larger ones) that writers search without a network (PLAN.md
local-first rule; M0.md §5.3). The plan proposes one SQLite file per pack with an FTS5 index,
read through `rusqlite` (`bundled`). This spike measures the file size, build time and search
latency, and settles the tokenizer and `detail` settings.

## Hypothesis
A single SQLite FTS5 file (rusqlite `bundled`) holding top-N articles gives an acceptable size
and sub-50 ms search for Lite (5k) and mid-size (50k) packs.

## Method
- **Data: a synthetic corpus, not Wikipedia.** Real Wikipedia text could not be fetched:
  dumps.wikimedia.org is blocked in the cloud session, and per CLAUDE.md the block is reported,
  not worked around.
  - `generate_corpus`: a SplitMix64 PRNG (no `rand`).
  - Body tokens are 35 % English stopwords, 0.2 % accented real words (café, naïve, Zürich…),
    and the rest pseudo-words drawn Zipf(s = 1.07) from a 60k vocabulary of 2–3 CV syllables.
  - Each article has one planted needle `zq{id:06}x`. Lengths are uniform in
    [mean/2, 3·mean/2] words, with mean 1,200 words.
  - Raw text is 29.1 MiB (5k articles) and 290.1 MiB (50k).
- **Schema** (version 1, recorded in a `meta` table):
  - `fts5(title, body, category UNINDEXED, tokenize=…, detail=…)` with `rowid` = article id;
  - `rank` configured as `bm25(10.0, 1.0)`, so the title weighs 10×;
  - optionally external content (`articles` table) and a `thumbnails` BLOB table.
- **Build**: one transaction, then `INSERT INTO fts(fts) VALUES('optimize')`, `VACUUM`, and
  `journal_mode=DELETE`. The result is one file with no `-wal`/`-shm`/`-journal`, and
  `integrity_check` = ok.
- **Search**: the user text is parsed into balanced `"phrases"`, bare terms and `term*`
  prefixes. Each part is emitted as a quoted FTS5 string, so `NEAR`, `AND`, `-`, `:`, `^`, `(`
  in user text are literals. The query is `ORDER BY rank LIMIT n` with
  `snippet(fts, -1, '[', ']', '…', 12)`. With `detail` other than `full`, phrases are split
  into ANDed terms, because FTS5 cannot run phrase queries without positions. The connection
  is `SQLITE_OPEN_READ_ONLY` with `query_only`.
- **`fts-bench --articles 5000,50000 --mean-words 1200`**:
  - variants: unicode61/full, porter/full, unicode61/column, unicode61/full + `prefix='2 3'`,
    and trigram/full (5k only);
  - per variant: 1,000 1–2-term queries drawn **uniformly from the vocabulary** (gated), 200
    drawn **Zipf-weighted** (1,000 in the local run; a stress case: most terms then occur in
    nearly every article), and 200 two-character prefix queries `ab*`, all with limit 20;
  - open-to-first-result = `Encyclopedia::open` plus one needle search.
- **Tests** (`tests/fts.rs`, 2,000 articles, ~1 s in debug): determinism and count; the needle
  is the first and only hit; limit; phrase; `cafe` matches `café`; 31 FTS-syntax strings plus
  a proptest over arbitrary strings never error; `get_article` round-trips (internal and
  external content); a single file plus integrity_check; every variant finds the needle; a
  read-only file stays byte-identical and unwritable; a missing file errors without being
  created.
- **Local**: Linux x86_64 container (Intel Xeon, 4 vCPU), Rust 1.97.0, SQLite 3.54.1, commit
  `327a3d3`.
  - The build and query files were on **tmpfs (`/dev/shm`)** with a warm page cache, because
    the container disk was full. Local latencies are therefore optimistic, especially
    open-to-first-result.
  - The decision is made on macos-15 in the `spike-fts` job, which builds on the runner's disk.

## Criteria and results
Gated rows use the spec thresholds (M0.md §5.3). The "best" row is the variant the ADR picks
(unicode61/full) unless stated otherwise.

| Metric | Threshold | ubuntu (local container) | ubuntu-24.04 CI | macos-15 CI | Pass |
|---|---|---|---|---|---|
| 50k file / raw text (best variant) | ≤ 1.5× | 1.749× unicode61/full; best overall 1.370× (unicode61/column) | pending CI | pending CI | local: no for full, yes for column |
| 5k Lite file | ≤ 75 MB | 51.1 MiB (unicode61/full) | pending CI | pending CI | local yes |
| Term-query p95, 50k (uniform terms) | ≤ 30 ms | 0.85 ms | pending CI | pending CI | local yes |
| Term-query p95, 50k (Zipf stress, not gated) | ≤ 30 ms | 85 ms | pending CI | pending CI | local no |
| Prefix `ab*` p95, 50k | ≤ 80 ms | 2 881 ms; 269 ms with `prefix='2 3'` | pending CI | pending CI | **local no** |
| Open-to-first-result, 50k | ≤ 150 ms | 0.47 ms (tmpfs, warm) | pending CI | pending CI | local yes |
| 50k build | ≤ 180 s | 18.4 s | pending CI | pending CI | local yes |

All variants, local Linux. p95 values in ms; size is file/raw. Every result JSON metric is named
`n<articles>_<variant>_<metric>`.

| Corpus / variant | File (MiB) | Size | Build (s) | Term p95 | Term-Zipf p95 | Prefix p95 |
|---|---|---|---|---|---|---|
| 5k unicode61/full | 51.1 | 1.756× | 1.4 | 0.72 | 10.1 | 326 |
| 5k porter/full | 51.0 | 1.753× | 1.5 | 1.56 | 11.0 | 323 |
| 5k unicode61/column | 40.1 | 1.377× | 1.2 | 1.79 | 133 | 296 |
| 5k unicode61/full prefix 2,3 | 71.9 | 2.471× | 2.3 | 0.72 | 10.2 | 65 |
| 5k trigram/full | 102.4 | 3.522× | 2.8 | 2.23 | 51.1 | n/a (needs ≥ 3 chars) |
| 50k unicode61/full | 507.3 | 1.749× | 18.4 | 0.85 | 85.1 | 2 881 |
| 50k porter/full | 506.5 | 1.746× | 19.8 | 1.55 | 88.9 | 2 882 |
| 50k unicode61/column | 397.5 | 1.370× | 15.8 | 8.80 | 1 272 | 2 428 |
| 50k unicode61/full prefix 2,3 | 714.4 | 2.463× | 26.4 | 1.05 | 89.5 | 269 |

Linear extrapolation to 300k (×6 of 50k):
- unicode61/full: ≈ 3.0 GiB, build ≈ 110 s;
- unicode61/column: ≈ 2.3 GiB;
- prefix 2,3: ≈ 4.2 GiB.

Notes on the numbers:
- With `detail=full`, about 1.0× of the file is the stored article text and about 0.75× is the
  index. Size is therefore dominated by storing uncompressed text, not by FTS5.
- Switching from `bm25() AS r ORDER BY r` to the configured `rank` column cut the 5k
  Zipf-weighted term p95 from 23 ms to 10 ms (first vs second local run). Prefix queries did not
  improve.
- 2-character prefixes over this vocabulary each expand to ~600 terms that cover nearly every
  article. Ranking all of them with bm25 is the cost; the prefix index removes the expansion
  but not the ranking.
- Trigram cannot serve 2-character prefixes: FTS5 trigram only matches substrings of 3 or more
  characters.

## Decision
**Go-with-conditions** (proposed; final after macos-15 CI). Pick **unicode61
`remove_diacritics 2`, `detail=full`**:
- porter brings no size or speed benefit and stems proper nouns;
- column saves 22 % but makes common-term queries 15× slower and removes phrase search;
- trigram is reserved for future CJK packs (3.5× raw at 5k).

Conditions:
1. **Size**: compress stored article text. Use an external-content or contentless FTS5 table
   plus a compressed `body` BLOB, decompressed in `get_article` and for snippets. That needs an
   approved compression dependency, e.g. `zstd` (BSD-3/MIT) or `miniz_oxide` (MIT/Zlib/Apache).
   The target is ≤ 1.5× for 50k with `detail=full`. Until that is measured, a pack may use
   `detail=column` only if it drops phrase search.
2. **Prefix (type-ahead) search** must not run bm25 over whole-body 2-character prefixes. Run
   type-ahead against a small separate titles index (prefix-indexed), require ≥ 3 characters
   for body prefixes, or both. Measure in M7-B.
3. **Common-term queries**: the Zipf stress p95 is 85 ms at 50k. Bound it: prefer title matches
   first, or abort with a progress handler at a time budget and return the best hits so far.
4. **Real data**: the size ratio and latencies must be re-measured on real Wikipedia text in a
   CI-side step (M7-B), because the synthetic vocabulary, word lengths and Zipf tail only
   approximate English.

## Consequences
- Pack format v1 (M7-B contract):
  - a single read-only `.sqlite`, journal_mode DELETE, with a `meta` table (`schema_version`,
    `tokenizer`, `detail`, `external_content`, `prefix_index`);
  - `fts` with a configured `rank`;
  - an optional `thumbnails` table.

  The app opens packs `SQLITE_OPEN_READ_ONLY` and never writes them, so deleting a pack never
  touches projects (data-safety invariant 3).
- Next-milestone contracts: `encyclopedia_search(pack, query, limit) -> Hit[]` and
  `encyclopedia_article(pack, id)`, with the escaping rules above as the only way user text
  reaches `MATCH`.
- Pack builds stay a build-time tool (not in the app). At ~18 s per 50k the build budget is not
  a concern; 300k is ≈ 2 min.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| rusqlite (`bundled`) | 0.41.1 | MIT | SQLite + FTS5 access |
| libsqlite3-sys (bundled SQLite 3.54.1) | 0.39.1 | MIT (SQLite itself is public domain) | statically linked SQLite with FTS5 |
| thiserror | 2 | MIT OR Apache-2.0 | typed errors |
| serde_json | 1 | MIT OR Apache-2.0 | results JSON |
| proptest (dev) | 1 | MIT OR Apache-2.0 | `search(arbitrary)` property test |

No license exceptions needed; `cargo deny check` passes.

## Follow-ups
- M0: fill in the ubuntu-24.04 and macos-15 columns from the `spike-fts` job and record the
  verdict. Owner: Orchestrator.
- M7-B:
  - a real-data run on Wikipedia text in CI (blocked locally: dumps.wikimedia.org);
  - compressed-content schema and its size ratio;
  - a titles type-ahead index;
  - a common-term time budget;
  - a cold-disk open-to-first-result measurement on macOS;
  - thumbnail sizing (`thumbnail_bytes` is implemented but not benchmarked).
- CJK packs: trigram (or an ICU tokenizer) sizing on real CJK text.

## Links
- CI: `spike-fts (ubuntu-24.04)`, `spike-fts (macos-15)` in `.github/workflows/spikes.yml`.
  Artifacts `spike-fts-ubuntu-24.04` and `spike-fts-macos-15` (`results/<os>.json`). Run URLs
  pending CI.
- Local results file: `spikes/fts5-encyclopedia/results/linux-local.json` (not committed).
