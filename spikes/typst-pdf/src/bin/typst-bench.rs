//! `typst-bench --pages N --out PATH [--size-report BASELINE]` (M0 §5.1).
//!
//! Measures a cold compile in a fresh world, the median of 5 warm recompiles after a
//! one-paragraph edit (via `set_main`), PDF export time, peak RSS where available, and the
//! binary size delta against `size-baseline`. Writes the §3.9 results JSON to `--out`.
//! Threshold misses are reported in the JSON, not as a failing exit code.
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use inkspark_spike_typst::{
    BookSpec, Comparator, Metric, SpikeWorld, TypstSpikeError, compile_pdf, generate_book_markup,
    write_results_with_notes,
};

const SEED: u64 = 0x1_5EED;
const WARM_RUNS: usize = 5;

#[derive(Debug, thiserror::Error)]
enum BenchError {
    #[error("usage: {0}\nusage: typst-bench --pages N --out PATH [--size-report BASELINE]")]
    Usage(String),
    #[error(transparent)]
    Typst(#[from] TypstSpikeError),
    #[error("io ({context}): {source}")]
    Io {
        context: String,
        source: std::io::Error,
    },
}

struct Args {
    pages: u32,
    out: PathBuf,
    size_report: Option<PathBuf>,
}

fn parse_args() -> Result<Args, BenchError> {
    let mut pages = 300;
    let mut out = None;
    let mut size_report = None;
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || {
            it.next()
                .ok_or_else(|| BenchError::Usage(format!("{flag} needs a value")))
        };
        match flag.as_str() {
            "--pages" => {
                let v = value()?;
                pages = v
                    .parse()
                    .map_err(|_| BenchError::Usage(format!("--pages: not a number: {v}")))?;
            }
            "--out" => out = Some(PathBuf::from(value()?)),
            "--size-report" => size_report = Some(PathBuf::from(value()?)),
            other => return Err(BenchError::Usage(format!("unknown argument {other}"))),
        }
    }
    let out = out.ok_or_else(|| BenchError::Usage(String::from("--out is required")))?;
    Ok(Args {
        pages,
        out,
        size_report,
    })
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v.get(v.len() / 2).copied().unwrap_or(f64::NAN)
}

/// Inserts one new paragraph at the first paragraph break after the middle of the book.
fn edit_one_paragraph(markup: &str, revision: usize) -> String {
    let mid = markup.len() / 2;
    let at = markup
        .get(mid..)
        .and_then(|rest| rest.find("\n\n"))
        .map_or(markup.len(), |i| mid + i);
    let (head, tail) = markup.split_at(at);
    format!("{head}\n\nOne edited paragraph, revision {revision}, written during the bench.{tail}")
}

/// Peak resident set size in MiB (Linux `VmHWM`). `None` elsewhere: macOS needs `getrusage`,
/// which would need `unsafe` or a new dependency.
fn peak_rss_mib() -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kib: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib / 1024.0)
}

fn file_len(path: &std::path::Path) -> Result<u64, BenchError> {
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|source| BenchError::Io {
            context: path.display().to_string(),
            source,
        })
}

fn run() -> Result<(), BenchError> {
    let args = parse_args()?;
    let mut notes = Vec::new();
    let mut metrics = Vec::new();

    let markup = generate_book_markup(&BookSpec {
        pages_target: args.pages,
        seed: SEED,
        include_rtl_sample: true,
    });

    let cold_start = Instant::now();
    let mut world = SpikeWorld::new(markup.clone());
    let cold = compile_pdf(&world)?;
    let cold_total = cold_start.elapsed();

    let mut warm_total = Vec::with_capacity(WARM_RUNS);
    let mut warm_compile = Vec::with_capacity(WARM_RUNS);
    for revision in 0..WARM_RUNS {
        world.set_main(edit_one_paragraph(&markup, revision));
        let start = Instant::now();
        let warm = compile_pdf(&world)?;
        warm_total.push(ms(start.elapsed()));
        warm_compile.push(ms(warm.compile));
    }

    metrics.push(Metric::new(
        "cold_compile_ms",
        ms(cold.compile),
        "ms",
        4000.0,
        Comparator::Le,
    ));
    metrics.push(Metric::new(
        "warm_recompile_ms",
        median(warm_total),
        "ms",
        600.0,
        Comparator::Le,
    ));
    metrics.push(Metric::new(
        "export_ms",
        ms(cold.export),
        "ms",
        1000.0,
        Comparator::Le,
    ));

    notes.push(format!(
        "pages={} (target {}), pdf_bytes={}, cold_total_ms={:.1} (world creation + compile + \
         export), warm_compile_only_median_ms={:.1}; warm_recompile_ms is compile + export \
         after a one-paragraph edit mid-book (median of {WARM_RUNS})",
        cold.page_count,
        args.pages,
        cold.bytes.len(),
        ms(cold_total),
        median(warm_compile),
    ));

    if let Some(baseline) = &args.size_report {
        let exe = std::env::current_exe().map_err(|source| BenchError::Io {
            context: String::from("current_exe"),
            source,
        })?;
        let own = file_len(&exe)?;
        let base = file_len(baseline)?;
        let delta_mib = (own as f64 - base as f64) / (1024.0 * 1024.0);
        metrics.push(Metric::new(
            "size_delta_mb",
            delta_mib,
            "MiB",
            30.0,
            Comparator::Le,
        ));
        notes.push(format!(
            "size: typst-bench={own} bytes, size-baseline={base} bytes (release profile: \
             lto=thin, codegen-units=1, strip=true)"
        ));
    } else {
        notes.push(String::from(
            "size delta not measured (pass --size-report <size-baseline>)",
        ));
    }

    match peak_rss_mib() {
        Some(rss) => notes.push(format!("peak_rss_mib={rss:.1} (VmHWM)")),
        None => notes.push(String::from(
            "peak RSS unavailable on this OS without unsafe/getrusage",
        )),
    }

    let vertical = SpikeWorld::new(String::from(
        "#set text(dir: ttb, lang: \"ja\")\n\n縦書きのテスト。\n",
    ));
    match compile_pdf(&vertical) {
        Ok(pdf) => notes.push(format!(
            "vertical writing (dir: ttb) compiled to {} page(s); Typst has no vertical layout",
            pdf.page_count
        )),
        Err(err) => notes.push(format!("vertical writing (dir: ttb) unsupported: {err}")),
    }

    for m in &metrics {
        println!(
            "{}: {:.1} {} (threshold {} {}) {}",
            m.name,
            m.value,
            m.unit,
            m.comparator.as_str(),
            m.threshold,
            if m.pass { "PASS" } else { "FAIL" }
        );
    }
    for n in &notes {
        println!("note: {n}");
    }

    write_results_with_notes(&args.out, &metrics, &notes).map_err(|source| BenchError::Io {
        context: args.out.display().to_string(),
        source,
    })?;
    println!("wrote {}", args.out.display());
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("typst-bench: {err}");
            ExitCode::FAILURE
        }
    }
}
