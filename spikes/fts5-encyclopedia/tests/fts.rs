//! Spec tests for the FTS5 encyclopedia spike (docs/milestones/M0.md §5.3).
//!
//! Corpora use 2,000 articles. Each test builds into its own unique directory under
//! `std::env::temp_dir()`, which is removed when the test ends.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use inkspark_spike_fts::{
    Article, BuildOptions, CorpusSpec, Detail, Encyclopedia, Tokenizer, build_encyclopedia,
    generate_corpus, needle_term,
};
use proptest::prelude::*;
use proptest::test_runner::TestRunner;

const ARTICLES: u32 = 2_000;
const MEAN_WORDS: u32 = 120;
const SEED: u64 = 0x00C0_FFEE;

static DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A unique temporary directory, removed on drop.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let n = DIR_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "inkspark-spike-fts-{label}-{}-{nanos}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn db(&self) -> PathBuf {
        self.path.join("encyclopedia.sqlite")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Read-only files block removal on Windows, so make everything writable first.
        if let Ok(entries) = std::fs::read_dir(&self.path) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    let mut perms = meta.permissions();
                    // Restoring write access to our own temp file before deleting it.
                    #[allow(clippy::permissions_set_readonly_false)]
                    perms.set_readonly(false);
                    let _ = std::fs::set_permissions(entry.path(), perms);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn corpus_spec() -> CorpusSpec {
    CorpusSpec {
        articles: ARTICLES,
        mean_words: MEAN_WORDS,
        seed: SEED,
    }
}

fn default_options() -> BuildOptions {
    BuildOptions {
        tokenizer: Tokenizer::Unicode61RemoveDiacritics,
        detail: Detail::Full,
        external_content: false,
        thumbnail_bytes: None,
    }
}

fn build_corpus(dir: &TempDir, opts: &BuildOptions) -> PathBuf {
    let path = dir.db();
    let report = build_encyclopedia(&path, generate_corpus(&corpus_spec()), opts)
        .expect("build encyclopedia");
    assert_eq!(report.articles, u64::from(ARTICLES));
    assert!(report.raw_text_bytes > 0);
    assert!(report.file_bytes > 0);
    path
}

fn article(id: i64, title: &str, body: &str) -> Article {
    Article {
        id,
        title: title.to_owned(),
        category: String::from("Test"),
        body: body.to_owned(),
    }
}

fn build_articles(dir: &TempDir, articles: Vec<Article>) -> PathBuf {
    let path = dir.db();
    build_encyclopedia(&path, articles, &default_options()).expect("build encyclopedia");
    path
}

fn hit_ids(enc: &Encyclopedia, query: &str) -> Vec<i64> {
    enc.search(query, 50)
        .expect("search succeeds")
        .iter()
        .map(|h| h.id)
        .collect()
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[test]
fn generate_corpus_is_deterministic_with_the_specified_count() {
    let a: Vec<Article> = generate_corpus(&corpus_spec()).collect();
    let b: Vec<Article> = generate_corpus(&corpus_spec()).collect();
    assert_eq!(a.len(), ARTICLES as usize);
    assert!(a == b, "two corpora from the same spec differ");

    let mut ids: Vec<i64> = a.iter().map(|x| x.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), a.len(), "article ids must be unique");
}

#[test]
fn needle_terms_are_planted_in_their_article() {
    assert_eq!(needle_term(1234), "zq001234x");
    let found = generate_corpus(&corpus_spec())
        .find(|a| a.id == 1234)
        .expect("corpus of 2,000 contains article 1234");
    assert!(found.body.contains(&needle_term(1234)));
}

