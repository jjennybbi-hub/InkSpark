//! A project is a folder the user picks: `pages/<id>.md` per page, the page order in
//! `project.json`, and older versions under `.history/<id>/<timestamp>.md`.
//!
//! Every write goes through [`atomic_write`] in the `storage` module.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::AppError;
use crate::storage::atomic_write;

/// How many previous versions of a page are kept.
pub const HISTORY_LIMIT: usize = 50;

/// Saves never overlap, whichever thread they arrive on.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

const PROJECT_FILE: &str = "project.json";

/// A page as shown in the left-hand list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    /// File stem of `pages/<id>.md`.
    pub id: String,
    /// The name the writer gave the page, else its first non-empty line, else an empty string.
    pub title: String,
    /// Whether `title` is a name the writer gave, so typing does not change it.
    pub named: bool,
}

/// A page in the Recently Deleted list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeletedPage {
    /// File stem of `pages/<id>.md`; the file stays there until it is erased.
    pub id: String,
    /// Same as [`PageSummary::title`].
    pub title: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct DeletedEntry {
    id: String,
    /// Where the page was in its chapter (or the top level), so restoring puts it back.
    position: usize,
    /// The chapter it was in, if any.
    #[serde(default)]
    chapter: Option<String>,
}

/// One row of the page list: a page, or a chapter holding pages. Chapters do not nest.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayoutEntry {
    /// A page outside any chapter.
    Page {
        /// The page id.
        id: String,
    },
    /// A chapter and the ids of its pages, in order.
    Chapter {
        /// The chapter id.
        id: String,
        /// The chapter's name.
        name: String,
        /// Its pages, in order.
        pages: Vec<String>,
    },
}

fn flatten(layout: &[LayoutEntry]) -> Vec<String> {
    let mut out = Vec::new();
    for entry in layout {
        match entry {
            LayoutEntry::Page { id } => out.push(id.clone()),
            LayoutEntry::Chapter { pages, .. } => out.extend(pages.iter().cloned()),
        }
    }
    out
}

fn chapter_ids(layout: &[LayoutEntry]) -> Vec<String> {
    layout
        .iter()
        .filter_map(|entry| match entry {
            LayoutEntry::Chapter { id, .. } => Some(id.clone()),
            LayoutEntry::Page { .. } => None,
        })
        .collect()
}

/// `pages` is the source of truth for which pages exist (an older app version may have changed it);
/// the layout only adds chapters and order. Pages missing from the layout go at the end.
fn reconcile(project: &mut ProjectFile) {
    project.pages.retain(|id| check_id(id).is_ok());
    if project.layout.is_empty() {
        project.layout = project
            .pages
            .iter()
            .map(|id| LayoutEntry::Page { id: id.clone() })
            .collect();
    }
    let active: BTreeSet<String> = project.pages.iter().cloned().collect();
    let mut seen_pages = BTreeSet::new();
    let mut seen_chapters = BTreeSet::new();
    let mut layout = Vec::new();
    for entry in std::mem::take(&mut project.layout) {
        match entry {
            LayoutEntry::Page { id } => {
                if active.contains(&id) && seen_pages.insert(id.clone()) {
                    layout.push(LayoutEntry::Page { id });
                }
            }
            LayoutEntry::Chapter { id, name, pages } => {
                if check_id(&id).is_ok() && seen_chapters.insert(id.clone()) {
                    let pages = pages
                        .into_iter()
                        .filter(|p| active.contains(p) && seen_pages.insert(p.clone()))
                        .collect();
                    layout.push(LayoutEntry::Chapter { id, name, pages });
                }
            }
        }
    }
    for id in &project.pages {
        if !seen_pages.contains(id) {
            layout.push(LayoutEntry::Page { id: id.clone() });
        }
    }
    project.layout = layout;
    project.pages = flatten(&project.layout);
}

