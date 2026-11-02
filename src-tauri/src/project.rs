//! A project is a folder the user picks: `pages/<id>.md` per page, the page order in
//! `project.json`, and older versions under `.history/<id>/<timestamp>.md`.
//!
//! Every write goes through [`atomic_write`] in the `storage` module.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::storage::atomic_write;

/// How many previous versions of a page are kept.
pub const HISTORY_LIMIT: usize = 50;

const PROJECT_FILE: &str = "project.json";

/// A page as shown in the left-hand list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    /// File stem of `pages/<id>.md`.
    pub id: String,
    /// The first non-empty line of the page, or an empty string for a blank page.
    pub title: String,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct ProjectFile {
    #[serde(default)]
    pages: Vec<String>,
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
        Ok(text) => serde_json::from_str(&text)
            .map_err(|err| AppError::Invalid(format!("{PROJECT_FILE} is unreadable: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ProjectFile::default()),
        Err(err) => Err(err.into()),
    }
}

fn write_project_file(root: &Path, project: &ProjectFile) -> Result<(), AppError> {
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

fn summaries(root: &Path, ids: &[String]) -> Vec<PageSummary> {
    ids.iter()
        .filter(|id| page_path(root, id).is_file())
        .map(|id| PageSummary {
            id: id.clone(),
            title: title_of(root, id),
        })
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
    Ok(summaries(root, &project.pages))
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
    project.pages.push(id.clone());
    write_project_file(root, &project)?;
    Ok(PageSummary {
        id,
        title: String::new(),
    })
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
    let path = page_path(root, id);
    if let Ok(previous) = fs::read(&path) {
        if previous == content.as_bytes() {
            return Ok(());
        }
        let dir = root.join(".history").join(id);
        fs::create_dir_all(&dir)?;
        let mut stamp = now_millis();
        let target = loop {
            // Zero-padded so names sort in time order.
            let candidate = dir.join(format!("{stamp:020}.md"));
            if !candidate.exists() {
                break candidate;
            }
            stamp += 1;
        };
        atomic_write(&target, &previous)?;
        prune_history(&dir)?;
    }
    atomic_write(&path, content.as_bytes())?;
    Ok(())
}

fn prune_history(dir: &Path) -> Result<(), AppError> {
    let mut names: Vec<_> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name())
        .filter(|name| name.to_string_lossy().ends_with(".md"))
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
