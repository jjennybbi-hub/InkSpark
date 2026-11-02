//! macOS implementation through objc2. The only module where `unsafe` is allowed; every use
//! needs a `// SAFETY:` comment within the 3 lines above it.
//!
//! Callbacks (synthesizer buffers, recognition results, authorization answers) arrive on
//! framework queues. They only write into `Arc<Mutex<_>>` state; the calling thread pumps its
//! `NSRunLoop` until that state says "done" or a deadline passes (risk R5 in M0.md).

use std::path::Path;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::{Retained, autoreleasepool};
use objc2_avf_audio::{
    AVAudioBuffer, AVAudioEngine, AVAudioPCMBuffer, AVAudioTime, AVSpeechBoundary,
    AVSpeechSynthesisVoice, AVSpeechSynthesizer, AVSpeechUtterance,
};
use objc2_foundation::{
    NSDate, NSDefaultRunLoopMode, NSError, NSLocale, NSOperationQueue, NSRunLoop, NSString, NSURL,
};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionRequest, SFSpeechRecognitionResult,
    SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus, SFSpeechURLRecognitionRequest,
};

use crate::{AuthStatus, PcmStats, RecognizerStatus, SpeechError, Transcript, VoiceInfo};

/// Longest single wait inside `pump_until`, so deadlines and "done" flags are checked often.
const PUMP_STEP: Duration = Duration::from_millis(20);
/// After the last synthesizer buffer, this much silence also counts as "finished", in case the
/// terminating zero-length buffer never arrives.
const SYNTH_QUIET: Duration = Duration::from_secs(2);
/// How long `speak_blocking` waits for speech to start.
const SPEAK_START: Duration = Duration::from_secs(5);
/// How long the user has to answer the authorization prompt.
const AUTH_PROMPT: Duration = Duration::from_secs(120);
/// How long dictation waits for the final result after the microphone stops.
const DICTATION_FINAL: Duration = Duration::from_secs(10);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs the current thread's run loop in short steps until `done()` or `deadline`.
/// Returns whether `done()` became true.
fn pump_until(deadline: Instant, mut done: impl FnMut() -> bool) -> bool {
    let run_loop = NSRunLoop::currentRunLoop();
    // SAFETY: `NSDefaultRunLoopMode` is an immutable NSString constant exported by Foundation.
    let mode = unsafe { NSDefaultRunLoopMode };
    loop {
        if done() {
            return true;
        }
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        let step = (deadline - now).min(PUMP_STEP);
        let limit = NSDate::dateWithTimeIntervalSinceNow(step.as_secs_f64());
        if !run_loop.runMode_beforeDate(mode, &limit) {
            // No input sources on this run loop: it returned at once, so wait instead of spinning.
            std::thread::sleep(step);
        }
    }
}

fn error_text(error: &NSError) -> String {
    error.localizedDescription().to_string()
}

pub(crate) fn platform_supported() -> bool {
    true
}

// ---- read-aloud (AVSpeechSynthesizer) ----------------------------------------------------------

pub(crate) fn list_voices() -> Result<Vec<VoiceInfo>, SpeechError> {
    autoreleasepool(|_| {
        // SAFETY: a class method with no arguments; it returns a retained NSArray of voices.
        let voices = unsafe { AVSpeechSynthesisVoice::speechVoices() };
        let list = voices
            .iter()
            .map(|voice| {
                // SAFETY: plain property getters on a valid voice object.
                let (id, name, language) =
                    unsafe { (voice.identifier(), voice.name(), voice.language()) };
                VoiceInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    language: language.to_string(),
                }
            })
            .collect();
        Ok(list)
    })
}

