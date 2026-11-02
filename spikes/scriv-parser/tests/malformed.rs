//! Malformed input and package detection (M0 §6.2). Nothing here may panic.
//! Conventions are in `fixtures/README.md`.

mod support;

use std::fs;
use std::path::Path;

use inkspark_spike_scriv::{ScrivError, parse_scrivx, read_project};

#[test]
fn malformed_fixture_is_an_xml_error() {
    let result = read_project(&support::fixture("malformed"));
    assert!(
        matches!(result, Err(ScrivError::Xml(_))),
        "expected Err(Xml), got {:?}",
        result.map(|p| p.binder)
    );
}

#[test]
fn parse_scrivx_rejects_the_truncated_fixture() {
    let xml = fs::read_to_string(support::fixture_scrivx("malformed")).expect("read scrivx");
    assert!(matches!(parse_scrivx(&xml), Err(ScrivError::Xml(_))));
}

#[test]
fn parse_scrivx_rejects_empty_and_foreign_documents() {
    let cases = [
        "",
        "   \n",
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<NotScrivener Version=\"2.0\"><Binder/></NotScrivener>\n",
        "<html><body>hello</body></html>",
        "not xml at all",
        "<ScrivenerProject Version=\"2.0\"><Binder><BinderItem UUID=\"A\" Type=\"Text\"></Binder></ScrivenerProject>",
        "<ScrivenerProject Version=\"2.0\"><Binder>",
        "<ScrivenerProject Version=\"2.0\"",
    ];
    for xml in cases {
        let result = parse_scrivx(xml);
        assert!(
            matches!(result, Err(ScrivError::Xml(_))),
            "expected Err(Xml) for {xml:?}, got {result:?}"
        );
    }
}

/// Any truncation of a valid `.scrivx` before the end of `</ScrivenerProject>`
/// leaves elements open, so it must be an XML error.
#[test]
fn every_truncation_of_a_valid_scrivx_is_an_xml_error() {
    for name in ["minimal", "nested"] {
        let xml = fs::read_to_string(support::fixture_scrivx(name)).expect("read scrivx");
        assert!(parse_scrivx(&xml).is_ok(), "{name} must parse whole");
        let end = xml.rfind("</ScrivenerProject>").expect("closing root tag")
            + "</ScrivenerProject>".len();
        let mut cut = 0;
        while cut < end {
            if xml.is_char_boundary(cut) {
                let result = parse_scrivx(&xml[..cut]);
                assert!(
                    matches!(result, Err(ScrivError::Xml(_))),
                    "{name} truncated at byte {cut} should be Err(Xml), got {result:?}"
                );
            }
            cut += 7;
        }
        let tail = parse_scrivx(&xml[..end]);
        assert!(
            tail.is_ok(),
            "{name} cut right after the root close tag must parse: {tail:?}"
        );
    }
}

fn assert_not_a_package(path: &Path) {
    let result = read_project(path);
    assert!(
        matches!(result, Err(ScrivError::NotAScrivPackage(_))),
        "expected Err(NotAScrivPackage) for {}, got {:?}",
        path.display(),
        result.map(|p| p.binder)
    );
}

#[test]
fn empty_directory_is_not_a_package() {
    assert_not_a_package(&support::scratch_dir("empty"));
}

#[test]
fn directory_without_scrivx_is_not_a_package() {
    let dir = support::scratch_dir("no-scrivx").join("Novel.scriv");
    support::write_file(&dir.join("notes.txt"), b"just some notes\n").expect("write");
    support::write_file(&dir.join("Files").join("version.txt"), b"23\n").expect("write");
    assert_not_a_package(&dir);
}

#[test]
fn nested_scrivx_does_not_count() {
    let dir = support::scratch_dir("deep-scrivx").join("Outer.scriv");
    fs::create_dir_all(dir.join("Inner")).expect("mkdir");
    fs::copy(
        support::fixture_scrivx("minimal"),
        dir.join("Inner").join("Outer.scrivx"),
    )
    .expect("copy");
    assert_not_a_package(&dir);
}

#[test]
fn missing_path_is_not_a_package() {
    assert_not_a_package(&support::scratch_dir("missing").join("does-not-exist.scriv"));
}

#[test]
fn regular_file_is_not_a_package() {
    assert_not_a_package(&support::fixtures_dir().join("README.md"));
    assert_not_a_package(&support::fixture_scrivx("minimal"));
}

#[test]
fn scrivx_named_differently_from_the_directory_is_found() {
    let dir = support::scratch_dir("renamed").join("Renamed Copy.scriv");
    support::copy_dir(&support::fixture("minimal"), &dir).expect("copy fixture");
    let copy = read_project(&dir).expect("a renamed package still has one .scrivx");
    let original = read_project(&support::fixture("minimal")).expect("minimal");
    assert_eq!(copy, original);
}

#[test]
fn scrivx_matching_the_directory_stem_wins() {
    let dir = support::scratch_dir("two-scrivx").join("nested.scriv");
    support::copy_dir(&support::fixture("nested"), &dir).expect("copy fixture");
    // A decoy that sorts first; the stem match must still be preferred.
    fs::copy(support::fixture_scrivx("minimal"), dir.join("aaa.scrivx")).expect("copy decoy");
    let project = read_project(&dir).expect("nested copy");
    assert_eq!(project.binder.items[0].title, "Manuscript");
}

#[test]
fn malformed_rtf_in_a_project_is_a_warning_not_an_error() {
    let dir = support::scratch_dir("bad-rtf").join("minimal.scriv");
    support::copy_dir(&support::fixture("minimal"), &dir).expect("copy fixture");
    let uuid = "D20CA403-93A4-4DF3-A22A-4E1B9559F2B6";
    support::write_file(
        &dir.join("Files")
            .join("Data")
            .join(uuid)
            .join("content.rtf"),
        b"\x00\xff garbage, not rtf",
    )
    .expect("overwrite content");
    let project = read_project(&dir).expect("bad RTF must not fail the project");
    assert_eq!(project.documents[uuid].content, None);
    assert_eq!(
        project.warnings,
        vec![format!("invalid rtf in {uuid}/content.rtf")]
    );
}
