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
    // A non-empty directory at the target makes the final rename fail.
    let blocked = root.join("b.md");
    fs::create_dir_all(blocked.join("inner")).unwrap_or_else(|err| panic!("{err}"));
    assert!(atomic_write(&blocked, b"lost").is_err());
    assert_eq!(fs::read(&file).unwrap_or_default(), b"keep me");
    let temps = fs::read_dir(&root)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
                .count()
        })
        .unwrap_or(99);
    assert_eq!(temps, 0, "failed write must clean up its temp file");
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

#[test]
fn pruning_never_deletes_files_it_did_not_create() {
    let root = temp_root("prune-foreign");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|err| panic!("{err}"));
    let id = "pg";
    save_page(&root, id, "v0").unwrap_or_else(|err| panic!("{err}"));
    let dir = root.join(".history").join(id);
    fs::create_dir_all(&dir).unwrap_or_else(|err| panic!("{err}"));
    atomic_write(&dir.join("my-notes.md"), b"keep me").unwrap_or_else(|err| panic!("{err}"));
    for n in 1..=(HISTORY_LIMIT + 5) {
        save_page(&root, id, &format!("v{n}")).unwrap_or_else(|err| panic!("{err}"));
    }
    assert_eq!(
        fs::read_to_string(dir.join("my-notes.md")).unwrap_or_default(),
        "keep me"
    );
}

#[test]
fn a_clock_that_moves_backwards_does_not_get_the_newest_copy_pruned() {
    let root = temp_root("clock");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|err| panic!("{err}"));
    let id = "pg";
    save_page(&root, id, "v0").unwrap_or_else(|err| panic!("{err}"));
    let dir = root.join(".history").join(id);
    fs::create_dir_all(&dir).unwrap_or_else(|err| panic!("{err}"));
    // Fifty copies stamped far in the future, as if the clock had been ahead.
    let future = now_millis() + 10_000_000_000;
    for n in 0..HISTORY_LIMIT as u128 {
        atomic_write(&dir.join(format!("{:020}.md", future + n)), b"old")
            .unwrap_or_else(|err| panic!("{err}"));
    }
    save_page(&root, id, "v1").unwrap_or_else(|err| panic!("{err}"));
    let copies: Vec<String> = history_files(&root, id)
        .iter()
        .map(|n| fs::read_to_string(dir.join(n)).unwrap_or_default())
        .collect();
    assert!(
        copies.contains(&"v0".to_owned()),
        "the version just replaced must be kept"
    );
}

#[cfg(unix)]
#[test]
fn an_unreadable_page_is_not_overwritten() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_root("unreadable");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|err| panic!("{err}"));
    let id = "pg";
    save_page(&root, id, "precious").unwrap_or_else(|err| panic!("{err}"));
    let path = page_path(&root, id);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000))
        .unwrap_or_else(|err| panic!("{err}"));
    if fs::read(&path).is_ok() {
        return; // running as root: permissions do not apply
    }
    assert!(save_page(&root, id, "new").is_err());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(fs::read_to_string(&path).unwrap_or_default(), "precious");
}

