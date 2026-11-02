# .scriv parser fixtures (M0 Track D, ADR 006)

Every fixture here is **hand-written and synthetic**. No real Scrivener project
was available (M0 §6.2, risk R12). Each `<name>.scriv/` directory has a golden
`<name>.expected.json` next to it (except `malformed`, which must fail).

This README is part of the spec. The goldens encode the conventions below, and
`read_project`, `parse_scrivx` and `rtf_to_doc` must follow them exactly.

All files are LF-only and must stay byte-exact (`fixtures/.gitattributes` sets
`-text`). RTF files are 7-bit ASCII. `.scrivx` and `synopsis.txt` are UTF-8.

## Fixtures

| Fixture | What it covers |
|---|---|
| `minimal.scriv` | Draft with 2 texts, plus empty Research and Trash. Synopsis on one text, notes on the other. A final paragraph with no trailing `\par`. |
| `nested.scriv` | Draft → Folder → Folder → Text (3 levels below the Draft). Research holds a `Text` and a `PDF` (`Other("PDF")`). Trash holds a text. `IncludeInCompile=No`, labels and statuses (including a non-contiguous label ID 7), `LabelID`/`StatusID` absent or `-1`, a title with surrounding whitespace, `&amp;` in a title, a `<Collections>` section whose `<Title>`s must not leak into the binder, a folder with a synopsis but no content (no warning). |
| `unicode.scriv` | `\'hh` in cp1252 (`\'93`, `\'94`, `\'80` are not Latin-1), `\uN?` with fallbacks, `\uc0`, a `\'hh` fallback, signed and unsigned surrogate pairs (emoji), an unpaired surrogate, Hebrew. UTF-8 and `&#x2014;` in `.scrivx` titles and label names. A UTF-8 synopsis. |
| `formatting.scriv` | `\b \i \ul` (and `\b0 \i0 \ul0 \ulnone \b1`), groups that restore formatting, `\par`, an empty paragraph, `\\ \{ \}`, `\tab`, `\fonttbl`, `\colortbl`, `\stylesheet`, `\info`, `\pict`, `{\*\…}` groups (ignored), and a footnote `{\*\Scrv_fn …}` kept as inline text. Formatting that carries across `\par`. |
| `missing-content.scriv` | A text with no data directory, a text whose data directory has only `synopsis.txt`, and a text whose `notes.rtf` is not RTF. |
| `malformed.scriv` | A `.scrivx` truncated in the middle of a `<Title>`. `read_project` must return `Err(ScrivError::Xml(_))`. |

## JSON shape

`<name>.expected.json` is `serde_json::to_value(&ScrivProject)` with the
**default** serde derive representation of the §6.2 structs. There are no
`rename` attributes.

- Field names are exactly as declared (snake_case), for example `format_version`, `include_in_compile`, `label_id`.
- `BinderItemKind` is externally tagged. Unit variants serialize as strings (`"DraftFolder"`, `"Text"`). `Other(s)` serializes as `{"Other": "<s>"}`.
- `BTreeMap<i32, String>` keys serialize as JSON strings (`"-1"`, `"0"`, `"7"`).
- `Option::None` serializes as `null`, and absent `Vec`s as `[]`. No field is skipped.
- `Run` is `{"text", "bold", "italic", "underline"}`. `RtfDoc` is `{"paragraphs": [[Run, …], …]}`.

The golden test compares `serde_json::Value`s, so key order and whitespace do
not matter. Values, and the order of arrays, do.

## Package layout (`read_project`)

- `read_project(dir)` reads `dir/<stem>.scrivx`, where `<stem>` is the directory's file stem (`minimal.scriv` → `minimal.scrivx`). If that file does not exist, it uses the first `*.scrivx` directly inside `dir`, in sorted file-name order.
- `Err(ScrivError::NotAScrivPackage(_))` when `dir` does not exist, is not a directory, or contains no `*.scrivx` file directly inside it.
- An XML error in the `.scrivx` gives `Err(ScrivError::Xml(_))`.
- Every file is opened **read-only**. Nothing under `dir` is created, modified, renamed or deleted, and no metadata is written (data-safety invariant 2).
- Per-item files live at `dir/Files/Data/<UUID>/content.rtf`, `synopsis.txt` and `notes.rtf`. `<UUID>` is the `UUID` attribute exactly as written in the `.scrivx`. Any other file (`content.styles`, `Files/version.txt`, `Settings/…`) is ignored, as are data directories that no binder item references.

## Binder (`parse_scrivx`)

- The root element must be `<ScrivenerProject>`. Any other root, an empty document, or malformed XML gives `Err(ScrivError::Xml(_))`. This includes **end of input while elements are still open** (truncation).
- `format_version` is the root's `Version` attribute, or `""` if it is absent.
- `items` are the `<BinderItem>` children of `<Binder>`, in document order. `children` are the `<BinderItem>` children of that item's `<Children>`, in document order, recursively. An item with no `<Children>` has `children: []`.
- `uuid` is the `UUID` attribute (or `""` if absent).
- `kind` maps the `Type` attribute: `DraftFolder`, `ResearchFolder`, `TrashFolder`, `Folder` and `Text` map to the matching variant. Any other value `t` (for example `PDF`, `Image`, `WebArchive`) maps to `Other(t)`, and an absent `Type` maps to `Other("")`.
- `title` is the text of the item's own `<Title>` child, with XML entities and character references decoded, then **trimmed** (`str::trim`). It is `""` if absent. Only an item's direct `<Title>` counts. `<Title>` elements in `<Collections>`, `<LabelSettings>`, `<StatusSettings>` and so on are not binder titles.
- `include_in_compile` is `true` only if the item's `<MetaData><IncludeInCompile>` text, trimmed, equals `Yes`. When it is absent, or holds anything else (`No`), it is `false`.
- `label_id` and `status_id` come from `<MetaData><LabelID>` and `<MetaData><StatusID>`, trimmed and parsed as `i32`. The value is `None` when the element is absent, equals `-1`, or does not parse.
- `Created`, `Modified`, `<TextSettings>` and any other elements are ignored.
- `labels` maps every `<LabelSettings><Labels><Label ID="n">name</Label>` to `n → name.trim()`, **including** `-1` ("No Label"). `statuses` does the same for `<StatusSettings><StatusItems><Status ID="n">name</Status>`. An entry whose `ID` does not parse as `i32` is skipped. If either section is absent, its map is empty.

