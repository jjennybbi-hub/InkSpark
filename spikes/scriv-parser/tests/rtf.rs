//! Unit cases for the in-house RTF tokenizer (M0 §6.2). Conventions are in
//! `fixtures/README.md` under "RTF".

use inkspark_spike_scriv::{RtfDoc, Run, ScrivError, rtf_to_doc};

/// Wraps `body` in a minimal cp1252 RTF document. The space after
/// `\ansicpg1252` is the control-word delimiter, so `body` starts verbatim.
fn doc(body: &str) -> RtfDoc {
    let rtf = format!("{{\\rtf1\\ansi\\ansicpg1252 {body}}}");
    rtf_to_doc(rtf.as_bytes()).unwrap_or_else(|e| panic!("rtf_to_doc({rtf:?}) failed: {e}"))
}

fn paragraphs(body: &str) -> Vec<Vec<Run>> {
    doc(body).paragraphs
}

fn run(text: &str, bold: bool, italic: bool, underline: bool) -> Run {
    Run {
        text: text.to_owned(),
        bold,
        italic,
        underline,
    }
}

fn plain(text: &str) -> Run {
    run(text, false, false, false)
}

fn bold(text: &str) -> Run {
    run(text, true, false, false)
}

fn italic(text: &str) -> Run {
    run(text, false, true, false)
}

fn underline(text: &str) -> Run {
    run(text, false, false, true)
}

/// `\uN?`, built at runtime so the source never holds a literal escape.
fn u(n: i32) -> String {
    format!("\\u{n}?")
}

/// The single paragraph's plain text.
fn text(body: &str) -> String {
    let d = doc(body);
    assert!(
        d.paragraphs.len() <= 1,
        "expected one paragraph, got {:?}",
        d.paragraphs
    );
    d.plain_text()
}

// ---- document shape -------------------------------------------------------

#[test]
fn plain_text_is_one_run() {
    assert_eq!(paragraphs("Hello world"), vec![vec![plain("Hello world")]]);
}

#[test]
fn empty_document_has_no_paragraphs() {
    let d = rtf_to_doc(b"{\\rtf1\\ansi }").expect("valid");
    assert!(d.paragraphs.is_empty(), "{:?}", d.paragraphs);
    assert_eq!(d.plain_text(), "");
}

#[test]
fn header_then_par_gives_one_empty_paragraph() {
    let d = rtf_to_doc(
        b"{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fswiss Helvetica;}{\\colortbl;\\red0\\green0\\blue0;}\n\\pard\\f0\\fs24 \\par\n}",
    )
    .expect("valid");
    // One empty paragraph ended by \par; the trailing open one is empty and dropped.
    assert_eq!(d.paragraphs, vec![Vec::<Run>::new()]);
}

#[test]
fn par_splits_paragraphs_and_trailing_empty_one_is_dropped() {
    assert_eq!(
        paragraphs("One\\par Two\\par"),
        vec![vec![plain("One")], vec![plain("Two")]]
    );
    assert_eq!(
        paragraphs("One\\par\nTwo\\par\n"),
        vec![vec![plain("One")], vec![plain("Two")]]
    );
}

#[test]
fn final_paragraph_without_par_is_kept() {
    assert_eq!(
        paragraphs("One\\par Two"),
        vec![vec![plain("One")], vec![plain("Two")]]
    );
}

#[test]
fn empty_paragraphs_between_pars_are_kept() {
    assert_eq!(
        paragraphs("A\\par\\par\\par B"),
        vec![vec![plain("A")], vec![], vec![], vec![plain("B")]]
    );
}

#[test]
fn backslash_newline_is_a_paragraph_break() {
    assert_eq!(
        paragraphs("A\\\nB\\\r\nC"),
        vec![vec![plain("A")], vec![plain("B")], vec![plain("C")]]
    );
}

#[test]
fn raw_cr_and_lf_are_ignored() {
    assert_eq!(text("Hel\nlo\r\n wor\rld"), "Hello world");
}

