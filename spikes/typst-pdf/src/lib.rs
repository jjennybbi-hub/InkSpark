//! Typst PDF spike (M0 §5.1, ADR 002): compile a ~300-page novel to PDF with the `typst` crate
//! and embedded fonts only.
#![forbid(unsafe_code)]

mod results;

use std::time::Duration;

use typst::diag::FileResult;
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, World};

pub use results::{Comparator, Metric, write_results};

/// What `generate_book_markup` produces.
pub struct BookSpec {
    pub pages_target: u32,
    pub seed: u64,
    pub include_rtl_sample: bool,
}

/// Deterministic Typst markup for a book: 5.5x8.5in pages, chapters with headings,
/// ~280 words/page, footnotes, page numbers.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn generate_book_markup(spec: &BookSpec) -> String {
    todo!("M0 track C")
}

/// A Typst world: the main source, embedded plus extra fonts, and a fixed `today`.
pub struct SpikeWorld {
    // stub: removed by implementer
    _stub: (),
}

impl SpikeWorld {
    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn new(main: String) -> Self {
        todo!("M0 track C")
    }

    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn with_extra_fonts(main: String, fonts: Vec<Vec<u8>>) -> Result<Self, TypstSpikeError> {
        todo!("M0 track C")
    }

    /// Replaces the main source. Keeps the font book and memo cache, for warm compiles.
    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn set_main(&mut self, main: String) {
        todo!("M0 track C")
    }

    pub fn font_families(&self) -> Vec<String> {
        todo!("M0 track C")
    }
}

// stub: removed by implementer
#[allow(unused_variables)]
impl World for SpikeWorld {
    fn library(&self) -> &LazyHash<Library> {
        todo!("M0 track C")
    }

    fn book(&self) -> &LazyHash<FontBook> {
        todo!("M0 track C")
    }

    fn main(&self) -> FileId {
        todo!("M0 track C")
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        todo!("M0 track C")
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        todo!("M0 track C")
    }

    fn font(&self, index: usize) -> Option<Font> {
        todo!("M0 track C")
    }

    fn today(&self, offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        todo!("M0 track C")
    }
}

/// A compiled PDF and its timings.
pub struct CompiledPdf {
    pub bytes: Vec<u8>,
    pub page_count: usize,
    pub compile: Duration,
    pub export: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum TypstSpikeError {
    #[error("compile: {0}")]
    Compile(String),
    #[error("export: {0}")]
    Export(String),
    #[error("font: {0}")]
    Font(String),
}

/// `typst::compile::<PagedDocument>` then `typst_pdf::pdf`, with no timestamp.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn compile_pdf(world: &SpikeWorld) -> Result<CompiledPdf, TypstSpikeError> {
    todo!("M0 track C")
}