#[test]
fn needle_search_returns_exactly_that_article_first() {
    let dir = TempDir::new("needle");
    let path = build_corpus(&dir, &default_options());
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");

    let hits = enc.search(&needle_term(1234), 10).expect("search succeeds");
    let first = hits.first().expect("at least one hit");
    assert_eq!(first.id, 1234);
    assert!(
        hits.iter().all(|h| h.id == 1234),
        "only article 1234 contains its needle term"
    );
    assert!(!first.title.is_empty());
    assert!(
        first.snippet.contains('[') && first.snippet.contains(']'),
        "snippet {:?} must mark the match with [ ]",
        first.snippet
    );
    assert!(first.rank.is_finite());
}

#[test]
fn search_respects_the_limit() {
    let dir = TempDir::new("limit");
    let path = build_corpus(&dir, &default_options());
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");
    // A stopword is present in nearly every article.
    let hits = enc.search("the", 7).expect("search succeeds");
    assert!(hits.len() <= 7, "got {} hits for limit 7", hits.len());
}

#[test]
fn phrase_query_matches_only_the_adjacent_phrase() {
    let dir = TempDir::new("phrase");
    let path = build_articles(
        &dir,
        vec![
            article(1, "Adjacent", "the quick brown fox jumps over the lazy dog"),
            article(2, "Separated", "brown dogs are quick to bark at a fox"),
            article(3, "Unrelated", "a quiet afternoon in the library"),
        ],
    );
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");

    // A user-quoted phrase is honoured as an FTS5 phrase: only adjacent tokens match.
    assert_eq!(hit_ids(&enc, "\"quick brown\""), vec![1]);
    assert!(hit_ids(&enc, "quick brown").contains(&1));
}

#[test]
fn unicode61_remove_diacritics_matches_cafe_to_cafe_accented() {
    let dir = TempDir::new("diacritics");
    let path = build_articles(
        &dir,
        vec![
            article(1, "Paris", "We met at a small café near the river."),
            article(2, "Tea", "A teahouse with no coffee at all."),
        ],
    );
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");
    assert_eq!(hit_ids(&enc, "cafe"), vec![1]);
    assert_eq!(hit_ids(&enc, "café"), vec![1]);
}

#[test]
fn fts_syntax_characters_in_user_text_do_not_error() {
    let dir = TempDir::new("syntax");
    let path = build_corpus(&dir, &default_options());
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");

    let queries = [
        "\"",
        "\"unbalanced quote",
        "say \"hello",
        "*",
        "**",
        "foo*bar",
        "NEAR",
        "NEAR(",
        "NEAR(a b, 2)",
        "-",
        "-foo",
        "a - b",
        "AND",
        "OR",
        "NOT",
        "a AND",
        "OR b",
        "(",
        ")",
        "(a OR",
        ":",
        "title:foo",
        "body:",
        "^",
        "^start",
        "{title body}: x",
        "+",
        "a + b",
        "",
        "   ",
        "'; DROP TABLE fts; --",
    ];
    for q in queries {
        assert!(enc.search(q, 10).is_ok(), "search({q:?}) returned an error");
    }
}

#[test]
fn get_article_round_trips() {
    for external_content in [false, true] {
        let dir = TempDir::new("roundtrip");
        let opts = BuildOptions {
            external_content,
            ..default_options()
        };
        let path = build_corpus(&dir, &opts);
        let enc = Encyclopedia::open(&path).expect("open encyclopedia");

        for original in generate_corpus(&corpus_spec()).step_by(97) {
            let stored = enc
                .get_article(original.id)
                .expect("get_article succeeds")
                .expect("article exists");
            assert_eq!(stored, original, "external_content={external_content}");
        }
        assert_eq!(
            enc.get_article(-424_242).expect("get_article succeeds"),
            None
        );
    }
}