#[test]
fn plain_text_joins_paragraphs_with_newline() {
    assert_eq!(
        doc("a\\par {\\b b}c\\par\\par d").plain_text(),
        "a\nbc\n\nd"
    );
}

// ---- control words and symbols --------------------------------------------

#[test]
fn one_space_after_a_control_word_is_consumed() {
    assert_eq!(paragraphs("\\b  x"), vec![vec![bold(" x")]]);
    assert_eq!(text("a\\fs24 b"), "ab");
}

#[test]
fn non_letter_terminator_is_not_consumed() {
    assert_eq!(paragraphs("\\b,x"), vec![vec![bold(",x")]]);
    assert_eq!(text("a\\fs24;b"), "a;b");
}

#[test]
fn unknown_control_words_are_ignored() {
    assert_eq!(text("a\\foobar12 b\\zz-3 c"), "abc");
    assert_eq!(text("a\\cocoatextscaling0\\pardirnatural b"), "ab");
}

#[test]
fn escaped_braces_and_backslash() {
    assert_eq!(text("\\\\ \\{ \\}"), "\\ { }");
    assert_eq!(text("path\\\\to"), "path\\to");
}

#[test]
fn tab_control_word() {
    assert_eq!(text("a\\tab b"), "a\tb");
}

#[test]
fn paragraph_and_font_words_do_not_split_runs() {
    assert_eq!(
        paragraphs("a\\f1 b\\fs28 c\\cf2 d\\pard\\tx720 e"),
        vec![vec![plain("abcde")]]
    );
}

// ---- character formatting ---------------------------------------------------

#[test]
fn bold_on_and_off() {
    assert_eq!(
        paragraphs("a \\b b\\b0  c"),
        vec![vec![plain("a "), bold("b"), plain(" c")]]
    );
}

#[test]
fn bold_with_nonzero_parameter_is_on() {
    assert_eq!(
        paragraphs("\\b1 x\\b0 y"),
        vec![vec![bold("x"), plain("y")]]
    );
}

#[test]
fn italic_on_and_off() {
    assert_eq!(
        paragraphs("\\i x\\i0 y"),
        vec![vec![italic("x"), plain("y")]]
    );
}

#[test]
fn underline_on_and_off() {
    assert_eq!(
        paragraphs("\\ul x\\ul0 y"),
        vec![vec![underline("x"), plain("y")]]
    );
    assert_eq!(
        paragraphs("\\ul x\\ulnone y"),
        vec![vec![underline("x"), plain("y")]]
    );
}

#[test]
fn combined_formatting() {
    assert_eq!(
        paragraphs("\\b a\\i b\\ul c\\b0 d"),
        vec![vec![
            bold("a"),
            run("b", true, true, false),
            run("c", true, true, true),
            run("d", false, true, true)
        ]]
    );
}

#[test]
fn plain_resets_all_formatting() {
    assert_eq!(
        paragraphs("\\b\\i\\ul x\\plain y"),
        vec![vec![run("x", true, true, true), plain("y")]]
    );
}

#[test]
fn groups_restore_formatting() {
    assert_eq!(paragraphs("{\\b x}y"), vec![vec![bold("x"), plain("y")]]);
    assert_eq!(
        paragraphs("\\i a{\\b b{\\i0 c}d}e"),
        vec![vec![
            italic("a"),
            run("b", true, true, false),
            bold("c"),
            run("d", true, true, false),
            italic("e")
        ]]
    );
}

#[test]
fn nested_groups() {
    assert_eq!(
        paragraphs("{{{\\b x}}}y{{z}}"),
        vec![vec![bold("x"), plain("yz")]]
    );
}

#[test]
fn adjacent_runs_with_the_same_formatting_are_merged() {
    assert_eq!(paragraphs("{\\b a}{\\b b}"), vec![vec![bold("ab")]]);
    assert_eq!(paragraphs("a{\\f1 b}c"), vec![vec![plain("abc")]]);
    assert_eq!(paragraphs("\\b a\\b0\\b b"), vec![vec![bold("ab")]]);
}

