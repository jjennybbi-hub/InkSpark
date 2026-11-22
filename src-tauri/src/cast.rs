//! The cast list: each project's characters, places and events, kept in `.inkspark-cast.json`.
//!
//! Every write goes through [`atomic_write`] in the `storage` module.

use std::fs;
use std::path::Path;

use crate::error::AppError;
use crate::storage::atomic_write;

const CAST_FILE: &str = ".inkspark-cast.json";
const CAST_VERSION: u32 = 1;

/// What a cast entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CastKind {
    /// A person who can speak.
    Character,
    /// A place.
    Place,
    /// An event.
    Event,
}

/// One name on the cast list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CastEntry {
    /// The name as it is written in the pages.
    pub name: String,
    /// Character, place or event.
    pub kind: CastKind,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CastFile {
    version: u32,
    entries: Vec<CastEntry>,
}

/// Reads the cast list. A missing file is an empty list.
///
/// # Errors
///
/// Fails on I/O, a corrupt file or a version this app does not know.
pub fn get_cast(root: &Path) -> Result<Vec<CastEntry>, AppError> {
    let text = match fs::read_to_string(root.join(CAST_FILE)) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let file: CastFile = serde_json::from_str(&text)
        .map_err(|err| AppError::Invalid(format!("{CAST_FILE} is unreadable: {err}")))?;
    if file.version != CAST_VERSION {
        return Err(AppError::Invalid(format!(
            "{CAST_FILE} has version {}, which this app cannot read",
            file.version
        )));
    }
    Ok(file.entries)
}

/// Replaces the cast list. Names are trimmed; blank and repeated names are dropped.
///
/// # Errors
///
/// Fails when the file cannot be written.
pub fn set_cast(root: &Path, entries: Vec<CastEntry>) -> Result<Vec<CastEntry>, AppError> {
    let mut kept: Vec<CastEntry> = Vec::new();
    for entry in entries {
        let name = entry.name.trim().to_owned();
        if name.is_empty() || kept.iter().any(|k| k.name == name) {
            continue;
        }
        kept.push(CastEntry {
            name,
            kind: entry.kind,
        });
    }
    let file = CastFile {
        version: CAST_VERSION,
        entries: kept,
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|err| AppError::Io(format!("could not encode {CAST_FILE}: {err}")))?;
    atomic_write(&root.join(CAST_FILE), json.as_bytes())?;
    Ok(file.entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let dir = std::env::temp_dir().join(format!("inkspark-cast-{name}-{stamp}"));
        fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{e}"));
        dir
    }

    fn entry(name: &str, kind: CastKind) -> CastEntry {
        CastEntry {
            name: name.to_owned(),
            kind,
        }
    }

    #[test]
    fn cast_round_trips_and_drops_blank_and_repeated_names() {
        let root = temp_root("round");
        assert!(get_cast(&root).unwrap_or_default().is_empty());
        let saved = set_cast(
            &root,
            vec![
                entry(" Annie ", CastKind::Character),
                entry("", CastKind::Place),
                entry("Annie", CastKind::Character),
                entry("Paris", CastKind::Place),
            ],
        )
        .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            saved,
            vec![
                entry("Annie", CastKind::Character),
                entry("Paris", CastKind::Place)
            ]
        );
        assert_eq!(get_cast(&root).unwrap_or_default(), saved);
    }

    #[test]
    fn unknown_versions_and_corrupt_files_are_refused() {
        let root = temp_root("bad");
        atomic_write(&root.join(CAST_FILE), br#"{"version":9,"entries":[]}"#)
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(get_cast(&root).is_err());
        atomic_write(&root.join(CAST_FILE), b"nope").unwrap_or_else(|e| panic!("{e}"));
        assert!(get_cast(&root).is_err());
    }
}
