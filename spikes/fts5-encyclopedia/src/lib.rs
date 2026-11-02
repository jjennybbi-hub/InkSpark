//! FTS5 encyclopedia spike (M0 §5.3, ADR 004): a single SQLite FTS5 file for offline packs.
#![forbid(unsafe_code)]

mod results;

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

pub use results::{Comparator, Metric, write_results, write_results_with_notes};

/// Version of the on-disk schema (the `meta` table). Bumped on any layout change.
pub const SCHEMA_VERSION: i64 = 1;

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

/// SplitMix64: tiny, deterministic, dependency-free (no `rand` crate).
#[derive(Clone)]
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Uniform in `0..n`; `0` when `n == 0`. Modulo bias is irrelevant here.
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        usize::try_from(self.next_u64() % n as u64).unwrap_or(0)
    }
}

/// Size of the pseudo-word vocabulary (M0 §5.3).
pub const VOCABULARY_SIZE: usize = 60_000;
/// Zipf exponent (M0 §5.3: s ≈ 1.07).
const ZIPF_S: f64 = 1.07;
/// Share of body tokens that are English stopwords.
const STOPWORD_SHARE: f64 = 0.35;
/// Share of body tokens that are accented real words.
const ACCENTED_SHARE: f64 = 0.002;

const STOPWORDS: &[&str] = &[
    "the", "of", "and", "a", "to", "in", "is", "was", "it", "for", "on", "as", "with", "by", "at",
    "from", "that", "this", "which", "be", "are", "were", "or", "an", "its", "his", "her", "their",
    "has", "had", "have", "not", "but", "also", "after", "into", "during", "between", "first",
    "one", "two", "who", "when", "where", "there", "been", "other", "more", "most",
];

const ACCENTED: &[&str] = &[
    "café",
    "naïve",
    "résumé",
    "façade",
    "über",
    "señor",
    "crème",
    "déjà",
    "fiancée",
    "coöperate",
    "Zürich",
    "São",
    "Kraków",
    "Malmö",
    "Québec",
    "piñata",
    "jalapeño",
    "élan",
    "garçon",
];

const CATEGORIES: &[&str] = &[
    "History",
    "Geography",
    "Biography",
    "Science",
    "Arts",
    "Literature",
    "Music",
    "Philosophy",
    "Technology",
    "Nature",
    "Sport",
    "Religion",
];

const ONSETS: &[&str] = &[
    "b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "y", "br",
    "st",
];
const VOWELS: &[&str] = &["a", "e", "i", "o", "u"];

/// The pseudo-word of Zipf rank `rank` (0-based). Syllables are consonant(s) + vowel, so no
/// word can contain the needle prefix `zq`. Ranks below 10,000 get two syllables, the rest three,
/// so every rank maps to a distinct word.
pub fn vocabulary_word(rank: usize) -> String {
    let syllables = ONSETS.len() * VOWELS.len();
    let count = if rank < syllables * syllables { 2 } else { 3 };
    let mut digits = Vec::with_capacity(count);
    let mut n = rank;
    for _ in 0..count {
        digits.push(n % syllables);
        n /= syllables;
    }
    let mut word = String::with_capacity(count * 3);
    for d in digits.into_iter().rev() {
        word.push_str(ONSETS.get(d / VOWELS.len()).copied().unwrap_or("b"));
        word.push_str(VOWELS.get(d % VOWELS.len()).copied().unwrap_or("a"));
    }
    word
}

/// A Zipf(s) sampler over `0..n` (inverse CDF by binary search).
#[derive(Clone)]
pub struct Zipf {
    cdf: Arc<Vec<f64>>,
}

impl Zipf {
    pub fn new(n: usize, s: f64) -> Self {
        let mut cdf = Vec::with_capacity(n);
        let mut total = 0.0;
        for k in 1..=n {
            total += 1.0 / (k as f64).powf(s);
            cdf.push(total);
        }
        for c in &mut cdf {
            *c /= total;
        }
        Self { cdf: Arc::new(cdf) }
    }

    /// The vocabulary sampler used by the corpus.
    pub fn vocabulary() -> Self {
        Self::new(VOCABULARY_SIZE, ZIPF_S)
    }

