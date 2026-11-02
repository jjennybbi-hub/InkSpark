//! Property tests (M0 §6.2): the parsers never panic on arbitrary input, and
//! successful results keep the invariants from `fixtures/README.md`.
//!
//! Cases default to 256 locally; CI sets `PROPTEST_CASES=2000`.

mod support;

use std::fs;

use inkspark_spike_scriv::{RtfDoc, Run, ScrivError, parse_scrivx, read_project, rtf_to_doc};
use proptest::prelude::*;

fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(256)
}

/// Invariants every successful `rtf_to_doc` result must hold.
fn assert_doc_invariants(doc: &RtfDoc) -> Result<(), TestCaseError> {
    for paragraph in &doc.paragraphs {
        for run in paragraph {
            prop_assert!(!run.text.is_empty(), "empty run in {:?}", doc.paragraphs);
        }
        for pair in paragraph.windows(2) {
            let same = (pair[0].bold, pair[0].italic, pair[0].underline)
                == (pair[1].bold, pair[1].italic, pair[1].underline);
            prop_assert!(!same, "unmerged adjacent runs {:?}", pair);
        }
    }
    let expected: Vec<String> = doc
        .paragraphs
        .iter()
        .map(|p| p.iter().map(|r| r.text.as_str()).collect())
        .collect();
    prop_assert_eq!(doc.plain_text(), expected.join("\n"));
    Ok(())
}

/// RTF-shaped token soup: far more likely than random bytes to reach deep states.
fn rtf_soup() -> impl Strategy<Value = Vec<u8>> {
    let token = prop_oneof![
        Just("{".to_owned()),
        Just("}".to_owned()),
        Just("\\".to_owned()),
        Just("\\\\".to_owned()),
        Just("\\{".to_owned()),
        Just("\\}".to_owned()),
        Just("\\par ".to_owned()),
        Just("\\par".to_owned()),
        Just("\\pard".to_owned()),
        Just("\\b ".to_owned()),
        Just("\\b0 ".to_owned()),
        Just("\\i".to_owned()),
        Just("\\i0".to_owned()),
        Just("\\ul ".to_owned()),
        Just("\\ulnone ".to_owned()),
        Just("\\plain ".to_owned()),
        Just("\\tab ".to_owned()),
        Just("\\*".to_owned()),
        Just("{\\*\\Scrv_fn ".to_owned()),
        Just("{\\fonttbl".to_owned()),
        Just("{\\colortbl;".to_owned()),
        Just("{\\pict ".to_owned()),
        Just("\\\n".to_owned()),
        Just("\r\n".to_owned()),
        "\\\\u-?[0-9]{0,7}\\??",
        "\\\\uc[0-9]{0,3} ?",
        "\\\\'[0-9a-fA-Fxz]{0,2}",
        "\\\\[a-z]{1,10}-?[0-9]{0,4} ?",
        "[a-zA-Z0-9 .,;?]{1,12}",
    ];
    (any::<bool>(), prop::collection::vec(token, 0..64)).prop_map(|(header, tokens)| {
        let mut out = if header {
            "{\\rtf1\\ansi\\ansicpg1252 ".to_owned()
        } else {
            String::new()
        };
        out.extend(tokens);
        out.into_bytes()
    })
}

/// XML-shaped token soup around the `.scrivx` vocabulary.
fn xml_soup() -> impl Strategy<Value = String> {
    let token = prop_oneof![
        Just("<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_owned()),
        Just("<ScrivenerProject Version=\"2.0\">".to_owned()),
        Just("</ScrivenerProject>".to_owned()),
        Just("<Binder>".to_owned()),
        Just("</Binder>".to_owned()),
        Just("<BinderItem UUID=\"A\" Type=\"Text\">".to_owned()),
        Just("<BinderItem Type=\"Folder\">".to_owned()),
        Just("</BinderItem>".to_owned()),
        Just("<Children>".to_owned()),
        Just("</Children>".to_owned()),
        Just("<Title>".to_owned()),
        Just("</Title>".to_owned()),
        Just("<MetaData>".to_owned()),
        Just("</MetaData>".to_owned()),
        Just("<LabelID>".to_owned()),
        Just("</LabelID>".to_owned()),
        Just("<IncludeInCompile>Yes</IncludeInCompile>".to_owned()),
        Just("<LabelSettings><Labels><Label ID=\"".to_owned()),
        Just("\">".to_owned()),
        Just("</Label></Labels></LabelSettings>".to_owned()),
        Just("<StatusSettings><StatusItems><Status ID=\"-1\">".to_owned()),
        Just("&amp;".to_owned()),
        Just("&#x".to_owned()),
        Just("&bogus;".to_owned()),
        Just("<![CDATA[".to_owned()),
        Just("]]>".to_owned()),
        Just("<!--".to_owned()),
        Just("-->".to_owned()),
        Just("<".to_owned()),
        Just(">".to_owned()),
        Just("/>".to_owned()),
        "-?[0-9]{1,12}",
        "[a-zA-Z \u{e9}\u{5E9}\u{1F30A}]{1,10}",
    ];
    prop::collection::vec(token, 0..48).prop_map(|t| t.concat())
}

/// Text that needs no RTF escaping and has no raw CR/LF.
fn safe_text() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 .,;:!?'\"()-]{1,40}"
}

