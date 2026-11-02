//! The only module that writes user files: temp file, fsync, rename (CLAUDE.md, "Never lose a word").

use std::fs;
use std::io::Write;
use std::path::Path;

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
    let tmp = parent.join(format!(".{name}.tmp"));
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