    pub fn sample(&self, rng: &mut SplitMix64) -> usize {
        let u = rng.next_f64();
        self.cdf
            .partition_point(|&c| c < u)
            .min(self.cdf.len().saturating_sub(1))
    }
}

fn pick<'a>(rng: &mut SplitMix64, list: &[&'a str]) -> &'a str {
    list.get(rng.below(list.len())).copied().unwrap_or("")
}

fn capitalize(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn generate_article(id: i64, mean_words: u32, zipf: &Zipf, rng: &mut SplitMix64) -> Article {
    let title_words = 1 + rng.below(3);
    let title = (0..title_words)
        .map(|_| capitalize(&vocabulary_word(rng.below(VOCABULARY_SIZE))))
        .collect::<Vec<_>>()
        .join(" ");
    let category = pick(rng, CATEGORIES).to_owned();

    // Length uniform in [mean/2, 3·mean/2], at least one word plus the needle.
    let mean = mean_words.max(2) as usize;
    let words = mean / 2 + rng.below(mean + 1);
    let needle_at = rng.below(words);
    let needle = needle_term(id);

    let mut body = String::with_capacity(words * 7);
    let mut sentence_left = 0usize;
    for i in 0..words {
        if i > 0 {
            if sentence_left == 0 {
                body.push_str(if rng.below(6) == 0 { ".\n\n" } else { ". " });
            } else {
                body.push(' ');
            }
        }
        if sentence_left == 0 {
            sentence_left = 8 + rng.below(18);
        }
        sentence_left -= 1;
        if i == needle_at {
            body.push_str(&needle);
            continue;
        }
        let u = rng.next_f64();
        if u < STOPWORD_SHARE {
            body.push_str(pick(rng, STOPWORDS));
        } else if u < STOPWORD_SHARE + ACCENTED_SHARE {
            body.push_str(pick(rng, ACCENTED));
        } else {
            body.push_str(&vocabulary_word(zipf.sample(rng)));
        }
    }
    body.push('.');

    Article {
        id,
        title,
        category,
        body,
    }
}

/// Articles `1..=spec.articles`, each with its needle term planted once in the body.
pub fn generate_corpus(spec: &CorpusSpec) -> impl Iterator<Item = Article> + use<> {
    let zipf = Zipf::vocabulary();
    let mut rng = SplitMix64::new(spec.seed);
    let mean_words = spec.mean_words;
    (1..=i64::from(spec.articles)).map(move |id| generate_article(id, mean_words, &zipf, &mut rng))
}

/// The planted term for article `id`: `zq{id:06}x`.
pub fn needle_term(id: i64) -> String {
    format!("zq{id:06}x")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tokenizer {
    Unicode61RemoveDiacritics,
    Porter,
    Trigram,
}

impl Tokenizer {
    /// The FTS5 `tokenize=` argument.
    fn fts5_arg(self) -> &'static str {
        match self {
            Self::Unicode61RemoveDiacritics => "unicode61 remove_diacritics 2",
            Self::Porter => "porter unicode61 remove_diacritics 2",
            Self::Trigram => "trigram remove_diacritics 1",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Unicode61RemoveDiacritics => "unicode61",
            Self::Porter => "porter",
            Self::Trigram => "trigram",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Detail {
    Full,
    Column,
    None,
}

impl Detail {
    pub fn name(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Column => "column",
            Self::None => "none",
        }
    }

    fn from_name(name: &str) -> Self {
        match name {
            "column" => Self::Column,
            "none" => Self::None,
            _ => Self::Full,
        }
    }
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

fn create_schema(
    conn: &Connection,
    opts: &BuildOptions,
    prefix_index: &[u8],
) -> Result<(), FtsSpikeError> {
    let tokenize = opts.tokenizer.fts5_arg();
    let detail = opts.detail.name();
    let prefix = if prefix_index.is_empty() {
        String::new()
    } else {
        let lengths: Vec<String> = prefix_index.iter().map(u8::to_string).collect();
        format!(", prefix='{}'", lengths.join(" "))
    };
    let ddl = if opts.external_content {
        format!(
            "CREATE TABLE articles(id INTEGER PRIMARY KEY, title TEXT NOT NULL, \
               category TEXT NOT NULL, body TEXT NOT NULL);
             CREATE VIRTUAL TABLE fts USING fts5(title, body, content='articles', \
               content_rowid='id', tokenize='{tokenize}', detail={detail}{prefix});"
        )
    } else {
        format!(
            "CREATE VIRTUAL TABLE fts USING fts5(title, body, category UNINDEXED, \
               tokenize='{tokenize}', detail={detail}{prefix});"
        )
    };
    conn.execute_batch(&format!(
        "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
         {ddl}
         INSERT INTO fts(fts, rank) VALUES('rank', 'bm25(10.0, 1.0)');"
    ))?;
    if opts.thumbnail_bytes.is_some() {
        conn.execute_batch("CREATE TABLE thumbnails(id INTEGER PRIMARY KEY, data BLOB NOT NULL);")?;
    }
    let mut meta = conn.prepare("INSERT INTO meta(key, value) VALUES (?1, ?2)")?;
    for (k, v) in [
        ("schema_version", SCHEMA_VERSION.to_string()),
        ("tokenizer", opts.tokenizer.name().to_owned()),
        ("detail", detail.to_owned()),
        ("external_content", opts.external_content.to_string()),
        ("prefix_index", prefix.trim_start_matches(", ").to_owned()),
    ] {
        meta.execute(params![k, v])?;
    }
    Ok(())
}

/// Builds the file in one transaction, then `optimize`, `VACUUM` and `journal_mode=DELETE`:
/// a single file with no `-wal`/`-shm` left behind. Refuses to overwrite an existing file.
pub fn build_encyclopedia(
    path: &Path,
    articles: impl IntoIterator<Item = Article>,
    opts: &BuildOptions,
) -> Result<BuildReport, FtsSpikeError> {
    build_encyclopedia_with_prefix_index(path, articles, opts, &[])
}

/// [`build_encyclopedia`] plus FTS5 prefix indexes for the given prefix lengths
/// (`prefix='2 3'`), which trade file size for fast `ab*` queries.
pub fn build_encyclopedia_with_prefix_index(
    path: &Path,
    articles: impl IntoIterator<Item = Article>,
    opts: &BuildOptions,
    prefix_index: &[u8],
) -> Result<BuildReport, FtsSpikeError> {
    if path.exists() {
        return Err(FtsSpikeError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("{} already exists", path.display()),
        )));
    }
    let start = Instant::now();
    let mut conn = Connection::open(path)?;
    // The file is regenerable build output, so durability during the build does not matter.
    // journal_mode is DELETE (never WAL), so no -wal/-shm can appear.
    conn.execute_batch(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF; PRAGMA cache_size=-262144;",
    )?;

    let mut count = 0u64;
    let mut raw = 0u64;
    let tx = conn.transaction()?;
    create_schema(&tx, opts, prefix_index)?;
    {
        let mut insert_fts = if opts.external_content {
            tx.prepare("INSERT INTO fts(rowid, title, body) VALUES (?1, ?2, ?3)")?
        } else {
            tx.prepare("INSERT INTO fts(rowid, title, body, category) VALUES (?1, ?2, ?3, ?4)")?
        };
        let mut insert_content = if opts.external_content {
            Some(tx.prepare(
                "INSERT INTO articles(id, title, category, body) VALUES (?1, ?2, ?3, ?4)",
            )?)
        } else {
            None
        };
        let mut insert_thumb = if opts.thumbnail_bytes.is_some() {
            Some(tx.prepare("INSERT INTO thumbnails(id, data) VALUES (?1, ?2)")?)
        } else {
            None
        };
        for a in articles {
            raw += (a.title.len() + a.category.len() + a.body.len()) as u64;
            if let Some(stmt) = insert_content.as_mut() {
                stmt.execute(params![a.id, a.title, a.category, a.body])?;
                insert_fts.execute(params![a.id, a.title, a.body])?;
            } else {
                insert_fts.execute(params![a.id, a.title, a.body, a.category])?;
            }
            if let (Some(stmt), Some(size)) = (insert_thumb.as_mut(), opts.thumbnail_bytes) {
                stmt.execute(params![a.id, thumbnail(a.id, size)])?;
            }
            count += 1;
        }
    }
    tx.execute_batch("INSERT INTO fts(fts) VALUES('optimize');")?;
    tx.commit()?;
    conn.execute_batch("VACUUM; PRAGMA journal_mode=DELETE;")?;
    conn.close().map_err(|(_, e)| FtsSpikeError::Sqlite(e))?;

    let file_bytes = std::fs::metadata(path)?.len();
    Ok(BuildReport {
        articles: count,
        raw_text_bytes: raw,
        file_bytes,
        build: start.elapsed(),
    })
}

/// Incompressible stand-in bytes for an article thumbnail (sizes only; not an image).
fn thumbnail(id: i64, size: u32) -> Vec<u8> {
    let mut rng = SplitMix64::new(id.unsigned_abs() ^ 0x7417_8B4A_11);
    let mut out = Vec::with_capacity(size as usize);
    while out.len() < size as usize {
        out.extend_from_slice(&rng.next_u64().to_le_bytes());
    }
    out.truncate(size as usize);
    out
}

pub struct Hit {
    pub id: i64,
    pub title: String,
    pub snippet: String,
    pub rank: f64,
}

/// A read-only encyclopedia connection.
pub struct Encyclopedia {
    conn: Connection,
    detail: Detail,
    external_content: bool,
}

impl Encyclopedia {
    /// Opens with `SQLITE_OPEN_READ_ONLY`.
    pub fn open(path: &Path) -> Result<Self, FtsSpikeError> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch("PRAGMA query_only=1;")?;
        let meta = |key: &str| -> Result<Option<String>, FtsSpikeError> {
            Ok(conn
                .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .optional()?)
        };
        let version: i64 = meta("schema_version")?
            .and_then(|v| v.parse().ok())
            .unwrap_or_default();
        if version != SCHEMA_VERSION {
            return Err(FtsSpikeError::Query(format!(
                "unsupported encyclopedia schema version {version} (expected {SCHEMA_VERSION})"
            )));
        }
        let detail = Detail::from_name(meta("detail")?.as_deref().unwrap_or("full"));
        let external_content = meta("external_content")?.as_deref() == Some("true");
        Ok(Self {
            conn,
            detail,
            external_content,
        })
    }

    /// User text escaped into an FTS5 query; bm25 rank; snippet with `[ ]` markers.
    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<Hit>, FtsSpikeError> {
        let Some(fts_query) = to_fts5_query(query, self.detail == Detail::Full) else {
            return Ok(Vec::new());
        };
        let mut stmt = self.conn.prepare_cached(
            // `rank` is configured as bm25(10.0, 1.0) (title weighted 10×) at build time;
            // `ORDER BY rank` is FTS5's optimized top-N path.
            "SELECT rowid, title, snippet(fts, -1, '[', ']', '…', 12), rank
             FROM fts WHERE fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![fts_query, limit], |row| {
            Ok(Hit {
                id: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                rank: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_article(&self, id: i64) -> Result<Option<Article>, FtsSpikeError> {
        let sql = if self.external_content {
            "SELECT id, title, category, body FROM articles WHERE id = ?1"
        } else {
            "SELECT rowid, title, category, body FROM fts WHERE rowid = ?1"
        };
        let mut stmt = self.conn.prepare_cached(sql)?;
        Ok(stmt
            .query_row([id], |row| {
                Ok(Article {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    category: row.get(2)?,
                    body: row.get(3)?,
                })
            })
            .optional()?)
    }
}

/// One element of a parsed user query.
enum Part {
    /// Words the user wrapped in balanced double quotes.
    Phrase(String),
    /// A bare word; `prefix` when it ended in `*`.
    Term { text: String, prefix: bool },
}

/// Splits user text into quoted phrases and bare terms. An unbalanced quote is ignored.
fn parse_user_query(input: &str) -> Vec<Part> {
    let mut parts = Vec::new();
    let mut rest = input;
    while let Some(open) = rest.find('"') {
        let (before, after) = rest.split_at(open);
        push_terms(before, &mut parts);
        let after = after.get(1..).unwrap_or("");
        match after.find('"') {
            Some(close) => {
                let (phrase, tail) = after.split_at(close);
                parts.push(Part::Phrase(phrase.to_owned()));
                rest = tail.get(1..).unwrap_or("");
            }
            None => {
                rest = after;
                break;
            }
        }
    }
    push_terms(rest, &mut parts);
    parts
}

fn push_terms(text: &str, parts: &mut Vec<Part>) {
    for word in text.split_whitespace() {
        let prefix = word.ends_with('*');
        let text = word.trim_end_matches('*');
        parts.push(Part::Term {
            text: text.to_owned(),
            prefix,
        });
    }
}

/// Whether a string would produce at least one token: only alphanumerics are token characters
/// for the unicode61 tokenizer (and the trigram tokenizer needs them to match anything useful).
fn has_token_chars(s: &str) -> bool {
    s.chars().any(char::is_alphanumeric)
}

/// An FTS5 string literal: double quotes with embedded quotes doubled. Inside a string, FTS5
/// syntax characters (`*`, `-`, `:`, `^`, `(`, `NEAR`, `AND`...) have no meaning.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Turns user text into a safe FTS5 query: every term and phrase is a quoted string, joined by
/// implicit AND; `word*` becomes a prefix query. Without positional data (`detail` other than
/// `full`), multi-token phrases are not supported by FTS5, so phrases and terms are split into
/// single alphanumeric runs and ANDed. Returns `None` when nothing searchable remains.
fn to_fts5_query(input: &str, positional: bool) -> Option<String> {
    let mut out: Vec<String> = Vec::new();
    for part in parse_user_query(input) {
        match part {
            Part::Phrase(p) if positional => {
                if has_token_chars(&p) {
                    out.push(quote(&p));
                }
            }
            Part::Term { text, prefix } if positional => {
                if has_token_chars(&text) {
                    out.push(if prefix {
                        format!("{}*", quote(&text))
                    } else {
                        quote(&text)
                    });
                }
            }
            Part::Phrase(p) => {
                out.extend(alnum_runs(&p).map(quote));
            }
            Part::Term { text, prefix } => {
                let runs: Vec<&str> = alnum_runs(&text).collect();
                let last = runs.len().saturating_sub(1);
                for (i, run) in runs.into_iter().enumerate() {
                    if prefix && i == last {
                        out.push(format!("{}*", quote(run)));
                    } else {
                        out.push(quote(run));
                    }
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out.join(" "))
    }
}

fn alnum_runs(s: &str) -> impl Iterator<Item = &str> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|r| !r.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_words_are_unique_and_never_contain_the_needle_prefix() {
        let mut words: Vec<String> = (0..VOCABULARY_SIZE).map(vocabulary_word).collect();
        assert!(words.iter().all(|w| !w.contains("zq")));
        words.sort_unstable();
        words.dedup();
        assert_eq!(words.len(), VOCABULARY_SIZE);
    }

    #[test]
    fn zipf_prefers_low_ranks() {
        let z = Zipf::new(1000, ZIPF_S);
        let mut rng = SplitMix64::new(1);
        let low = (0..10_000).filter(|_| z.sample(&mut rng) < 10).count();
        assert!(low > 3_000, "{low}");
    }

    #[test]
    fn queries_are_quoted() {
        assert_eq!(
            to_fts5_query("say \"hello world\" ab*", true).as_deref(),
            Some("\"say\" \"hello world\" \"ab\"*")
        );
        assert_eq!(
            to_fts5_query("\"unbalanced", true).as_deref(),
            Some("\"unbalanced\"")
        );
        assert_eq!(to_fts5_query("* - ( )", true), None);
        assert_eq!(to_fts5_query("", true), None);
        assert_eq!(
            to_fts5_query("\"quick brown\" foo*bar*", false).as_deref(),
            Some("\"quick\" \"brown\" \"foo\" \"bar\"*")
        );
    }
}