proptest! {
    #![proptest_config(ProptestConfig { cases: cases(), ..ProptestConfig::default() })]

    #[test]
    fn rtf_to_doc_never_panics_on_arbitrary_bytes(bytes in prop::collection::vec(any::<u8>(), 0..2048)) {
        if let Ok(doc) = rtf_to_doc(&bytes) {
            assert_doc_invariants(&doc)?;
        }
    }

    #[test]
    fn rtf_to_doc_never_panics_on_rtf_like_input(bytes in rtf_soup()) {
        match rtf_to_doc(&bytes) {
            Ok(doc) => assert_doc_invariants(&doc)?,
            Err(e) => prop_assert!(matches!(e, ScrivError::Rtf(_)), "unexpected error kind {e:?}"),
        }
    }

    #[test]
    fn rtf_with_header_is_never_rejected(bytes in rtf_soup()) {
        // Anything that starts with the header is tolerated, per the README.
        let mut input = b"{\\rtf1\\ansi ".to_vec();
        input.extend_from_slice(&bytes);
        let doc = rtf_to_doc(&input);
        prop_assert!(doc.is_ok(), "{:?}", doc);
        assert_doc_invariants(&doc.unwrap())?;
    }

    #[test]
    fn plain_paragraphs_round_trip(lines in prop::collection::vec(safe_text(), 1..6)) {
        let rtf = format!("{{\\rtf1\\ansi\\ansicpg1252 {}}}", lines.join("\\par\n"));
        let doc = rtf_to_doc(rtf.as_bytes()).expect("valid RTF");
        let expected: Vec<Vec<Run>> = lines
            .iter()
            .map(|l| vec![Run { text: l.clone(), bold: false, italic: false, underline: false }])
            .collect();
        prop_assert_eq!(&doc.paragraphs, &expected);
        prop_assert_eq!(doc.plain_text(), lines.join("\n"));
    }

    #[test]
    fn formatted_segments_round_trip_with_merging(
        segments in prop::collection::vec((safe_text(), any::<bool>(), any::<bool>(), any::<bool>()), 1..12)
    ) {
        let mut body = String::new();
        let mut expected: Vec<Run> = Vec::new();
        for (text, bold, italic, underline) in &segments {
            body.push_str("{\\plain");
            if *bold { body.push_str("\\b"); }
            if *italic { body.push_str("\\i"); }
            if *underline { body.push_str("\\ul"); }
            body.push(' ');
            body.push_str(text);
            body.push('}');
            match expected.last_mut() {
                Some(last) if (last.bold, last.italic, last.underline) == (*bold, *italic, *underline) => {
                    last.text.push_str(text);
                }
                _ => expected.push(Run { text: text.clone(), bold: *bold, italic: *italic, underline: *underline }),
            }
        }
        let rtf = format!("{{\\rtf1\\ansi {body}}}");
        let doc = rtf_to_doc(rtf.as_bytes()).expect("valid RTF");
        prop_assert_eq!(doc.paragraphs, vec![expected]);
    }

    #[test]
    fn parse_scrivx_never_panics_on_arbitrary_strings(xml in any::<String>()) {
        if let Err(e) = parse_scrivx(&xml) {
            prop_assert!(matches!(e, ScrivError::Xml(_)), "unexpected error kind {e:?}");
        }
    }

    #[test]
    fn parse_scrivx_never_panics_on_xml_like_input(xml in xml_soup()) {
        if let Err(e) = parse_scrivx(&xml) {
            prop_assert!(matches!(e, ScrivError::Xml(_)), "unexpected error kind {e:?}");
        }
    }

    #[test]
    fn parse_scrivx_never_panics_on_mutated_fixtures(
        which in 0usize..5,
        at in any::<prop::sample::Index>(),
        len in 0usize..64,
        insert in xml_soup(),
    ) {
        let name = support::GOLDEN_FIXTURES[which];
        let xml = fs::read_to_string(support::fixture_scrivx(name)).expect("read scrivx");
        let mut start = at.index(xml.len() + 1);
        while !xml.is_char_boundary(start) { start -= 1; }
        let mut end = (start + len).min(xml.len());
        while !xml.is_char_boundary(end) { end -= 1; }
        let mutated = format!("{}{}{}", &xml[..start], insert, &xml[end..]);
        if let Err(e) = parse_scrivx(&mutated) {
            prop_assert!(matches!(e, ScrivError::Xml(_)), "unexpected error kind {e:?}");
        }
    }
}

proptest! {
    // Each case touches the filesystem, so cap it below the pure-parser cases.
    #![proptest_config(ProptestConfig { cases: cases().min(256), ..ProptestConfig::default() })]

    #[test]
    fn read_project_tolerates_arbitrary_content_rtf(bytes in prop_oneof![
        prop::collection::vec(any::<u8>(), 0..512),
        rtf_soup(),
    ]) {
        let uuid = "D20CA403-93A4-4DF3-A22A-4E1B9559F2B6";
        let dir = scratch_minimal();
        let content = dir.join("Files").join("Data").join(uuid).join("content.rtf");
        support::write_file(&content, &bytes).expect("write content.rtf");

        let project = read_project(&dir).expect("bad content.rtf is a warning, not an error");
        match rtf_to_doc(&bytes) {
            Ok(doc) => {
                prop_assert_eq!(project.documents[uuid].content.as_ref(), Some(&doc));
                prop_assert!(project.warnings.is_empty(), "{:?}", project.warnings);
            }
            Err(_) => {
                prop_assert_eq!(project.documents[uuid].content.as_ref(), None);
                prop_assert_eq!(project.warnings, vec![format!("invalid rtf in {uuid}/content.rtf")]);
            }
        }
    }
}

/// One copy of `minimal.scriv` per test process, reused across cases.
fn scratch_minimal() -> std::path::PathBuf {
    use std::sync::OnceLock;
    static DIR: OnceLock<std::path::PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = support::scratch_dir("props").join("minimal.scriv");
        support::copy_dir(&support::fixture("minimal"), &dir).expect("copy fixture");
        dir
    })
    .clone()
}
