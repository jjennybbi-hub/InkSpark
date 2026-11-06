# InkSpark v1: lite plan (read this, not PLAN.md)

**Goal:** a calm desktop writing app where you open it and write, and never lose a word. No goals, streaks or praise.

**Already done (M0):** Tauri 2 + React + TS scaffold, lint, CI, feature flags (`src/app/flags.ts`). See `docs/milestones/M0-report.md` only if needed.

**v1, built in 2 sessions:**

- **Session A: write and save**
  - A left list of pages; a plain editor (a textarea is fine) on the right.
  - Project = a folder the user picks. Each page is `pages/<id>.md`; the order lives in `project.json`.
  - All writes go through Rust: temp file → fsync → rename (atomic).
  - Autosave ~1 s after typing stops, plus ⌘S. On each save, copy the previous version to `.history/<id>/<timestamp>.md` (keep the last 50).
  - A quiet save dot (saved/saving).
  - Rust tests for the atomic write and history only.
- **Session B: ideas and prompts**
  - Idea Shelf: a collapsible right rail of short notes in `ideas/<id>.md`; ⌘I focuses a quick-capture box.
  - A prompt button: deals one prompt from small built-in word lists through a few templates. It never repeats (seen hashes in `.inkspark-seen.json`). Prompts are labeled as app prompts.

Light/dark follows the system. Everything else in PLAN.md comes later.

**UI rule (always):** the layout stays constant. Menus and settings are overlays that never push content; app controls are icon buttons (gear, +). See CLAUDE.md.

**Rules for every session (to save tokens):**

- Opus model, medium effort, short sessions (one feature each).
- Read only this file and the files you edit. Small edits; don't re-read files you've already read.
- General effort-saving rules live in the personal ~/.claude/CLAUDE.md.
- When the step works: update the app the user clicks on with `scripts/install-app.sh` (never `tauri dev`, never by hand), update `NEXT-STEP.txt` for the next session, and stop.
