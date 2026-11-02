//! `speech-spike voices | synth <text> | speak <text> | status <locale> |
//! transcribe <wav> <locale> | dictate <locale> <secs>` (M0 §6.1).
#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    eprintln!("speech-spike: not implemented (M0 track D)");
    ExitCode::FAILURE
}
