//! Export to Markdown and Word. The frontend hands over the finished text or document model;
//! this module builds the `.docx` and writes it through [`atomic_write`].

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::{Cursor, Write as _};
use std::path::{Path, PathBuf};

use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use crate::error::AppError;
use crate::storage::atomic_write;

/// A whole Word document: the writer's default look plus its paragraphs in order.
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DocxDocument {
    /// Default font name.
    pub font: String,
    /// Default text size, in half-points (Word's unit).
    pub half_points: u32,
    pub blocks: Vec<DocxBlock>,
}

/// One paragraph.
#[derive(Debug, Clone, Default, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // Mirrors independent paragraph properties.
pub struct DocxBlock {
    /// Heading level 1-3, or 0 for body text.
    pub heading: u8,
    /// `left`, `center`, `right` or `justify`.
    pub align: Option<String>,
    pub list: Option<DocxList>,
    pub quote: bool,
    pub code: bool,
    /// A horizontal line with no text.
    pub rule: bool,
    /// Start this paragraph on a new page.
    pub page_break: bool,
    pub runs: Vec<DocxRun>,
}

/// Membership of a list. Items sharing an `id` count together.
#[derive(Debug, Clone, Copy, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DocxList {
    pub id: u32,
    pub ordered: bool,
    /// Nesting depth, starting at 0.
    pub level: u8,
}

/// A stretch of text with one formatting. A newline in `text` is a line break.
#[derive(Debug, Clone, Default, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // Mirrors independent character properties.
pub struct DocxRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
    pub font: Option<String>,
    pub half_points: Option<u32>,
    /// Six hex digits; anything else is ignored.
    pub color: Option<String>,
    /// Six hex digits; anything else is ignored.
    pub highlight: Option<String>,
}

const CODE_FONT: &str = "Courier New";
const MAX_LIST_LEVEL: u8 = 8;
const WORD_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#;
const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;

/// Makes text safe inside XML, dropping characters XML cannot hold at all.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if u32::from(c) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

fn hex_color(value: Option<&String>) -> Option<&str> {
    value
        .map(String::as_str)
        .filter(|v| v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit()))
}