/// Removes a page from wherever it sits; returns its chapter and its position there.
fn take_page(layout: &mut Vec<LayoutEntry>, id: &str) -> Option<(Option<String>, usize)> {
    if let Some(index) = layout
        .iter()
        .position(|e| matches!(e, LayoutEntry::Page { id: p } if p == id))
    {
        layout.remove(index);
        return Some((None, index));
    }
    layout.iter_mut().find_map(|entry| match entry {
        LayoutEntry::Chapter {
            id: chapter, pages, ..
        } => pages.iter().position(|p| p == id).map(|index| {
            pages.remove(index);
            (Some(chapter.clone()), index)
        }),
        LayoutEntry::Page { .. } => None,
    })
}

/// Trims, folds runs of spaces and caps a name at 80 characters.
fn clean_name(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct ProjectFile {
    #[serde(default)]
    pages: Vec<String>,
    /// Names given by the writer, by page id. The page text is never changed by a rename.
    #[serde(default)]
    names: BTreeMap<String, String>,
    /// Deleted pages, oldest first.
    #[serde(default)]
    deleted: Vec<DeletedEntry>,
    /// Chapters and order. `pages` is kept as the flat order, for exports and older versions.
    #[serde(default)]
    layout: Vec<LayoutEntry>,
}

fn check_id(id: &str) -> Result<(), AppError> {
    let ok = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("bad page id: {id:?}")))
    }
}

fn page_path(root: &Path, id: &str) -> PathBuf {
    root.join("pages").join(format!("{id}.md"))
}

fn read_project_file(root: &Path) -> Result<ProjectFile, AppError> {
    match fs::read_to_string(root.join(PROJECT_FILE)) {
        Ok(text) => {
            let mut project: ProjectFile = serde_json::from_str(&text)
                .map_err(|err| AppError::Invalid(format!("{PROJECT_FILE} is unreadable: {err}")))?;
            reconcile(&mut project);
            Ok(project)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ProjectFile::default()),
        Err(err) => Err(err.into()),
    }
}

fn write_project_file(root: &Path, project: &mut ProjectFile) -> Result<(), AppError> {
    project.pages = flatten(&project.layout);
    let text = serde_json::to_string_pretty(project)
        .map_err(|err| AppError::Io(format!("could not encode {PROJECT_FILE}: {err}")))?;
    atomic_write(&root.join(PROJECT_FILE), text.as_bytes())?;
    Ok(())
}

fn title_of(root: &Path, id: &str) -> String {
    fs::read_to_string(page_path(root, id))
        .ok()
        .and_then(|text| {
            text.lines()
                .map(|line| line.trim().trim_start_matches('#').trim())
                .find(|line| !line.is_empty())
                .map(|line| line.chars().take(80).collect())
        })
        .unwrap_or_default()
}

fn summary(root: &Path, project: &ProjectFile, id: &str) -> PageSummary {
    let name = project.names.get(id);
    PageSummary {
        id: id.to_owned(),
        title: name.cloned().unwrap_or_else(|| title_of(root, id)),
        named: name.is_some(),
    }
}

