# InkSpark: Build Plan

## 1. Summary
**Goal:** a calm, local-first desktop writing app that takes a writer from the first spark to a published book, removes every bit of resistance to writing, and never loses a word.

**Principles:**
- **Local-first**: plain files on your own disk; no account, no server.
- **Calm technology**: tools stay at the edges; no badges, popups or comments on the writer.
- **Ma (間) minimalism**: generous empty space, quiet surfaces.
- **Tool for thought**: presets for everything, plus "make your own"; a ⌘K command palette.

**Fixed decisions**

| Topic | Decision |
|---|---|
| Form | Tauri 2 desktop app (Rust + React/TypeScript); projects are real folders of Markdown and JSON. |
| Where it's built | Claude Code **cloud session** on `jjennybbi-hub/InkSpark` (Linux). GitHub Actions also builds the **macOS app**, so it can be tested on the user's Mac without installing tools. |
| Use | Personal and testing for now; commercial items are parked in §9. |
| Encouragement | None: no goals, streaks or praise. Counts appear only in Publish. |
| Saving | Autosave plus ⌘S, atomic writes, crash journal, version history, local backups. |
| Prompts | Randomizer over word/phrase banks and templates (AI-drafted and labeled), with a never-repeat ledger. Quotes and passages are real, cited human text only. |
| Previews | Scrivener-level accuracy: the real compiled PDF and EPUB, plus a flat cover preview. |
| Writing direction | LTR and RTL for editing. Vertical-RL/LR only in preview and EPUB export: the M0 spike was a No-go for editable vertical text on WebKit (ADR 001). |
| Name | InkSpark: no conflicting writing app found. A trademark check is due before selling (§9). |

## 2. Release 1 scope
**In:**
- **Write & save**: the save stack; calm editor with focus modes; free pages and scenes; split view; back/forward trail; LTR/RTL (vertical editing was a No-go in M0, ADR 001); multilingual fonts.
- **Ideas**: Idea Shelf, quick capture (⌘I), night notes, scraps from highlights, voice notes (macOS), "Save to Ideas" on every spark.
- **Personal space**: themes, fonts, places, your own music and generated ambience.
- **Sparks**: prompt randomizer, offline quotes/passages/images with source picker, Walk Break, Craft Library core.
- **Plan**: outline, board, timeline, structure presets, story bible; write-first tools (auto-split, reverse outline, two-way link, bridge cards, character and setup→payoff checks).
- **Revise**: review marks (preset and custom types), Review panel, margin notes, snapshots and compare.
- **Publish**: EPUB, print PDF (Typst), DOCX, Standard Manuscript Format; preflight; cover template; Reader View; counts.
- **Import**: Scrivener, DOCX, ODT, RTF, Markdown folders, Fountain/FDX, Plottr, TXT, with a preview first and the original never modified.
- **Packs**: the pack format, Pack Manager, Detox Mode, disk budget, Pack Creator; **Lite** packs for Fantasy, Romance and Mystery/Thriller, plus a Lite always-on pack; universal pack tools (subset).
- **Project types**: Fiction and Non-fiction (Non-fiction basics: argument outline, footnotes, fact-check marks).

**Out (later updates; see §8):**
- Automerge two-device merging
- Other project types
- Standard/Complete pack sizes
- Polish analyzers
- Feedback/track changes
- 3D book preview
- Zotero
- Mobile companion
- UI translations

## 3. Architecture & contracts
- **Stack**:
  - Frontend: Tauri 2; React 18 + TypeScript (strict) via Vite; TipTap/ProseMirror editor; `@dnd-kit`; Web Audio; Zustand for state.
  - Rust: `typst` crate (PDF); EPUB/DOCX writers; `rusqlite` with FTS5 (cache, search, spark ledger, pack encyclopedias); a `notify` file watcher.
  - **tauri-specta** generates TypeScript bindings from Rust commands, so the two sides' types can't drift.
