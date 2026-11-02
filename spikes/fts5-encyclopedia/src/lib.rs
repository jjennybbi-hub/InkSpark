//! FTS5 encyclopedia spike (M0 §5.3, ADR 004): a single SQLite FTS5 file for offline packs.
#![forbid(unsafe_code)]

mod results;

use std::path::Path;
use std::time::Duration;

pub use results::{Comparator, Metric, write_results};

/// A deterministic synthetic corpus (SplitMix64, Zipf over a pseudo-word vocabulary).
pub struct CorpusSpec {
    pub articles: u32,
    pub mean_words: u32,
    pub seed: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Article {
    pub id: i64,
    pub title: String,
    pub category: String,
    pub body: String,
}

// stub: removed by implementer
#[allow(unused_variables)]
pub fn generate_corpus(spec: &CorpusSpec) -> impl Iterator<Item = Article> {
    std::iter::from_fn(|| -> Option<Article> { todo!("M0 track C") })
}

/// The planted term for article `id`: `zq{id:06}x`.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn needle_term(id: i64) -> String {
    todo!("M0 track C")
}

#[derive(Clone, Copy)]
pub enum Tokenizer {
    Unicode61RemoveDiacritics,
    Porter,
    Trigram,
}

#[derive(Clone, Copy)]
pub enum Detail {
    Full,
    Column,
    None,
}

pub struct BuildOptions {
    pub tokenizer: Tokenizer,
    pub detail: Detail,
    pub external_content: bool,
    pub thumbnail_bytes: Option<u32>,
}

pub struct BuildReport {
    pub articles: u64,
    pub raw_text_bytes: u64,
    pub file_bytes: u64,
    pub build: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum FtsSpikeError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("query: {0}")]
    Query(String),
}

/// Builds the file in one transaction, then `optimize`, `VACUUM` and `journal_mode=DELETE`:
/// a single file with no `-wal`/`-shm` left behind.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn build_encyclopedia(
    path: &Path,
    articles: impl IntoIterator<Item = Article>,
    opts: &BuildOptions,
) -> Result<BuildReport, FtsSpikeError> {
    todo!("M0 track C")
}

pub struct Hit {
    pub id: i64,
    pub title: String,
    pub snippet: String,
    pub rank: f64,
}

/// A read-only encyclopedia connection.
pub struct Encyclopedia {
    // stub: removed by implementer
    _stub: (),
}

impl Encyclopedia {
    /// Opens with `SQLITE_OPEN_READ_ONLY`.
    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn open(path: &Path) -> Result<Self, FtsSpikeError> {
        todo!("M0 track C")
    }

    /// User text escaped into an FTS5 query; bm25 rank; snippet with `[ ]` markers.
    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<Hit>, FtsSpikeError> {
        todo!("M0 track C")
    }

    // stub: removed by implementer
    #[allow(unused_variables)]
    pub fn get_article(&self, id: i64) -> Result<Option<Article>, FtsSpikeError> {
        todo!("M0 track C")
    }
}
