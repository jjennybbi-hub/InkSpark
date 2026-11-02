# 007 — Toolchain, CI and E2E

Status: Proposed · Date: 2026-11-02 · Track: M0-A

## Context
Every later milestone builds on the M0 scaffold: one Cargo workspace, one npm workspace root,
strict lint and type checks, generated Rust ↔ TS bindings, and a CI that builds the app on
ubuntu, macOS and Windows and ships an unsigned macOS app the user can try (PLAN.md §3, §5;
M0.md §3). This ADR records the versions chosen, the E2E decision, how the dmg is produced, the
macOS target and the CSP.

## Hypothesis
The pinned set in M0.md §3.2 (Tauri 2.12, tauri-specta/specta rc.26, React 18, TS 5.9, Vite 8,
ESLint 10, Vitest 5, WebdriverIO 10) resolves, compiles and passes the full local gate, so no
fallback versions are needed.

## Method
- Local (Linux container, Node 22.23, Rust 1.97.0, WebKitGTK 4.1): `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm test`, `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`,
  `npm run bindings:check`, `npm run tauri build -- --ci --no-bundle`, `cargo deny check`,
  `npm audit --audit-level=high`, plus a 12 s launch of the release binary under `xvfb-run`.
  Workflows were checked with actionlint.
- CI: `.github/workflows/ci.yml` (gates) and `spikes.yml` (measurements). Run links are added
  by the Orchestrator.

## Criteria and results
| Metric | Threshold | ubuntu | macos | Pass |
|---|---|---|---|---|
| Pinned versions resolve and compile together | yes | yes (local) | CI | local yes |
| Local gate (all commands above) | green | green (local) | CI | local yes |
| `check` job | green ×3 | CI | CI | pending CI |
| `build-macos` smoke (alive 15 s) | yes | — | CI | pending CI |
| `e2e-linux` | green | CI | — | pending CI |
| `audit` | green | green (local) | — | local yes |