fn utterance(
    text: &str,
    voice_id: Option<&str>,
) -> Result<Retained<AVSpeechUtterance>, SpeechError> {
    if text.trim().is_empty() {
        return Err(SpeechError::Failed(
            "nothing to say: the text is empty".to_owned(),
        ));
    }
    let string = NSString::from_str(text);
    // SAFETY: `string` is a valid NSString; the constructor copies it.
    let utterance = unsafe { AVSpeechUtterance::speechUtteranceWithString(&string) };
    if let Some(id) = voice_id {
        // SAFETY: `voiceWithIdentifier:` accepts any NSString and returns nil when unknown.
        let voice = unsafe { AVSpeechSynthesisVoice::voiceWithIdentifier(&NSString::from_str(id)) };
        let Some(voice) = voice else {
            return Err(SpeechError::Unavailable(format!(
                "voice {id} is not installed"
            )));
        };
        // SAFETY: `voice` is a valid voice object; the utterance retains it.
        unsafe { utterance.setVoice(Some(&voice)) };
    }
    Ok(utterance)
}

#[derive(Default)]
struct PcmState {
    frames: u64,
    sample_rate: f64,
    channels: u32,
    finished: bool,
    last_buffer: Option<Instant>,
}

pub(crate) fn synthesize_to_pcm(
    text: &str,
    voice_id: Option<&str>,
    timeout: Duration,
) -> Result<PcmStats, SpeechError> {
    autoreleasepool(|_| {
        let deadline = Instant::now() + timeout;
        let utterance = utterance(text, voice_id)?;
        // SAFETY: `new` has no preconditions.
        let synthesizer = unsafe { AVSpeechSynthesizer::new() };

        let state = Arc::new(Mutex::new(PcmState::default()));
        let sink = Arc::clone(&state);
        let callback = RcBlock::new(move |buffer: NonNull<AVAudioBuffer>| {
            // SAFETY: AVFoundation passes a valid buffer that lives for the duration of the call.
            let buffer = unsafe { buffer.as_ref() };
            let mut s = lock(&sink);
            s.last_buffer = Some(Instant::now());
            let Some(pcm) = buffer.downcast_ref::<AVAudioPCMBuffer>() else {
                return;
            };
            // SAFETY: property getters on a valid PCM buffer and its format.
            let (frames, rate, channels) = unsafe {
                let format = pcm.format();
                (
                    pcm.frameLength(),
                    format.sampleRate(),
                    format.channelCount(),
                )
            };
            if frames == 0 {
                // A zero-length buffer marks the end of the utterance.
                s.finished = true;
            } else {
                s.frames += u64::from(frames);
                s.sample_rate = rate;
                s.channels = channels;
            }
        });
        // SAFETY: `callback` is a valid block; the synthesizer copies (retains) it, and the
        // closure only touches its own `Arc<Mutex<_>>`, so later calls on any queue are sound.
        unsafe {
            synthesizer.writeUtterance_toBufferCallback(&utterance, RcBlock::as_ptr(&callback))
        };

        let finished = pump_until(deadline, || {
            let s = lock(&state);
            s.finished
                || (s.frames > 0 && s.last_buffer.is_some_and(|t| t.elapsed() >= SYNTH_QUIET))
        });
        if !finished {
            // SAFETY: stopping a synthesizer that may or may not be writing has no preconditions.
            unsafe { synthesizer.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate) };
            return Err(SpeechError::Timeout);
        }
        let s = lock(&state);
        if s.frames == 0 || s.sample_rate <= 0.0 {
            return Err(SpeechError::Failed(
                "the synthesizer produced no audio".to_owned(),
            ));
        }
        let duration_ms = (s.frames as f64 / s.sample_rate * 1000.0).round() as u64;
        Ok(PcmStats {
            frames: s.frames,
            sample_rate: s.sample_rate,
            channels: s.channels,
            duration_ms,
        })
    })
}

