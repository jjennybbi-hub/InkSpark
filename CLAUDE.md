# CLAUDE.md — InkSpark conventions

`PLAN.md` is the approved plan and the single source of truth. If anything here conflicts with it, `PLAN.md` wins.
Each milestone has a spec in `docs/milestones/Mx.md`. Decisions are recorded as ADRs in `docs/adr/NNN-title.md`.

## Product rules (never break these)
- **No encouragement UI.** No goals, streaks, praise, badges, popups or nudges. Counts appear only in Publish.
- **No generated quotes.** Quotes and passages are real, cited human text only (author, work, location, link). AI-drafted prompt banks/templates must be labeled as AI-drafted.
- **Local-first.** No accounts, no servers, no telemetry.
- **Never lose a word.** All writes to user files go through the Rust `storage` module (temp file → fsync → rename).
- If a cloud network limit blocks a download or source, report it. Don't work around it.

## Stack
- Tauri 2 (Rust) + React 18 + TypeScript (strict) via Vite. Zustand for state. TipTap/ProseMirror editor.
- tauri-specta generates TS bindings from Rust commands into `src/contracts/`. Never hand-edit generated bindings.
- Rust: `rusqlite` (FTS5), the `typst` crate, a `notify` watcher.

## Conventions
- **TypeScript**: `strict` and `noUncheckedIndexedAccess`; ESLint `typescript-eslint` strict; Prettier. No `any`, and no `@ts-ignore` without a linked reason.
- **Rust**: `cargo clippy --all-targets -- -D warnings`, `rustfmt`, and `#![forbid(unsafe_code)]` in every crate except the native macOS plugin.
- **Validation**: every file read is validated with zod (TS) and serde (Rust). Every schema carries a version and has tested migrations.
- **Single write path**: frontend fs-write imports are banned by a lint rule. Only `src-tauri/src/storage/` may write user files.
- **Feature flags**: unfinished features stay behind flags (`src/app/flags.ts`), so `main` is always usable.
- **Lockfiles** (`package-lock.json`, `Cargo.lock`) are committed. CI runs `cargo deny` and `npm audit`.
- **Commits**: small Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:`).
- **Ownership**: each directory has exactly one owning track per milestone (see the milestone doc). Implementers never edit `src/contracts/` or another track's directories. Contract changes go to the Orchestrator as a request.
- **Spikes**: live in `spikes/<name>/`. Each one ends in a go/no-go ADR.

## Commands
- `npm run lint` (ESLint and Prettier check), `npm run typecheck`, `npm test` (vitest)
- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- `npm run tauri dev`, `npm run tauri build`

## Build loop (PLAN.md §4)
Plan subagent → Orchestrator commits contracts and stubs → Test-author writes failing tests → up to 4 Implementers in separate worktrees → independent Reviewer → integrate one track at a time with the full gate → Verifier → merge to `main` only on green CI → report.

## Test layers (PLAN.md §5)
Unit (vitest, cargo test); property tests (fast-check, proptest) for the journal, atomic writes, the ledger, scene split and mark anchoring; fault injection for saving; golden-file tests for exports (epubcheck, PDF parser, DOCX XML diff); fuzzing for importers; component tests (Testing Library) plus axe-core; E2E (WebdriverIO plus tauri-driver on Linux/Windows, plus a macOS smoke launch); performance (500k words: under 16 ms per keystroke, open in under 2 s).

## Data-safety invariants (tested every milestone)
1. No user file is written outside `storage`.
2. Imports never touch the source.
3. Deleting a pack never touches projects.
4. Every save is recoverable from history or the journal.

## Definition of Done
- [ ] Tests written first and passing
- [ ] Lint and type checks clean (ESLint, Prettier, tsc, rustfmt, clippy `-D warnings`)
- [ ] Reviewed by a Reviewer who did not write the code
- [ ] Accessible: keyboard operable, with labels on every control
- [ ] Docs and ADRs updated
- [ ] CI green on ubuntu, macOS and Windows

## Reviewer checklist
- **Correctness**: matches the milestone doc's interfaces and acceptance criteria; edge cases handled; tests check the spec, not the implementation.
- **Error handling**: no `unwrap()`/`expect()` on user data or I/O in non-test Rust; errors are typed and surfaced calmly; no swallowed promise rejections.
- **Data safety**: writes only through `storage`; atomic write pattern; never modifies import sources or projects outside its scope; invariants above hold.
- **Contracts**: no hand-edited generated bindings; inputs validated with zod/serde; schemas versioned.
- **Accessibility**: keyboard reachable, visible focus, labels/ARIA, sufficient contrast, no motion without reduce-motion handling.
- **Calm UI**: no goal/streak/encouragement UI, no badges or popups on the writer.
- **Content**: no generated quotes; every quote cited; AI-drafted content labeled.
- **Hygiene**: no stray `TODO`/`FIXME` without an issue or ADR reference, no debug logging, no dead code, no secrets, no new dependency without a stated reason and an acceptable license (MIT/Apache-2.0/BSD/ISC/MPL-2.0/Zlib/Unicode).
- **Ownership**: the diff touches only the track's owned directories.

## UI rule: stable layout (owner preference, applies to every session)
- The page structure stays constant. Menus, settings and pickers open as overlays (popovers, dropdowns, floating side sheets). They never push, shift or resize other parts of the layout.
- Toolbars have a fixed height.
- App controls are icon buttons with tooltips: a gear for settings, "+" for new items.
- Text formatting (inside the writing) and app appearance (themes, UI font) are separate controls.

## Keeping the owner's app stable (applies to every session)
- The owner opens InkSpark from the Dock (`~/Applications/InkSpark.app`). Never tell them to run `npm run tauri dev`; it stops when Terminal closes and restarts on every code edit.
- Update their app only with `scripts/install-app.sh`, and only at the end of a finished, tested step. Never delete or copy over the app by hand.
- If a new version won't open, run `scripts/rollback-app.sh`.
