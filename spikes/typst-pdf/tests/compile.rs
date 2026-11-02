//! Spec tests for the Typst PDF spike (docs/milestones/M0.md §5.1).
//!
//! Small documents keep debug builds fast. The 300-page benchmark is `#[ignore]`d and run by the
//! `spike-typst` CI job.

use std::time::Instant;

use inkspark_spike_typst::{
    BookSpec, CompiledPdf, SpikeWorld, TypstSpikeError, compile_pdf, generate_book_markup,
};

fn spec(pages_target: u32, include_rtl_sample: bool) -> BookSpec {
    BookSpec {
        pages_target,
        seed: 0x1_5EED,
        include_rtl_sample,
    }
}

fn compile_markup(markup: String) -> CompiledPdf {
    let world = SpikeWorld::new(markup);
    compile_pdf(&world).expect("markup compiles to PDF")
}

fn lopdf_page_count(bytes: &[u8]) -> usize {
    let doc = lopdf::Document::load_mem(bytes).expect("lopdf parses the PDF");
    doc.get_pages().len()
}

#[test]
fn ten_page_spec_compiles_to_a_pdf_with_the_expected_page_count() {
    let markup = generate_book_markup(&spec(10, false));
    let pdf = compile_markup(markup);

    assert!(
        pdf.bytes.starts_with(b"%PDF-"),
        "output must start with %PDF-"
    );
    assert!(
        (8..=12).contains(&pdf.page_count),
        "page_count {} not within 8..=12",
        pdf.page_count
    );
    assert_eq!(
        pdf.page_count,
        lopdf_page_count(&pdf.bytes),
        "page_count must equal the page count read by lopdf"
    );
}

#[test]
fn compiling_the_same_world_twice_is_byte_identical() {
    let world = SpikeWorld::new(generate_book_markup(&spec(3, false)));
    let first = compile_pdf(&world).expect("first compile");
    let second = compile_pdf(&world).expect("second compile");
    assert_eq!(first.page_count, second.page_count);
    assert!(
        first.bytes == second.bytes,
        "PDF bytes differ between two compiles of the same world"
    );
}

#[test]
fn identical_specs_in_fresh_worlds_are_byte_identical() {
    let a = compile_markup(generate_book_markup(&spec(3, false)));
    let b = compile_markup(generate_book_markup(&spec(3, false)));
    assert!(
        a.bytes == b.bytes,
        "fresh worlds with identical markup must give identical PDFs"
    );
}

#[test]
fn generate_book_markup_is_deterministic_per_seed() {
    let a = generate_book_markup(&spec(5, true));
    let b = generate_book_markup(&spec(5, true));
    assert_eq!(a, b);
    assert!(!a.is_empty());
}

#[test]
fn font_families_include_libertinus_serif() {
    let world = SpikeWorld::new(String::from("Hello"));
    let families = world.font_families();
    assert!(
        families.iter().any(|f| f == "Libertinus Serif"),
        "embedded font families {families:?} must include \"Libertinus Serif\""
    );
}

#[test]
fn invalid_markup_returns_compile_error_without_panicking() {
    let world = SpikeWorld::new(String::from("#let x = "));
    match compile_pdf(&world) {
        Err(TypstSpikeError::Compile(message)) => {
            assert!(!message.is_empty(), "compile error should carry a message");
        }
        Err(other) => panic!("expected TypstSpikeError::Compile, got {other:?}"),
        Ok(_) => panic!("expected TypstSpikeError::Compile, got Ok"),
    }
}

#[test]
fn extra_fonts_with_garbage_bytes_return_font_error() {
    let garbage = vec![vec![0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]];
    match SpikeWorld::with_extra_fonts(String::from("Hello"), garbage) {
        Err(TypstSpikeError::Font(message)) => {
            assert!(!message.is_empty(), "font error should carry a message");
        }
        Err(other) => panic!("expected TypstSpikeError::Font, got {other:?}"),
        Ok(_) => panic!("expected TypstSpikeError::Font, got Ok"),
    }
}

