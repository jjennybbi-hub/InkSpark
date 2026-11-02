//! Typst PDF spike (M0 §5.1, ADR 002): compile a ~300-page novel to PDF with the `typst` crate
//! and embedded fonts only.
#![forbid(unsafe_code)]

mod results;

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::ecow::EcoVec;
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook, FontInfo};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_kit::fonts::FontStore;
use typst_layout::PagedDocument;

pub use results::{Comparator, Metric, write_results, write_results_with_notes};

/// What `generate_book_markup` produces.
pub struct BookSpec {
    pub pages_target: u32,
    pub seed: u64,
    pub include_rtl_sample: bool,
}

/// Words per page the generator aims for (M0 §5.1).
const WORDS_PER_PAGE: u32 = 280;
/// Pages per chapter; every chapter starts on a new page.
const PAGES_PER_CHAPTER: u32 = 10;

/// A small vocabulary of ordinary English words, so line breaking and hyphenation behave like
/// prose. Kept short on purpose: only the layout cost matters here, not the text.
const WORDS: &[&str] = &[
    "the",
    "of",
    "and",
    "a",
    "to",
    "in",
    "was",
    "he",
    "she",
    "it",
    "that",
    "with",
    "for",
    "as",
    "his",
    "her",
    "on",
    "at",
    "by",
    "had",
    "from",
    "they",
    "not",
    "but",
    "were",
    "all",
    "one",
    "there",
    "been",
    "would",
    "said",
    "into",
    "over",
    "after",
    "before",
    "again",
    "through",
    "light",
    "window",
    "morning",
    "evening",
    "river",
    "garden",
    "letter",
    "silence",
    "stone",
    "harbour",
    "kitchen",
    "winter",
    "summer",
    "shadow",
    "voice",
    "door",
    "table",
    "road",
    "village",
    "mother",
    "father",
    "brother",
    "sister",
    "stranger",
    "remembered",
    "walked",
    "listened",
    "waited",
    "carried",
    "opened",
    "closed",
    "turned",
    "watched",
    "whispered",
    "slowly",
    "quietly",
    "suddenly",
    "perhaps",
    "nothing",
    "everything",
    "somewhere",
    "beneath",
    "between",
    "against",
    "towards",
    "without",
    "although",
    "because",
    "while",
    "until",
    "unfamiliar",
    "particular",
    "extraordinary",
    "considerable",
    "understanding",
    "conversation",
    "afterwards",
    "neighbourhood",
    "photograph",
    "handwriting",
    "candle",
    "lantern",
    "orchard",
    "meadow",
    "chimney",
    "staircase",
    "corridor",
    "attic",
    "cellar",
    "train",
    "station",
];

const HEBREW_SAMPLE: &str =
    "בראשית ברא אלהים את השמים ואת הארץ. והארץ היתה תהו ובהו, וחשך על פני תהום.";

/// SplitMix64: tiny, deterministic, dependency-free.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `0..n` (n > 0). Modulo bias is irrelevant for a text generator.
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n.max(1)
    }

    fn word(&mut self) -> &'static str {
        let i = usize::try_from(self.below(WORDS.len() as u64)).unwrap_or(0);
        WORDS.get(i).copied().unwrap_or("the")
    }
}

/// Appends one sentence of 6–21 words; returns the word count.
fn push_sentence(rng: &mut SplitMix64, out: &mut String) -> u32 {
    let len = 6 + rng.below(16);
    for i in 0..len {
        let w = rng.word();
        if i == 0 {
            let mut chars = w.chars();
            if let Some(first) = chars.next() {
                out.extend(first.to_uppercase());
                out.push_str(chars.as_str());
            }
        } else {
            out.push(' ');
            out.push_str(w);
        }
        if i + 1 < len && rng.below(9) == 0 {
            out.push(',');
        }
    }
    out.push_str(". ");
    u32::try_from(len).unwrap_or(0)
}