#[test]
fn build_leaves_a_single_file_that_passes_integrity_check() {
    let dir = TempDir::new("integrity");
    let path = build_corpus(&dir, &default_options());

    for suffix in ["-wal", "-shm", "-journal"] {
        let p = sidecar(&path, suffix);
        assert!(!p.exists(), "{} must not exist after build", p.display());
    }
    let entries: Vec<PathBuf> = std::fs::read_dir(&dir.path)
        .expect("read temp dir")
        .flatten()
        .map(|e| e.path())
        .collect();
    assert_eq!(
        entries,
        vec![path.clone()],
        "build must leave exactly one file"
    );

    let conn =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open built file");
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity_check");
    assert_eq!(integrity, "ok");
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode");
    assert_eq!(journal_mode.to_ascii_lowercase(), "delete");
}

#[test]
fn every_bench_variant_builds_and_finds_the_needle() {
    let variants = [
        (Tokenizer::Unicode61RemoveDiacritics, Detail::Full),
        (Tokenizer::Porter, Detail::Full),
        (Tokenizer::Unicode61RemoveDiacritics, Detail::Column),
        (Tokenizer::Trigram, Detail::Full),
    ];
    for (tokenizer, detail) in variants {
        let dir = TempDir::new("variant");
        let opts = BuildOptions {
            tokenizer,
            detail,
            ..default_options()
        };
        let path = build_corpus(&dir, &opts);
        let enc = Encyclopedia::open(&path).expect("open encyclopedia");
        let hits = hit_ids(&enc, &needle_term(1234));
        assert_eq!(hits.first().copied(), Some(1234));
    }
}

/// Adaptation: `Encyclopedia` hides its connection, so "writing through an Encyclopedia
/// connection fails" is checked by making the file read-only on disk. A read-only open
/// (`SQLITE_OPEN_READ_ONLY`) must still succeed and serve searches, and the file must be
/// byte-identical afterwards.
#[test]
fn encyclopedia_opens_read_only_files_and_never_writes() {
    let dir = TempDir::new("readonly");
    let path = build_corpus(&dir, &default_options());
    let before = std::fs::read(&path).expect("read db bytes");

    let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&path, perms).expect("make db read-only");

    {
        let enc = Encyclopedia::open(&path).expect("open read-only file");
        let hits = hit_ids(&enc, &needle_term(1234));
        assert_eq!(hits.first().copied(), Some(1234));
        assert!(enc.get_article(1234).expect("get_article").is_some());
    }

    let after = std::fs::read(&path).expect("read db bytes");
    assert!(
        before == after,
        "opening and searching must not modify the file"
    );
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(
            !sidecar(&path, suffix).exists(),
            "no {suffix} file after read-only use"
        );
    }

    // The same read-only flag the spec names refuses writes on this file.
    let conn =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open read-only");
    assert!(
        conn.execute_batch("CREATE TABLE should_fail(x INTEGER)")
            .is_err(),
        "writes through a read-only connection must fail"
    );
}

#[test]
fn opening_a_missing_file_is_an_error() {
    let dir = TempDir::new("missing");
    let missing = dir.path.join("does-not-exist.sqlite");
    assert!(Encyclopedia::open(&missing).is_err());
    assert!(
        !missing.exists(),
        "a read-only open must not create the file"
    );
}

fn proptest_cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256)
}

#[test]
fn search_arbitrary_strings_never_panics_and_returns_ok() {
    let dir = TempDir::new("proptest");
    let path = build_corpus(&dir, &default_options());
    let enc = Encyclopedia::open(&path).expect("open encyclopedia");

    let strategy = prop_oneof![
        any::<String>(),
        "[\"*()\\-+:^{}a-zA-Z0-9 ]{0,40}",
        "(NEAR|AND|OR|NOT|\\*|\"|-|\\(|\\)| |zq[0-9]{6}x){0,12}",
    ];
    let mut runner = TestRunner::new(ProptestConfig::with_cases(proptest_cases()));
    runner
        .run(&strategy, |query| {
            let result = enc.search(&query, 10);
            prop_assert!(result.is_ok(), "search({:?}) returned an error", query);
            Ok(())
        })
        .expect("search(arbitrary) is always Ok");
}
