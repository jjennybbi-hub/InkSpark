//! Golden-file tests (M0 §6.2): `read_project` on every fixture except
//! `malformed`, serialized with serde_json, must equal `<fixture>.expected.json`.
//! Conventions are in `fixtures/README.md`.

mod support;

use std::collections::BTreeSet;
use std::fs;

use inkspark_spike_scriv::{BinderItemKind, ScrivProject, parse_scrivx, read_project};
use serde_json::Value;

fn read(name: &str) -> ScrivProject {
    read_project(&support::fixture(name))
        .unwrap_or_else(|e| panic!("read_project({name}.scriv) failed: {e}"))
}

fn assert_golden(name: &str) {
    let actual = serde_json::to_value(read(name)).expect("serialize ScrivProject");
    let expected_text = fs::read_to_string(support::expected_json(name))
        .unwrap_or_else(|e| panic!("read {name}.expected.json: {e}"));
    let expected: Value = serde_json::from_str(&expected_text)
        .unwrap_or_else(|e| panic!("parse {name}.expected.json: {e}"));
    if actual != expected {
        panic!(
            "golden mismatch for {name}.scriv\n--- expected ({name}.expected.json)\n{}\n--- actual\n{}",
            serde_json::to_string_pretty(&expected).unwrap_or_default(),
            serde_json::to_string_pretty(&actual).unwrap_or_default(),
        );
    }
}

#[test]
fn golden_minimal() {
    assert_golden("minimal");
}

#[test]
fn golden_nested() {
    assert_golden("nested");
}

#[test]
fn golden_unicode() {
    assert_golden("unicode");
}

#[test]
fn golden_formatting() {
    assert_golden("formatting");
}

#[test]
fn golden_missing_content() {
    assert_golden("missing-content");
}

#[test]
fn every_fixture_package_is_listed_and_goldens_exist() {
    let on_disk: BTreeSet<String> = fs::read_dir(support::fixtures_dir())
        .expect("list fixtures")
        .map(|e| {
            e.expect("dir entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .filter_map(|n| n.strip_suffix(".scriv").map(str::to_owned))
        .collect();
    let listed: BTreeSet<String> = support::ALL_FIXTURES
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    assert_eq!(
        on_disk, listed,
        "fixtures/*.scriv and support::ALL_FIXTURES differ"
    );

    for name in support::GOLDEN_FIXTURES {
        assert!(
            support::expected_json(name).is_file(),
            "{name}.expected.json is missing"
        );
    }
    assert!(
        !support::expected_json("malformed").exists(),
        "malformed must not have a golden: it has to fail"
    );
}

#[test]
fn parse_scrivx_matches_read_project_binder() {
    for name in support::GOLDEN_FIXTURES {
        let xml = fs::read_to_string(support::fixture_scrivx(name)).expect("read scrivx");
        let binder = parse_scrivx(&xml).unwrap_or_else(|e| panic!("parse_scrivx({name}): {e}"));
        assert_eq!(
            binder,
            read(name).binder,
            "{name}: parse_scrivx differs from read_project"
        );
    }
}

#[test]
fn documents_cover_every_binder_item() {
    for name in support::GOLDEN_FIXTURES {
        let project = read(name);
        let uuids: BTreeSet<&str> = support::preorder(&project.binder.items)
            .iter()
            .map(|item| item.uuid.as_str())
            .collect();
        let keys: BTreeSet<&str> = project.documents.keys().map(String::as_str).collect();
        assert_eq!(
            uuids, keys,
            "{name}: documents keys must equal the binder UUIDs"
        );
    }
}

#[test]
fn plain_text_joins_paragraphs_with_newlines() {
    let project = read("minimal");
    let content = project.documents["D20CA403-93A4-4DF3-A22A-4E1B9559F2B6"]
        .content
        .as_ref()
        .expect("Chapter One has content");
    assert_eq!(
        content.plain_text(),
        "It was a quiet morning in the harbour town.\nThe kettle had not yet boiled."
    );

    let project = read("unicode");
    let content = project.documents["465D0C38-48AA-465D-8EFE-607E46C9094D"]
        .content
        .as_ref()
        .expect("Waves has content");
    assert_eq!(
        content.plain_text(),
        "Emoji: \u{1F600} and waves \u{1F30A}.\nUnsigned: \u{1F600}.\nLone: \u{FFFD}!"
    );
}

#[test]
fn nested_kinds_and_depth() {
    let project = read("nested");
    let items = &project.binder.items;
    let kinds: Vec<&BinderItemKind> = items.iter().map(|i| &i.kind).collect();
    assert_eq!(
        kinds,
        [
            &BinderItemKind::DraftFolder,
            &BinderItemKind::ResearchFolder,
            &BinderItemKind::TrashFolder
        ]
    );
    let scene = &items[0].children[0].children[0].children[0];
    assert_eq!(scene.title, "The Harbour");
    assert_eq!(scene.kind, BinderItemKind::Text);
    assert_eq!(
        items[1].children[1].kind,
        BinderItemKind::Other("PDF".to_owned())
    );
}