#[test]
fn extra_fonts_with_no_fonts_is_ok_and_keeps_embedded_families() {
    let world = SpikeWorld::with_extra_fonts(String::from("Hello"), Vec::new())
        .expect("an empty extra font list is valid");
    assert!(
        world
            .font_families()
            .iter()
            .any(|f| f == "Libertinus Serif")
    );
}

#[test]
fn rtl_sample_compiles() {
    let markup =
        String::from("#set text(dir: rtl, lang: \"he\")\n\nבראשית ברא אלהים את השמים ואת הארץ.\n");
    let pdf = compile_markup(markup);
    assert!(pdf.bytes.starts_with(b"%PDF-"));
    assert!(pdf.page_count >= 1);
}

#[test]
fn book_with_rtl_sample_compiles() {
    let pdf = compile_markup(generate_book_markup(&spec(3, true)));
    assert!(pdf.bytes.starts_with(b"%PDF-"));
    assert_eq!(pdf.page_count, lopdf_page_count(&pdf.bytes));
}

#[test]
fn set_main_replaces_the_source_for_the_next_compile() {
    let mut world = SpikeWorld::new(generate_book_markup(&spec(2, false)));
    let small = compile_pdf(&world).expect("small compile");

    world.set_main(generate_book_markup(&spec(10, false)));
    let large = compile_pdf(&world).expect("large compile after set_main");

    assert!(
        large.page_count > small.page_count,
        "after set_main to a longer book, page_count {} should exceed {}",
        large.page_count,
        small.page_count
    );
    assert_eq!(large.page_count, lopdf_page_count(&large.bytes));
}

/// Vertical writing is recorded as a note for ADR 002, not asserted. Expected: unsupported.
#[test]
fn vertical_writing_attempt_is_recorded_as_a_note() {
    let markup = String::from("#set text(dir: ttb, lang: \"ja\")\n\n縦書きのテスト。\n");
    let world = SpikeWorld::new(markup);
    match compile_pdf(&world) {
        Ok(pdf) => println!(
            "NOTE(ADR 002): vertical writing (dir: ttb) compiled to {} page(s); \
             inspect output manually, Typst has no vertical layout",
            pdf.page_count
        ),
        Err(err) => println!("NOTE(ADR 002): vertical writing (dir: ttb) unsupported: {err}"),
    }
}

/// Run by the `spike-typst` CI job: `cargo test --release -p inkspark-spike-typst -- --ignored`.
#[test]
#[ignore = "benchmark: run explicitly with --ignored (release build)"]
fn bench_300_pages() {
    let book = spec(300, true);
    let markup = generate_book_markup(&book);

    let cold_start = Instant::now();
    let mut world = SpikeWorld::new(markup.clone());
    let cold = compile_pdf(&world).expect("cold 300-page compile");
    let cold_total = cold_start.elapsed();

    assert!(
        (240..=360).contains(&cold.page_count),
        "300-page target produced {} pages",
        cold.page_count
    );
    assert_eq!(cold.page_count, lopdf_page_count(&cold.bytes));

    let mut warm_ms: Vec<f64> = Vec::with_capacity(5);
    for i in 0..5 {
        let edited = format!("{markup}\n\nOne edited paragraph, revision {i}.\n");
        world.set_main(edited);
        let start = Instant::now();
        let warm = compile_pdf(&world).expect("warm recompile");
        warm_ms.push(start.elapsed().as_secs_f64() * 1000.0);
        assert!(warm.page_count >= cold.page_count);
    }
    warm_ms.sort_by(f64::total_cmp);
    let warm_median = warm_ms.get(warm_ms.len() / 2).copied().unwrap_or(f64::NAN);

    println!(
        "bench_300_pages: pages={} cold_compile_ms={:.1} cold_export_ms={:.1} cold_total_ms={:.1} \
         warm_median_ms={:.1} pdf_bytes={} (thresholds: cold<=4000, warm<=600, export<=1000)",
        cold.page_count,
        cold.compile.as_secs_f64() * 1000.0,
        cold.export.as_secs_f64() * 1000.0,
        cold_total.as_secs_f64() * 1000.0,
        warm_median,
        cold.bytes.len()
    );
}
