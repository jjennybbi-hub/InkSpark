//! Writes `src/contracts/bindings.ts`, or with `--check` verifies it is up to date (M0 §3.3).
//!
//! `cargo run -p inkspark --bin export-bindings [-- --check]`
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;

fn bindings_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("contracts")
        .join("bindings.ts")
}

fn normalize(text: &str) -> String {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n")
}

fn first_difference(generated: &str, committed: &str) -> String {
    generated
        .lines()
        .zip(committed.lines())
        .position(|(g, c)| g != c)
        .map_or_else(
            || "the files differ in length".to_owned(),
            |i| format!("first difference at line {}", i + 1),
        )
}

fn check(generated: &str, path: &std::path::Path) -> ExitCode {
    match std::fs::read_to_string(path) {
        Ok(committed) => {
            let committed = normalize(&committed);
            if committed == generated {
                println!("{} is up to date.", path.display());
                ExitCode::SUCCESS
            } else {
                eprintln!(
                    "{} is out of date ({}). Run `npm run bindings` and commit the result.",
                    path.display(),
                    first_difference(generated, &committed)
                );
                ExitCode::FAILURE
            }
        }
        Err(err) => {
            eprintln!(
                "could not read {}: {err}. Run `npm run bindings`.",
                path.display()
            );
            ExitCode::FAILURE
        }
    }
}

// Generated source for the repository, not a user file: the storage module does not apply.
#[allow(clippy::disallowed_methods)]
fn write(generated: &str, path: &std::path::Path) -> ExitCode {
    match std::fs::write(path, generated) {
        Ok(()) => {
            println!("Wrote {}.", path.display());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("could not write {}: {err}", path.display());
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let mut check_mode = false;
    for arg in std::env::args().skip(1) {
        if arg == "--check" {
            check_mode = true;
        } else {
            eprintln!("unknown argument: {arg}\nusage: export-bindings [--check]");
            return ExitCode::from(2);
        }
    }

    let generated = match inkspark_lib::bindings_ts() {
        Ok(text) => normalize(&text),
        Err(err) => {
            eprintln!("{err}");
            return ExitCode::FAILURE;
        }
    };

    let path = bindings_path();
    if check_mode {
        check(&generated, &path)
    } else {
        write(&generated, &path)
    }
}
