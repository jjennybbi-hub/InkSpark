//! Automatic backups: a dated copy of the whole project goes to a folder the owner picks
//! (SPEC.md item 5). Once a day, keeping the last [`KEEP`] copies. The project itself is only
//! read; every write goes through [`crate::storage`].

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::storage;

/// How many dated copies stay in the backup folder.
pub const KEEP: usize = 30;

const PARTIAL: &str = ".partial";

/// A stamp is `YYYY-MM-DD HHMM` in the owner's local time, made by the frontend.
fn valid_stamp(stamp: &str) -> bool {
    let b = stamp.as_bytes();
    b.len() == 15
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b' ',
            _ => c.is_ascii_digit(),
        })
}

/// The folder inside `dest` that holds this project's copies.
fn backups_dir(root: &Path, dest: &Path) -> Result<PathBuf, AppError> {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| AppError::Invalid("the project folder has no name".to_owned()))?;
    Ok(dest.join(format!("{name} backups")))
}

/// Finished copies in `dir`, oldest first.
fn finished(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| valid_stamp(n))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), AppError> {
    storage::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if storage::is_temp_name(&name.to_string_lossy()) {
            continue; // A save in progress; the finished file is copied instead.
        }
        let src = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&src, &to.join(&name))?;
        } else if kind.is_file() {
            storage::atomic_write(&to.join(&name), &fs::read(&src)?)?;
        }
    }
    Ok(())
}

/// Copies the project at `root` into `dest`, named by `stamp`. With `daily`, does nothing when
/// a copy from the same day is already there. Returns the new copy's folder, or `None` when
/// skipped. Old copies beyond [`KEEP`] and leftovers from an interrupted backup are removed.
///
/// # Errors
///
/// Fails on a bad stamp, when `dest` is inside the project, or on I/O errors.
pub fn backup_project(
    root: &Path,
    dest: &Path,
    stamp: &str,
    daily: bool,
) -> Result<Option<String>, AppError> {
    if !valid_stamp(stamp) {
        return Err(AppError::Invalid(format!("bad backup stamp: {stamp:?}")));
    }
    if !root.is_dir() {
        return Err(AppError::NotFound("the project folder".to_owned()));
    }
    if !dest.is_dir() {
        return Err(AppError::NotFound("the backup folder".to_owned()));
    }
    let root_real = root.canonicalize()?;
    if dest.canonicalize()?.starts_with(&root_real) {
        return Err(AppError::Invalid(
            "the backup folder cannot be inside the project".to_owned(),
        ));
    }
    let dir = backups_dir(&root_real, dest)?;
    let day = stamp.get(..10).unwrap_or(stamp);
    let existing = finished(&dir);
    if daily && existing.iter().any(|n| n.starts_with(day)) {
        return Ok(None);
    }
    let target = dir.join(stamp);
    if target.exists() {
        return Ok(Some(target.to_string_lossy().into_owned()));
    }
    remove_partials(&dir)?;
    let partial = dir.join(format!("{stamp}{PARTIAL}"));
    copy_tree(&root_real, &partial)?;
    storage::rename(&partial, &target)?;
    prune(&dir)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// Removes old copies beyond [`KEEP`].
fn prune(dir: &Path) -> Result<(), AppError> {
    let names = finished(dir);
    for old in names.iter().take(names.len().saturating_sub(KEEP)) {
        storage::remove_dir(&dir.join(old))?;
    }
    Ok(())
}

/// Removes half-made copies left by an interrupted backup.
fn remove_partials(dir: &Path) -> Result<(), AppError> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(()); // No backups folder yet.
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(base) = name.strip_suffix(PARTIAL)
            && valid_stamp(base)
            && entry.path().is_dir()
        {
            storage::remove_dir(&entry.path())?;
        }
    }
    Ok(())
}

/// The newest finished copy's stamp, if any.
///
/// # Errors
///
/// Fails when the project folder has no name.
pub fn last_backup(root: &Path, dest: &Path) -> Result<Option<String>, AppError> {
    let root_real = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    Ok(finished(&backups_dir(&root_real, dest)?).pop())
}

#[cfg(test)]
#[path = "backup_tests.rs"]
mod tests;