- **Encyclopedia format** (simplified to remove a risk): instead of Kiwix/libzim, each pack encyclopedia is one **SQLite FTS5 file**. It holds the top-N most-viewed Wikipedia articles from the pack's categories (plain text plus optional thumbnails) and is built by our own script.
- **Project folder** (the source of truth; everything else can be rebuilt):
  ```
  MyBook.inkspark/
    project.json          schema-versioned (type, settings, structure order)
    manuscript/<id>.md    one file per scene (front matter: title, status, pov, marks)
    ideas/<id>.md   bible/<id>.md   research/   assets/
    .history/             snapshots    .journal/  crash journal    .cache/  rebuildable index
  ```
- **Single write path**: all writes to user files go through the Rust `storage` module (temp file → fsync → rename). This is enforced by a lint rule (frontend fs-write imports are banned) and by Rust module visibility.
- **Module map and ownership** (each directory has exactly one owning track per milestone):
  ```
  src-tauri/src/storage/   atomic, journal, history, backup, watch
  src-tauri/src/compile/   typst, epub, docx, preflight
  src-tauri/src/import/    scriv, docx, odt_rtf, markdown, fountain, plottr
  src-tauri/src/packs/     manifest, validator, manager, fts, detox
  src-tauri/src/native/    macos_speech (plugin)
  src/contracts/           generated bindings + zod schemas (orchestrator only)
  src/editor/ src/ideas/ src/spark/ src/plan/ src/revise/ src/publish/ src/import/ src/packs/ src/personalize/ src/app/
  scripts/                 pack builders, verify-sources
  docs/adr/  docs/milestones/
  ```

## 4. Build process with subagents
The cloud session acts as **Orchestrator** and runs each milestone through the same loop:

1. **Design**: a **Plan subagent** writes `docs/milestones/Mx.md`, covering interfaces (Rust command signatures, TS types, file formats), file ownership per track, a test list mapped to acceptance criteria, and risks. The Orchestrator reviews it and commits the contracts to `src/contracts` and the Rust command stubs **before** any implementation starts.
2. **Tests first**: a separate **Test-author subagent** writes failing tests from the milestone doc (unit, property, golden, E2E). Tests are written independently of the implementers, so they check the spec rather than mirror the code.
3. **Implement in parallel**: up to **4 Implementer subagents**, each in its own **git worktree** (`isolation: worktree`), each owning disjoint directories. They may not edit `src/contracts` or another track's directories; contract changes go to the Orchestrator as a request.
4. **Review**: a **Reviewer subagent**, who didn't write the code, reviews each track's diff against the milestone doc and the checklist in `CLAUDE.md` (correctness, error handling, data safety, accessibility, no stray TODOs). Findings go back to the implementer.
5. **Integrate**: the Orchestrator merges tracks into `milestone/Mx` one at a time, running the full gate after each merge.
6. **Verify**: a **Verifier subagent** runs the whole suite plus the E2E walkthrough and reports failures with logs. Only a green result merges to `main`.
7. **Report**: the Orchestrator writes a short milestone report (done, deferred, known issues), updates `PLAN.md`, and pushes. The user tests the macOS artifact from CI.

Supporting roles:
- **Explore subagents**: read-only research such as API terms, licenses and library docs.
- **ADRs**: every non-trivial decision is recorded in `docs/adr/NNN-title.md`.

## 5. Error-minimization rules
- **Contract-first, generated types**: Rust ↔ TS bindings come from tauri-specta. Every file read is validated with zod (TS) and serde (Rust), and every schema has a version and tested migrations.
- **Strictness**:
  - TypeScript `strict` and `noUncheckedIndexedAccess`; ESLint `typescript-eslint` strict; Prettier.
  - Rust `clippy -D warnings`, `rustfmt`, `#![forbid(unsafe_code)]` except in the native plugin.
  - Lockfiles committed; `cargo deny` and `npm audit` in CI.
