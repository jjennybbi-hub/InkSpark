//! Read-only Scrivener 3 (`.scriv`) parser spike (M0 §6.2, ADR 006): quick-xml for the binder
//! and a small in-house RTF tokenizer. It never writes and never panics on malformed input.
#![forbid(unsafe_code)]

mod rtf;
mod scrivx;

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum BinderItemKind {
    DraftFolder,
    ResearchFolder,
    TrashFolder,
    Folder,
    Text,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BinderItem {
    pub uuid: String,
    pub kind: BinderItemKind,
    pub title: String,
    pub include_in_compile: bool,
    pub label_id: Option<i32>,
    pub status_id: Option<i32>,
    pub children: Vec<BinderItem>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Binder {
    pub format_version: String,
    pub items: Vec<BinderItem>,
    pub labels: BTreeMap<i32, String>,
    pub statuses: BTreeMap<i32, String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Run {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RtfDoc {
    pub paragraphs: Vec<Vec<Run>>,
}

impl RtfDoc {
    /// The text of every paragraph, joined by `"\n"`.
    pub fn plain_text(&self) -> String {
        let paragraphs: Vec<String> = self
            .paragraphs
            .iter()
            .map(|runs| runs.iter().map(|run| run.text.as_str()).collect())
            .collect();
        paragraphs.join("\n")
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Document {
    pub content: Option<RtfDoc>,
    pub synopsis: Option<String>,
    pub notes: Option<RtfDoc>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ScrivProject {
    pub binder: Binder,
    pub documents: BTreeMap<String, Document>,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScrivError {
    #[error("not a .scriv package: {0}")]
    NotAScrivPackage(String),
    #[error("xml: {0}")]
    Xml(String),
    #[error("rtf: {0}")]
    Rtf(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Parses a `.scrivx` binder. Never panics; malformed or truncated XML, or a root other than
/// `<ScrivenerProject>`, is `Err(ScrivError::Xml(_))`.
pub fn parse_scrivx(xml: &str) -> Result<Binder, ScrivError> {
    scrivx::parse_scrivx(xml)
}

/// Converts RTF to paragraphs of formatted runs. Never panics or recurses per group; input that
/// does not start with `{\rtf` is `Err(ScrivError::Rtf(_))`.
pub fn rtf_to_doc(rtf: &[u8]) -> Result<RtfDoc, ScrivError> {
    rtf::rtf_to_doc(rtf)
}

/// Opens every file read-only. Missing content gives a warning, not an error.
pub fn read_project(scriv_dir: &Path) -> Result<ScrivProject, ScrivError> {
    let scrivx_path = find_scrivx(scriv_dir)?;
    let bytes = fs::read(&scrivx_path)?;
    let xml = std::str::from_utf8(&bytes)
        .map_err(|e| ScrivError::Xml(format!("{} is not UTF-8: {e}", scrivx_path.display())))?;
    let binder = parse_scrivx(xml.strip_prefix('\u{FEFF}').unwrap_or(xml))?;

    let data_dir = scriv_dir.join("Files").join("Data");
    let mut documents = BTreeMap::new();
    let mut warnings = Vec::new();
    for item in preorder(&binder.items) {
        let dir = item_dir(&data_dir, &item.uuid, &mut warnings);
        let mut read = |file: &str| match &dir {
            Some(dir) => read_optional(&dir.join(file), &item.uuid, file, &mut warnings),
            None => None,
        };
        let content_bytes = read("content.rtf");
        let synopsis_bytes = read("synopsis.txt");
        let notes_bytes = read("notes.rtf");

        if content_bytes.is_none() && item.kind == BinderItemKind::Text {
            warnings.push(format!("missing content for {}", item.uuid));
        }
        let content =
            content_bytes.and_then(|b| rtf_or_warn(&b, &item.uuid, "content.rtf", &mut warnings));
        let notes =
            notes_bytes.and_then(|b| rtf_or_warn(&b, &item.uuid, "notes.rtf", &mut warnings));
        let synopsis = synopsis_bytes.map(|b| String::from_utf8_lossy(&b).trim_end().to_owned());
        documents.insert(
            item.uuid.clone(),
            Document {
                content,
                synopsis,
                notes,
            },
        );
    }

    Ok(ScrivProject {
        binder,
        documents,
        warnings,
    })
}

/// `dir/<stem>.scrivx`, else the first `*.scrivx` directly inside `dir` in file-name order.
fn find_scrivx(dir: &Path) -> Result<PathBuf, ScrivError> {
    let not_a_package =
        |why: &str| ScrivError::NotAScrivPackage(format!("{}: {why}", dir.display()));
    if !fs::metadata(dir).is_ok_and(|m| m.is_dir()) {
        return Err(not_a_package("not a directory"));
    }
    if let Some(stem) = dir.file_stem() {
        let mut name = stem.to_os_string();
        name.push(".scrivx");
        let candidate = dir.join(name);
        if fs::metadata(&candidate).is_ok_and(|m| m.is_file()) {
            return Ok(candidate);
        }
    }
    let mut found: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        let is_scrivx = path.extension().is_some_and(|ext| ext == "scrivx");
        if is_scrivx && fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            found.push(path);
        }
    }
    found.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    found
        .into_iter()
        .next()
        .ok_or_else(|| not_a_package("no .scrivx file"))
}

/// Largest per-item file that is read; anything bigger is skipped with a warning.
const MAX_ITEM_FILE: u64 = 64 * 1024 * 1024;

/// The data directory of one item, or `None` when the UUID is not plain `[0-9A-Za-z-]+` (so a
/// crafted `.scrivx` cannot point outside `Files/Data`) or the directory is a symlink.
fn item_dir(data_dir: &Path, uuid: &str, warnings: &mut Vec<String>) -> Option<PathBuf> {
    let plain = !uuid.is_empty() && uuid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !plain {
        return None;
    }
    let dir = data_dir.join(uuid);
    match fs::symlink_metadata(&dir) {
        Ok(meta) if meta.file_type().is_symlink() => {
            warnings.push(format!("ignored symlinked data directory for {uuid}"));
            None
        }
        _ => Some(dir),
    }
}

/// Reads one per-item file read-only. Absent gives `None`. A symlink, a non-regular file, a
/// file over `MAX_ITEM_FILE` or a read error gives `None` plus a warning, so a single bad file
/// never fails the import.
fn read_optional(
    path: &Path,
    uuid: &str,
    file: &str,
    warnings: &mut Vec<String>,
) -> Option<Vec<u8>> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return None,
        Err(e) => {
            warnings.push(format!("unreadable {uuid}/{file}: {e}"));
            return None;
        }
    };
    if !meta.file_type().is_file() {
        warnings.push(format!("ignored non-regular file {uuid}/{file}"));
        return None;
    }
    if meta.len() > MAX_ITEM_FILE {
        warnings.push(format!("ignored oversized file {uuid}/{file}"));
        return None;
    }
    let read = fs::File::open(path).and_then(|f| {
        let mut bytes = Vec::new();
        // Bounded even if the file grows after the size check.
        f.take(MAX_ITEM_FILE + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match read {
        Ok(bytes) if bytes.len() as u64 > MAX_ITEM_FILE => {
            warnings.push(format!("ignored oversized file {uuid}/{file}"));
            None
        }
        Ok(bytes) => Some(bytes),
        Err(e) => {
            warnings.push(format!("unreadable {uuid}/{file}: {e}"));
            None
        }
    }
}

fn rtf_or_warn(bytes: &[u8], uuid: &str, file: &str, warnings: &mut Vec<String>) -> Option<RtfDoc> {
    match rtf_to_doc(bytes) {
        Ok(doc) => Some(doc),
        Err(_) => {
            warnings.push(format!("invalid rtf in {uuid}/{file}"));
            None
        }
    }
}

/// Binder items in pre-order, iteratively.
fn preorder(items: &[BinderItem]) -> Vec<&BinderItem> {
    let mut out = Vec::new();
    let mut stack: Vec<&BinderItem> = items.iter().rev().collect();
    while let Some(item) = stack.pop() {
        out.push(item);
        stack.extend(item.children.iter().rev());
    }
    out
}
