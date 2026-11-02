//! `fts-bench --articles 5000,50000 --mean-words 1200 --out PATH [--work-dir DIR]` (M0 §5.3).
//!
//! For each corpus size, builds the variants {unicode61/full, porter/full, unicode61/column,
//! unicode61/full + `prefix='2 3'`, unicode61/full + a separate prefix-indexed titles table,
//! trigram/full (5k only)}. Each variant is measured for file size, build time,
//! open-to-first-result, and the p95 of these query sets, all drawn from the corpus vocabulary:
//! - 1,000 1–2-term queries, Zipf-weighted (corpus frequency): **gated** term latency;
//! - 1,000 1–2-term queries uniform over the vocabulary (`rare_term`): context only;
//! - 200 two-character body prefix queries (`ab*`): **gated** prefix latency;
//! - 200 three-character body prefix queries (`abc*`): context;
//! - on the titles variant, the same 2- and 3-character prefixes against the titles table.
//!
//! Gates (`gate_*` metrics) apply to the chosen variant, unicode61/full ([`CHOSEN`]); the
//! per-variant metrics carry the same thresholds for context. Sizes use MB = 10^6 bytes.
//! Writes the §3.9 results JSON to `--out`. Threshold misses are reported in the JSON, not as a
//! failing exit code. Each variant's work directory is removed when it goes out of scope,
//! including on error.
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use inkspark_spike_fts::{
    BuildOptions, Comparator, CorpusSpec, Detail, Encyclopedia, FtsSpikeError, Hit, IndexTuning,
    Metric, SplitMix64, Tokenizer, VOCABULARY_SIZE, Zipf, build_encyclopedia_tuned,
    generate_corpus, needle_term, vocabulary_word, write_results_with_notes,
};

const SEED: u64 = 0x00C0_FFEE;
const TERM_QUERIES: usize = 1_000;
const PREFIX_QUERIES: usize = 200;
const LIMIT: u32 = 20;
/// Trigram is built only for corpora up to this size (M0 §5.3: "5k only").
const TRIGRAM_MAX_ARTICLES: u32 = 5_000;
/// Decimal megabyte, the unit of every size threshold.
const MB: f64 = 1_000_000.0;
/// The variant ADR 004 picks; the `gate_*` metrics are taken from it.
const CHOSEN: &str = "unicode61_full";
#[derive(Debug, thiserror::Error)]
enum BenchError {
    #[error(
        "usage: {0}\nusage: fts-bench --articles N[,N...] --mean-words W --out PATH [--work-dir DIR]"
    )]
    Usage(String),
    #[error(transparent)]
    Fts(#[from] FtsSpikeError),
    #[error("io ({context}): {source}")]
    Io {
        context: String,
        source: std::io::Error,
    },
}

struct Args {
    articles: Vec<u32>,
    mean_words: u32,
    out: PathBuf,
    work_dir: PathBuf,
}

fn parse_args() -> Result<Args, BenchError> {
    let mut articles = vec![5_000, 50_000];
    let mut mean_words = 1_200;
    let mut out = None;
    let mut work_dir = std::env::temp_dir();
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || {
            it.next()
                .ok_or_else(|| BenchError::Usage(format!("{flag} needs a value")))
        };
        match flag.as_str() {
            "--articles" => {
                let v = value()?;
                articles = v
                    .split(',')
                    .map(|n| n.trim().parse::<u32>())
                    .collect::<Result<_, _>>()
                    .map_err(|_| BenchError::Usage(format!("--articles: bad list {v}")))?;
            }
            "--mean-words" => {
                let v = value()?;
                mean_words = v
                    .parse()
                    .map_err(|_| BenchError::Usage(format!("--mean-words: not a number: {v}")))?;
            }
            "--out" => out = Some(PathBuf::from(value()?)),
            "--work-dir" => work_dir = PathBuf::from(value()?),
            other => return Err(BenchError::Usage(format!("unknown argument {other}"))),
        }
    }
    let out = out.ok_or_else(|| BenchError::Usage(String::from("--out is required")))?;
    if articles.is_empty() || articles.contains(&0) {
        return Err(BenchError::Usage(String::from(
            "--articles must be positive",
        )));
    }
    Ok(Args {
        articles,
        mean_words,
        out,
        work_dir,
    })
}

fn io_err(context: &Path) -> impl FnOnce(std::io::Error) -> BenchError + '_ {
    move |source| BenchError::Io {
        context: context.display().to_string(),
        source,
    }
}

/// A work directory that is removed when dropped, so an error mid-variant never leaves a
/// half-built pack (possibly hundreds of MB) behind.
struct WorkDir {
    path: PathBuf,
}