fn fonts_xml(font: &str) -> String {
    let f = escape(font);
    format!(r#"<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}" w:eastAsia="{f}"/>"#)
}

fn size_xml(half_points: u32) -> String {
    format!(r#"<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>"#)
}

fn push_text(out: &mut String, text: &str) {
    let mut plain = String::new();
    let flush = |out: &mut String, plain: &mut String| {
        if !plain.is_empty() {
            let _ = write!(out, r#"<w:t xml:space="preserve">{}</w:t>"#, escape(plain));
            plain.clear();
        }
    };
    for c in text.chars() {
        match c {
            '\n' => {
                flush(out, &mut plain);
                out.push_str("<w:br/>");
            }
            '\t' => {
                flush(out, &mut plain);
                out.push_str("<w:tab/>");
            }
            '\r' => {}
            c => plain.push(c),
        }
    }
    flush(out, &mut plain);
}

fn run_xml(out: &mut String, run: &DocxRun, code_block: bool) {
    let mut props = String::new();
    if run.code || code_block {
        props.push_str(&fonts_xml(CODE_FONT));
    } else if let Some(font) = &run.font {
        props.push_str(&fonts_xml(font));
    }
    if run.bold {
        props.push_str("<w:b/><w:bCs/>");
    }
    if run.italic {
        props.push_str("<w:i/><w:iCs/>");
    }
    if run.strike {
        props.push_str("<w:strike/>");
    }
    if let Some(color) = hex_color(run.color.as_ref()) {
        let _ = write!(props, r#"<w:color w:val="{color}"/>"#);
    }
    if let Some(size) = run.half_points {
        props.push_str(&size_xml(size));
    }
    if run.underline {
        props.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let Some(fill) = hex_color(run.highlight.as_ref()) {
        let _ = write!(
            props,
            r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>"#
        );
    }
    out.push_str("<w:r>");
    if !props.is_empty() {
        let _ = write!(out, "<w:rPr>{props}</w:rPr>");
    }
    push_text(out, &run.text);
    out.push_str("</w:r>");
}

fn block_xml(out: &mut String, block: &DocxBlock) {
    let mut props = String::new();
    if (1..=3).contains(&block.heading) {
        let _ = write!(props, r#"<w:pStyle w:val="Heading{}"/>"#, block.heading);
    } else if block.quote {
        props.push_str(r#"<w:pStyle w:val="Quote"/>"#);
    }
    if block.page_break {
        props.push_str("<w:pageBreakBefore/>");
    }
    if let Some(list) = block.list {
        let _ = write!(
            props,
            r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{}"/></w:numPr>"#,
            list.level.min(MAX_LIST_LEVEL),
            u64::from(list.id) + 1
        );
    }
    if block.rule {
        props.push_str(
            r#"<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>"#,
        );
    }
    let jc = match block.align.as_deref() {
        Some("center") => Some("center"),
        Some("right") => Some("right"),
        Some("justify") => Some("both"),
        _ => None,
    };
    if let Some(jc) = jc {
        let _ = write!(props, r#"<w:jc w:val="{jc}"/>"#);
    }
    out.push_str("<w:p>");
    if !props.is_empty() {
        let _ = write!(out, "<w:pPr>{props}</w:pPr>");
    }
    for run in &block.runs {
        run_xml(out, run, block.code);
    }
    out.push_str("</w:p>");
}

fn document_xml(doc: &DocxDocument) -> String {
    let mut body = String::new();
    for block in &doc.blocks {
        block_xml(&mut body, block);
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{WORD_NS}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    )
}

/// Heading sizes match what the editor shows: 2, 1.5 and 1.17 times the body text.
fn styles_xml(doc: &DocxDocument) -> String {
    let base = doc.half_points;
    let heading = |level: u8, numerator: u32| {
        format!(
            r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="{}"/></w:pPr><w:rPr><w:b/><w:bCs/>{}</w:rPr></w:style>"#,
            level - 1,
            size_xml(base * numerator / 100),
        )
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr>{}{}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>{}{}{}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="12" w:color="A0A0A0"/></w:pBdr><w:ind w:left="480"/></w:pPr></w:style></w:styles>"#,
        fonts_xml(&doc.font),
        size_xml(base),
        heading(1, 200),
        heading(2, 150),
        heading(3, 117),
    )
}

fn abstract_num(id: u8, ordered: bool) -> String {
    let mut levels = String::new();
    for level in 0..=MAX_LIST_LEVEL {
        let (format, text) = if ordered {
            ("decimal", format!("%{}.", level + 1))
        } else {
            ("bullet", "\u{2022}".to_owned())
        };
        let indent = 480 * (u32::from(level) + 1);
        let _ = write!(
            levels,
            r#"<w:lvl w:ilvl="{level}"><w:start w:val="1"/><w:numFmt w:val="{format}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{indent}" w:hanging="360"/></w:pPr></w:lvl>"#
        );
    }
    format!(
        r#"<w:abstractNum w:abstractNumId="{id}"><w:multiLevelType w:val="multilevel"/>{levels}</w:abstractNum>"#
    )
}

/// Every list gets its own numbering instance, so numbered lists each restart at 1.
fn numbering_xml(doc: &DocxDocument) -> String {
    let lists: BTreeMap<u32, DocxList> = doc
        .blocks
        .iter()
        .filter_map(|b| b.list)
        .map(|l| (l.id, l))
        .collect();
    let mut nums = String::new();
    for list in lists.values() {
        let num_id = u64::from(list.id) + 1;
        let _ = write!(
            nums,
            r#"<w:num w:numId="{num_id}"><w:abstractNumId w:val="{}"/>"#,
            u8::from(list.ordered)
        );
        if list.ordered {
            let _ = write!(
                nums,
                r#"<w:lvlOverride w:ilvl="{}"><w:startOverride w:val="1"/></w:lvlOverride>"#,
                list.level.min(MAX_LIST_LEVEL)
            );
        }
        nums.push_str("</w:num>");
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{WORD_NS}">{}{}{nums}</w:numbering>"#,
        abstract_num(0, false),
        abstract_num(1, true),
    )
}

/// Builds the bytes of a `.docx` file.
///
/// # Errors
///
/// Returns [`AppError::Io`] if the zip container cannot be assembled.
pub fn build_docx(doc: &DocxDocument) -> Result<Vec<u8>, AppError> {
    let zip_error = |err: zip::result::ZipError| AppError::Io(format!("could not build: {err}"));
    let parts = [
        ("[Content_Types].xml", CONTENT_TYPES.to_owned()),
        ("_rels/.rels", ROOT_RELS.to_owned()),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS.to_owned()),
        ("word/document.xml", document_xml(doc)),
        ("word/styles.xml", styles_xml(doc)),
        ("word/numbering.xml", numbering_xml(doc)),
    ];
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in parts {
        zip.start_file(name, SimpleFileOptions::default())
            .map_err(zip_error)?;
        zip.write_all(content.as_bytes())?;
    }
    Ok(zip.finish().map_err(zip_error)?.into_inner())
}

/// Adds the extension when the chosen name lacks it, keeping dots already in the name.
fn with_extension(dest: &Path, extension: &str) -> PathBuf {
    let has_it = dest
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(extension));
    if has_it {
        dest.to_path_buf()
    } else {
        let mut name = dest.as_os_str().to_owned();
        name.push(".");
        name.push(extension);
        PathBuf::from(name)
    }
}

/// An export must never replace a page or its history, which would skip the page's safety copies.
fn check_destination(project: &Path, dest: &Path) -> Result<(), AppError> {
    let folder = dest
        .parent()
        .ok_or_else(|| AppError::Invalid("that place has no folder".to_owned()))?;
    let folder = folder.canonicalize()?;
    for protected in ["pages", ".history"] {
        if let Ok(inner) = project.join(protected).canonicalize()
            && folder.starts_with(inner)
        {
            return Err(AppError::Invalid(
                "that folder holds your pages, so please export somewhere else".to_owned(),
            ));
        }
    }
    Ok(())
}

/// Writes Markdown to `dest`; returns the path actually written.
///
/// # Errors
///
/// Refuses the project's own page folders; otherwise returns the I/O error.
pub fn export_markdown(project: &Path, dest: &Path, content: &str) -> Result<String, AppError> {
    let dest = with_extension(dest, "md");
    check_destination(project, &dest)?;
    atomic_write(&dest, content.as_bytes())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Writes a Word document to `dest`; returns the path actually written.
///
/// # Errors
///
/// Refuses the project's own page folders; otherwise returns the build or I/O error.
pub fn export_docx(project: &Path, dest: &Path, doc: &DocxDocument) -> Result<String, AppError> {
    let dest = with_extension(dest, "docx");
    check_destination(project, &dest)?;
    atomic_write(&dest, &build_docx(doc)?)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
