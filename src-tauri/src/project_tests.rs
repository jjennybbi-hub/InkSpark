// Tests for the atomic write and the save history only (PLAN-LITE, Session A).

use super::*;

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "inkspark-test-{tag}-{}-{}",
        std::process::id(),
        now_millis()
    ));
    fs::create_dir_all(&root).unwrap_or_else(|err| panic!("temp dir: {err}"));
    root
}

fn history_files(root: &Path, id: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root.join(".history").join(id))
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn atomic_write_creates_and_replaces_without_leaving_a_temp_file() {
    let root = temp_root("atomic");
    let file = root.join("a.md");
    atomic_write(&file, b"one").unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(fs::read(&file).unwrap_or_default(), b"one");
    atomic_write(&file, b"two").unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(fs::read(&file).unwrap_or_default(), b"two");
    let leftovers: Vec<_> = fs::read_dir(&root)
        .unwrap_or_else(|err| panic!("{err}"))
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftovers, ["a.md"]);
}

#[test]
fn atomic_write_failure_keeps_the_old_file() {
    let root = temp_root("atomic-fail");
    let file = root.join("a.md");
    atomic_write(&file, b"keep me").unwrap_or_else(|err| panic!("{err}"));
    // A directory squatting on the temp name makes the temp file impossible to create.
    fs::create_dir(root.join(".a.md.tmp")).unwrap_or_else(|err| panic!("{err}"));
    assert!(atomic_write(&file, b"lost").is_err());
    assert_eq!(fs::read(&file).unwrap_or_default(), b"keep me");
}

#[test]
fn saving_copies_the_previous_version_into_history() {
    let root = temp_root("history");
    let pages = open_project(&root).unwrap_or_else(|err| panic!("{err}"));
    let id = pages.first().map(|p| p.id.clone()).unwrap_or_default();
    save_page(&root, &id, "first").unwrap_or_else(|err| panic!("{err}"));
    save_page(&root, &id, "second").unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(read_page(&root, &id).unwrap_or_default(), "second");
    let names = history_files(&root, &id);
    // The blank page created on open, then "first".
    assert_eq!(names.len(), 2);
    let newest = names.last().cloned().unwrap_or_default();
    let kept = fs::read_to_string(root.join(".history").join(&id).join(newest));
    assert_eq!(kept.unwrap_or_default(), "first");
}

#[test]
fn saving_unchanged_text_adds_no_history() {
    let root = temp_root("same");
    let id = create_page(&root).unwrap_or_else(|err| panic!("{err}")).id;
    save_page(&root, &id, "text").unwrap_or_else(|err| panic!("{err}"));
    let before = history_files(&root, &id);
    save_page(&root, &id, "text").unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(history_files(&root, &id), before);
}

#[test]
fn history_keeps_only_the_newest_fifty() {
    let root = temp_root("prune");
    let id = create_page(&root).unwrap_or_else(|err| panic!("{err}")).id;
    for n in 0..60 {
        save_page(&root, &id, &format!("version {n}")).unwrap_or_else(|err| panic!("{err}"));
    }
    let names = history_files(&root, &id);
    assert_eq!(names.len(), HISTORY_LIMIT);
    let newest = names.last().cloned().unwrap_or_default();
    let kept = fs::read_to_string(root.join(".history").join(&id).join(newest));
    assert_eq!(kept.unwrap_or_default(), "version 58");
}

#[test]
fn page_ids_cannot_escape_the_pages_folder() {
    let root = temp_root("ids");
    assert!(save_page(&root, "../evil", "x").is_err());
    assert!(read_page(&root, "a/b").is_err());
}