#[test]
fn no_empty_runs() {
    assert_eq!(paragraphs("\\b\\b0 x{\\i}{\\ul }"), vec![vec![plain("x")]]);
}

#[test]
fn formatting_carries_across_par_and_pard() {
    assert_eq!(
        paragraphs("\\b one\\par\\pard two\\b0 .\\par"),
        vec![vec![bold("one")], vec![bold("two"), plain(".")]]
    );
}

// ---- encodings --------------------------------------------------------------

#[test]
fn hex_escape_decodes_cp1252() {
    // 0x93/0x94/0x80/0x85 differ between cp1252 and Latin-1.
    assert_eq!(
        text("caf\\'e9 \\'93q\\'94 \\'805 \\'85"),
        "caf\u{e9} \u{201C}q\u{201D} \u{20AC}5 \u{2026}"
    );
}

#[test]
fn hex_escape_is_case_insensitive() {
    assert_eq!(text("\\'E9\\'e9"), "\u{e9}\u{e9}");
}

#[test]
fn raw_high_bytes_decode_cp1252() {
    let d = rtf_to_doc(b"{\\rtf1\\ansi\\ansicpg1252 caf\xe9 \x93q\x94}").expect("valid");
    assert_eq!(d.plain_text(), "caf\u{e9} \u{201C}q\u{201D}");
}

#[test]
fn unicode_escape_skips_one_fallback_character_by_default() {
    assert_eq!(text("\\u233?x"), "\u{e9}x");
    assert_eq!(text(&format!("{}{}", u(1513), u(1500))), "\u{5E9}\u{5DC}");
}

#[test]
fn unicode_escape_fallback_can_be_a_hex_escape() {
    assert_eq!(text("cr\\u232\\'e8me"), "cr\u{e8}me");
}

#[test]
fn uc_sets_the_fallback_length() {
    assert_eq!(text(&format!("\\uc0\\u{} x", 8220)), "\u{201C}x");
    assert_eq!(text("\\uc0\\u233 x"), "\u{e9}x");
    assert_eq!(text("\\uc2\\u233 ab c"), "\u{e9} c");
}

#[test]
fn uc_is_group_scoped() {
    assert_eq!(text("{\\uc0 \\u233 }\\u233?x"), "\u{e9}\u{e9}x");
}

#[test]
fn negative_unicode_values_wrap_and_surrogate_pairs_combine() {
    assert_eq!(text("\\u-10179?\\u-8704?"), "\u{1F600}");
    assert_eq!(text("\\u-10180?\\u-8438?"), "\u{1F30A}");
}

#[test]
fn unsigned_surrogate_pairs_combine() {
    assert_eq!(text(&format!("{}{}", u(55357), u(56832))), "\u{1F600}");
}

#[test]
fn unpaired_surrogates_become_replacement_characters() {
    assert_eq!(text("\\u-10179?!"), "\u{FFFD}!");
    assert_eq!(text("a\\u-8704?b"), "a\u{FFFD}b");
}

#[test]
fn hebrew_from_unicode_escapes() {
    let body: String = [1513, 1500, 1493, 1501].iter().map(|&n| u(n)).collect();
    assert_eq!(text(&body), "\u{5E9}\u{5DC}\u{5D5}\u{5DD}");
}

// ---- destinations -----------------------------------------------------------

#[test]
fn ignorable_destinations_are_skipped_with_their_nested_groups() {
    assert_eq!(text("a{\\*\\foo hidden {\\b nested} text}b"), "ab");
    assert_eq!(
        text("a{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;}b"),
        "ab"
    );
}

#[test]
fn known_header_destinations_are_skipped() {
    assert_eq!(
        text("{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1 Times;}x"),
        "x"
    );
    assert_eq!(text("{\\colortbl;\\red255\\green255\\blue255;}x"), "x");
    assert_eq!(text("{\\stylesheet{\\s0 Normal;}{\\s1 Heading;}}x"), "x");
    assert_eq!(text("{\\info{\\title A}{\\author B}}x"), "x");
    assert_eq!(text("{\\pict\\pngblip\\picw10 89504e470d0a}x"), "x");
}