- **Test layers**:
  - unit tests (vitest, `cargo test`);
  - **property tests** (fast-check, proptest) for the journal, atomic writes, the ledger, scene split and mark anchoring;
  - **fault injection** for saving (kill -9 mid-write, disk full, read-only, file changed externally);
  - **golden-file tests** for exports (EPUB through **epubcheck**, PDF page geometry and text via a parser, DOCX XML diff);
  - **fuzzing** for importers (short `cargo-fuzz` runs in CI);
  - component tests (Testing Library) and accessibility checks (axe-core);
  - **E2E** with WebdriverIO and `tauri-driver` on Linux/Windows, plus a macOS smoke launch;
  - **performance**: a 500k-word project must stay under 16 ms per keystroke and open in under 2 s.
- **CI (GitHub Actions)**:
  - every push runs a matrix on **ubuntu, macos and windows**: lint, typecheck, unit, Rust tests and build;
  - E2E runs on ubuntu;
  - the **unsigned macOS `.app`/`.dmg`** is uploaded as an artifact.
  - `main` is protected: green CI is required.
- **Feature flags** keep unfinished features hidden, so `main` is always usable.
- **Spikes before commitments** (M0, each with a go/no-go ADR): vertical text in ProseMirror on WebKit; Typst crate compile time and fonts; foliate-js in WKWebView/WebKitGTK; the macOS Speech plugin (built in macOS CI); `.scriv` parsing on sample projects; FTS5 encyclopedia size and speed.
- **Data-safety invariants**, tested on every milestone:
  - no user file is written outside `storage`;
  - imports never touch the source;
  - deleting a pack never touches projects;
  - every save is recoverable from history or the journal.
- **`CLAUDE.md` in the repo** holds conventions, the Definition of Done and the reviewer checklist.
- **Definition of Done**: tests written first and passing; lint and type checks clean; reviewed; accessible (keyboard plus labels); docs and ADR updated; CI green on all three OSes.
- **Small steps**: tracks merge in small commits with Conventional Commit messages. No track runs longer than one milestone without integrating.

## 6. Milestones (Release 1)
Each milestone ends with a usable app and a macOS CI artifact. Tracks within a milestone run in parallel in separate worktrees. "Accept" lists the gate tests.

**M0: Scaffold & spikes**
- A: repo scaffold, Tauri 2 + React + Vite, tauri-specta, lint/format, `CLAUDE.md`, CI matrix and macOS artifact, feature-flag system.
- B: editor spikes (TipTap baseline, RTL, vertical writing on WebKit).
- C: Typst crate PDF, foliate-js EPUB view, FTS5 encyclopedia prototype.
- D: macOS Speech plugin (dictation and read-aloud), `.scriv` parser prototype.
- Accept: CI green on 3 OSes; downloadable Mac app opens; one ADR per spike with a go/no-go.

- **M0 status: done** (report: `docs/milestones/M0-report.md`). Spike verdicts:
  - vertical editing on WebKit: **No-go** (ADR 001);
  - Typst PDF: **Go-with-conditions**; the app-size cost needs a user decision (ADR 002);
  - foliate-js: **Go-with-conditions** (ADR 003);
  - FTS5 encyclopedia: **No-go as designed**; a revised path needs a decision before M7-B (ADR 004);
  - macOS speech: **pending the user's Mac test** (ADR 005);
  - `.scriv` parser: **Go** (ADR 006);
  - toolchain/CI: **Go** (ADR 007).

**M1: Write & save (first usable app)**
- A (`storage/`): atomic writes, journal and recovery, snapshots and retention, local backups with test-restore, file watcher with external-change "both versions" prompt.
- B (`contracts`, data layer): project folder schema, migrations, autosave/⌘S orchestration, status dot.
- C (`editor/`): calm editor, focus modes, free pages and scenes, LTR/RTL, split view, back/forward trail, basic ⌘K palette.
- D (`ideas/`): Idea Shelf, quick capture, night notes, scraps, voice notes (macOS plugin).
- Accept:
  - fault-injection suite (kill mid-save → no corruption, journal restores the last keystrokes);
  - restore is byte-exact;
  - external change is never overwritten;
  - typing a 500k-word benchmark stays under 16 ms;
  - E2E: write → quit → crash → reopen → nothing lost.

