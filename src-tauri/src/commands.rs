//! Tauri commands exposed to the frontend. Types here are exported to
//! `src/contracts/bindings.ts` by tauri-specta (M0 §3.3).

use std::path::Path;

use crate::error::AppError;
use crate::export::{self, DocxDocument};
use crate::ideas::{self, Idea};
use crate::project::{self, DeletedPage, LayoutEntry, PageSummary, SearchHit};

/// Basic facts about the running build of the app.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Always `"InkSpark"`.
    pub name: String,
    /// The crate version (equal to `package.json` and `tauri.conf.json`).
    pub version: String,
    /// The operating system the app was compiled for.
    pub os: OsKind,
    /// The CPU architecture, as in `std::env::consts::ARCH`.
    pub arch: String,
    /// The Tauri runtime version.
    pub tauri_version: String,
}

/// The operating system family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum OsKind {
    Macos,
    Linux,
    Windows,
    Other,
}

impl OsKind {
    /// The OS this binary was compiled for.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else {
            Self::Other
        }
    }
}

/// Returns static information about this build of InkSpark.
#[tauri::command]
#[specta::specta]
#[must_use]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "InkSpark".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        os: OsKind::current(),
        arch: std::env::consts::ARCH.to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
    }
}

/// Opens (creating if needed) the project in the folder at `path`; returns its pages in order.
#[tauri::command]
#[specta::specta]
pub fn open_project(path: String) -> Result<Vec<PageSummary>, AppError> {
    project::open_project(Path::new(&path))
}

/// Adds a blank page to the project at `path`.
#[tauri::command]
#[specta::specta]
pub fn create_page(path: String) -> Result<PageSummary, AppError> {
    project::create_page(Path::new(&path))
}

/// Returns the text of one page.
#[tauri::command]
#[specta::specta]
pub fn read_page(path: String, id: String) -> Result<String, AppError> {
    project::read_page(Path::new(&path), &id)
}

/// Atomically saves one page, keeping the previous version in `.history`.
#[tauri::command]
#[specta::specta]
pub fn save_page(path: String, id: String, content: String) -> Result<(), AppError> {
    project::save_page(Path::new(&path), &id, &content)
}

/// Names a page in the list without changing its text; an empty name clears it.
#[tauri::command]
#[specta::specta]
pub fn rename_page(path: String, id: String, name: String) -> Result<PageSummary, AppError> {
    project::rename_page(Path::new(&path), &id, &name)
}

/// Moves a page to Recently Deleted; returns the pages still in the list.
#[tauri::command]
#[specta::specta]
pub fn delete_page(path: String, id: String) -> Result<Vec<PageSummary>, AppError> {
    project::delete_page(Path::new(&path), &id)
}

/// Lists Recently Deleted, newest first.
#[tauri::command]
#[specta::specta]
pub fn list_deleted(path: String) -> Result<Vec<DeletedPage>, AppError> {
    project::list_deleted(Path::new(&path))
}

/// Puts a deleted page back; returns the pages in the list.
#[tauri::command]
#[specta::specta]
pub fn restore_page(path: String, id: String) -> Result<Vec<PageSummary>, AppError> {
    project::restore_page(Path::new(&path), &id)
}

/// Permanently erases a page that is already in Recently Deleted.
#[tauri::command]
#[specta::specta]
pub fn erase_page(path: String, id: String) -> Result<(), AppError> {
    project::erase_page(Path::new(&path), &id)
}

/// The page list's chapters and order.
#[tauri::command]
#[specta::specta]
pub fn get_layout(path: String) -> Result<Vec<LayoutEntry>, AppError> {
    project::get_layout(Path::new(&path))
}

/// Saves a new order of pages and chapters; every page and chapter must still be there once.
#[tauri::command]
#[specta::specta]
pub fn set_layout(path: String, layout: Vec<LayoutEntry>) -> Result<Vec<LayoutEntry>, AppError> {
    project::set_layout(Path::new(&path), layout)
}

/// A new chapter and the layout that now holds it.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NewChapter {
    /// The new chapter's id.
    pub id: String,
    /// The whole layout after adding it.
    pub layout: Vec<LayoutEntry>,
}

/// Adds an empty chapter at the end of the list.
#[tauri::command]
#[specta::specta]
pub fn add_chapter(path: String, name: String) -> Result<NewChapter, AppError> {
    let (layout, id) = project::add_chapter(Path::new(&path), &name)?;
    Ok(NewChapter { id, layout })
}

/// Renames a chapter.
#[tauri::command]
#[specta::specta]
pub fn rename_chapter(
    path: String,
    id: String,
    name: String,
) -> Result<Vec<LayoutEntry>, AppError> {
    project::rename_chapter(Path::new(&path), &id, &name)
}

/// Removes a chapter; its pages stay in the list where it was.
#[tauri::command]
#[specta::specta]
pub fn remove_chapter(path: String, id: String) -> Result<Vec<LayoutEntry>, AppError> {
    project::remove_chapter(Path::new(&path), &id)
}

/// Lists the Idea Shelf, newest first.
#[tauri::command]
#[specta::specta]
pub fn list_ideas(path: String) -> Result<Vec<Idea>, AppError> {
    ideas::list_ideas(Path::new(&path))
}

/// Adds a note to the Idea Shelf.
#[tauri::command]
#[specta::specta]
pub fn add_idea(path: String, text: String) -> Result<Idea, AppError> {
    ideas::add_idea(Path::new(&path), &text)
}

/// Returns the hashes of prompts already shown in this project.
#[tauri::command]
#[specta::specta]
pub fn seen_prompts(path: String) -> Result<Vec<String>, AppError> {
    ideas::seen_prompts(Path::new(&path))
}

/// Records a prompt hash as shown in this project.
#[tauri::command]
#[specta::specta]
pub fn mark_prompt_seen(path: String, hash: String) -> Result<(), AppError> {
    ideas::mark_prompt_seen(Path::new(&path), &hash)
}

/// Writes Markdown to `dest` (chosen by the user); returns the path written.
#[tauri::command]
#[specta::specta]
pub fn export_markdown(path: String, dest: String, content: String) -> Result<String, AppError> {
    export::export_markdown(Path::new(&path), Path::new(&dest), &content)
}

/// Writes a theme file to `dest` (chosen by the user); returns the path written.
#[tauri::command]
#[specta::specta]
pub fn export_theme(path: String, dest: String, content: String) -> Result<String, AppError> {
    export::export_theme(Path::new(&path), Path::new(&dest), &content)
}

/// Writes a Word document to `dest` (chosen by the user); returns the path written.
#[tauri::command]
#[specta::specta]
pub fn export_docx(path: String, dest: String, doc: DocxDocument) -> Result<String, AppError> {
    export::export_docx(Path::new(&path), Path::new(&dest), &doc)
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;

/// Finds text across every page of the project at `path`, including Recently Deleted.
#[tauri::command]
#[specta::specta]
pub fn search_pages(path: String, query: String) -> Result<Vec<SearchHit>, AppError> {
    project::search_pages(Path::new(&path), &query)
}