#[test]
fn unknown_non_ignorable_groups_keep_their_text() {
    assert_eq!(text("a{\\someunknownword kept}b"), "akeptb");
}

#[test]
fn scrivener_footnotes_are_kept_inline() {
    assert_eq!(
        paragraphs("Out. {\\*\\Scrv_fn A {\\i note}.} Then."),
        vec![vec![plain("Out. A "), italic("note"), plain(". Then.")]]
    );
}

#[test]
fn destination_text_does_not_leak_formatting() {
    assert_eq!(paragraphs("{\\*\\x \\b hidden}y"), vec![vec![plain("y")]]);
}

// ---- input validation and robustness ------------------------------------------

#[test]
fn non_rtf_input_is_an_rtf_error() {
    for input in [
        &b""[..],
        b"   ",
        b"hello",
        b"{hello}",
        b"{\\rt",
        b"\x00\xff\xfe",
        b"rtf1 {\\rtf1 x}",
    ] {
        let result = rtf_to_doc(input);
        assert!(
            matches!(result, Err(ScrivError::Rtf(_))),
            "expected Err(Rtf) for {input:?}, got {result:?}"
        );
    }
}

#[test]
fn leading_whitespace_before_the_header_is_allowed() {
    let d = rtf_to_doc(b" \r\n\t{\\rtf1\\ansi x}").expect("valid");
    assert_eq!(d.plain_text(), "x");
}

#[test]
fn unclosed_groups_are_closed_at_end_of_input() {
    let d = rtf_to_doc(b"{\\rtf1\\ansi abc{\\b def").expect("tolerated");
    assert_eq!(d.paragraphs, vec![vec![plain("abc"), bold("def")]]);
}

#[test]
fn input_after_the_outer_group_is_ignored() {
    let d = rtf_to_doc(b"{\\rtf1\\ansi a}}} trailing {\\b text}").expect("tolerated");
    assert_eq!(d.paragraphs, vec![vec![plain("a")]]);
}

#[test]
fn truncated_escapes_do_not_panic() {
    for input in [
        &b"{\\rtf1\\ansi a\\"[..],
        b"{\\rtf1\\ansi a\\'",
        b"{\\rtf1\\ansi a\\'e",
        b"{\\rtf1\\ansi a\\u",
        b"{\\rtf1\\ansi a\\u-",
        b"{\\rtf1\\ansi a\\u233",
        b"{\\rtf1\\ansi a\\uc",
        b"{\\rtf1\\ansi a\\'zz b}",
        b"{\\rtf1\\ansi a\\u99999999999999999999? b}",
        b"{\\rtf1\\ansi a\\b99999999999999999999 b}",
        b"{\\rtf1\\ansi a\\uc99999999999 \\u233 bcdef}",
        b"{\\rtf1\\ansi {\\*",
        b"{\\rtf1\\ansi {\\*\\",
    ] {
        let _ = rtf_to_doc(input);
    }
}

#[test]
fn deep_nesting_does_not_overflow_the_stack() {
    let depth = 50_000;
    let mut rtf = String::from("{\\rtf1\\ansi ");
    rtf.push_str(&"{".repeat(depth));
    rtf.push('x');
    rtf.push_str(&"}".repeat(depth));
    rtf.push('}');
    let _ = rtf_to_doc(rtf.as_bytes());

    // Unclosed too: everything is closed implicitly at the end.
    let mut open = String::from("{\\rtf1\\ansi ");
    open.push_str(&"{\\b ".repeat(depth));
    let _ = rtf_to_doc(open.as_bytes());

    // And inside an ignored destination.
    let mut hidden = String::from("{\\rtf1\\ansi {\\*\\x ");
    hidden.push_str(&"{".repeat(depth));
    hidden.push_str("}}y}");
    let _ = rtf_to_doc(hidden.as_bytes());
}