/// Deterministic Typst markup for a book: 5.5x8.5in pages, chapters with headings,
/// ~280 words/page, footnotes, page numbers.
pub fn generate_book_markup(spec: &BookSpec) -> String {
    let mut rng = SplitMix64(spec.seed);
    let total_words = spec.pages_target.max(1) * WORDS_PER_PAGE;
    let words_per_chapter = PAGES_PER_CHAPTER * WORDS_PER_PAGE;

    let mut out = String::with_capacity(total_words as usize * 8);
    out.push_str(
        "#set document(title: \"InkSpark spike novel\", author: \"InkSpark\", date: none)\n\
         #set page(width: 5.5in, height: 8.5in, margin: (x: 0.75in, y: 0.8in), numbering: \"1\")\n\
         #set text(font: \"Libertinus Serif\", size: 11pt, lang: \"en\")\n\
         #set par(justify: true, first-line-indent: 1.2em, spacing: 0.65em)\n\
         #show heading.where(level: 1): it => { pagebreak(weak: true); v(1.5in); align(center, it); v(0.5in) }\n\n",
    );

    let mut written = 0u32;
    let mut chapter = 0u32;
    while written < total_words {
        chapter += 1;
        let _ = writeln!(out, "= Chapter {chapter}\n");
        let chapter_end = (written + words_per_chapter).min(total_words);
        let mut paragraph = 0u32;
        while written < chapter_end {
            paragraph += 1;
            let sentences = 3 + rng.below(6);
            for _ in 0..sentences {
                written += push_sentence(&mut rng, &mut out);
            }
            // Roughly one footnote every few paragraphs.
            if rng.below(5) == 0 {
                out.push_str("#footnote[");
                written += push_sentence(&mut rng, &mut out);
                out.push(']');
            }
            out.push_str("\n\n");
            if spec.include_rtl_sample && chapter == 1 && paragraph == 2 {
                let _ = writeln!(
                    out,
                    "#block(text(dir: rtl, lang: \"he\")[{HEBREW_SAMPLE}])\n"
                );
            }
        }
    }
    out
}

/// A Typst world: the main source, embedded plus extra fonts, and a fixed `today`.
pub struct SpikeWorld {
    library: LazyHash<Library>,
    fonts: FontStore,
    main_id: FileId,
    source: Source,
}

fn main_file_id() -> FileId {
    // A constant, normalized relative path: `new` only fails for paths escaping the root.
    #[allow(clippy::expect_used)]
    let vpath = VirtualPath::new("main.typ").expect("constant virtual path is valid");
    FileId::new(RootedPath::new(VirtualRoot::Project, vpath))
}

impl SpikeWorld {
    pub fn new(main: String) -> Self {
        let mut fonts = FontStore::new();
        fonts.extend(typst_kit::fonts::embedded());
        Self::from_parts(main, fonts)
    }

    pub fn with_extra_fonts(main: String, fonts: Vec<Vec<u8>>) -> Result<Self, TypstSpikeError> {
        let mut store = FontStore::new();
        store.extend(typst_kit::fonts::embedded());
        for (i, data) in fonts.into_iter().enumerate() {
            let faces: Vec<(Font, FontInfo)> = Font::iter(Bytes::new(data))
                .map(|font| {
                    let info = font.info().clone();
                    (font, info)
                })
                .collect();
            if faces.is_empty() {
                return Err(TypstSpikeError::Font(format!(
                    "extra font #{i} contains no readable font face"
                )));
            }
            store.extend(faces);
        }
        Ok(Self::from_parts(main, store))
    }

    fn from_parts(main: String, fonts: FontStore) -> Self {
        let main_id = main_file_id();
        Self {
            library: LazyHash::new(Library::default()),
            fonts,
            main_id,
            source: Source::new(main_id, main),
        }
    }

    /// Replaces the main source. Keeps the font book and memo cache, for warm compiles.
    pub fn set_main(&mut self, main: String) {
        // `replace` diffs and reparses incrementally, so unchanged syntax nodes keep their
        // spans and comemo can reuse memoized results.
        self.source.replace(&main);
    }

    pub fn font_families(&self) -> Vec<String> {
        self.fonts
            .book()
            .families()
            .map(|(family, _)| family.to_owned())
            .collect()
    }
}

impl World for SpikeWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            Ok(self.source.clone())
        } else {
            Err(not_found(id))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main_id {
            Ok(Bytes::from_string(self.source.clone()))
        } else {
            Err(not_found(id))
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }

    /// Fixed date, so output never depends on the clock.
    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        Datetime::from_ymd(2026, 1, 1)
    }
}

fn not_found(id: FileId) -> FileError {
    FileError::NotFound(id.get().vpath().get_with_slash().into())
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

fn describe(diags: &EcoVec<SourceDiagnostic>) -> String {
    let joined = diags
        .iter()
        .map(|d| d.message.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    if joined.is_empty() {
        String::from("unknown error")
    } else {
        joined
    }
}

/// `typst::compile::<PagedDocument>` then `typst_pdf::pdf`, with no timestamp.
pub fn compile_pdf(world: &SpikeWorld) -> Result<CompiledPdf, TypstSpikeError> {
    let start = Instant::now();
    let document = typst::compile::<PagedDocument>(world)
        .output
        .map_err(|d| TypstSpikeError::Compile(describe(&d)))?;
    let compile = start.elapsed();

    let start = Instant::now();
    let options = typst_pdf::PdfOptions {
        timestamp: None,
        ..typst_pdf::PdfOptions::default()
    };
    let bytes =
        typst_pdf::pdf(&document, &options).map_err(|d| TypstSpikeError::Export(describe(&d)))?;
    let export = start.elapsed();

    Ok(CompiledPdf {
        bytes,
        page_count: document.pages().len(),
        compile,
        export,
    })
}
