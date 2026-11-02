# 005 — macOS speech: read-aloud and on-device dictation through objc2

Status: Proposed · Date: 2026-11-02 · Track: M0-D

## Context
PLAN.md plans read-aloud and dictation for the writer on macOS, under the local-first rule:
no audio and no text may leave the Mac. Apple ships both in the OS: `AVSpeechSynthesizer`
(AVFAudio) for text-to-speech and `SFSpeechRecognizer` (Speech) for recognition, which can be
forced on-device with `requiresOnDeviceRecognition`. This spike (M0.md §6.1) decides whether
Rust can drive them directly through the objc2 bindings, or whether a Swift bridge is needed.

## Hypothesis
objc2 0.6 with objc2-foundation / objc2-avf-audio / objc2-speech 0.3 and block2 0.6 support
local-first read-aloud and **on-device** dictation without Swift, with `unsafe` confined to one
module and every block/run-loop callback bounded by a timeout.

## Method
- Crate `inkspark-spike-speech` (`spikes/macos-speech`). `#![deny(unsafe_code)]` at the root;
  `unsafe` only in `src/macos/mod.rs`, each with a `// SAFETY:` comment (enforced by
  `tests/unsafe_audit.rs`). Other OSes build `src/stub.rs`, which returns `Unsupported`.
- objc2 APIs used:
  - AVFAudio: `AVSpeechSynthesisVoice::{speechVoices, voiceWithIdentifier, identifier, name,
    language}`, `AVSpeechUtterance::{speechUtteranceWithString, setVoice}`,
    `AVSpeechSynthesizer::{new, writeUtterance_toBufferCallback, speakUtterance, isSpeaking,
    stopSpeakingAtBoundary}`, `AVAudioPCMBuffer::{frameLength, format}` (downcast from
    `AVAudioBuffer`), `AVAudioFormat::{sampleRate, channelCount}`, `AVAudioEngine::{new,
    inputNode, prepare, startAndReturnError, stop}`, `AVAudioNode::{outputFormatForBus,
    installTapOnBus_bufferSize_format_block, removeTapOnBus}`.
  - Speech: `SFSpeechRecognizer::{authorizationStatus, requestAuthorization, supportedLocales,
    initWithLocale, isAvailable, supportsOnDeviceRecognition, setQueue,
    recognitionTaskWithRequest_resultHandler}`, `SFSpeechURLRecognitionRequest::initWithURL`,
    `SFSpeechAudioBufferRecognitionRequest::{new, appendAudioPCMBuffer, endAudio}`,
    `SFSpeechRecognitionRequest::{setRequiresOnDeviceRecognition,
    setShouldReportPartialResults}`, `SFSpeechRecognitionResult::{bestTranscription, isFinal}`,
    `SFTranscription::formattedString`, `SFSpeechRecognitionTask::{cancel, finish}`.
  - Foundation: `NSRunLoop::{currentRunLoop, runMode_beforeDate}` with `NSDefaultRunLoopMode`,
    `NSDate`, `NSLocale`, `NSURL::fileURLWithPath`, `NSOperationQueue::new`, `NSError`,
    `NSThread::isMainThread_class`.
  - block2 `RcBlock` for the buffer, tap, result and authorization callbacks.
  - objc2 `exception::catch` (feature `exception`) around `installTapOnBus…` and
    `prepare`/`startAndReturnError`, so an NSException from AVAudioEngine becomes
    `SpeechError::Failed` instead of aborting the process.
- Concurrency model (risk R5): callbacks only write into `Arc<Mutex<_>>` state. The calling
  thread pumps its `NSRunLoop` in 20 ms steps until the state says done or the deadline passes
  (`SpeechError::Timeout`). Recognizers deliver results on a private `NSOperationQueue`, not
  the main queue, so they also work off the main thread. Synthesis counts as finished on the
  zero-length final buffer, or after 2 s without a new buffer. Each pump step has its own
  autorelease pool. The authorization wait is bounded by the caller's deadline (at most 120 s).
- Permissions (risk R6): `build.rs` embeds `macos/Info.plist` (`CFBundleIdentifier`,
  `NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`) with
  `-Wl,-sectcreate,__TEXT,__info_plist,…` into every macOS link target (the bin and the test
  binaries). `recognizer_status` only reads `authorizationStatus` and never prompts.
  `transcribe_file` and `dictate_microphone` ask only when the status is `NotDetermined`.
  The `speech-spike` CLI always requires on-device recognition; `dictate_microphone` always
  sets `requiresOnDeviceRecognition` and returns `Unavailable` when the locale cannot do it.
