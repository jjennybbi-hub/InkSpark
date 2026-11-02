//! macOS implementation through objc2. The only module where `unsafe` is allowed; every use
//! needs a `// SAFETY:` comment within the 3 lines above it.

use std::path::Path;
use std::time::Duration;

use crate::{PcmStats, RecognizerStatus, SpeechError, Transcript, VoiceInfo};

pub(crate) fn platform_supported() -> bool {
    todo!("M0 track D")
}

pub(crate) fn list_voices() -> Result<Vec<VoiceInfo>, SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn synthesize_to_pcm(
    _text: &str,
    _voice_id: Option<&str>,
    _timeout: Duration,
) -> Result<PcmStats, SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn speak_blocking(_text: &str, _voice_id: Option<&str>) -> Result<(), SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn supported_locales() -> Result<Vec<String>, SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn recognizer_status(_locale: &str) -> Result<RecognizerStatus, SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn transcribe_file(
    _path: &Path,
    _locale: &str,
    _require_on_device: bool,
    _timeout: Duration,
) -> Result<Transcript, SpeechError> {
    todo!("M0 track D")
}

pub(crate) fn dictate_microphone(_locale: &str, _seconds: u32) -> Result<Transcript, SpeechError> {
    todo!("M0 track D")
}