## Documents and warnings (`read_project`)

- `documents` has **one entry for every binder item at every depth** (folders included), keyed by `uuid`.
  - `content` is `rtf_to_doc(content.rtf)`, or `null` if the file is absent.
  - `synopsis` is the UTF-8 text of `synopsis.txt` (decoded lossily) with trailing whitespace removed (`str::trim_end`), or `null` if the file is absent. Leading whitespace and inner newlines are kept.
  - `notes` is `rtf_to_doc(notes.rtf)`, or `null` if the file is absent.
- `warnings` are exact strings, in **binder pre-order** (an item, then its children, then the next sibling). For a single item, the content warning comes before the notes warning.
  - `missing content for <UUID>`: an item whose `kind` is `Text` has no `content.rtf`, whether or not its data directory exists. Folders and `Other` kinds never get this warning.
  - `invalid rtf in <UUID>/content.rtf` or `invalid rtf in <UUID>/notes.rtf`: `rtf_to_doc` returned an error for that file. The field is then `null`. This is a warning, not an error.
- Missing or unreadable per-item files never make `read_project` fail.

## RTF (`rtf_to_doc`)

General:
- The input must start (after optional ASCII whitespace) with `{\rtf`, otherwise `Err(ScrivError::Rtf(_))`. An empty input is an error.
- It never panics and never overflows the stack, whatever the nesting depth (tests use 50,000 nested groups), so group handling must not recurse per group. Unbalanced braces are tolerated: groups still open at end of input are closed implicitly, and everything after the outer group closes (stray `}`, trailing text) is ignored. A truncated escape at end of input (`\`, `\'e`, `\u`) is ignored.
- Raw CR and LF bytes are ignored (they are not text). A backslash followed by CR or LF is equivalent to `\par`, as in the RTF spec. Fixtures use explicit `\par`.
- A control word is `\` plus ASCII letters, plus an optional signed decimal parameter. As a Scrivener extension, a name that starts with `Scrv` also takes `_` and further letters, so `\Scrv_fn` is one control word. One space directly after it is a delimiter and is consumed. Any other terminator is not consumed.
- Unknown control words and control symbols are ignored.

Text:
- `\\`, `\{` and `\}` produce `\`, `{` and `}`. `\tab` produces a tab character (U+0009). Nothing else produces whitespace beyond the literal text.
- `\'hh` decodes one byte through the document code page, from `\ansicpgN`. The default is 1252, and only cp1252 is required (`\'93` → `“`, `\'80` → `€`, `\'e9` → `é`). An unknown or unsupported code page falls back to cp1252; it is never an error. Raw bytes ≥ 0x80 in text decode the same way.
- `\uN` produces the code point `N`. If `N` is negative, add 65536. Then skip the next `\ucN` fallback characters (the default is 1). A fallback character is one literal text byte or one `\'hh` escape. `\ucN` is group-scoped, like formatting.
- UTF-16 surrogates: a high surrogate followed directly by a `\uN` low surrogate is combined into one code point. An unpaired surrogate becomes U+FFFD.

Destinations (ignored entirely, including their text and nested groups):
- any group that starts with `{\*\…}` (for example `\expandedcolortbl`, `\listtable`, unknown ones), **except** `{\*\Scrv_fn …}`;
- groups that start with `\fonttbl`, `\colortbl`, `\stylesheet`, `\info` or `\pict`.

Footnotes:
- `{\*\Scrv_fn …}` is treated as an ordinary group. Its text is emitted inline, where it occurs in the current paragraph, with the normal formatting rules and no added delimiters.

Formatting:
- `\b` or `\bN` (N ≠ 0) turns bold on and `\b0` turns it off. The same goes for `\i`/`\i0`. `\ul`/`\ulN` turns underline on, and `\ul0` or `\ulnone` turns it off. `\plain` turns all three off.
- `{` saves the formatting state and `\uc` value, and `}` restores them. `\pard` and `\par` do **not** change character formatting, so formatting carries across paragraphs.
- Font, size, colour and paragraph control words (`\f`, `\fs`, `\cf`, `\pard`, `\tx`, …) are ignored. They do not split runs.

Paragraphs and runs:
- `\par` ends the current paragraph. A paragraph with no text is `[]`, and it is kept when it lies between two `\par`s.
- The paragraph still open at end of input is kept if it has text, and **dropped if it is empty**. So `…text\par}` gives no trailing empty paragraph, and `…text}` keeps `text` as the last paragraph.
- A `Run` is a maximal stretch of text with identical `(bold, italic, underline)`. Adjacent runs with identical formatting are always merged, even across groups or ignored control words. Runs never have empty `text`.
- `RtfDoc::plain_text()` concatenates each paragraph's run texts and joins the paragraphs with `"\n"`.
