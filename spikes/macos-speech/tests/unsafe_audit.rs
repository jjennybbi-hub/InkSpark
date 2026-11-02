//! Unsafe audit (M0 §6.1), run on every OS.
//!
//! Scans every `.rs` file under `src/` and asserts that:
//! 1. the keyword `unsafe` (as a whole word, in code: not in comments or
//!    string/char literals, and not as part of `unsafe_code` or
//!    `unsafe_op_in_unsafe_fn`) appears only in files under `src/macos/`;
//! 2. every line with such an `unsafe` (block, fn, impl, trait, extern, attribute)
//!    has a `// SAFETY:` comment on one of the 3 lines directly above it.
//!
//! A crate with no `unsafe` at all (the stub) passes.

use std::fs;
use std::path::{Component, Path, PathBuf};

const KEYWORD: &str = "unsafe";
const SAFETY_MARKER: &str = "// SAFETY:";
const SAFETY_WINDOW: usize = 3;

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .map(|e| e.expect("dir entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// Returns the source with comments and the contents of string and char
/// literals replaced by spaces. Newlines are kept, so line numbers still match.
fn code_only(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    let is_ident = |c: char| c.is_alphanumeric() || c == '_';
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        let prev_is_ident = i > 0 && is_ident(chars[i - 1]);
        if c == '/' && next == Some('/') {
            // Line comment (including doc comments).
            while i < chars.len() && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            // Block comment, possibly nested.
            let mut depth = 0usize;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(chars[i]));
                    i += 1;
                }
            }
        } else if (c == 'r' || (c == 'b' && next == Some('r')) || (c == 'c' && next == Some('r')))
            && !prev_is_ident
            && {
                let start = if c == 'r' { i + 1 } else { i + 2 };
                let mut j = start;
                while chars.get(j) == Some(&'#') {
                    j += 1;
                }
                chars.get(j) == Some(&'"')
            }
        {
            // Raw string: r"..", r#".."#, br"..", cr"..".
            let start = if c == 'r' { i + 1 } else { i + 2 };
            let mut j = start;
            while chars[j] == '#' {
                j += 1;
            }
            let hashes = j - start;
            for _ in i..=j {
                out.push(' ');
            }
            i = j + 1;
            while i < chars.len() {
                if chars[i] == '"' && (1..=hashes).all(|k| chars.get(i + k) == Some(&'#')) {
                    for _ in 0..=hashes {
                        out.push(' ');
                    }
                    i += hashes + 1;
                    break;
                }
                out.push(blank(chars[i]));
                i += 1;
            }
        } else if c == '"' {
            // String literal (also b".." and c"..": the prefix stays as an identifier char).
            out.push(' ');
            i += 1;
            while i < chars.len() {
                match chars[i] {
                    '\\' => {
                        out.push(' ');
                        if let Some(&n) = chars.get(i + 1) {
                            out.push(blank(n));
                        }
                        i += 2;
                    }
                    '"' => {
                        out.push(' ');
                        i += 1;
                        break;
                    }
                    other => {
                        out.push(blank(other));
                        i += 1;
                    }
                }
            }
        } else if c == '\'' {
            // Char literal ('x', '\n', '\u{..}'), or a lifetime / label ('a), left as is.
            if next == Some('\\') {
                out.push(' ');
                i += 1;
                while i < chars.len() {
                    let ch = chars[i];
                    out.push(blank(ch));
                    i += 1;
                    if ch == '\\' {
                        if let Some(&n) = chars.get(i) {
                            out.push(blank(n));
                            i += 1;
                        }
                    } else if ch == '\'' {
                        break;
                    }
                }
            } else if chars.get(i + 2) == Some(&'\'') {
                out.push_str("   ");
                i += 3;
            } else {
                out.push(c);
                i += 1;
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Whether `line` (already stripped of comments and literals) contains the
/// keyword as a whole word. `unsafe_code` and `unsafe_op_in_unsafe_fn` do not match.
fn has_unsafe_keyword(line: &str) -> bool {
    let is_ident = |c: char| c.is_alphanumeric() || c == '_';
    line.match_indices(KEYWORD).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + KEYWORD.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

fn under_macos(rel: &Path) -> bool {
    matches!(rel.components().next(), Some(Component::Normal(first)) if first == "macos")
        && rel.components().count() > 1
}

/// Violations for one file; `rel` is relative to `src/`.
fn audit(rel: &Path, source: &str) -> Vec<String> {
    let original: Vec<&str> = source.lines().collect();
    let code = code_only(source);
    let mut violations = Vec::new();
    for (idx, line) in code.lines().enumerate() {
        if !has_unsafe_keyword(line) {
            continue;
        }
        let at = format!("src/{}:{}", rel.display(), idx + 1);
        if !under_macos(rel) {
            violations.push(format!("{at}: `unsafe` outside src/macos/"));
        }
        let first = idx.saturating_sub(SAFETY_WINDOW);
        let documented = original[first..idx]
            .iter()
            .any(|l| l.contains(SAFETY_MARKER));
        if !documented {
            violations.push(format!(
                "{at}: `unsafe` without a `{SAFETY_MARKER}` comment in the {SAFETY_WINDOW} lines above"
            ));
        }
    }
    violations
}

#[test]
fn unsafe_only_in_src_macos_and_always_justified() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    assert!(src.is_dir(), "{} is missing", src.display());
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    assert!(!files.is_empty(), "no .rs files under {}", src.display());

    let mut violations = Vec::new();
    for file in &files {
        let source =
            fs::read_to_string(file).unwrap_or_else(|e| panic!("read {}: {e}", file.display()));
        let rel = file.strip_prefix(&src).expect("under src");
        violations.extend(audit(rel, &source));
    }
    assert!(
        violations.is_empty(),
        "unsafe audit failed:\n{}",
        violations.join("\n")
    );
}

// ---- self-tests for the scanner, so a broken audit cannot pass vacuously ----

fn audit_str(rel: &str, source: &str) -> Vec<String> {
    audit(Path::new(rel), source)
}

#[test]
fn audit_accepts_code_without_unsafe() {
    let src = "#![deny(unsafe_code)]\n#[cfg(target_os = \"macos\")]\n#[allow(unsafe_code)]\nmod macos;\n\
               #![deny(unsafe_op_in_unsafe_fn)]\nfn f() -> u8 { 1 }\n";
    assert!(audit_str("lib.rs", src).is_empty());
}

#[test]
fn audit_ignores_comments_and_literals() {
    let src = "// unsafe here is fine\n/// docs mention unsafe\n//! and unsafe\n\
               /* block unsafe /* nested unsafe */ still comment unsafe */\n\
               const A: &str = \"unsafe\";\nconst B: &str = r#\"an \"unsafe\" raw\"#;\n\
               const C: &[u8] = b\"unsafe\";\nconst D: char = '\\'';\nfn e<'a>(x: &'a str) -> &'a str { x }\n";
    assert_eq!(audit_str("lib.rs", src), Vec::<String>::new());
}

#[test]
fn audit_ignores_lint_names() {
    let src = "#![deny(unsafe_code)]\n#[allow(unsafe_code)]\n#![deny(unsafe_op_in_unsafe_fn)]\nlet my_unsafe_flag = 1;\nlet unsafely = 2;\n";
    assert!(audit_str("lib.rs", src).is_empty());
}

#[test]
fn audit_flags_unsafe_outside_macos() {
    let src = "fn f() {\n    // SAFETY: justified.\n    unsafe { g() }\n}\n";
    let v = audit_str("stub.rs", src);
    assert_eq!(v.len(), 1, "{v:?}");
    assert!(v[0].contains("outside src/macos/"), "{v:?}");
    // A top-level file named macos.rs is not under src/macos/.
    assert_eq!(audit_str("macos.rs", src).len(), 1);
    assert_eq!(audit_str("bin/speech-spike.rs", src).len(), 1);
}

#[test]
fn audit_requires_a_safety_comment_within_three_lines() {
    let ok = "fn f() {\n    // SAFETY: the pointer is valid for the call.\n    unsafe { g() }\n}\n";
    assert!(audit_str("macos/mod.rs", ok).is_empty());

    let ok_with_attrs = "// SAFETY: Foo only wraps a thread-safe handle.\n#[allow(dead_code)]\n#[doc(hidden)]\nunsafe impl Send for Foo {}\n";
    assert!(audit_str("macos/voices.rs", ok_with_attrs).is_empty());

    let too_far = "// SAFETY: too far away.\n\n\n\nunsafe fn g() {}\n";
    assert_eq!(audit_str("macos/mod.rs", too_far).len(), 1);

    let missing = "fn f() {\n    let x = unsafe { g() };\n}\n";
    let v = audit_str("macos/mod.rs", missing);
    assert_eq!(v.len(), 1, "{v:?}");
    assert!(v[0].contains("SAFETY"), "{v:?}");

    let first_line = "unsafe fn g() {}\n";
    assert_eq!(audit_str("macos/mod.rs", first_line).len(), 1);

    let wrong_marker = "// Safety: lower case does not count.\nunsafe fn g() {}\n";
    assert_eq!(audit_str("macos/mod.rs", wrong_marker).len(), 1);
}

#[test]
fn audit_checks_every_occurrence() {
    let src = "// SAFETY: first.\nunsafe fn a() {}\nfn b() {}\nfn c() {}\nfn d() {}\nunsafe fn e() {}\n\
               #[unsafe(no_mangle)]\nextern \"C\" fn f() {}\n";
    let v = audit_str("macos/mod.rs", src);
    assert_eq!(v.len(), 2, "{v:?}");
    assert!(v[0].contains(":6:"), "{v:?}");
    assert!(v[1].contains(":7:"), "{v:?}");
}