#[test]
fn overlapping_saves_never_corrupt_the_page() {
    let root = temp_root("overlap");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|err| panic!("{err}"));
    let id = "pg";
    save_page(&root, id, "start").unwrap_or_else(|err| panic!("{err}"));
    let handles: Vec<_> = (0..8)
        .map(|t| {
            let root = root.clone();
            std::thread::spawn(move || {
                for n in 0..10 {
                    save_page(&root, id, &format!("thread {t} save {n}"))
                        .unwrap_or_else(|err| panic!("{err}"));
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap_or_else(|_| panic!("save thread panicked"));
    }
    let text = fs::read_to_string(page_path(&root, id)).unwrap_or_default();
    assert!(text.starts_with("thread "), "page was: {text:?}");
    let leftovers = fs::read_dir(root.join("pages"))
        .map(|rd| rd.filter_map(Result::ok).count())
        .unwrap_or(0);
    assert_eq!(leftovers, 1, "no temp files left behind");
}

#[cfg(unix)]
#[test]
fn a_read_only_folder_fails_cleanly_and_keeps_the_old_text() {
    use std::os::unix::fs::PermissionsExt;
    let root = temp_root("readonly");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|err| panic!("{err}"));
    let id = "pg";
    save_page(&root, id, "safe").unwrap_or_else(|err| panic!("{err}"));
    let pages = root.join("pages");
    fs::set_permissions(&pages, fs::Permissions::from_mode(0o500))
        .unwrap_or_else(|err| panic!("{err}"));
    let result = save_page(&root, id, "changed");
    fs::set_permissions(&pages, fs::Permissions::from_mode(0o700))
        .unwrap_or_else(|err| panic!("{err}"));
    if result.is_ok() {
        return; // running as root
    }
    assert_eq!(
        fs::read_to_string(page_path(&root, id)).unwrap_or_default(),
        "safe"
    );
}

fn ok<T>(result: Result<T, AppError>) -> T {
    result.unwrap_or_else(|err| panic!("{err}"))
}

fn three_pages(tag: &str) -> (PathBuf, Vec<String>) {
    let root = temp_root(tag);
    let first = ok(open_project(&root)).remove(0).id;
    let second = ok(create_page(&root)).id;
    let third = ok(create_page(&root)).id;
    (root, vec![first, second, third])
}

#[test]
fn rename_changes_the_list_but_never_the_text() {
    let (root, ids) = three_pages("rename");
    ok(save_page(&root, &ids[0], "First line\nmore"));
    let renamed = ok(rename_page(&root, &ids[0], "  My   chapter "));
    assert_eq!(renamed.title, "My chapter");
    assert!(renamed.named);
    assert_eq!(ok(read_page(&root, &ids[0])), "First line\nmore");
    assert_eq!(ok(open_project(&root))[0].title, "My chapter");
    let cleared = ok(rename_page(&root, &ids[0], "   "));
    assert_eq!(cleared.title, "First line");
    assert!(!cleared.named);
}

#[test]
fn delete_keeps_the_words_and_restore_puts_the_page_back_in_place() {
    let (root, ids) = three_pages("delete");
    ok(save_page(&root, &ids[1], "Keep me"));
    let left = ok(delete_page(&root, &ids[1]));
    assert_eq!(left.len(), 2);
    assert_eq!(ok(read_page(&root, &ids[1])), "Keep me");
    assert_eq!(ok(list_deleted(&root))[0].title, "Keep me");
    let back = ok(restore_page(&root, &ids[1]));
    let order: Vec<_> = back.into_iter().map(|p| p.id).collect();
    assert_eq!(order, ids);
    assert!(ok(list_deleted(&root)).is_empty());
}

#[test]
fn deleting_the_last_page_leaves_a_blank_one_and_stays_restorable() {
    let root = temp_root("last");
    let only = ok(open_project(&root)).remove(0).id;
    ok(save_page(&root, &only, "Words"));
    let left = ok(delete_page(&root, &only));
    assert_eq!(left.len(), 1);
    assert_ne!(left[0].id, only);
    assert_eq!(ok(restore_page(&root, &only)).len(), 2);
}

#[test]
fn erase_only_works_on_a_deleted_page_and_removes_its_history() {
    let (root, ids) = three_pages("erase");
    ok(save_page(&root, &ids[0], "one"));
    ok(save_page(&root, &ids[0], "two"));
    assert!(erase_page(&root, &ids[0]).is_err());
    assert_eq!(ok(read_page(&root, &ids[0])), "two");
    ok(delete_page(&root, &ids[0]));
    ok(erase_page(&root, &ids[0]));
    assert!(read_page(&root, &ids[0]).is_err());
    assert!(history_files(&root, &ids[0]).is_empty());
    assert!(restore_page(&root, &ids[0]).is_err());
}

#[test]
fn bad_ids_cannot_reach_outside_the_project() {
    let root = temp_root("badid");
    ok(open_project(&root));
    assert!(erase_page(&root, "../x").is_err());
    assert!(delete_page(&root, "../x").is_err());
}

#[test]
fn project_files_from_before_this_feature_still_open() {
    let root = temp_root("oldfile");
    ok(fs::create_dir_all(root.join("pages")).map_err(AppError::from));
    ok(atomic_write(&root.join("pages/p1.md"), b"Old").map_err(AppError::from));
    ok(atomic_write(&root.join("project.json"), br#"{"pages":["p1"]}"#).map_err(AppError::from));
    assert_eq!(ok(open_project(&root))[0].title, "Old");
}
