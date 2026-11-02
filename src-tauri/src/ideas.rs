//! The Idea Shelf (`ideas/<id>.md`, one short note each) and the prompt dealer, which never
//! repeats a prompt (seen hashes live in `.inkspark-seen.json`).
//!
//! Every write goes through [`atomic_write`] in the `storage` module.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::error::AppError;
use crate::storage::atomic_write;

const SEEN_FILE: &str = ".inkspark-seen.json";

/// One note on the shelf.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    /// File stem of `ideas/<id>.md`; ids sort oldest first.
    pub id: String,
    /// The note text.
    pub text: String,
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Lists the shelf, newest first. A missing `ideas` folder is an empty shelf.
///
/// # Errors
///
/// Fails when the folder exists but cannot be read.
pub fn list_ideas(root: &Path) -> Result<Vec<Idea>, AppError> {
    let dir = root.join("ideas");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut ideas: Vec<Idea> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".md")?.to_owned();
            let text = fs::read_to_string(entry.path()).ok()?;
            Some(Idea { id, text })
        })
        .collect();
    ideas.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(ideas)
}

/// Adds a note to the shelf.
///
/// # Errors
///
/// `Invalid` for blank text; otherwise fails when the file cannot be written.
pub fn add_idea(root: &Path, text: &str) -> Result<Idea, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::Invalid("an idea cannot be empty".to_owned()));
    }
    let dir = root.join("ideas");
    fs::create_dir_all(&dir)?;
    let mut stamp = now_millis();
    let id = loop {
        let candidate = format!("i{stamp:016}");
        if !dir.join(format!("{candidate}.md")).exists() {
            break candidate;
        }
        stamp += 1;
    };
    atomic_write(&dir.join(format!("{id}.md")), text.as_bytes())?;
    Ok(Idea {
        id,
        text: text.to_owned(),
    })
}

fn read_seen(root: &Path) -> Result<BTreeSet<String>, AppError> {
    match fs::read_to_string(root.join(SEEN_FILE)) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|err| AppError::Invalid(format!("{SEEN_FILE} is unreadable: {err}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(BTreeSet::new()),
        Err(err) => Err(err.into()),
    }
}

/// Returns the hashes of the prompts this project has already been shown.
///
/// # Errors
///
/// Fails on I/O or a corrupt seen file.
pub fn seen_prompts(root: &Path) -> Result<Vec<String>, AppError> {
    Ok(read_seen(root)?.into_iter().collect())
}

/// Records a prompt hash (16 hex digits) as seen.
///
/// # Errors
///
/// `Invalid` for a malformed hash; otherwise fails on I/O or a corrupt seen file.
pub fn mark_prompt_seen(root: &Path, hash: &str) -> Result<(), AppError> {
    let valid = hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::Invalid(format!("bad prompt hash: {hash:?}")));
    }
    let mut seen = read_seen(root)?;
    if seen.insert(hash.to_ascii_lowercase()) {
        let json = serde_json::to_string_pretty(&seen)
            .map_err(|err| AppError::Io(format!("could not encode {SEEN_FILE}: {err}")))?;
        atomic_write(&root.join(SEEN_FILE), json.as_bytes())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("inkspark-ideas-{name}-{}", now_millis()));
        fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        dir
    }

    #[test]
    fn ideas_round_trip_newest_first() {
        let root = temp_root("ideas");
        assert!(list_ideas(&root).unwrap_or_default().is_empty());
        add_idea(&root, "first").unwrap_or_else(|e| panic!("{e}"));
        add_idea(&root, " second ").unwrap_or_else(|e| panic!("{e}"));
        let texts: Vec<_> = list_ideas(&root)
            .unwrap_or_default()
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert_eq!(texts, ["second", "first"]);
        assert!(add_idea(&root, "  ").is_err());
    }

    #[test]
    fn seen_prompts_persist_and_reject_bad_hashes() {
        let root = temp_root("seen");
        assert!(seen_prompts(&root).unwrap_or_default().is_empty());
        mark_prompt_seen(&root, "00ff00ff00ff00ff").unwrap_or_else(|e| panic!("{e}"));
        mark_prompt_seen(&root, "00ff00ff00ff00ff").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            seen_prompts(&root).unwrap_or_default(),
            ["00ff00ff00ff00ff"]
        );
        assert!(mark_prompt_seen(&root, "nope").is_err());
    }
}
