//! `fts-bench --articles 5000,50000 --mean-words 1200 --out PATH [--work-dir DIR]` (M0 §5.3).
//!
//! For each corpus size, builds the variants {unicode61/full, porter/full, unicode61/column,
//! unicode61/full with prefix indexes 2 and 3, trigram/full (5k only)}, then measures file size,
//! build time, open-to-first-result, and the p95 of 1,000 random 1–2-term queries (uniform over
//! the vocabulary, plus a Zipf-weighted stress set) and 200 prefix queries (`ab*`) drawn from
//! the corpus vocabulary. Writes the §3.9 results JSON to `--out`. Threshold misses are reported in the
//! JSON, not as a failing exit code. Each built file is deleted once measured.
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use inkspark_spike_fts::{
    BuildOptions, Comparator, CorpusSpec, Detail, Encyclopedia, FtsSpikeError, Metric, SplitMix64,
    Tokenizer, VOCABULARY_SIZE, Zipf, build_encyclopedia_with_prefix_index, generate_corpus,
    needle_term, vocabulary_word, write_results_with_notes,
};

const SEED: u64 = 0x00C0_FFEE;
const TERM_QUERIES: usize = 1_000;
const PREFIX_QUERIES: usize = 200;
const LIMIT: u32 = 20;
/// Trigram is built only for corpora up to this size (M0 §5.3: "5k only").
const TRIGRAM_MAX_ARTICLES: u32 = 5_000;
const MIB: f64 = 1024.0 * 1024.0;

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

