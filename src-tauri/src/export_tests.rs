// Unit tests for `export.rs`, included from the bottom of that file.

use std::fs;

use super::*;

fn run(text: &str) -> DocxRun {
    DocxRun {
        text: text.to_owned(),
        ..DocxRun::default()
    }
}

fn doc(blocks: Vec<DocxBlock>) -> DocxDocument {
    DocxDocument {
        font: "Georgia".to_owned(),
        half_points: 27,
        blocks,
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("inkspark-export-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn text_is_escaped_and_breaks_become_word_breaks() {
    let xml = document_xml(&doc(vec![DocxBlock {
        runs: vec![run("Tom & <Jerry>\nline\u{1} two")],
        ..DocxBlock::default()
    }]));
    assert!(xml.contains("Tom &amp; &lt;Jerry&gt;</w:t><w:br/>"));
    assert!(xml.contains(">line two</w:t>"));
}

#[test]
fn formatting_reaches_word() {
    let xml = document_xml(&doc(vec![DocxBlock {
        heading: 2,
        align: Some("center".to_owned()),
        runs: vec![DocxRun {
            bold: true,
            italic: true,
            underline: true,
            font: Some("Arial".to_owned()),
            half_points: Some(40),
            color: Some("FF0000".to_owned()),
            highlight: Some("not-a-colour".to_owned()),
            ..run("Big")
        }],
        ..DocxBlock::default()
    }]));
    for expected in [
        r#"<w:pStyle w:val="Heading2"/>"#,
        r#"<w:jc w:val="center"/>"#,
        "<w:b/>",
        "<w:i/>",
        r#"<w:u w:val="single"/>"#,
        r#"w:ascii="Arial""#,
        r#"<w:sz w:val="40"/>"#,
        r#"<w:color w:val="FF0000"/>"#,
    ] {
        assert!(xml.contains(expected), "missing {expected}");
    }
    assert!(!xml.contains("not-a-colour"));
}

#[test]
fn default_look_is_the_writers_font_and_size() {
    let xml = styles_xml(&doc(vec![]));
    assert!(xml.contains(r#"w:ascii="Georgia""#));
    assert!(xml.contains(r#"<w:sz w:val="27"/>"#));
}

#[test]
fn each_numbered_list_restarts() {
    let item = |id| DocxBlock {
        list: Some(DocxList {
            id,
            ordered: true,
            level: 0,
        }),
        ..DocxBlock::default()
    };
    let xml = numbering_xml(&doc(vec![item(0), item(0), item(1)]));
    assert_eq!(xml.matches("<w:num ").count(), 2);
    assert_eq!(xml.matches("<w:startOverride").count(), 2);
}

#[test]
fn docx_is_a_zip_with_every_part() {
    let bytes = build_docx(&doc(vec![])).expect("build");
    let archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip");
    let names: Vec<String> = archive
        .file_names()
        .map(|n| n.expect("name").into_owned())
        .collect();
    for part in [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/styles.xml",
        "word/numbering.xml",
    ] {
        assert!(names.iter().any(|n| n == part), "missing {part}");
    }
}

#[test]
fn adds_a_missing_extension_without_eating_dots() {
    let dir = temp_dir("ext");
    let written = export_markdown(&dir, &dir.join("Vol.2"), "hello").expect("export");
    assert!(written.ends_with("Vol.2.md"));
    assert_eq!(fs::read_to_string(written).expect("read"), "hello");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn refuses_to_replace_a_page_or_its_history() {
    let dir = temp_dir("guard");
    let pages = dir.join("pages");
    fs::create_dir_all(&pages).expect("pages");
    atomic_write(&pages.join("p1.md"), b"my words").expect("page");
    assert!(export_markdown(&dir, &pages.join("p1.md"), "other").is_err());
    assert!(export_docx(&dir, &pages.join("x.docx"), &doc(vec![])).is_err());
    assert_eq!(
        fs::read_to_string(pages.join("p1.md")).expect("read"),
        "my words"
    );
    let _ = fs::remove_dir_all(dir);
}
