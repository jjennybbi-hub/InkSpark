//! macOS Speech spike tests (M0 §6.1, ADR 005).
//!
//! - Off macOS, the stub must report `Unsupported` everywhere and never touch
//!   audio, files or the network.
//! - On macOS, the `ci_*` tests are `#[ignore]`d and run only by the
//!   `spike-speech` job: `cargo test -p inkspark-spike-speech -- --include-ignored ci_`.
//!   They never request authorization, speak aloud or open the microphone;
//!   `speak_blocking` and `dictate_microphone` are checked manually.

#[cfg(not(target_os = "macos"))]
mod stub {
    use std::path::Path;
    use std::time::Duration;

    use inkspark_spike_speech::{
        SpeechError, dictate_microphone, list_voices, platform_supported, recognizer_status,
        speak_blocking, supported_locales, synthesize_to_pcm, transcribe_file,
    };

    const UNSUPPORTED: Option<SpeechError> = Some(SpeechError::Unsupported);

    #[test]
    fn platform_is_not_supported() {
        assert!(!platform_supported());
    }

    #[test]
    fn list_voices_is_unsupported() {
        assert_eq!(list_voices().err(), UNSUPPORTED);
    }

    #[test]
    fn synthesize_to_pcm_is_unsupported() {
        let timeout = Duration::from_secs(1);
        assert_eq!(
            synthesize_to_pcm("Hello.", None, timeout).err(),
            UNSUPPORTED
        );
        assert_eq!(
            synthesize_to_pcm(
                "Hello.",
                Some("com.apple.voice.compact.en-US.Samantha"),
                timeout
            )
            .err(),
            UNSUPPORTED
        );
        assert_eq!(
            synthesize_to_pcm("", None, Duration::ZERO).err(),
            UNSUPPORTED
        );
    }

    #[test]
    fn speak_blocking_is_unsupported() {
        assert_eq!(speak_blocking("Hello.", None).err(), UNSUPPORTED);
        assert_eq!(
            speak_blocking("Hello.", Some("any-voice")).err(),
            UNSUPPORTED
        );
    }

    #[test]
    fn supported_locales_is_unsupported() {
        assert_eq!(supported_locales().err(), UNSUPPORTED);
    }

    #[test]
    fn recognizer_status_is_unsupported() {
        assert_eq!(recognizer_status("en-US").err(), UNSUPPORTED);
        assert_eq!(recognizer_status("").err(), UNSUPPORTED);
    }

    #[test]
    fn transcribe_file_is_unsupported_even_for_missing_files() {
        let missing = Path::new("definitely-missing-dir").join("missing.wav");
        let timeout = Duration::from_secs(1);
        assert_eq!(
            transcribe_file(&missing, "en-US", true, timeout).err(),
            UNSUPPORTED
        );
        assert_eq!(
            transcribe_file(&missing, "en-US", false, timeout).err(),
            UNSUPPORTED
        );
    }

    #[test]
    fn dictate_microphone_is_unsupported() {
        assert_eq!(dictate_microphone("en-US", 1).err(), UNSUPPORTED);
        assert_eq!(dictate_microphone("en-US", 0).err(), UNSUPPORTED);
    }

    #[test]
    fn unsupported_error_message() {
        assert_eq!(
            SpeechError::Unsupported.to_string(),
            "unsupported on this platform"
        );
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use inkspark_spike_speech::{
        list_voices, platform_supported, recognizer_status, supported_locales, synthesize_to_pcm,
    };

    /// Runs `f` on its own thread and fails if it has not returned within `limit`,
    /// so a hang is a test failure rather than a stuck CI job.
    fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = tx.send(f());
        });
        rx.recv_timeout(limit)
            .unwrap_or_else(|e| panic!("did not return within {limit:?}: {e}"))
    }

    #[test]
    fn platform_is_supported() {
        assert!(platform_supported());
    }

    #[test]
    #[ignore = "ci: macos-15 spike-speech job"]
    fn ci_list_voices_includes_english() {
        let voices = within(Duration::from_secs(30), list_voices).expect("list_voices");
        assert!(!voices.is_empty(), "no voices installed");
        assert!(
            voices.iter().any(|v| v.language.starts_with("en")),
            "no English voice among {:?}",
            voices
                .iter()
                .map(|v| (&v.id, &v.language))
                .collect::<Vec<_>>()
        );
        for v in &voices {
            assert!(!v.id.is_empty(), "voice with empty id: {}", v.name);
        }
    }

    #[test]
    #[ignore = "ci: macos-15 spike-speech job"]
    fn ci_synthesize_to_pcm_produces_audio() {
        let stats = within(Duration::from_secs(30), || {
            synthesize_to_pcm(
                "The quick brown fox jumps over the lazy dog.",
                None,
                Duration::from_secs(10),
            )
        })
        .expect("synthesize_to_pcm");
        assert!(stats.frames > 0, "no frames");
        assert!(
            stats.duration_ms >= 1000,
            "only {} ms of audio",
            stats.duration_ms
        );
        assert!(stats.sample_rate > 0.0, "sample rate {}", stats.sample_rate);
        assert!(stats.channels >= 1, "channels {}", stats.channels);
    }

    #[test]
    #[ignore = "ci: macos-15 spike-speech job"]
    fn ci_supported_locales_contains_en_us() {
        let locales =
            within(Duration::from_secs(30), supported_locales).expect("supported_locales");
        assert!(
            locales.iter().any(|l| l == "en-US"),
            "en-US missing from {locales:?}"
        );
    }

    #[test]
    #[ignore = "ci: macos-15 spike-speech job"]
    fn ci_recognizer_status_returns_without_prompting() {
        // Never prompts: CI has no one to answer, so this must return promptly.
        let status = within(Duration::from_secs(30), || recognizer_status("en-US"))
            .expect("recognizer_status");
        println!(
            "en-US: available={} on_device={} authorization={:?}",
            status.available, status.supports_on_device, status.authorization
        );
    }
}