### Versions (resolved, from the lockfiles)
| Rust crate | Version | | npm package | Version |
|---|---|---|---|---|
| toolchain | 1.97.0 (`rust-toolchain.toml`) | | Node | 22 (CI), `engines >=22.12` |
| tauri / tauri-build | 2.12.5 / 2.7.4 | | @tauri-apps/cli, /api | 2.12.4 |
| tauri-specta | =2.0.0-rc.26 | | react, react-dom | 18.3.1 |
| specta | =2.0.0-rc.26 | | typescript | 5.9.3 |
| specta-typescript | =0.0.13 | | vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 |
| specta-serde / specta-util (transitive) | 0.0.13 / 0.0.13 | | eslint / typescript-eslint | 10.14.0 / 8.72.1 |
| serde / serde_json / thiserror | 1.0.229 / 1.0.154 / 2.0.21 | | eslint-plugin-react-hooks | 7.1.1 |
| tauri-driver (CI) | 2.1.0 | | prettier | 3.9.10 |
| | | | vitest / jsdom | 5.0.5 / 30.1.3 |
| | | | @testing-library/react, /dom, /jest-dom, /user-event | 16.3.3, 10.4.2, 7.0.1, 14.6.8 |
| | | | axe-core | 4.14.0 |
| | | | webdriverio, @wdio/* | 10.1.0 |

The §3.2 pins worked as written: tauri-specta rc.26 requires `specta =2.0.0-rc.26`, and
specta-typescript 0.0.13 is the last release on rc.26 (0.0.14 moves to rc.27). No fallback
(Vite 7 / plugin-react 5) was needed.

## Decision
**Go** with the §3.2 set, pending green CI.

### E2E: included, required, ubuntu only
- WebdriverIO 10 + `tauri-driver` 2.1.0 + WebKitWebDriver (`webkit2gtk-driver`) under
  `xvfb-run`, against `target/debug/inkspark` built with `tauri build --debug --no-bundle`.
- `e2e/wdio.conf.ts` starts `tauri-driver` in `beforeSession`, waits for port 4444, and kills it
  in `afterSession`. It sets `wdio:enforceWebDriverClassic` because tauri-driver does not speak
  WebDriver BiDi, which WebdriverIO 9+ requests by default.
- It cannot run in the cloud container (no WebKitWebDriver; installing it is not allowed), so
  developers rely on CI for it.
- Fallback: if the job flakes twice during M0 for infrastructure reasons, it becomes
  non-required with a note here and is fixed in M1.

### macOS target and dmg
- Target `universal-apple-darwin` (risk R9: the user's Mac CPU is unknown). CI adds
  `aarch64-apple-darwin` and `x86_64-apple-darwin`.
- The `.app` is built first (`--bundles app`), smoke-launched for 15 s, zipped with
  `ditto -c -k --keepParent` and uploaded as `InkSpark-macos-universal-unsigned`
  unconditionally.
- The `.dmg` is built in a separate step (`--bundles dmg`) with a 20-minute timeout and one
  retry (risk R3). On success the artifact is re-uploaded under the same name
  (`overwrite: true`) holding the `.app` zip and the `.dmg`. The Finder/AppleScript styling in
  `bundle_dmg.sh` is the usual source of hangs; the Tauri bundler is believed to skip it when
  `CI` is set (GitHub sets `CI=true`), which could not be confirmed locally. If the dmg still
  fails twice, the fallback is a plain `hdiutil create` step, recorded here.
- The app is unsigned. On first launch the user right-clicks → Open (Gatekeeper).

### CSP
Exactly as M0.md §3.1:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: blob: data:; font-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost`.
No `unsafe-eval`. Only `core:default` is granted; no Tauri plugins are registered.

### Implementation notes and deviations from M0.md
- **`typecheck` script.** `npm run typecheck --workspaces --if-present` exits 1 with
  "No workspaces found" while no `spikes/*/package.json` exists. `typecheck` therefore runs
  `tsc -b && npm run typecheck:spikes`, and `typecheck:spikes` runs the workspace command only
  when a spike package exists (a portable `node -e` guard; it still fails when a workspace's
  typecheck fails). The Orchestrator restored the exact §3.6 form at the M0 stub step, once
  `spikes/editor-text` and `spikes/foliate-view` had a `package.json`.
- **Spike job skipping.** `hashFiles()` is not available in a job-level `if`, so `spikes.yml`
  has a `detect` job that evaluates `hashFiles(...)` in a step and exposes outputs; each spike
  job has `needs: detect` and `if: needs.detect.outputs.<spike> == 'true'`.
- **ESLint and virtual paths.** The TypeScript project service only assigns files that exist on
  disk to a tsconfig, so `lintText` with `src/x.ts` or `spikes/editor-text/src/x.ts` would be a
  fatal parse error. `eslint.config.js` computes `allowDefaultProject` globs that match only
  top-level files a tsconfig cannot claim (non-existent files, and spikes without a
  tsconfig.json), with `defaultProject: tsconfig.app.json`. Existing files are excluded because
  typescript-eslint rejects a file that is both default-project and in a tsconfig. Verified
  with and without a simulated spike tsconfig.
- **fs-write ban hardening.** The ban covers `{ts,tsx,mts,cts,js,jsx,mjs,cjs}` under `src/` and
  `spikes/*/src/`, catches template-literal `import()`/`require()`, and bans `module`/
  `node:module` (`createRequire`). Inline eslint comments are disabled there
  (`noInlineConfig`), so the ban cannot be silenced; unused disable directives are errors
  everywhere. Frontend `.js` files use the TypeScript parser without type information.
- **Spikes before their stub.** Spike tests were committed before any spike `package.json`.
  Existing files of spikes without a `package.json` are left out of the root ESLint run (listed
  from disk, so virtual paths are still linted), matching the typecheck and vitest guards. Once a
  spike gets its stub, its tsconfig must include its `tests/` and `fixtures/` TypeScript too.
- **Lint config for committed tests.** `no-irregular-whitespace` uses `skipRegExps` (the tests
  strip a BOM with a literal U+FEFF in a regex), and `no-unnecessary-condition` is off in test
  and E2E files (they guard `textContent ?? ""`, which lib.dom types as non-null).
- **Prettier ignores.** `PLAN.md`, `README.md`, `CLAUDE.md` and `docs/**/*.md` (hand-aligned
  tables), `spikes/*/fixtures/` (byte-exact goldens), `tests/lint/fs-write-ban.test.ts` and
  `tests/config/strictness.test.ts` (committed with one non-Prettier line break; implementers
  may not edit tests). The latter entry should be removed after the Orchestrator reformats it.
- **`bindings_ts()`** renders through a unique scratch file in the OS temp dir, because
  tauri-specta rc.26 exports only to a path. Output is LF-normalized.
- **CI triggers.** `push` to `main` and `claude/**`, `pull_request` to `main`, and
  `workflow_dispatch` (both workflows).
- **dmg retry hygiene.** Before the retry, CI force-detaches `/Volumes/InkSpark` and removes
  leftover `rw.*.dmg`/partial `.dmg` files. The `.app` zip and upload run whenever the build
  step succeeded, even if the smoke launch failed (the job still fails).
- **Spike jobs** export `SPIKE_OS`/`RUNNER_OS_LABEL` (the matrix OS label), `spike-typst` passes
  `--size-report target/release/size-baseline` and runs its ignored tests, and `spike-scriv`
  runs the release `perf` test. The `check` job runs the scriv property tests with
  `PROPTEST_CASES=2000` once that crate exists.
- **Rust toolchain in CI** is installed with `rustup toolchain install 1.97.0` (explicit, so it
  does not depend on rustup's auto-install behaviour) and then selected by
  `rust-toolchain.toml`.
- **Tauri `version`** is `"../package.json"`, so the app version has one source; the Cargo
  package version is kept equal (checked by `tests/config/versions.test.ts`).

### Accepted advisory exceptions
- cargo-deny ignores two *unmaintained* (not vulnerable) advisories with no fixed version:
  RUSTSEC-2024-0436 (`paste`, via specta) and RUSTSEC-2024-0370 (`proc-macro-error`, via
  gtk-rs `glib-macros` 0.18 in the Linux webview stack). Revisit at each Tauri/specta upgrade;
  expiry: end of M2.
- `npm audit --audit-level=high` passes. 26 moderate advisories remain, all in the
  WebdriverIO 10 dev-dependency tree (`glob`/`minimatch` via `@wdio/config`); the only offered
  fix is a downgrade to WebdriverIO 9. They affect the E2E tooling only, never the shipped app.
  Revisit when WebdriverIO publishes a fix; expiry: end of M2.

### npm licenses outside the allow-list (dev-only, not shipped)
All of these come from dev tooling (Vite/Browserslist, WebdriverIO, jsdom, ESLint); none is in
the shipped frontend bundle, which contains only React, react-dom and @tauri-apps/api (MIT):
CC-BY-4.0 (`caniuse-lite`, `@promptbook/utils`), Unlicense, PSF-2.0, MIT-0, `jszip` (dual
MIT/GPL-3.0, MIT elected), `pako` (MIT AND Zlib), CC-BY-3.0 (`spdx-exceptions`) and `css-value`
(no license field in its package.json). Revisit if any of them moves into runtime dependencies.

## Consequences
- tauri-specta, specta and specta-typescript upgrades go only through the Orchestrator, with
  regenerated bindings (risk R1). `npm run bindings:check` fails CI if they drift.
- After A is integrated, the root config files listed under A in M0.md §2.1 are
  Orchestrator-owned.
- M1's "write → crash → reopen" E2E reuses `e2e/wdio.conf.ts`.

## Dependencies added
| Name | Version | License | Reason |
|---|---|---|---|
| tauri, tauri-build | 2 | MIT OR Apache-2.0 | App shell (PLAN §3) |
| tauri-specta, specta, specta-typescript | =2.0.0-rc.26, =2.0.0-rc.26, =0.0.13 | MIT | Generated TS bindings (PLAN §3) |
| serde, serde_json, thiserror | 1, 1, 2 | MIT OR Apache-2.0 | Serialization and typed errors |
| react, react-dom, @tauri-apps/api | 18, 18, 2 | MIT, MIT, MIT OR Apache-2.0 | Frontend |
| typescript, vite, @vitejs/plugin-react | 5.9, 8, 6 | Apache-2.0, MIT, MIT | Build |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals, prettier | see table | MIT | Lint and format |
| vitest, jsdom, @testing-library/*, axe-core | see table | MIT, MIT, MIT, MPL-2.0 | Unit, component and a11y tests |
| webdriverio, @wdio/*, @types/mocha | 10 | MIT | E2E |
| @tauri-apps/cli | 2 | MIT OR Apache-2.0 | Build tooling |

## Follow-ups
- Fill in CI run links and flip to Accepted once `check` ×3, `build-macos`, `e2e-linux` and
  `audit` are green (Orchestrator, M0).
- Remove the `tests/config/strictness.test.ts` Prettier ignore after reformatting (M0).
- Revisit the two advisory exceptions (M2).
- Replace the placeholder ink-drop icon with a designed one (before Release 1).

## Links
- CI run: _to be added by the Orchestrator_
- Artifact: `InkSpark-macos-universal-unsigned` (`InkSpark-macos-universal.app.zip`, `.dmg`)

## Integration fixes (Orchestrator, first CI run)
- **`export-bindings` is a Cargo example, not a `[[bin]]`.** The Tauri bundler copies every `[[bin]]` into `InkSpark.app`, and the universal build only compiles the main binary, so bundling failed. Run it with `cargo run -p inkspark --example export-bindings` (same npm scripts).
- **Windows app manifest for every target.** `tauri-build` embeds the comctl32 v6 manifest only into binaries. Test executables that link Tauri then exit with `STATUS_ENTRYPOINT_NOT_FOUND`. `build.rs` now uses `WindowsAttributes::new_without_app_manifest()` and embeds `src-tauri/windows-app-manifest.xml` into all MSVC targets with `/MANIFEST:EMBED /MANIFESTINPUT`.
