//! A small, iterative RTF tokenizer that keeps text, paragraphs and bold/italic/underline.
//! The conventions it follows are in `fixtures/README.md` under "RTF".
//!
//! Groups never recurse: the formatting stack is a `Vec`, and ignored destinations are skipped
//! with a depth counter, so any nesting depth is safe.

use encoding_rs::Encoding;

use crate::{RtfDoc, Run, ScrivError};

/// Character formatting tracked per group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct Fmt {
    bold: bool,
    italic: bool,
    underline: bool,
}

/// State saved by `{` and restored by `}`.
#[derive(Debug, Clone, Copy)]
struct Group {
    fmt: Fmt,
    uc: u32,
}

/// Header destinations whose whole group is ignored when they are the group's first token.
const SKIPPED_DESTINATIONS: &[&[u8]] = &[b"fonttbl", b"colortbl", b"stylesheet", b"info", b"pict"];

/// The one `{\*\…}` destination that is kept (Scrivener footnotes).
const SCRIVENER_FOOTNOTE: &[u8] = b"Scrv_fn";

/// Upper bound for `\ucN`; anything larger skips the rest of the input just the same.
const MAX_UC: u32 = 1 << 20;

/// Single-byte code pages that `\ansicpgN` may select. Anything else falls back to cp1252.
fn code_page(n: i32) -> &'static Encoding {
    match n {
        874 => encoding_rs::WINDOWS_874,
        1250 => encoding_rs::WINDOWS_1250,
        1251 => encoding_rs::WINDOWS_1251,
        1253 => encoding_rs::WINDOWS_1253,
        1254 => encoding_rs::WINDOWS_1254,
        1255 => encoding_rs::WINDOWS_1255,
        1256 => encoding_rs::WINDOWS_1256,
        1257 => encoding_rs::WINDOWS_1257,
        1258 => encoding_rs::WINDOWS_1258,
        10000 => encoding_rs::MACINTOSH,
        _ => encoding_rs::WINDOWS_1252,
    }
}

/// Decoding table for bytes 0x80..=0xFF in one single-byte code page.
fn high_byte_table(encoding: &'static Encoding) -> [char; 128] {
    let mut table = ['\u{FFFD}'; 128];
    for (i, slot) in table.iter_mut().enumerate() {
        // `i < 128`, so the byte is 0x80..=0xFF.
        let byte = [0x80 | i as u8];
        let (decoded, _) = encoding.decode_without_bom_handling(&byte);
        if let Some(c) = decoded.chars().next() {
            *slot = c;
        }
    }
    table
}

struct Parser {
    paragraphs: Vec<Vec<Run>>,
    current: Vec<Run>,
    fmt: Fmt,
    uc: u32,
    groups: Vec<Group>,
    /// Depth inside an ignored destination; 0 when emitting.
    skip_depth: usize,
    /// The next token is the first one in a freshly opened group.
    group_start: bool,
    /// `\*` was the first token of the current group.
    star: bool,
    /// Fallback characters still to skip after a `\uN`.
    fallback: u32,
    /// A high surrogate waiting for its low half.
    pending_high: Option<u32>,
    high_bytes: [char; 128],
}

impl Parser {
    fn new() -> Self {
        Parser {
            paragraphs: Vec::new(),
            current: Vec::new(),
            fmt: Fmt::default(),
            uc: 1,
            groups: Vec::new(),
            skip_depth: 0,
            group_start: false,
            star: false,
            fallback: 0,
            pending_high: None,
            high_bytes: high_byte_table(encoding_rs::WINDOWS_1252),
        }
    }

    fn flush_surrogate(&mut self) {
        if self.pending_high.take().is_some() {
            self.push_char_raw('\u{FFFD}');
        }
    }

    fn push_char_raw(&mut self, c: char) {
        let fmt = self.fmt;
        match self.current.last_mut() {
            Some(run)
                if (run.bold, run.italic, run.underline)
                    == (fmt.bold, fmt.italic, fmt.underline) =>
            {
                run.text.push(c);
            }
            _ => self.current.push(Run {
                text: c.to_string(),
                bold: fmt.bold,
                italic: fmt.italic,
                underline: fmt.underline,
            }),
        }
    }

