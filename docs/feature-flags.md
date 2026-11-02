# Feature flags

Unfinished features stay behind flags so `main` is always usable (CLAUDE.md, PLAN.md §5).
Flags live in [`src/app/flags.ts`](../src/app/flags.ts). In M0 they are **build-time and
frontend-only**.

## Current flags

| Flag | Feature | Accepted in |
|---|---|---|
| `verticalWriting` | Vertical writing modes in the editor | M8 |
| `readerView` | foliate-js Reader View | M5 |
| `dictation` | macOS dictation | M1 |
| `readAloud` | macOS read-aloud | M4 |
| `scrivenerImport` | Scrivener importer | M6 |
| `encyclopedia` | Pack encyclopedia search | M7 |

Every flag defaults to `false`.

## The rule

A flag's `default` stays `false` until the milestone named in its `milestone` field accepts the
feature (its gate tests pass and it is reviewed). The type `FlagDefinition` has
`default: false`, so turning a default on is a deliberate change to that type, made in the
accepting milestone. After acceptance, the flag and its checks are removed rather than left on.

## Turning flags on for a build

Set `VITE_INKSPARK_FLAGS` when running or building:

```sh
VITE_INKSPARK_FLAGS="readerView,-dictation" npm run tauri dev
```

Syntax:

- Comma-separated. Whitespace around names is ignored.
- `name` enables a flag; `-name` disables it.
- A later entry for the same flag wins: `readerView,-readerView` leaves it off.
- Unknown names are ignored (they are collected by `parseFlagOverrides`, never thrown).
- Empty or whitespace-only input changes nothing.

On Windows (PowerShell): `$env:VITE_INKSPARK_FLAGS="readerView"; npm run tauri dev`.

Because flags are read through `import.meta.env`, the value is fixed when Vite builds the
frontend. Changing it needs a rebuild or a dev-server restart.

## Reading a flag

```ts
import { isEnabled } from "../app/flags";

if (isEnabled("readerView")) {
  // render the Reader View entry point
}
```

`flags` is a frozen object with every flag; `resolveFlags(raw)` is the pure function behind it
and is what tests use.

## Adding a flag

1. Add an entry to `FLAG_DEFINITIONS` in `src/app/flags.ts` with `default: false`, a short
   `description` and the accepting `milestone` (`"M<n>"`).
2. Add a row to the table above.
3. Guard the feature's entry points with `isEnabled("<name>")`.
4. `src/app/flags.test.ts` covers every flag automatically (default off, description present,
   milestone format).

If Rust ever needs to see a flag, that is a contract change: ask the Orchestrator rather than
adding a Rust-side copy.