pub(crate) fn speak_blocking(text: &str, voice_id: Option<&str>) -> Result<(), SpeechError> {
    autoreleasepool(|_| {
        let utterance = utterance(text, voice_id)?;
        // SAFETY: `new` has no preconditions.
        let synthesizer = unsafe { AVSpeechSynthesizer::new() };
        // SAFETY: `utterance` is valid; the synthesizer retains it while speaking.
        unsafe { synthesizer.speakUtterance(&utterance) };

        // SAFETY: `isSpeaking` is a read-only property getter.
        let speaking = || unsafe { synthesizer.isSpeaking() };
        if !pump_until(Instant::now() + SPEAK_START, speaking) {
            return Err(SpeechError::Failed("speech did not start".to_owned()));
        }
        // Generous upper bound: about 4 characters per 100 ms, plus slack.
        let limit = Duration::from_secs(30) + Duration::from_millis(25 * text.len() as u64);
        if pump_until(Instant::now() + limit, || !speaking()) {
            Ok(())
        } else {
            // SAFETY: stopping a speaking synthesizer has no preconditions.
            unsafe { synthesizer.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate) };
            Err(SpeechError::Timeout)
        }
    })
}

// ---- dictation (SFSpeechRecognizer) ------------------------------------------------------------

fn auth_status() -> AuthStatus {
    // SAFETY: a class method that only reads the stored authorization; it never prompts.
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    map_status(status)
}

fn map_status(status: SFSpeechRecognizerAuthorizationStatus) -> AuthStatus {
    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        AuthStatus::Authorized
    } else if status == SFSpeechRecognizerAuthorizationStatus::Denied {
        AuthStatus::Denied
    } else if status == SFSpeechRecognizerAuthorizationStatus::Restricted {
        AuthStatus::Restricted
    } else {
        AuthStatus::NotDetermined
    }
}

/// Asks for speech-recognition permission only when it was never answered. Manual paths only
/// (`transcribe_file`, `dictate_microphone`); `recognizer_status` never calls this.
fn ensure_authorized() -> Result<(), SpeechError> {
    match auth_status() {
        AuthStatus::Authorized => return Ok(()),
        AuthStatus::Denied | AuthStatus::Restricted => return Err(SpeechError::NotAuthorized),
        AuthStatus::NotDetermined => {}
    }
    let answer: Arc<Mutex<Option<AuthStatus>>> = Arc::new(Mutex::new(None));
    let sink = Arc::clone(&answer);
    let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
        *lock(&sink) = Some(map_status(status));
    });
    // SAFETY: `handler` is a valid block that Speech copies; it only writes its own Arc state.
    // The binary embeds NSSpeechRecognitionUsageDescription (build.rs), so TCC does not abort.
    unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
    if !pump_until(Instant::now() + AUTH_PROMPT, || lock(&answer).is_some()) {
        return Err(SpeechError::Timeout);
    }
    match *lock(&answer) {
        Some(AuthStatus::Authorized) => Ok(()),
        _ => Err(SpeechError::NotAuthorized),
    }
}

fn recognizer(locale: &str) -> Result<Retained<SFSpeechRecognizer>, SpeechError> {
    if locale.trim().is_empty() {
        return Err(SpeechError::Unavailable("no locale given".to_owned()));
    }
    let ns_locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(locale));
    // SAFETY: `initWithLocale:` takes a freshly allocated object and a valid locale; it returns
    // nil (None) for unsupported locales.
    let recognizer =
        unsafe { SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &ns_locale) };
    let recognizer = recognizer
        .ok_or_else(|| SpeechError::Unavailable(format!("no recognizer for {locale}")))?;
    // Deliver results on a private background queue, not the main queue, so they arrive even
    // when the caller is not the main thread.
    let queue = NSOperationQueue::new();
    // SAFETY: `queue` is a valid operation queue; the recognizer retains it.
    unsafe { recognizer.setQueue(&queue) };
    Ok(recognizer)
}

