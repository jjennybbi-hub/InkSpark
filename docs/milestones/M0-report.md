# M0 report: Scaffold & spikes

Status: **done**. Code merged to `main` on green CI. ADRs are in `docs/adr/`.

## Delivered
- **App scaffold**
  - Tauri 2 + React 18 + TypeScript (strict) + Vite.
  - A calm, empty window with no goals, streaks or praise.
  - tauri-specta generates `src/contracts/bindings.ts`, and CI checks that it is up to date.
- **Guardrails**
  - Strict ESLint and Prettier, rustfmt, and clippy `-D warnings`.
  - `forbid(unsafe_code)` everywhere except the macOS speech spike.
  - A lint rule that bans frontend file writes; it cannot be silenced inline.
  - `cargo deny` and `npm audit` run in CI.
- **Feature flags**: `src/app/flags.ts`, all off by default (`docs/feature-flags.md`).
- **CI** (GitHub Actions)
  - On ubuntu, macOS and Windows: lint, typecheck, unit tests, Rust tests and the app build.
  - E2E smoke test on Linux (WebdriverIO + tauri-driver).
  - A universal (Apple Silicon + Intel), unsigned macOS `InkSpark.app` and `.dmg`, smoke-launched for 15 s and uploaded as an artifact.
  - A separate **Spikes** workflow records measurements.
- **Six spikes**, each with an ADR, plus ADR 007 for the toolchain.

## Spike verdicts
| ADR | Spike | Verdict |
|---|---|---|
| 001 | Vertical text in the editor on WebKit | **No-go** for editing: 10 core failures on both WebKit runners (arrow keys, click-to-caret). LTR/RTL: **Go**. Vertical stays in preview/EPUB only. |
| 002 | Typst PDF | **Go-with-conditions.** Very fast (300-page book: 0.3 s cold, 0.08 s after an edit, macOS). It adds about 40 MB to the app against a 30 MB budget. **Needs a user decision.** |
| 003 | foliate-js EPUB reader | **Go-with-conditions.** Works on both WebKit engines with the strict security policy. Page turns are a little slow on Linux. |
| 004 | FTS5 offline encyclopedia | **No-go as designed.** Files are too big and common-word and prefix search are too slow at 50k articles. A revised design (title index, compression) is proposed and needs a decision before M7. |
| 005 | macOS dictation and read-aloud | **Pending the user's Mac test.** 3 of 4 CI checks pass. The 4th (synthesis on a background thread) fails as predicted; the Mac test runs it on the main thread. |
| 006 | Scrivener `.scriv` reader | **Go.** Reads a 1,000-document project in about 0.06 s and never changes the source. |
| 007 | Toolchain, CI, E2E | **Go.** |

## Known issues and follow-ups
- **Branch protection on `main` is not enabled.** The repo owner turns it on in GitHub settings.
- **The macOS app is unsigned.** macOS asks once before opening it. Signing is parked (PLAN §9).
- **Cloud network limits blocked several downloads**, so some spikes used synthetic data:
  - Wikipedia dumps (FTS5 spike);
  - Project Gutenberg and direct GitHub downloads (real Scrivener samples);
  - Maven (epubcheck).
  - Each affected ADR lists a follow-up to re-run on real data in CI.
- **Speech**: the synthesis CI check should become a CLI-based step (ADR 005).
- **foliate-js**: page-turn timing should be measured to the `relocate` event in M5; epubcheck should run on the EPUB fixture.
- **Typst**: 7 dependency advisories (unmaintained crates and a quick-xml DoS) are ignored for the spike only. They must be resolved before Typst enters the app.

## Decisions taken during M0
These are recorded in `docs/milestones/M0.md` §11 and in the ADRs:
- **Editor latency** is measured as per-keystroke work time.
- **The Tauri security policy stays strict.** Book CSS is inlined.
- **The macOS build is universal.**
- **`export-bindings`** is a Cargo example, not a bundled binary.