fn summaries(root: &Path, project: &ProjectFile) -> Vec<PageSummary> {
    project
        .pages
        .iter()
        .filter(|id| page_path(root, id).is_file())
        .map(|id| summary(root, project, id))
        .collect()
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Opens (and if needed initialises) the project in `root`; a new project gets one blank page.
///
/// # Errors
///
/// Fails when the folder cannot be read or written, or `project.json` is corrupt.
pub fn open_project(root: &Path) -> Result<Vec<PageSummary>, AppError> {
    if !root.is_dir() {
        return Err(AppError::NotFound(root.display().to_string()));
    }
    fs::create_dir_all(root.join("pages"))?;
    let mut project = read_project_file(root)?;
    project.pages.retain(|id| check_id(id).is_ok());
    if project
        .pages
        .iter()
        .all(|id| !page_path(root, id).is_file())
    {
        create_page(root)?;
        project = read_project_file(root)?;
    }
    Ok(summaries(root, &project))
}

/// Adds a blank page at the end of the order.
///
/// # Errors
///
/// Fails when the page file or `project.json` cannot be written.
pub fn create_page(root: &Path) -> Result<PageSummary, AppError> {
    fs::create_dir_all(root.join("pages"))?;
    let mut stamp = now_millis();
    let id = loop {
        let candidate = format!("p{stamp}");
        if !page_path(root, &candidate).exists() {
            break candidate;
        }
        stamp += 1;
    };
    atomic_write(&page_path(root, &id), b"")?;
    let mut project = read_project_file(root)?;
    project.layout.push(LayoutEntry::Page { id: id.clone() });
    write_project_file(root, &mut project)?;
    Ok(PageSummary {
        id,
        title: String::new(),
        named: false,
    })
}

fn lock_project() -> std::sync::MutexGuard<'static, ()> {
    SAVE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Names a page in the list without touching its text. An empty name goes back to the first line.
///
/// # Errors
///
/// `NotFound` when the page is not in the project; otherwise the write error.
pub fn rename_page(root: &Path, id: &str, name: &str) -> Result<PageSummary, AppError> {
    check_id(id)?;
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    if !project.pages.iter().any(|p| p == id) {
        return Err(AppError::NotFound(id.to_owned()));
    }
    let clean = clean_name(name);
    if clean.is_empty() {
        project.names.remove(id);
    } else {
        project.names.insert(id.to_owned(), clean);
    }
    write_project_file(root, &mut project)?;
    Ok(summary(root, &project, id))
}

/// Moves a page to Recently Deleted; its file and history stay on disk. A project always keeps
/// one page, so deleting the last one adds a blank page. Returns the pages still in the list.
///
/// # Errors
///
/// `NotFound` when the page is not in the list; otherwise the write error.
pub fn delete_page(root: &Path, id: &str) -> Result<Vec<PageSummary>, AppError> {
    check_id(id)?;
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let (chapter, position) =
        take_page(&mut project.layout, id).ok_or_else(|| AppError::NotFound(id.to_owned()))?;
    project.deleted.push(DeletedEntry {
        id: id.to_owned(),
        position,
        chapter,
    });
    write_project_file(root, &mut project)?;
    if project.pages.is_empty() {
        create_page(root)?;
        project = read_project_file(root)?;
    }
    Ok(summaries(root, &project))
}

/// Lists Recently Deleted, newest first.
///
/// # Errors
///
/// Fails when `project.json` cannot be read.
pub fn list_deleted(root: &Path) -> Result<Vec<DeletedPage>, AppError> {
    let project = read_project_file(root)?;
    Ok(project
        .deleted
        .iter()
        .rev()
        .filter(|entry| page_path(root, &entry.id).is_file())
        .map(|entry| {
            let shown = summary(root, &project, &entry.id);
            DeletedPage {
                id: shown.id,
                title: shown.title,
            }
        })
        .collect())
}

/// Puts a deleted page back where it was, in its chapter if that still exists.
/// Returns the pages in the list.
///
/// # Errors
///
/// `NotFound` when the page is not in Recently Deleted; otherwise the write error.
pub fn restore_page(root: &Path, id: &str) -> Result<Vec<PageSummary>, AppError> {
    check_id(id)?;
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let index = project
        .deleted
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_owned()))?;
    let entry = project.deleted.remove(index);
    let home = project.layout.iter_mut().find_map(|e| match e {
        LayoutEntry::Chapter { id: c, pages, .. }
            if entry.chapter.as_deref() == Some(c.as_str()) =>
        {
            Some(pages)
        }
        _ => None,
    });
    match home {
        Some(pages) => {
            let at = entry.position.min(pages.len());
            pages.insert(at, entry.id);
        }
        None => {
            let at = entry.position.min(project.layout.len());
            project
                .layout
                .insert(at, LayoutEntry::Page { id: entry.id });
        }
    }
    write_project_file(root, &mut project)?;
    Ok(summaries(root, &project))
}