pub(crate) fn supported_locales() -> Result<Vec<String>, SpeechError> {
    autoreleasepool(|_| {
        // SAFETY: a class method with no arguments; it does not need authorization.
        let locales = unsafe { SFSpeechRecognizer::supportedLocales() };
        let mut ids: Vec<String> = locales
            .iter()
            .map(|l| l.localeIdentifier().to_string().replace('_', "-"))
            .collect();
        ids.sort();
        ids.dedup();
        Ok(ids)
    })
}

pub(crate) fn recognizer_status(locale: &str) -> Result<RecognizerStatus, SpeechError> {
    autoreleasepool(|_| {
        let authorization = auth_status();
        let recognizer = recognizer(locale)?;
        // SAFETY: read-only property getters on a valid recognizer; neither prompts.
        let (available, supports_on_device) = unsafe {
            (
                recognizer.isAvailable(),
                recognizer.supportsOnDeviceRecognition(),
            )
        };
        Ok(RecognizerStatus {
            available,
            supports_on_device,
            authorization,
        })
    })
}

#[derive(Default)]
struct RecognitionState {
    text: String,
    error: Option<String>,
    finished: bool,
}

type ResultHandler = RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>;

fn result_handler(state: &Arc<Mutex<RecognitionState>>) -> ResultHandler {
    let sink = Arc::clone(state);
    RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            // SAFETY: Speech passes either null or a valid result/error for the duration of the call.
            let (result, error) = unsafe { (result.as_ref(), error.as_ref()) };
            let mut s = lock(&sink);
            if let Some(result) = result {
                // SAFETY: property getters on a valid recognition result.
                let (text, is_final) = unsafe {
                    (
                        result.bestTranscription().formattedString().to_string(),
                        result.isFinal(),
                    )
                };
                s.text = text;
                s.finished |= is_final;
            }
            if let Some(error) = error {
                s.error = Some(error_text(error));
                s.finished = true;
            }
        },
    )
}

/// Checks availability, on-device support and authorization before any audio is touched.
fn ready_recognizer(
    locale: &str,
    require_on_device: bool,
) -> Result<Retained<SFSpeechRecognizer>, SpeechError> {
    let recognizer = recognizer(locale)?;
    // SAFETY: read-only property getters on a valid recognizer.
    let (available, on_device) = unsafe {
        (
            recognizer.isAvailable(),
            recognizer.supportsOnDeviceRecognition(),
        )
    };
    if !available {
        return Err(SpeechError::Unavailable(format!(
            "the {locale} recognizer is not available right now"
        )));
    }
    if require_on_device && !on_device {
        return Err(SpeechError::Unavailable(format!(
            "on-device recognition is not supported for {locale}"
        )));
    }
    ensure_authorized()?;
    Ok(recognizer)
}

fn finish_transcript(
    state: &Mutex<RecognitionState>,
    on_device: bool,
) -> Result<Transcript, SpeechError> {
    let s = lock(state);
    match &s.error {
        Some(error) if s.text.is_empty() => Err(SpeechError::Failed(error.clone())),
        _ => Ok(Transcript {
            text: s.text.clone(),
            on_device,
        }),
    }
}

pub(crate) fn transcribe_file(
    path: &Path,
    locale: &str,
    require_on_device: bool,
    timeout: Duration,
) -> Result<Transcript, SpeechError> {
    autoreleasepool(|_| {
        let deadline = Instant::now() + timeout;
        if !path.is_file() {
            return Err(SpeechError::Failed(format!(
                "no such audio file: {}",
                path.display()
            )));
        }
        let path_str = path
            .to_str()
            .ok_or_else(|| SpeechError::Failed(format!("path is not UTF-8: {}", path.display())))?;
        let recognizer = ready_recognizer(locale, require_on_device)?;

        let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
        // SAFETY: `initWithURL:` takes a freshly allocated object and a valid file URL.
        let request = unsafe {
            SFSpeechURLRecognitionRequest::initWithURL(SFSpeechURLRecognitionRequest::alloc(), &url)
        };
        // SAFETY: plain property setters on a request that has not started yet.
        unsafe {
            request.setRequiresOnDeviceRecognition(require_on_device);
            request.setShouldReportPartialResults(false);
        }

        let state = Arc::new(Mutex::new(RecognitionState::default()));
        let handler = result_handler(&state);
        let request: &SFSpeechRecognitionRequest = &request;
        // SAFETY: `request` and `handler` are valid; the task retains both until it ends.
        let task =
            unsafe { recognizer.recognitionTaskWithRequest_resultHandler(request, &handler) };

        if !pump_until(deadline, || lock(&state).finished) {
            // SAFETY: cancelling a running task has no preconditions.
            unsafe { task.cancel() };
            return Err(SpeechError::Timeout);
        }
        finish_transcript(&state, require_on_device)
    })
}

