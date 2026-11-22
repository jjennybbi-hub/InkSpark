//! The only module that writes user files: temp file, fsync, rename (CLAUDE.md, "Never lose a word").

use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

const TEMP_SUFFIX: &str = ".tmp";

/// True for the temp file of a save still in progress (`.name.<pid>-<n>.tmp`), which copies
/// and listings should skip. A user's own file that merely ends in `.tmp` is not one.
#[must_use]
pub fn is_temp_name(name: &str) -> bool {
    name.starts_with('.')
        && name
            .strip_suffix(TEMP_SUFFIX)
            .and_then(|rest| rest.rsplit_once('.'))
            .and_then(|(_, id)| id.split_once('-'))
            .is_some_and(|(pid, n)| {
                !pid.is_empty()
                    && !n.is_empty()
                    && pid.bytes().all(|b| b.is_ascii_digit())
                    && n.bytes().all(|b| b.is_ascii_digit())
            })
}

/// Writes `bytes` to `path` so a crash never leaves a half-written file: the data goes to a
/// temp file in the same folder, is fsynced, and is then renamed over `path`.
///
/// # Errors
///
/// Returns the underlying I/O error; the temp file is removed on failure.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("path has no parent folder"))?;
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::other("path has no file name"))?
        .to_string_lossy();
    // Unique per call so two overlapping writes to one file never share a temp file.
    let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(
        ".{name}.{}-{unique}{TEMP_SUFFIX}",
        std::process::id()
    ));
    let written = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
        return written;
    }
    // Make the rename itself durable. Not possible on every platform, so best effort.
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

/// Creates a folder (and its parents) for files the app is about to write.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub fn create_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

/// Renames a finished folder into place, so a half-made copy never looks complete.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

/// Removes a whole folder the app made itself (an old or unfinished backup copy).
///
/// # Errors
///
/// Returns the underlying I/O error.
pub fn remove_dir(path: &Path) -> std::io::Result<()> {
    fs::remove_dir_all(path)
}

#[cfg(test)]
mod temp_name_tests {
    use super::is_temp_name;

    #[test]
    fn only_save_temp_files_count() {
        assert!(is_temp_name(".page.md.123-0.tmp"));
        assert!(!is_temp_name("notes.tmp"));
        assert!(!is_temp_name(".notes.tmp"));
        assert!(!is_temp_name("page.md"));
    }
}
