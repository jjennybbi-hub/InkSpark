//! macOS Speech spike (M0 §6.1, ADR 005): read-aloud (AVSpeechSynthesizer) and on-device
//! dictation (SFSpeechRecognizer) through objc2, without a Swift bridge.
//!
//! `unsafe` is allowed only in `src/macos/`, and every use carries a `// SAFETY:` comment
//! (checked by `tests/unsafe_audit.rs`). Other platforms get a stub that reports
//! `SpeechError::Unsupported`.
#![deny(unsafe_code)]

use std::path::Path;
use std::time::Duration;

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(not(target_os = "macos"))]
mod stub;
#[cfg(not(target_os = "macos"))]
use stub as platform;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SpeechError {
    #[error("unsupported on this platform")]
    Unsupported,
    #[error("not authorized")]
    NotAuthorized,
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("timed out")]
    Timeout,
    #[error("failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AuthStatus {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

#[derive(Debug, Clone)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
}

#[derive(Debug, Clone)]
pub struct PcmStats {
    pub frames: u64,
    pub sample_rate: f64,
    pub channels: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RecognizerStatus {
    pub available: bool,
    pub supports_on_device: bool,
    pub authorization: AuthStatus,
}

#[derive(Debug, Clone)]
pub struct Transcript {
    pub text: String,
    pub on_device: bool,
}

pub fn platform_supported() -> bool {
    platform::platform_supported()
}

pub fn list_voices() -> Result<Vec<VoiceInfo>, SpeechError> {
    platform::list_voices()
}

/// Renders `text` with `writeUtterance:toBufferCallback:`; nothing is played on a speaker.
pub fn synthesize_to_pcm(
    text: &str,
    voice_id: Option<&str>,
    timeout: Duration,
) -> Result<PcmStats, SpeechError> {
    platform::synthesize_to_pcm(text, voice_id, timeout)
}

/// Speaks aloud and blocks until done. Manual testing only.
pub fn speak_blocking(text: &str, voice_id: Option<&str>) -> Result<(), SpeechError> {
    platform::speak_blocking(text, voice_id)
}

pub fn supported_locales() -> Result<Vec<String>, SpeechError> {
    platform::supported_locales()
}

/// Never prompts for authorization.
pub fn recognizer_status(locale: &str) -> Result<RecognizerStatus, SpeechError> {
    platform::recognizer_status(locale)
}

pub fn transcribe_file(
    path: &Path,
    locale: &str,
    require_on_device: bool,
    timeout: Duration,
) -> Result<Transcript, SpeechError> {
    platform::transcribe_file(path, locale, require_on_device, timeout)
}

/// Dictates from the microphone through AVAudioEngine. Manual testing only.
pub fn dictate_microphone(locale: &str, seconds: u32) -> Result<Transcript, SpeechError> {
    platform::dictate_microphone(locale, seconds)
}
