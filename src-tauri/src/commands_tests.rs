// Unit tests for `commands.rs` (M0 §3.7). Included from the bottom of `commands.rs` via
// `#[cfg(test)] #[path = "commands_tests.rs"] mod tests;`, so `super` is the `commands` module.

use super::*;

fn expected_os() -> OsKind {
    if cfg!(target_os = "macos") {
        OsKind::Macos
    } else if cfg!(target_os = "linux") {
        OsKind::Linux
    } else if cfg!(target_os = "windows") {
        OsKind::Windows
    } else {
        OsKind::Other
    }
}

fn expected_os_str() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

#[test]
fn name_is_inkspark() {
    assert_eq!(app_info().name, "InkSpark");
}

#[test]
fn version_is_the_crate_version() {
    assert_eq!(app_info().version, env!("CARGO_PKG_VERSION"));
}

#[test]
fn os_matches_the_compile_target() {
    assert_eq!(app_info().os, expected_os());
}

#[test]
fn arch_is_non_empty_and_matches_the_target() {
    let info = app_info();
    assert!(!info.arch.is_empty());
    assert_eq!(info.arch, std::env::consts::ARCH);
}

#[test]
fn tauri_version_is_reported() {
    let info = app_info();
    assert!(!info.tauri_version.is_empty());
    assert_eq!(info.tauri_version, tauri::VERSION);
}

#[test]
fn serializes_with_camel_case_keys_and_lowercase_os() {
    let value = match serde_json::to_value(app_info()) {
        Ok(value) => value,
        Err(err) => panic!("AppInfo failed to serialize: {err}"),
    };
    let Some(object) = value.as_object() else {
        panic!("AppInfo did not serialize to a JSON object: {value}");
    };
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["arch", "name", "os", "tauriVersion", "version"]);
    assert!(!object.contains_key("tauri_version"));
    assert_eq!(
        object.get("os").and_then(serde_json::Value::as_str),
        Some(expected_os_str())
    );
}

#[test]
fn os_kind_serializes_lowercase() {
    let cases = [
        (OsKind::Macos, "macos"),
        (OsKind::Linux, "linux"),
        (OsKind::Windows, "windows"),
        (OsKind::Other, "other"),
    ];
    for (kind, expected) in cases {
        let json = match serde_json::to_string(&kind) {
            Ok(json) => json,
            Err(err) => panic!("{kind:?} failed to serialize: {err}"),
        };
        assert_eq!(json, format!("\"{expected}\""));
    }
}