    fn push_char(&mut self, c: char) {
        self.flush_surrogate();
        self.push_char_raw(c);
    }

    fn end_paragraph(&mut self) {
        self.flush_surrogate();
        self.paragraphs.push(std::mem::take(&mut self.current));
    }

    /// A literal byte of text (or the byte of a `\'hh` escape).
    fn text_byte(&mut self, b: u8) {
        if self.fallback > 0 {
            self.fallback -= 1;
            return;
        }
        let c = if b < 0x80 {
            char::from(b)
        } else {
            self.high_bytes[usize::from(b & 0x7F)]
        };
        self.push_char(c);
    }

    fn unicode(&mut self, param: Option<i32>) {
        let Some(n) = param else {
            return;
        };
        let code = if n < 0 {
            i64::from(n) + 65_536
        } else {
            i64::from(n)
        };
        let code = u32::try_from(code).unwrap_or(0xFFFD);
        if (0xDC00..=0xDFFF).contains(&code) {
            if let Some(high) = self.pending_high.take() {
                let combined = 0x10000 + ((high - 0xD800) << 10) + (code - 0xDC00);
                self.push_char_raw(char::from_u32(combined).unwrap_or('\u{FFFD}'));
            } else {
                self.push_char('\u{FFFD}');
            }
        } else if (0xD800..=0xDBFF).contains(&code) {
            self.flush_surrogate();
            self.pending_high = Some(code);
        } else {
            self.push_char(char::from_u32(code).unwrap_or('\u{FFFD}'));
        }
        self.fallback = self.uc;
    }

    fn open_group(&mut self) {
        self.fallback = 0;
        if self.skip_depth > 0 {
            self.skip_depth += 1;
            return;
        }
        self.flush_surrogate();
        self.groups.push(Group {
            fmt: self.fmt,
            uc: self.uc,
        });
        self.group_start = true;
        self.star = false;
    }

    /// Returns `false` once the outermost group has closed.
    fn close_group(&mut self) -> bool {
        self.fallback = 0;
        self.group_start = false;
        self.star = false;
        if self.skip_depth > 0 {
            self.skip_depth -= 1;
            return !(self.skip_depth == 0 && self.groups.is_empty());
        }
        self.flush_surrogate();
        match self.groups.pop() {
            Some(group) => {
                self.fmt = group.fmt;
                self.uc = group.uc;
                !self.groups.is_empty()
            }
            None => false,
        }
    }

    /// Turns the group just opened into an ignored destination.
    fn skip_current_group(&mut self) {
        if let Some(group) = self.groups.pop() {
            self.fmt = group.fmt;
            self.uc = group.uc;
        }
        self.skip_depth = 1;
        self.group_start = false;
        self.star = false;
    }

    fn control_word(&mut self, name: &[u8], param: Option<i32>) {
        if self.skip_depth > 0 {
            return;
        }
        if self.group_start {
            let destination = if self.star {
                name != SCRIVENER_FOOTNOTE
            } else {
                SKIPPED_DESTINATIONS.contains(&name)
            };
            self.group_start = false;
            self.star = false;
            if destination {
                self.skip_current_group();
                return;
            }
        }
        if name != b"u" {
            self.fallback = 0;
        }
        let on = param != Some(0);
        match name {
            b"b" => self.fmt.bold = on,
            b"i" => self.fmt.italic = on,
            b"ul" => self.fmt.underline = on,
            b"ulnone" => self.fmt.underline = false,
            b"plain" => self.fmt = Fmt::default(),
            b"par" => self.end_paragraph(),
            b"tab" => self.push_char('\t'),
            b"u" => self.unicode(param),
            b"uc" => {
                let n = param.unwrap_or(1).max(0);
                self.uc = u32::try_from(n).unwrap_or(0).min(MAX_UC);
            }
            b"ansicpg" => {
                if let Some(n) = param {
                    self.high_bytes = high_byte_table(code_page(n));
                }
            }
            _ => {}
        }
    }

