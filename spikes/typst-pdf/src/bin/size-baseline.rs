//! Size baseline for the Typst size delta: links std + serde_json only (M0 §5.1).
//!
//! `typst-bench --size-report <this binary>` subtracts this binary's size from its own, so the
//! delta is what the typst stack adds on top of a minimal Rust + serde_json program.
#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Use serde_json for real so the linker keeps it.
    let report = serde_json::json!({ "bin": "size-baseline", "args": args });
    match serde_json::to_string(&report) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("size-baseline: {err}");
            ExitCode::FAILURE
        }
    }
}
