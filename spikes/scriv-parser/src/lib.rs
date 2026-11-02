//! Read-only Scrivener 3 (`.scriv`) parser spike (M0 §6.2, ADR 006): quick-xml for the binder
//! and a small in-house RTF tokenizer. It never writes and never panics on malformed input.
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::path::Path;

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
        todo!("M0 track D")
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

// stub: removed by implementer
#[allow(unused_variables)]
pub fn parse_scrivx(xml: &str) -> Result<Binder, ScrivError> {
    todo!("M0 track D")
}

// stub: removed by implementer
#[allow(unused_variables)]
pub fn rtf_to_doc(rtf: &[u8]) -> Result<RtfDoc, ScrivError> {
    todo!("M0 track D")
}

/// Opens every file read-only. Missing content gives a warning, not an error.
// stub: removed by implementer
#[allow(unused_variables)]
pub fn read_project(scriv_dir: &Path) -> Result<ScrivProject, ScrivError> {
    todo!("M0 track D")
}