    /// `\*` and other control symbols that are not text.
    fn star_symbol(&mut self) {
        if self.skip_depth > 0 {
            return;
        }
        if self.group_start {
            self.star = true;
        } else {
            self.fallback = 0;
        }
    }

    fn not_first_token(&mut self) {
        self.group_start = false;
        self.star = false;
    }

    fn finish(mut self) -> RtfDoc {
        self.flush_surrogate();
        if !self.current.is_empty() {
            self.paragraphs.push(self.current);
        }
        RtfDoc {
            paragraphs: self.paragraphs,
        }
    }
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Parses the optional signed decimal parameter at `bytes[*pos..]`, saturating to `i32`.
fn parameter(bytes: &[u8], pos: &mut usize) -> Option<i32> {
    let negative = bytes.get(*pos) == Some(&b'-');
    let digits_at = if negative { *pos + 1 } else { *pos };
    if !bytes.get(digits_at).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    *pos = digits_at;
    let mut value: i64 = 0;
    while let Some(&d) = bytes.get(*pos) {
        if !d.is_ascii_digit() {
            break;
        }
        value = (value * 10 + i64::from(d - b'0')).min(i64::from(i32::MAX) + 1);
        *pos += 1;
    }
    let value = if negative { -value } else { value };
    Some(i32::try_from(value).unwrap_or(if negative { i32::MIN } else { i32::MAX }))
}

pub(crate) fn rtf_to_doc(rtf: &[u8]) -> Result<RtfDoc, ScrivError> {
    let start = rtf
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .ok_or_else(|| ScrivError::Rtf("empty input".to_owned()))?;
    let bytes = &rtf[start..];
    if !bytes.starts_with(b"{\\rtf") {
        return Err(ScrivError::Rtf("missing {\\rtf header".to_owned()));
    }

    let mut p = Parser::new();
    let mut pos = 0;
    while let Some(&b) = bytes.get(pos) {
        pos += 1;
        match b {
            b'{' => p.open_group(),
            b'}' => {
                if !p.close_group() {
                    break;
                }
            }
            b'\r' | b'\n' => {}
            b'\\' => {
                let Some(&next) = bytes.get(pos) else {
                    break;
                };
                if next.is_ascii_alphabetic() {
                    let name_start = pos;
                    while bytes.get(pos).is_some_and(u8::is_ascii_alphabetic) {
                        pos += 1;
                    }
                    if bytes[name_start..pos].starts_with(b"Scrv") {
                        while bytes
                            .get(pos)
                            .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
                        {
                            pos += 1;
                        }
                    }
                    let name_end = pos;
                    let param = parameter(bytes, &mut pos);
                    if bytes.get(pos) == Some(&b' ') {
                        pos += 1;
                    }
                    p.control_word(&bytes[name_start..name_end], param);
                    continue;
                }
                pos += 1;
                match next {
                    b'\\' | b'{' | b'}' => {
                        p.not_first_token();
                        if p.skip_depth == 0 {
                            p.text_byte(next);
                        }
                    }
                    b'\'' => {
                        p.not_first_token();
                        let hi = bytes.get(pos).copied().and_then(hex_value);
                        let lo = bytes.get(pos + 1).copied().and_then(hex_value);
                        // A truncated or invalid escape is ignored.
                        if let (Some(hi), Some(lo)) = (hi, lo) {
                            pos += 2;
                            if p.skip_depth == 0 {
                                p.text_byte((hi << 4) | lo);
                            }
                        }
                    }
                    b'*' => p.star_symbol(),
                    b'\r' | b'\n' => {
                        p.not_first_token();
                        if p.skip_depth == 0 {
                            p.fallback = 0;
                            p.end_paragraph();
                        }
                    }
                    _ => {
                        p.not_first_token();
                        if p.skip_depth == 0 {
                            p.fallback = 0;
                        }
                    }
                }
            }
            _ => {
                p.not_first_token();
                if p.skip_depth == 0 {
                    p.text_byte(b);
                }
            }
        }
    }
    Ok(p.finish())
}
