//! Non-macOS platforms: every speech function reports `SpeechError::Unsupported`.

use std::path::Path;
use std::time::Duration;

use crate::{PcmStats, RecognizerStatus, SpeechError, Transcript, VoiceInfo};

pub(crate) fn platform_supported() -> bool {
    false
}

pub(crate) fn list_voices() -> Result<Vec<VoiceInfo>, SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn synthesize_to_pcm(
    _text: &str,
    _voice_id: Option<&str>,
    _timeout: Duration,
) -> Result<PcmStats, SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn speak_blocking(_text: &str, _voice_id: Option<&str>) -> Result<(), SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn supported_locales() -> Result<Vec<String>, SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn recognizer_status(_locale: &str) -> Result<RecognizerStatus, SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn transcribe_file(
    _path: &Path,
    _locale: &str,
    _require_on_device: bool,
    _timeout: Duration,
) -> Result<Transcript, SpeechError> {
    Err(SpeechError::Unsupported)
}

pub(crate) fn dictate_microphone(_locale: &str, _seconds: u32) -> Result<Transcript, SpeechError> {
    Err(SpeechError::Unsupported)
}
