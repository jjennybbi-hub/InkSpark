use super::*;

fn temp(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let p = std::env::temp_dir().join(format!("inkspark-bk-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&p).unwrap_or_else(|e| panic!("temp: {e}"));
    p
}

fn project() -> PathBuf {
    let root = temp("proj").join("Novel");
    fs::create_dir_all(root.join("pages")).unwrap_or_else(|e| panic!("{e}"));
    storage::atomic_write(&root.join("pages/a.md"), b"hello").unwrap_or_else(|e| panic!("{e}"));
    storage::atomic_write(&root.join("project.json"), b"{}").unwrap_or_else(|e| panic!("{e}"));
    storage::atomic_write(&root.join(".x.md.1-1.tmp"), b"half").unwrap_or_else(|e| panic!("{e}"));
    root
}

#[test]
fn copies_the_whole_project_and_leaves_it_alone() {
    let root = project();
    let dest = temp("dest");
    let made = backup_project(&root, &dest, "2026-11-21 0930", true)
        .unwrap_or_else(|e| panic!("{e}"))
        .unwrap_or_else(|| panic!("skipped"));
    let copy = PathBuf::from(made);
    assert!(copy.ends_with("Novel backups/2026-11-21 0930"));
    assert_eq!(
        fs::read_to_string(copy.join("pages/a.md")).unwrap_or_default(),
        "hello"
    );
    assert!(!copy.join(".x.md.1-1.tmp").exists());
    assert_eq!(
        fs::read_to_string(root.join("pages/a.md")).unwrap_or_default(),
        "hello"
    );
}

#[test]
fn daily_skips_a_second_copy_the_same_day() {
    let root = project();
    let dest = temp("dest");
    assert!(
        backup_project(&root, &dest, "2026-11-21 0930", true)
            .unwrap_or_default()
            .is_some()
    );
    assert!(
        backup_project(&root, &dest, "2026-11-21 1800", true)
            .unwrap_or_default()
            .is_none()
    );
    assert!(
        backup_project(&root, &dest, "2026-11-21 1801", false)
            .unwrap_or_default()
            .is_some()
    );
    assert!(
        backup_project(&root, &dest, "2026-11-22 0800", true)
            .unwrap_or_default()
            .is_some()
    );
    assert_eq!(
        last_backup(&root, &dest).unwrap_or_default().as_deref(),
        Some("2026-11-22 0800")
    );
}

#[test]
fn keeps_only_the_newest_thirty() {
    let root = project();
    let dest = temp("dest");
    for i in 0..35 {
        let stamp = format!("2026-{:02}-{:02} 1200", 10 + i / 28, 1 + i % 28);
        backup_project(&root, &dest, &stamp, true).unwrap_or_else(|e| panic!("{e}"));
    }
    let dir = dest.join("Novel backups");
    assert_eq!(finished(&dir).len(), KEEP);
}

#[test]
fn removes_an_interrupted_copy() {
    let root = project();
    let dest = temp("dest");
    let stale = dest.join("Novel backups/2026-11-20 0900.partial");
    fs::create_dir_all(&stale).unwrap_or_else(|e| panic!("{e}"));
    backup_project(&root, &dest, "2026-11-21 0930", true).unwrap_or_else(|e| panic!("{e}"));
    assert!(!stale.exists());
}

#[test]
fn refuses_bad_input() {
    let root = project();
    let dest = temp("dest");
    assert!(backup_project(&root, &dest, "../evil", true).is_err());
    assert!(backup_project(&root, &root.join("pages"), "2026-11-21 0930", true).is_err());
    assert!(backup_project(&root, &dest.join("missing"), "2026-11-21 0930", true).is_err());
}
