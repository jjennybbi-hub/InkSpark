//! `speech-spike voices | synth <text> | speak <text> | status <locale> |
//! transcribe <wav> <locale> | dictate <locale> <secs>` (M0 §6.1).
//!
//! A manual test tool for ADR 005. Recognition is always on-device: the tool never asks for
//! network recognition. Exit codes: 0 success, 1 the speech call failed, 2 bad usage.
#![forbid(unsafe_code)]

use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use inkspark_spike_speech::{
    SpeechError, dictate_microphone, list_voices, platform_supported, recognizer_status,
    speak_blocking, supported_locales, synthesize_to_pcm, transcribe_file,
};

const USAGE: &str = "usage: speech-spike <command>

commands:
  voices                      list installed voices
  synth <text> [voice-id]     render speech to memory (silent) and report its length
  speak <text> [voice-id]     speak aloud through the speakers
  locales                     list speech-recognition locales
  status <locale>             recognizer status for a locale (never asks for permission)
  transcribe <wav> <locale>   transcribe an audio file, on-device only
  dictate <locale> <secs>     dictate from the microphone for <secs> seconds, on-device only";

const SYNTH_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_DICTATION_SECS: u32 = 300;

enum Outcome {
    Usage(String),
    Failed(SpeechError),
}

impl From<SpeechError> for Outcome {
    fn from(e: SpeechError) -> Self {
        Outcome::Failed(e)
    }
}

fn run(args: &[String]) -> Result<(), Outcome> {
    let arg = |i: usize| args.get(i).map(String::as_str);
    match (arg(0), args.len()) {
        (Some("voices"), 1) => {
            let voices = list_voices()?;
            for v in &voices {
                println!("{}\t{}\t{}", v.language, v.name, v.id);
            }
            println!("{} voices", voices.len());
        }
        (Some("synth"), 2 | 3) => {
            let text = arg(1).unwrap_or_default();
            let stats = synthesize_to_pcm(text, arg(2), SYNTH_TIMEOUT)?;
            println!("frames: {}", stats.frames);
            println!("sample_rate: {}", stats.sample_rate);
            println!("channels: {}", stats.channels);
            println!("duration_ms: {}", stats.duration_ms);
        }
        (Some("speak"), 2 | 3) => {
            speak_blocking(arg(1).unwrap_or_default(), arg(2))?;
            println!("spoken");
        }
        (Some("locales"), 1) => {
            for locale in supported_locales()? {
                println!("{locale}");
            }
        }
        (Some("status"), 2) => {
            let locale = arg(1).unwrap_or_default();
            let status = recognizer_status(locale)?;
            println!("locale: {locale}");
            println!("available: {}", status.available);
            println!("supports_on_device: {}", status.supports_on_device);
            println!("authorization: {:?}", status.authorization);
        }
        (Some("transcribe"), 3) => {
            let path = Path::new(arg(1).unwrap_or_default());
            let transcript =
                transcribe_file(path, arg(2).unwrap_or_default(), true, TRANSCRIBE_TIMEOUT)?;
            println!("on_device: {}", transcript.on_device);
            println!("text: {}", transcript.text);
        }
        (Some("dictate"), 3) => {
            let locale = arg(1).unwrap_or_default();
            let secs: u32 = arg(2)
                .and_then(|s| s.parse().ok())
                .filter(|&n| (1..=MAX_DICTATION_SECS).contains(&n))
                .ok_or_else(|| {
                    Outcome::Usage(format!(
                        "<secs> must be a whole number from 1 to {MAX_DICTATION_SECS}"
                    ))
                })?;
            println!("Listening for {secs} s. Read your sentences now.");
            let transcript = dictate_microphone(locale, secs)?;
            println!("on_device: {}", transcript.on_device);
            println!("text: {}", transcript.text);
        }
        (Some("help" | "--help" | "-h"), _) => println!("{USAGE}"),
        (None, _) => return Err(Outcome::Usage("no command given".to_owned())),
        (Some(cmd), _) => {
            return Err(Outcome::Usage(format!(
                "unknown command or wrong number of arguments: {cmd}"
            )));
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !platform_supported() {
        eprintln!("speech-spike: {}", SpeechError::Unsupported);
        return ExitCode::FAILURE;
    }
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Outcome::Usage(why)) => {
            eprintln!("speech-spike: {why}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Err(Outcome::Failed(e)) => {
            eprintln!("speech-spike: {e}");
            ExitCode::FAILURE
        }
    }
}