**M2: Personal space & sparks**
- A (`personalize/`): preset system (preset + "make your own" + export/import), themes, typography and multilingual font packs (Noto, on demand), places.
- B (`personalize/music`): your own files/playlists, generated ambience mixer, per-project sound.
- C (`spark/engine`): randomizer (banks × templates), never-repeat ledger, variety balancer, custom decks, Save-to-Ideas.
- D (`spark/sources`): offline quotes/passages (Gutenberg-verified via `verify-sources`), image starter set with mood/genre/era tags, source picker and source sets, live sources with cache, Walk Break, Craft Library core.
- Accept:
  - 100k deals per generated type with zero repeats and the balance within tolerance;
  - every quote cites author, work, location and link;
  - offline mode works;
  - the theme and font apply everywhere.

**M3: Plan & write-first**
- A: outline and board with two-way manuscript link.
- B: timeline, character tracker, continuity checks.
- C: story bible, structure presets, Fiction/Non-fiction project-type toggles.
- D: auto-split, reverse outline, bridge cards, setup→payoff threads.
- Accept:
  - a seeded 90k-word draft splits correctly and the reverse outline finds the right characters;
  - board reorder = manuscript reorder (property-tested);
  - seeded continuity errors are flagged.

**M4: Revise**
- A: mark system (ProseMirror marks, preset and custom types, anchoring through edits) and Review panel.
- B: snapshots compare/restore (paragraph-level).
- C: margin notes, non-fiction fact-check marks and footnotes.
- Accept: marks survive 10k random edits (property test); restore is exact; the Review panel's filters are correct.

**M5: Publish & Reader View**
- A (`compile/typst`): compile model, print PDF with trim sizes and book-design presets, Standard Manuscript Format, front matter, metadata.
- B (`compile/epub`): EPUB 3 with epubcheck in CI, plus the foliate-js Reader View.
- C (`compile/docx`): DOCX export.
- D (`compile/preflight`): preflight, cover template (spine from page count), counts and stats.
- Accept:
  - epubcheck passes with no errors;
  - PDF golden tests pass (trim, margins, page count);
  - the preview equals the exported file;
  - preflight catches every seeded problem;
  - LTR/RTL exports are correct.

**M6: Import**
- Orchestrator first builds the shared import-preview UI and import model.
- A: Scrivener (binder, synopses, notes, labels, comments, snapshots).
- B: DOCX (comments, tracked changes), ODT, RTF.
- C: Markdown folders, Fountain/FDX, Plottr, TXT.
- Accept: fixture projects import with structure intact; sources are hash-checked as unchanged; fuzzers run clean.

**M7: Packs & Detox**
- A (`packs/`): manifest format, validator (license fields required), Pack Manager (sizes, layers, disk budget, external-drive location), Detox Mode (network kill-switch, verified).
- B (`scripts/`): pack builders (Gutenberg texts, top-pageview Wikipedia → FTS5, image thumbnails), size reports.
- C: content for Fantasy, Romance and Mystery/Thriller Lite packs: banks, tropes, structures, generators and Unstuck trees, drafted and labeled.
- D: Pack Creator UI and universal pack tools subset (character builder, scene builder, setup/payoff tracker, research parking lot, random tables).
- Accept:
  - with Detox on, zero network requests;
  - every layer works offline;
  - Lite sizes are within 10% of estimates;
  - an invalid community pack is rejected;
  - deleting a pack leaves projects intact.

**M8: Hardening & Release 1**
- A: vertical writing in preview/export (editing was a No-go in M0, ADR 001; it can be reopened only with a custom caret layer and a new spike), plus language font packs completed.
- B: accessibility pass (VoiceOver, keyboard, contrast) and performance pass.
- C: full E2E journey (idea → plan → draft → marks → EPUB/PDF), macOS `.dmg` artifact, user guide.
- Accept: all gates green on 3 OSes; the user signs off after testing the Mac build.