/// The page list's chapters and order.
///
/// # Errors
///
/// Fails when `project.json` cannot be read.
pub fn get_layout(root: &Path) -> Result<Vec<LayoutEntry>, AppError> {
    Ok(read_project_file(root)?.layout)
}

/// Reorders pages and chapters. The new layout must hold exactly the same pages and chapters;
/// chapter names are kept as stored. Returns the saved layout.
///
/// # Errors
///
/// `Invalid` when a page or chapter would be lost, added or repeated; otherwise the write error.
pub fn set_layout(root: &Path, layout: Vec<LayoutEntry>) -> Result<Vec<LayoutEntry>, AppError> {
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let mut wanted_pages = flatten(&layout);
    let mut current_pages = project.pages.clone();
    let mut wanted_chapters = chapter_ids(&layout);
    let mut current_chapters = chapter_ids(&project.layout);
    for list in [
        &mut wanted_pages,
        &mut current_pages,
        &mut wanted_chapters,
        &mut current_chapters,
    ] {
        list.sort();
    }
    if wanted_pages != current_pages || wanted_chapters != current_chapters {
        return Err(AppError::Invalid(
            "the new order must keep every page and chapter exactly once".to_owned(),
        ));
    }
    let names: BTreeMap<String, String> = project
        .layout
        .iter()
        .filter_map(|e| match e {
            LayoutEntry::Chapter { id, name, .. } => Some((id.clone(), name.clone())),
            LayoutEntry::Page { .. } => None,
        })
        .collect();
    project.layout = layout
        .into_iter()
        .map(|e| match e {
            LayoutEntry::Chapter { id, pages, .. } => LayoutEntry::Chapter {
                name: names.get(&id).cloned().unwrap_or_default(),
                id,
                pages,
            },
            page @ LayoutEntry::Page { .. } => page,
        })
        .collect();
    write_project_file(root, &mut project)?;
    Ok(project.layout)
}

/// Adds an empty chapter at the end of the list. Returns the layout and the new chapter's id.
///
/// # Errors
///
/// Fails when `project.json` cannot be written.
pub fn add_chapter(root: &Path, name: &str) -> Result<(Vec<LayoutEntry>, String), AppError> {
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let taken = chapter_ids(&project.layout);
    let mut stamp = now_millis();
    let id = loop {
        let candidate = format!("c{stamp}");
        if !taken.contains(&candidate) {
            break candidate;
        }
        stamp += 1;
    };
    let clean = clean_name(name);
    project.layout.push(LayoutEntry::Chapter {
        id: id.clone(),
        name: if clean.is_empty() {
            "New chapter".to_owned()
        } else {
            clean
        },
        pages: Vec::new(),
    });
    write_project_file(root, &mut project)?;
    Ok((project.layout, id))
}

/// Renames a chapter. An empty name is refused, so a chapter always has a name to show.
///
/// # Errors
///
/// `NotFound` for an unknown chapter, `Invalid` for an empty name; otherwise the write error.
pub fn rename_chapter(root: &Path, id: &str, name: &str) -> Result<Vec<LayoutEntry>, AppError> {
    let clean = clean_name(name);
    if clean.is_empty() {
        return Err(AppError::Invalid("a chapter needs a name".to_owned()));
    }
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let found = project.layout.iter_mut().find_map(|e| match e {
        LayoutEntry::Chapter { id: c, name, .. } if c == id => Some(name),
        _ => None,
    });
    *found.ok_or_else(|| AppError::NotFound(id.to_owned()))? = clean;
    write_project_file(root, &mut project)?;
    Ok(project.layout)
}

/// Removes a chapter but never its pages: they stay in the list, in the chapter's place.
///
/// # Errors
///
/// `NotFound` for an unknown chapter; otherwise the write error.
pub fn remove_chapter(root: &Path, id: &str) -> Result<Vec<LayoutEntry>, AppError> {
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let index = project
        .layout
        .iter()
        .position(|e| matches!(e, LayoutEntry::Chapter { id: c, .. } if c == id))
        .ok_or_else(|| AppError::NotFound(id.to_owned()))?;
    if let LayoutEntry::Chapter { pages, .. } = project.layout.remove(index) {
        for (offset, page) in pages.into_iter().enumerate() {
            project
                .layout
                .insert(index + offset, LayoutEntry::Page { id: page });
        }
    }
    write_project_file(root, &mut project)?;
    Ok(project.layout)
}