pub(crate) fn dictate_microphone(locale: &str, seconds: u32) -> Result<Transcript, SpeechError> {
    autoreleasepool(|_| {
        if seconds == 0 {
            return Err(SpeechError::Failed(
                "dictation needs at least 1 second".to_owned(),
            ));
        }
        // Local-first: dictation is always on-device; network recognition is never used.
        let recognizer = ready_recognizer(locale, true)?;

        // SAFETY: `new` has no preconditions.
        let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        // SAFETY: plain property setters on a request that has not started yet.
        unsafe {
            request.setRequiresOnDeviceRecognition(true);
            request.setShouldReportPartialResults(true);
        }

        // SAFETY: `new` has no preconditions; `inputNode` creates the singleton input node.
        let (engine, input) = unsafe {
            let engine = AVAudioEngine::new();
            let input = engine.inputNode();
            (engine, input)
        };
        // SAFETY: bus 0 always exists on the input node.
        let format = unsafe { input.outputFormatForBus(0) };
        // SAFETY: read-only property getters on a valid format.
        let (rate, channels) = unsafe { (format.sampleRate(), format.channelCount()) };
        if rate <= 0.0 || channels == 0 {
            return Err(SpeechError::Unavailable(
                "no microphone input is available".to_owned(),
            ));
        }

        let feed = request.clone();
        let tap = RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                // SAFETY: AVAudioEngine passes a valid buffer for the duration of the call, and the
                // request copies the audio it is given.
                unsafe { feed.appendAudioPCMBuffer(buffer.as_ref()) };
            },
        );
        // SAFETY: `tap` is a valid block that the node copies; `format` matches the bus format.
        unsafe {
            input.installTapOnBus_bufferSize_format_block(
                0,
                1024,
                Some(&format),
                RcBlock::as_ptr(&tap),
            )
        };

        // SAFETY: the engine has an input node with a tap and no other configuration.
        let started = unsafe {
            engine.prepare();
            engine.startAndReturnError()
        };
        if let Err(error) = started {
            // SAFETY: removing the tap installed above.
            unsafe { input.removeTapOnBus(0) };
            return Err(SpeechError::Failed(format!(
                "microphone did not start: {}",
                error_text(&error)
            )));
        }

        let state = Arc::new(Mutex::new(RecognitionState::default()));
        let handler = result_handler(&state);
        let as_request: &SFSpeechRecognitionRequest = &request;
        // SAFETY: `as_request` and `handler` are valid; the task retains both until it ends.
        let task =
            unsafe { recognizer.recognitionTaskWithRequest_resultHandler(as_request, &handler) };

        let listen_until = Instant::now() + Duration::from_secs(u64::from(seconds));
        let _ = pump_until(listen_until, || lock(&state).finished);

        // SAFETY: stop audio first, then tell the request no more audio is coming.
        unsafe {
            input.removeTapOnBus(0);
            engine.stop();
            request.endAudio();
        }
        if !pump_until(Instant::now() + DICTATION_FINAL, || lock(&state).finished) {
            // SAFETY: finishing a running task has no preconditions; partial text is kept.
            unsafe { task.finish() };
        }
        finish_transcript(&state, true)
    })
}