## 7. Running it on your Mac
- **Easiest, no tools needed**:
  1. Open the repo's **Actions** tab, pick the latest green run, and download the macOS artifact.
  2. Unzip it and right-click → Open (it's unsigned, so macOS asks once).
- **From source** (optional): install Node and Rust, then run `npm install` and `npm run tauri dev`.
- **Disk**: the app is ~10–30 MB; packs are Lite and download only when you ask.

## 8. After Release 1 (roadmap)
In this order:
1. Automerge two-device merging
2. Polish analyzers (dialogue-aware)
3. Feedback (reader packet, track changes, DOCX round-trip)
4. Zotero and the full non-fiction toolkit
5. Standard/Complete pack sizes and the remaining genre packs (sci-fi, horror, historical, thriller, literary, poetry, memoir…)
6. Other project types (short stories, series, screenplay, picture book, comics, interactive fiction, academic, essays, journal, fan fiction, worldbuilding/TTRPG, game narrative, audio drama, textbook, cookbook, songwriting, speech, translation)
7. 3D book preview and device frames, webnovel presets
8. Mobile companion
9. UI translations

Details are in the Appendix.

## 9. Before Commercializing (parked)
- **Licensing**: commercially reusable content only (PD, CC0, CC BY, CC BY-SA); exclude non-commercial sources unless licensed (e.g., verify the Old Bailey license); public-domain status per country; a build check that fails on unknown/NC licenses; legal review.
- **Content**: human editing of AI-drafted prompt banks, tropes and summaries.
- **Business**: one-time price; pack CDN with optional P2P; possible paid packs.
- **Trademark**: proper search (US mark "INKSPARKS", serial 97582239, belongs to a printing-consumables firm; a small Devpost project also uses "InkSpark").
- **Distribution**: code signing and notarization; usability beta; UI translations.

---

## Appendix: Feature reference (the full vision, from planning)

**Writers' complaints addressed:**

| Complaint | Answer |
|---|---|
| Steep learning curve (Scrivener, Campfire, Novelcrafter) | Progressive disclosure and plain-language ⌘K. |
| Unpredictable compile | Live preview plus preflight. |
| Broken sync and no Android version | One file per scene now, Automerge later, mobile later. |
| Subscriptions | One-time price; plain files. |
| Data loss and lockouts | Save stack, verified backups, no account. |
| AI-training fears | No cloud, no telemetry; Detox switch. |
| Lag on long manuscripts | Per-scene files and a virtualized editor (500k-word budget). |
| Fragmented tools and Mac-only Vellum | One app, cross-platform, Typst. |
| No collaboration | Reader packet, DOCX round-trip. |
| Switching cost | Importers. |
| Cluttered worldbuilding | Simple bible. |
| Non-fiction neglected | Toolkit and Zotero. |
| Distraction | Focus mode. |
| Grammar tools flatten voice | Dialogue-aware analyzers, voice profiles. |
| KDP rejections | epubcheck, retailer presets, cover template. |
| Missing undo | Universal undo. |
| Bloat | Project types. |
| No mobile | Companion app. |
| Accessibility | Dyslexia fonts, screen readers, voice typing. |
| Citations | Zotero. |
| Final Draft cost | Built-in screenplay. |
| Comic scripts | Auto page/panel numbering. |
| Twine/articy | Open-data branching. |
| Overleaf | Local Typst. |
| Day One | Local journal. |
| World Anvil | Offline worldbuilding. |
| Script hotkeys | One Tab/Enter flow. |
| Vendor trust | Open format. |

**Stages** (never forced): Spark → Plan → Draft → Revise → Polish → Feedback → Publish.

**Sparks**: 35+ types in 6 families (See, Read, World, Words, What-if, Craft & senses, plus Yours).
- Never-repeat ledger and variety balancer; custom decks.
- Images come from 20 open-access collections (museums, LoC, NYPL, BL, BHL, Rumsey maps, Wikimedia, NASA), filtered by era, genre/subject, mood (color analysis + keywords + learning from your re-tags), region, medium and color, and saved as image sets.
- Source picker by type, era, topic, region, author or book (Gutenberg catalog), or your own books. Sacred texts each carry translation and verse citations: Tanakh, Bible, Qur'an, Talmud, Gita, Vedas, Upanishads, Ramayana, Mahabharata, Dhammapada/Pali Canon, Tao Te Ching, Zhuangzi, Analects, Guru Granth Sahib (license to confirm), Avesta, Jain Agamas, Kojiki, Book of Mormon, Bahá'í writings.
- Research basis: Thrash & Elliot; Mehta & Zhu 2009; Mehta, Zhu & Cheema 2012; Oppezzo & Schwartz 2014.

**Craft Library**: 250+ guides by genre, topic and tradition.
- Public-domain classics in full (Aristotle, Horace, Longinus, Wordsworth, Shelley, James, Besant, Stevenson, Bennett, Lubbock, Wharton, Freytag, Archer, Poe, Chekhov, Strunk, Polti, Knox, Van Dine, Pound…).
- Modern methods summarized with links.
- World traditions.
- How famous writers worked, with "try this method".
- Your own guides.

**Genre packs**: 12 layers each: library, annotated examples, offline encyclopedia (top-viewed articles), image atlas, prompt decks, linked generators, tropes with subversions, structures, reference tools, craft course with exercises, Unstuck guide, atmosphere.
- Sizes: Lite / Standard / Complete; mix-and-match layers; disk budget; external drive; nothing big downloads automatically.
- Universal tools: character builder, scene builder, tension graph, arc shapes, setup/payoff, motif tracker, dialogue lab, sensory sheet, reader-promise check, opening/ending lab, title/logline/blurb workshop, research parking lot, random tables.
- Deep packs:
  - **Sci-fi**: planet → species → culture generators; relativity/orbit calculators; tech tree; future timeline.
  - **Fantasy**: magic-system builder; map canvas; dynasty tree; conlang lexicon; magic consistency check; calendar.
  - **Horror**: dread curve; monster rules.
  - **Mystery**: clue tracker; suspect board; evidence chain; fair-play audit; Old Bailey records (license check).
  - **Romance**: couple generator; relationship timeline; trope combiner; POV balance.
  - **Historical**: Chronicling America; era lexicon; anachronism check; real-events overlay; "who's alive".
- Other packs: thriller, literary, western/adventure, humor, children's/YA, poetry (meter/rhyme/form checker via the CMU dictionary), non-fiction, memoir, screenplay, comics, interactive fiction, worldbuilding/TTRPG, fan fiction, essays, songwriting (chord player), cookbook, speech, academic, journal, translation.
- Always-on pack: general deck, Craft Library, top-viewed Wikipedia (5k/50k/300k), Wiktionary, Wikiquote, great-books shelf, word and name banks.

**Project types**: Fiction, Non-fiction, Memoir, Poetry, Screenplay/stage, Webnovel, Short stories/anthology, Picture book, MG/YA, Comic script, Interactive fiction, Game narrative, Audio drama, Fan fiction, Series, Worldbuilding/TTRPG, Essays/blog, Journal, Academic, Textbook, Cookbook, Songwriting, Speech, Translation, Custom (savable as your own type).

**Revise / Polish / Feedback**:
- Marks: Review, Edit, Check, Change, Expand, Cut, Rewrite, Research, Continuity, Dialogue, Pacing, Question, Keep, plus custom types; Review panel.
- Revision passes; snapshots.
- On-demand analyzers.
- Consistency checker; find & replace; read-aloud.
- Reader copies; DOCX comments/tracked changes; track-changes mode.

**Publish**:
- SMF, DOCX, print PDF (trims, designs, KDP/Ingram presets), EPUB 3, HTML/static site, webnovel paste presets.
- Front/back matter; metadata; cover template; stats; submission kit and tracker.
- Reader View: PDF spreads, EPUB reader, web widths; 3D book later.

**Personalization**:
- Themes; fonts (with multilingual Noto packs and per-script fallback); places; ambience; your own music.
- Presets for every list, plus "make your own"; shareable.
- Writing direction: LTR, RTL, vertical.