fn time_queries(enc: &Encyclopedia, queries: &[String]) -> Result<Timings, BenchError> {
    let mut lat = Vec::with_capacity(queries.len());
    let mut hits = 0usize;
    for q in queries {
        let start = Instant::now();
        hits += enc.search(q, LIMIT)?.len();
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

/// 1–2-term queries. `zipf_weighted` draws terms by corpus frequency (a stress case: most
/// terms then occur in nearly every article); otherwise uniformly over the vocabulary.
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

/// The query sets every variant runs.
struct Queries {
    uniform: Vec<String>,
    zipf: Vec<String>,
    prefix: Vec<String>,
}

fn prefix_queries(seed: u64) -> Vec<String> {
    let zipf = Zipf::vocabulary();
    let mut rng = SplitMix64::new(seed);
    (0..PREFIX_QUERIES)
        .map(|_| {
            let word = vocabulary_word(zipf.sample(&mut rng));
            let prefix: String = word.chars().take(2).collect();
            format!("{prefix}*")
        })
        .collect()
}

struct Variant {
    tokenizer: Tokenizer,
    detail: Detail,
    /// FTS5 `prefix=` lengths; empty for none.
    prefix_index: &'static [u8],
}

impl Variant {
    fn name(&self) -> String {
        let mut name = format!("{}_{}", self.tokenizer.name(), self.detail.name());
        if !self.prefix_index.is_empty() {
            name.push_str("_prefix");
            for n in self.prefix_index {
                name.push_str(&n.to_string());
            }
        }
        name
    }
}

fn variants(articles: u32) -> Vec<Variant> {
    let mut v = vec![
        Variant {
            tokenizer: Tokenizer::Unicode61RemoveDiacritics,
            detail: Detail::Full,
            prefix_index: &[],
        },
        Variant {
            tokenizer: Tokenizer::Porter,
            detail: Detail::Full,
            prefix_index: &[],
        },
        Variant {
            tokenizer: Tokenizer::Unicode61RemoveDiacritics,
            detail: Detail::Column,
            prefix_index: &[],
        },
        Variant {
            tokenizer: Tokenizer::Unicode61RemoveDiacritics,
            detail: Detail::Full,
            prefix_index: &[2, 3],
        },
    ];
    if articles <= TRIGRAM_MAX_ARTICLES {
        v.push(Variant {
            tokenizer: Tokenizer::Trigram,
            detail: Detail::Full,
            prefix_index: &[],
        });
    }
    v
}

struct Outcome {
    metrics: Vec<Metric>,
    notes: Vec<String>,
    size_ratio: f64,
}

fn bench_variant(
    args: &Args,
    articles: u32,
    variant: &Variant,
    queries: &Queries,
) -> Result<Outcome, BenchError> {
    let label = format!("n{articles}_{}", variant.name());
    let dir = args
        .work_dir
        .join(format!("inkspark-fts-bench-{}-{label}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(io_err(&dir))?;
    let path = dir.join("encyclopedia.sqlite");

    let opts = BuildOptions {
        tokenizer: variant.tokenizer,
        detail: variant.detail,
        external_content: false,
        thumbnail_bytes: None,
    };
    let corpus = generate_corpus(&CorpusSpec {
        articles,
        mean_words: args.mean_words,
        seed: SEED,
    });
    eprintln!("fts-bench: building {label}...");
    let report = build_encyclopedia_with_prefix_index(&path, corpus, &opts, variant.prefix_index)?;

    let open_start = Instant::now();
    let enc = Encyclopedia::open(&path)?;
    let first = enc.search(&needle_term(i64::from(articles / 2).max(1)), LIMIT)?;
    let open_first = ms(open_start.elapsed());

    let term = time_queries(&enc, &queries.uniform)?;
    let zipf = time_queries(&enc, &queries.zipf)?;
    let prefix = time_queries(&enc, &queries.prefix)?;
    drop(enc);

    let file_mib = report.file_bytes as f64 / MIB;
    let raw_mib = report.raw_text_bytes as f64 / MIB;
    let size_ratio = report.file_bytes as f64 / report.raw_text_bytes.max(1) as f64;
    let build_s = report.build.as_secs_f64();

    let mut metrics = vec![
        Metric::new(
            &format!("{label}_size_ratio"),
            size_ratio,
            "x",
            1.5,
            Comparator::Le,
        ),
        Metric::new(
            &format!("{label}_term_p95_ms"),
            term.p95,
            "ms",
            30.0,
            Comparator::Le,
        ),
        Metric::new(
            &format!("{label}_term_zipf_p95_ms"),
            zipf.p95,
            "ms",
            30.0,
            Comparator::Le,
        ),
        Metric::new(
            &format!("{label}_prefix_p95_ms"),
            prefix.p95,
            "ms",
            80.0,
            Comparator::Le,
        ),
        Metric::new(
            &format!("{label}_open_to_first_result_ms"),
            open_first,
            "ms",
            150.0,
            Comparator::Le,
        ),
        Metric::new(
            &format!("{label}_build_s"),
            build_s,
            "s",
            180.0,
            Comparator::Le,
        ),
    ];
    if articles <= 5_000 {
        metrics.push(Metric::new(
            &format!("{label}_file_mb"),
            file_mib,
            "MiB",
            75.0,
            Comparator::Le,
        ));
    }

    let scale = 300_000.0 / f64::from(articles);
    let mut notes = vec![format!(
        "{label}: file={file_mib:.1} MiB raw={raw_mib:.1} MiB ratio={size_ratio:.3} \
         build={build_s:.1}s first_hits={} term p50/p95/max={:.2}/{:.2}/{:.2} ms \
         (mean hits {:.1}) term_zipf p50/p95/max={:.2}/{:.2}/{:.2} ms (mean hits {:.1}) \
         prefix p50/p95/max={:.2}/{:.2}/{:.2} ms (mean hits {:.1}); \
         linear 300k extrapolation: file≈{:.0} MiB build≈{:.0}s",
        first.len(),
        term.p50,
        term.p95,
        term.max,
        term.mean_hits,
        zipf.p50,
        zipf.p95,
        zipf.max,
        zipf.mean_hits,
        prefix.p50,
        prefix.p95,
        prefix.max,
        prefix.mean_hits,
        file_mib * scale,
        build_s * scale,
    )];
    if variant.tokenizer == Tokenizer::Trigram {
        notes.push(format!(
            "{label}: trigram matches substrings of 3+ characters only, so 2-character prefix \
             queries (`ab*`) return nothing; size recorded for future CJK packs"
        ));
    }

    std::fs::remove_dir_all(&dir).map_err(io_err(&dir))?;
    Ok(Outcome {
        metrics,
        notes,
        size_ratio,
    })
}

fn run() -> Result<(), BenchError> {
    let args = parse_args()?;
    let queries = Queries {
        uniform: term_queries(SEED ^ 0x7E57, false),
        zipf: term_queries(SEED ^ 0x21FF, true),
        prefix: prefix_queries(SEED ^ 0x9FE1),
    };

    let mut metrics = Vec::new();
    let mut notes = vec![format!(
        "synthetic corpus (SplitMix64 seed {SEED:#x}, Zipf s=1.07 over 60k pseudo-words, \
         35% stopwords, accented words, planted needles), mean_words={}; real Wikipedia data \
         was not used (dumps.wikimedia.org blocked in the cloud session); term queries: \
         uniform over the vocabulary (gated) and Zipf-weighted (stress); prefix queries are \
         2-char prefixes of Zipf-weighted words; limit {LIMIT}, bm25 + snippet; work dir {}",
        args.mean_words,
        args.work_dir.display()
    )];

    let largest = args.articles.iter().copied().max().unwrap_or(0);
    for &n in &args.articles {
        let mut best = f64::INFINITY;
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
            best = best.min(outcome.size_ratio);
            metrics.extend(outcome.metrics);
            notes.extend(outcome.notes);
        }
        if n == largest {
            metrics.push(Metric::new(
                &format!("n{n}_best_size_ratio"),
                best,
                "x",
                1.5,
                Comparator::Le,
            ));
        }
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