impl WorkDir {
    fn create(path: PathBuf) -> Result<Self, BenchError> {
        if path.exists() {
            return Err(BenchError::Io {
                context: path.display().to_string(),
                source: std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "work directory already exists",
                ),
            });
        }
        std::fs::create_dir_all(&path).map_err(io_err(&path))?;
        Ok(Self { path })
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        // Only this bench's own directory, created above.
        if let Err(err) = std::fs::remove_dir_all(&self.path) {
            eprintln!("fts-bench: could not remove {}: {err}", self.path.display());
        }
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Nearest-rank percentile of `v` (sorted in place).
fn percentile(v: &mut [f64], p: f64) -> f64 {
    v.sort_by(f64::total_cmp);
    if v.is_empty() {
        return f64::NAN;
    }
    let rank = ((p / 100.0) * v.len() as f64).ceil() as usize;
    v.get(rank.saturating_sub(1).min(v.len() - 1))
        .copied()
        .unwrap_or(f64::NAN)
}

struct Timings {
    p50: f64,
    p95: f64,
    max: f64,
    mean_hits: f64,
}

impl Timings {
    fn describe(&self, name: &str) -> String {
        format!(
            "{name} p50/p95/max={:.2}/{:.2}/{:.2} ms (mean hits {:.1})",
            self.p50, self.p95, self.max, self.mean_hits
        )
    }
}

fn time_queries(
    queries: &[String],
    mut search: impl FnMut(&str) -> Result<Vec<Hit>, FtsSpikeError>,
) -> Result<Timings, BenchError> {
    let mut lat = Vec::with_capacity(queries.len());
    let mut hits = 0usize;
    for q in queries {
        let start = Instant::now();
        hits += search(q)?.len();
        lat.push(ms(start.elapsed()));
    }
    let max = lat.iter().copied().fold(0.0, f64::max);
    Ok(Timings {
        p50: percentile(&mut lat, 50.0),
        p95: percentile(&mut lat, 95.0),
        max,
        mean_hits: hits as f64 / queries.len().max(1) as f64,
    })
}

/// 1–2-term queries. `zipf_weighted` draws terms by corpus frequency (the gated set: common
/// terms occur in nearly every article); otherwise uniformly over the vocabulary (mostly rare
/// terms).
fn term_queries(seed: u64, zipf_weighted: bool) -> Vec<String> {
    let zipf = Zipf::vocabulary();
    let mut rng = SplitMix64::new(seed);
    (0..TERM_QUERIES)
        .map(|_| {
            let terms = 1 + rng.below(2);
            (0..terms)
                .map(|_| {
                    let rank = if zipf_weighted {
                        zipf.sample(&mut rng)
                    } else {
                        rng.below(VOCABULARY_SIZE)
                    };
                    vocabulary_word(rank)
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

/// `chars`-character prefixes of Zipf-weighted vocabulary words, as `ab*` queries.
fn prefix_queries(seed: u64, chars: usize) -> Vec<String> {
    let zipf = Zipf::vocabulary();
    let mut rng = SplitMix64::new(seed);
    (0..PREFIX_QUERIES)
        .map(|_| {
            let word = vocabulary_word(zipf.sample(&mut rng));
            let prefix: String = word.chars().take(chars).collect();
            format!("{prefix}*")
        })
        .collect()
}

/// The query sets every variant runs.
struct Queries {
    zipf: Vec<String>,
    rare: Vec<String>,
    prefix2: Vec<String>,
    prefix3: Vec<String>,
}

struct Variant {
    tokenizer: Tokenizer,
    detail: Detail,
    /// FTS5 `prefix=` lengths on the article index; empty for none.
    prefix_index: &'static [u8],
    /// A separate prefix-indexed titles table, measured with title type-ahead queries.
    title_index: bool,
}

impl Variant {
    const fn new(tokenizer: Tokenizer, detail: Detail) -> Self {
        Self {
            tokenizer,
            detail,
            prefix_index: &[],
            title_index: false,
        }
    }

    fn name(&self) -> String {
        let mut name = format!("{}_{}", self.tokenizer.name(), self.detail.name());
        if !self.prefix_index.is_empty() {
            name.push_str("_prefix");
            for n in self.prefix_index {
                name.push_str(&n.to_string());
            }
        }
        if self.title_index {
            name.push_str("_titleindex");
        }
        name
    }
}

fn variants(articles: u32) -> Vec<Variant> {
    let mut v = vec![
        Variant::new(Tokenizer::Unicode61RemoveDiacritics, Detail::Full),
        Variant::new(Tokenizer::Porter, Detail::Full),
        Variant::new(Tokenizer::Unicode61RemoveDiacritics, Detail::Column),
        Variant {
            prefix_index: &[2, 3],
            ..Variant::new(Tokenizer::Unicode61RemoveDiacritics, Detail::Full)
        },
        Variant {
            title_index: true,
            ..Variant::new(Tokenizer::Unicode61RemoveDiacritics, Detail::Full)
        },
    ];
    if articles <= TRIGRAM_MAX_ARTICLES {
        v.push(Variant::new(Tokenizer::Trigram, Detail::Full));
    }
    v
}

fn le(name: &str, value: f64, unit: &str, threshold: f64) -> Metric {
    Metric::new(name, value, unit, threshold, Comparator::Le)
}

struct Outcome {
    variant: String,
    metrics: Vec<Metric>,
    notes: Vec<String>,
}

fn bench_variant(
    args: &Args,
    articles: u32,
    variant: &Variant,
    queries: &Queries,
) -> Result<Outcome, BenchError> {
    let label = format!("n{articles}_{}", variant.name());
    let dir = WorkDir::create(
        args.work_dir
            .join(format!("inkspark-fts-bench-{}-{label}", std::process::id())),
    )?;
    let path = dir.path.join("encyclopedia.sqlite");

    let opts = BuildOptions {
        tokenizer: variant.tokenizer,
        detail: variant.detail,
        external_content: false,
        thumbnail_bytes: None,
    };
    let tuning = IndexTuning {
        prefix_index: variant.prefix_index,
        title_prefix_index: variant.title_index,
    };
    let corpus = generate_corpus(&CorpusSpec {
        articles,
        mean_words: args.mean_words,
        seed: SEED,
    });
    eprintln!("fts-bench: building {label}...");
    let report = build_encyclopedia_tuned(&path, corpus, &opts, &tuning)?;

    let open_start = Instant::now();
    let enc = Encyclopedia::open(&path)?;
    let first = enc.search(&needle_term(i64::from(articles / 2).max(1)), LIMIT)?;
    let open_first = ms(open_start.elapsed());

    let body = |q: &str| enc.search(q, LIMIT);
    let zipf = time_queries(&queries.zipf, body)?;
    let rare = time_queries(&queries.rare, body)?;

    let file_mb = report.file_bytes as f64 / MB;
    let raw_mb = report.raw_text_bytes as f64 / MB;
    let size_ratio = report.file_bytes as f64 / report.raw_text_bytes.max(1) as f64;
    let build_s = report.build.as_secs_f64();

    let mut metrics = vec![
        le(&format!("{label}_size_ratio"), size_ratio, "x", 1.5),
        le(&format!("{label}_file_mb"), file_mb, "MB", 75.0),
        le(&format!("{label}_term_p95_ms"), zipf.p95, "ms", 30.0),
        le(&format!("{label}_rare_term_p95_ms"), rare.p95, "ms", 30.0),
        le(
            &format!("{label}_open_to_first_result_ms"),
            open_first,
            "ms",
            150.0,
        ),
        le(&format!("{label}_build_s"), build_s, "s", 180.0),
    ];
    let mut timings = vec![zipf.describe("term"), rare.describe("rare_term")];

    if variant.title_index {
        // Body prefix queries would repeat unicode61_full exactly; measure type-ahead on titles.
        let titles = |q: &str| enc.search_titles(q, LIMIT);
        let t2 = time_queries(&queries.prefix2, titles)?;
        let t3 = time_queries(&queries.prefix3, titles)?;
        metrics.push(le(
            &format!("{label}_title_prefix_p95_ms"),
            t2.p95,
            "ms",
            80.0,
        ));
        metrics.push(le(
            &format!("{label}_title_prefix3_p95_ms"),
            t3.p95,
            "ms",
            80.0,
        ));
        timings.push(t2.describe("title_prefix"));
        timings.push(t3.describe("title_prefix3"));
    } else {
        let p2 = time_queries(&queries.prefix2, body)?;
        let p3 = time_queries(&queries.prefix3, body)?;
        metrics.push(le(&format!("{label}_prefix_p95_ms"), p2.p95, "ms", 80.0));
        metrics.push(le(&format!("{label}_prefix3_p95_ms"), p3.p95, "ms", 80.0));
        timings.push(p2.describe("prefix"));
        timings.push(p3.describe("prefix3"));
    }
    drop(enc);

    let scale = 300_000.0 / f64::from(articles);
    let mut notes = vec![format!(
        "{label}: file={file_mb:.1} MB raw={raw_mb:.1} MB ratio={size_ratio:.3} \
         build={build_s:.1}s first_hits={}; {}; linear 300k extrapolation: file≈{:.0} MB \
         build≈{:.0}s",
        first.len(),
        timings.join("; "),
        file_mb * scale,
        build_s * scale,
    )];
    if variant.tokenizer == Tokenizer::Trigram {
        notes.push(format!(
            "{label}: trigram matches substrings of 3+ characters only, so 2-character prefix \
             queries (`ab*`) return nothing; size recorded for future CJK packs"
        ));
    }
    if variant.title_index {
        notes.push(format!(
            "{label}: body prefix queries not repeated (identical index to {CHOSEN}); \
             prefix metrics are against the separate titles table"
        ));
    }

    Ok(Outcome {
        variant: variant.name(),
        metrics,
        notes,
    })
}

/// The `gate_*` metrics: the spec thresholds applied to the chosen variant only.
fn gates(articles: u32, largest: u32, smallest: u32, chosen: &[Metric]) -> Vec<Metric> {
    let find = |suffix: &str| {
        chosen
            .iter()
            .find(|m| m.name == format!("n{articles}_{CHOSEN}_{suffix}"))
    };
    let mut wanted: Vec<(&str, &str)> = vec![
        ("term_p95_ms", "term_p95_ms"),
        ("prefix_p95_ms", "prefix_p95_ms"),
        ("open_to_first_result_ms", "open_to_first_result_ms"),
    ];
    if articles == largest {
        wanted.push(("size_ratio", "size_ratio"));
        wanted.push(("build_s", "build_s"));
    }
    if articles == smallest {
        wanted.push(("file_mb", "lite_file_mb"));
    }
    wanted
        .into_iter()
        .filter_map(|(suffix, gate)| {
            find(suffix).map(|m| Metric {
                name: format!("gate_n{articles}_{gate}"),
                ..m.clone()
            })
        })
        .collect()
}

fn run() -> Result<(), BenchError> {
    let args = parse_args()?;
    let queries = Queries {
        zipf: term_queries(SEED ^ 0x21FF, true),
        rare: term_queries(SEED ^ 0x7E57, false),
        prefix2: prefix_queries(SEED ^ 0x9FE1, 2),
        prefix3: prefix_queries(SEED ^ 0x9FE3, 3),
    };

    let mut metrics = Vec::new();
    let mut notes = vec![format!(
        "synthetic corpus (SplitMix64 seed {SEED:#x}, Zipf s=1.07 over 60k pseudo-words, \
         35% stopwords, accented words, planted needles), mean_words={}; real Wikipedia data \
         was not used (dumps.wikimedia.org blocked in the cloud session); gated term queries \
         are Zipf-weighted (corpus frequency), rare_term queries are uniform over the \
         vocabulary (context); prefix queries are 2-char (gated) and 3-char (context) \
         prefixes of Zipf-weighted words; limit {LIMIT}, bm25 rank + snippet; gate_* metrics \
         are the chosen variant {CHOSEN}; sizes in MB = 10^6 bytes; work dir {}",
        args.mean_words,
        args.work_dir.display()
    )];

    let largest = args.articles.iter().copied().max().unwrap_or(0);
    let smallest = args.articles.iter().copied().min().unwrap_or(0);
    for &n in &args.articles {
        let mut gate_metrics = Vec::new();
        for variant in variants(n) {
            let outcome = bench_variant(&args, n, &variant, &queries)?;
            for m in &outcome.metrics {
                eprintln!(
                    "  {}: {:.3} {} (<= {}) {}",
                    m.name,
                    m.value,
                    m.unit,
                    m.threshold,
                    if m.pass { "PASS" } else { "FAIL" }
                );
            }
            for note in &outcome.notes {
                eprintln!("  note: {note}");
            }
            if outcome.variant == CHOSEN {
                gate_metrics = gates(n, largest, smallest, &outcome.metrics);
            }
            metrics.extend(outcome.metrics);
            notes.extend(outcome.notes);
        }
        for m in &gate_metrics {
            eprintln!(
                "  GATE {}: {:.3} {} (<= {}) {}",
                m.name,
                m.value,
                m.unit,
                m.threshold,
                if m.pass { "PASS" } else { "FAIL" }
            );
        }
        metrics.extend(gate_metrics);
    }

    write_results_with_notes(&args.out, &metrics, &notes).map_err(io_err(&args.out))?;
    println!("wrote {}", args.out.display());
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("fts-bench: {err}");
            ExitCode::FAILURE
        }
    }
}
