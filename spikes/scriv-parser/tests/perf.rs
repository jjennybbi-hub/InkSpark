//! Performance (M0 §6.2): a generated 1,000-document project parses in under
//! 2 s in release. Recorded on macos-15 with
//! `cargo test --release -p inkspark-spike-scriv -- --ignored perf`.

mod support;

use std::time::{Duration, Instant};

use inkspark_spike_scriv::{BinderItemKind, read_project};

/// Not a perf measurement: checks the generator and the parser agree, so the
/// timed run below measures a project that parses cleanly.
#[test]
fn generated_project_parses_cleanly() {
    let dir = support::scratch_dir("generated").join("Generated.scriv");
    support::generate_large_project(&dir, 25, 42).expect("generate");
    let project = read_project(&dir).expect("read generated project");

    assert!(project.warnings.is_empty(), "{:?}", project.warnings);
    let items = support::preorder(&project.binder.items);
    let texts: Vec<_> = items
        .iter()
        .filter(|i| i.kind == BinderItemKind::Text)
        .collect();
    assert_eq!(texts.len(), 25);
    assert_eq!(project.documents.len(), items.len());
    for (n, text) in texts.iter().enumerate() {
        let doc = &project.documents[&text.uuid];
        let content = doc
            .content
            .as_ref()
            .expect("every generated text has content");
        assert!(
            content.paragraphs.len() >= 3,
            "{}: {:?}",
            text.uuid,
            content.paragraphs
        );
        assert!(!content.plain_text().trim().is_empty());
        assert_eq!(
            doc.synopsis.is_some(),
            n.is_multiple_of(3),
            "synopsis on every 3rd text"
        );
        assert_eq!(
            doc.notes.is_some(),
            n.is_multiple_of(5),
            "notes on every 5th text"
        );
    }
}

#[test]
fn generator_is_deterministic() {
    let a = support::scratch_dir("det-a").join("Same.scriv");
    let b = support::scratch_dir("det-b").join("Same.scriv");
    support::generate_large_project(&a, 12, 99).expect("generate a");
    support::generate_large_project(&b, 12, 99).expect("generate b");
    assert_eq!(read_project(&a).expect("a"), read_project(&b).expect("b"));
}

#[test]
#[ignore = "perf: run with `cargo test --release -- --ignored perf`"]
fn perf_read_project_1000_docs_under_2s() {
    let dir = support::scratch_dir("perf").join("Large.scriv");
    support::generate_large_project(&dir, 1_000, 2026).expect("generate");

    let start = Instant::now();
    let project = read_project(&dir).expect("read large project");
    let elapsed = start.elapsed();

    let texts = support::preorder(&project.binder.items)
        .iter()
        .filter(|i| i.kind == BinderItemKind::Text)
        .count();
    assert_eq!(texts, 1_000);
    assert!(project.warnings.is_empty(), "{:?}", project.warnings);
    println!("read_project(1000 docs): {} ms", elapsed.as_millis());

    let limit = Duration::from_secs(2);
    if cfg!(debug_assertions) {
        // The threshold is defined for release builds only.
        eprintln!("debug build: {elapsed:?} reported, {limit:?} threshold not enforced");
    } else {
        assert!(
            elapsed < limit,
            "read_project took {elapsed:?}, threshold {limit:?}"
        );
    }
}