- Local (Linux container, Rust 1.97.0): stub tests, `unsafe_audit`, `cargo fmt`, Linux clippy,
  and `cargo clippy -p inkspark-spike-speech --target aarch64-apple-darwin --all-targets --
  -D warnings` (type-checks the macOS code; it cannot link or run without the macOS SDK).
- CI: `spike-speech` job on macos-15 runs `cargo test -p inkspark-spike-speech --
  --include-ignored ci_`, then builds release `speech-spike` for aarch64 and x86_64, joins them
  with `lipo` into a universal binary, and uploads it as `speech-spike-macos`.
- Manual: the user runs the artifact on their Mac (below).

## Criteria and results
| Metric | Threshold | ubuntu | macos | Pass |
|---|---|---|---|---|
| Stub: every function `Err(Unsupported)` | yes | 9/9 tests (local) | — | local yes |
| `unsafe` only in `src/macos/`, each with `// SAFETY:` | yes | 7/7 tests (local) | same test in CI | local yes |
| macOS code type-checks, clippy `-D warnings` (aarch64-apple-darwin) | clean | clean (local cross-check) | pending CI (spike-speech job on macos-15) | local yes |
| `ci_list_voices_includes_english` | non-empty, has `en*` | — | pending CI (spike-speech job on macos-15) | pending |
| `ci_synthesize_to_pcm_produces_audio` | `frames > 0`, `duration_ms ≥ 1000` | — | pending CI (spike-speech job on macos-15) | pending |
| `ci_supported_locales_contains_en_us` | contains `en-US` | — | pending CI (spike-speech job on macos-15) | pending |
| `ci_recognizer_status_returns_without_prompting` | `Ok`, no hang | — | pending CI (spike-speech job on macos-15) | pending |
| Manual: `status en-US` | `supports_on_device: true` | — | pending (user's Mac) | pending |
| Manual: `dictate en-US 15`, 3 read sentences | WER ≤ 15 %, on-device | — | pending (user's Mac) | pending |
| Manual: `speak "Hello"` | audible | — | pending (user's Mac) | pending |

A CI runner may have no voices installed or no on-device model. If a `ci_` test fails only for
that reason, the result is reported here and the decision relies on the manual run (R5).

**Risk: the synthesizer's buffer-callback queue is undocumented.** Apple does not say on which
queue `writeUtterance:toBufferCallback:` calls back. The `ci_` tests call it from a spawned
thread while the test harness blocks the main thread. If Apple delivers on the main queue, the
callback can never run there. In that case `synthesize_to_pcm` returns
`Failed("buffer callback never fired (main thread: false)")` instead of a plain timeout. That
failure says nothing about the API itself; the manual CLI run (`speech-spike synth "…"` and
`speak`, which run on the main thread and pump its run loop) then decides read-aloud.

**`Transcript.on_device`** reports what was requested, not something Speech confirms: Speech
does not report which engine produced a result. With `requiresOnDeviceRecognition` set
(dictation and the CLI, always), Speech fails rather than use the network, so `true` is
reliable. With `require_on_device = false`, `on_device` is `false`, meaning "may have used the
network".

### How you test it on your Mac
The tool is one small program that runs in Terminal. It works on both Apple Silicon and
Intel Macs (it is a universal binary).

1. Open the latest CI run of this branch on GitHub, scroll to **Artifacts**, and download
   `speech-spike-macos`. You must be signed in to GitHub to download artifacts. Unzip it;
   you get a file called `speech-spike`.
2. Open Terminal (in Applications → Utilities) and go to that folder, for example
   `cd ~/Downloads/speech-spike-macos`.
3. Make the file runnable. The zip download loses the "this is a program" mark, so type
   `chmod +x speech-spike` and press Return. Nothing is printed when it works.
4. Let macOS run it. The program is not signed by a registered Apple developer, so macOS
   Gatekeeper blocks it the first time with a message like "cannot be opened because the
   developer cannot be verified". The usual right-click → Open trick does not work for
   Terminal programs. Use one of these two ways instead:
   - In Terminal, type `xattr -d com.apple.quarantine ./speech-spike`. This removes the
     "downloaded from the internet" tag that triggers the block. If it says "No such xattr",
     the tag was not there, which is fine.
   - Or run `./speech-spike voices` once, let macOS block it, then open System Settings →
     Privacy & Security, scroll down to the message about `speech-spike`, click
     **Allow Anyway**, and run the command again (click **Open** if asked).
5. Run these four commands and note what happens:

| Command | What you should see |
|---|---|
| `./speech-spike voices` | One line per installed voice (language, name, id), ending with a count such as `150 voices`. At least one line starts with `en`. |
| `./speech-spike speak "Hello"` | You hear "Hello" from your speakers, then the tool prints `spoken`. |
| `./speech-spike status en-US` | Four lines. The important one is `supports_on_device: true`. `authorization` may say `NotDetermined` the first time; that is fine. |
| `./speech-spike dictate en-US 15` | The first time, macOS asks to allow speech recognition and microphone access for Terminal: allow both. It prints `Listening for 15 s.`; read three ordinary sentences aloud at a normal pace. After about 15 s it prints `on_device: true` and `text: …` with what it heard. |

   If the first `dictate` run prints empty text because you were answering the permission
   prompts, run it again.

6. Send back the output of all four commands, plus the three sentences you read. The word
   error rate is counted from those (target: at most 15 % of words wrong, missing or extra).

If `status` shows `supports_on_device: false`, open System Settings → Keyboard → Dictation,
turn Dictation on for English (US) so the on-device model downloads, and try again. If
`dictate` prints `not authorized`, allow Terminal under System Settings → Privacy & Security →
Speech Recognition and → Microphone.

## Decision
**Pending** (Proposed). The go/no-go rule:
- **Go** needs both: CI green (macOS compiles clippy-clean, the `ci_` tests pass, the stub passes
  on Linux and Windows) **and** the manual run passes (`supports_on_device: true`, dictation
  WER ≤ 15 % with on-device recognition, `speak` audible).
- **Dictation is No-go if on-device recognition is unavailable.** Network-based recognition
  sends the writer's audio to Apple's servers, which breaks local-first (and Detox mode); it is
  never used as a fallback. Read-aloud is then assessed on its own and can still be Go.
- If objc2 block or run-loop handling proves unworkable on macos-15 (callbacks never fire,
  deadlocks, TCC aborts), the fallback is a small Swift package called through swift-rs, keeping
  the same Rust API.

## Consequences
- The dictation and read-aloud features stay behind their flags until this ADR is Accepted.
- The production version becomes a Tauri plugin crate that keeps the same `unsafe` rules and
  audit test. It must run synthesis and recognition off the UI thread and stream partial
  results through a typed event contract (Orchestrator request when that milestone starts).
- Microphone permission is requested implicitly by `AVAudioEngine` start. When it is denied,
  macOS delivers silence instead of an error, so dictation returns empty text; the app must
  check `AVCaptureDevice`/`AVAudioApplication` record permission first (needs another objc2
  crate or a newer macOS minimum, decided later).
- The TCC prompt names Terminal (the responsible process) for the CLI. In the app bundle it
  will name InkSpark, using the app's own Info.plist strings.
- The production API drops the `require_on_device` parameter: recognition is always on-device,
  and a locale without on-device support is reported as unavailable. The spike keeps the
  parameter only to match the M0 §6.1 signature.
- `objc2`'s `exception` feature compiles a small Objective-C helper (objc2-exception-helper).
  For the local cross-check from Linux this needs
  `CC_aarch64_apple_darwin=clang AR_aarch64_apple_darwin=llvm-ar-18`; macOS CI needs nothing
  extra.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| objc2 | 0.6.5 | MIT | Objective-C runtime bindings (macOS only); feature `exception` |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT | pulled in by `exception`: catches NSException (macOS only) |
| block2 | 0.6.2 | MIT | Objective-C blocks for callbacks (macOS only) |
| objc2-foundation | 0.3.2 | MIT | NSRunLoop, NSString, NSLocale, NSURL, NSError (macOS only) |
| objc2-avf-audio | 0.3.2 | Zlib OR Apache-2.0 OR MIT | AVSpeechSynthesizer, AVAudioEngine (macOS only) |
| objc2-speech | 0.3.2 | Zlib OR Apache-2.0 OR MIT | SFSpeechRecognizer (macOS only) |
| thiserror | 2 | MIT OR Apache-2.0 | `SpeechError` |

Default features of the three framework crates are off; only the classes used are enabled
(see `spikes/macos-speech/Cargo.toml`). This also drops objc2-core-media, objc2-core-audio,
objc2-core-video and objc2-audio-toolbox from the build.

## Follow-ups
- M0 (Orchestrator): fill in the macos-15 `spike-speech` run link and results; record the
  user's manual results and set the verdict.
- Dictation milestone: WER measured on a fixed passage set, partial results in the editor,
  punctuation (`addsPunctuation`), and a record-permission check before listening.
- Read-aloud milestone: voice picker from `list_voices`, rate/pitch, highlighting via
  `willSpeakRangeOfSpeechString` (needs an objc2 `define_class!` delegate).
- If the CI runner has no voices, add a CI step that lists voices so the cause is visible.

## Links
- CI run: pending CI (spike-speech job on macos-15).
- Artifact: `speech-spike-macos`.