/// Permanently erases a page and its history. Only a page already in Recently Deleted can be erased.
///
/// # Errors
///
/// `NotFound` when the page is not in Recently Deleted; otherwise the I/O error.
pub fn erase_page(root: &Path, id: &str) -> Result<(), AppError> {
    check_id(id)?;
    let _guard = lock_project();
    let mut project = read_project_file(root)?;
    let index = project
        .deleted
        .iter()
        .position(|entry| entry.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_owned()))?;
    project.deleted.remove(index);
    project.names.remove(id);
    write_project_file(root, &mut project)?;
    let ignore_missing = |result: std::io::Result<()>| match result {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    };
    ignore_missing(fs::remove_file(page_path(root, id)))?;
    ignore_missing(fs::remove_dir_all(root.join(".history").join(id)))?;
    Ok(())
}

/// Reads one page's text.
///
/// # Errors
///
/// `NotFound` when the page does not exist, `Invalid` for a bad id.
pub fn read_page(root: &Path, id: &str) -> Result<String, AppError> {
    check_id(id)?;
    match fs::read_to_string(page_path(root, id)) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::NotFound(id.to_owned()))
        }
        Err(err) => Err(err.into()),
    }
}

/// Saves a page. The previous version is first copied to `.history/<id>/<timestamp>.md`
/// (newest 50 kept), then the new text is written atomically. Saving unchanged text is a no-op.
///
/// # Errors
///
/// Fails when the history copy or the write fails; in that case the page file is untouched.
pub fn save_page(root: &Path, id: &str, content: &str) -> Result<(), AppError> {
    check_id(id)?;
    let _guard = SAVE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let path = page_path(root, id);
    match fs::read(&path) {
        Ok(previous) => {
            if previous == content.as_bytes() {
                return Ok(());
            }
            let dir = root.join(".history").join(id);
            fs::create_dir_all(&dir)?;
            // Never older than a version already kept, even if the clock moved backwards,
            // so pruning can never pick the copy we are about to make.
            let mut stamp = now_millis().max(newest_history_stamp(&dir).saturating_add(1));
            let target = loop {
                // Zero-padded so names sort in time order.
                let candidate = dir.join(format!("{stamp:020}.md"));
                if !candidate.exists() {
                    break candidate;
                }
                stamp += 1;
            };
            atomic_write(&target, &previous)?;
            // Tidying old copies must never stop the user's words being saved.
            let _ = prune_history(&dir);
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        // Unreadable but present: we cannot keep a copy, so do not overwrite it.
        Err(err) => return Err(err.into()),
    }
    atomic_write(&path, content.as_bytes())?;
    Ok(())
}

/// The stamp encoded in a history file name (`<20 digits>.md`), if it is one of ours.
fn history_stamp(name: &str) -> Option<u128> {
    let stem = name.strip_suffix(".md")?;
    if stem.len() == 20 && stem.bytes().all(|b| b.is_ascii_digit()) {
        stem.parse().ok()
    } else {
        None
    }
}

fn newest_history_stamp(dir: &Path) -> u128 {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| history_stamp(&e.file_name().to_string_lossy()))
        .max()
        .unwrap_or(0)
}

fn prune_history(dir: &Path) -> Result<(), AppError> {
    // Only files this module created are ever considered for deletion.
    let mut names: Vec<_> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name())
        .filter(|name| history_stamp(&name.to_string_lossy()).is_some())
        .collect();
    names.sort();
    let excess = names.len().saturating_sub(HISTORY_LIMIT);
    for name in names.into_iter().take(excess) {
        fs::remove_file(dir.join(name))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "project_tests.rs"]
mod tests;
