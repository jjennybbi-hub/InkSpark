//! Data-safety invariant 2 (CLAUDE.md): imports never touch the source.
//! Every file's bytes, length, permissions and mtime, and every directory's
//! entries and mtime, must be identical before and after `read_project`.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use inkspark_spike_scriv::read_project;

#[derive(Debug, PartialEq, Eq)]
struct Entry {
    is_dir: bool,
    /// File contents (byte compare); `None` for directories.
    bytes: Option<Vec<u8>>,
    len: u64,
    readonly: bool,
    modified: SystemTime,
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Entry> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Entry>) {
        for entry in fs::read_dir(dir).expect("read_dir") {
            let path = entry.expect("dir entry").path();
            let meta = fs::symlink_metadata(&path).expect("metadata");
            let rel = path.strip_prefix(root).expect("under root").to_path_buf();
            let is_dir = meta.is_dir();
            out.insert(
                rel,
                Entry {
                    is_dir,
                    bytes: if is_dir {
                        None
                    } else {
                        Some(fs::read(&path).expect("read file"))
                    },
                    len: meta.len(),
                    readonly: meta.permissions().readonly(),
                    modified: meta.modified().expect("mtime"),
                },
            );
            if is_dir {
                walk(root, &path, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    let meta = fs::metadata(root).expect("root metadata");
    out.insert(
        PathBuf::new(),
        Entry {
            is_dir: true,
            bytes: None,
            len: 0,
            readonly: meta.permissions().readonly(),
            modified: meta.modified().expect("mtime"),
        },
    );
    walk(root, root, &mut out);
    out
}

fn assert_untouched(dir: &Path) {
    let before = snapshot(dir);
    assert!(before.len() > 1, "{} looks empty", dir.display());
    // The result does not matter here (malformed must fail); only the source does.
    let _ = read_project(dir);
    let _ = read_project(dir);
    let after = snapshot(dir);
    for (path, entry) in &before {
        assert_eq!(
            after.get(path),
            Some(entry),
            "{} changed under {}",
            path.display(),
            dir.display()
        );
    }
    let added: Vec<_> = after.keys().filter(|p| !before.contains_key(*p)).collect();
    assert!(
        added.is_empty(),
        "read_project created {added:?} under {}",
        dir.display()
    );
}

#[test]
fn every_fixture_is_untouched() {
    for name in support::ALL_FIXTURES {
        assert_untouched(&support::fixture(name));
    }
}

#[test]
fn generated_project_is_untouched() {
    let dir = support::scratch_dir("untouched").join("Generated.scriv");
    support::generate_large_project(&dir, 40, 7).expect("generate");
    assert_untouched(&dir);
}

/// A read-only copy must still parse, identically: `read_project` opens files
/// read-only. (Where the tests run as root, permissions do not bind, and this
/// only checks that the result is unchanged.)
#[test]
fn read_only_copy_parses_identically() {
    for name in support::GOLDEN_FIXTURES {
        let dir = support::scratch_dir("readonly").join(format!("{name}.scriv"));
        support::copy_dir(&support::fixture(name), &dir).expect("copy fixture");
        // Files only: read-only directories would stop `cargo clean` from removing the copy.
        let files = snapshot(&dir)
            .into_iter()
            .filter(|(_, e)| !e.is_dir)
            .map(|(rel, _)| dir.join(rel));
        for path in files {
            let mut perms = fs::metadata(&path).expect("metadata").permissions();
            perms.set_readonly(true);
            fs::set_permissions(&path, perms).expect("set read-only");
        }
        let copy = read_project(&dir).unwrap_or_else(|e| panic!("read-only {name}: {e}"));
        let original = read_project(&support::fixture(name)).expect("original");
        assert_eq!(copy, original, "{name}: read-only copy parsed differently");
        assert_untouched(&dir);
    }
}
