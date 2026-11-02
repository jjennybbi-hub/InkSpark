# Vendored: foliate-js

- **Upstream:** https://github.com/johnfactotum/foliate-js
- **Commit:** `78914aef4466eb960965702401634c2cb348e9b1` (committed 2026-05-01)
- **Vendored on:** 2026-11-02 (M0, Track C, ADR 003)
- **License:** MIT (`LICENSE`, copied from upstream). Sub-dependencies below.
- **Local modifications:** none. Every file is byte-identical to upstream at the commit above.

> Never use the npm package named `foliate-js`: it is published by an unrelated party.
> InkSpark only uses this upstream copy.

## Files

Copied from the upstream repository root unless noted. These are `view.js` and every module
it imports, statically or lazily, except the PDF adapter.

| File | Role | SHA-256 |
|---|---|---|
| `LICENSE` | MIT license (upstream) | `b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c` |
| `view.js` | `<foliate-view>` element, `makeBook` | `e0093af921feb03bb58fb51aeedc321fa108a4158d215f6913ecf7925415c945` |
| `epub.js` | EPUB parser and resource loader | `dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298` |
| `epubcfi.js` | EPUB CFI | `e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645` |
| `paginator.js` | `<foliate-paginator>` (reflowable layout) | `51cec81572d5d182e231fe68ce9c3b5489a0976b36172060516336ba893565ea` |
| `fixed-layout.js` | `<foliate-fxl>` (pre-paginated layout) | `7aee1d15d8e0479b8a6c59a20304b250dafc4c7dc158147a2b2c6bed9e180b4c` |
| `progress.js` | TOC and section progress | `544f5e90babc0cb31c5caf971a5f06dd6249ec06600cb62f672fa7179811fde1` |
| `overlayer.js` | Annotation overlays | `d3d3396e3083277ccbd4f17c407621159b22a407107e43ce75ca3014578094fb` |
| `text-walker.js` | Text node walker (search) | `4ad740ab6142b5be428700ef4d270253cef6649cf6e047ae7d2698a7aec65e92` |
| `search.js` | Search matcher | `31e846bdc095a645de0e94f7baa2c9e136561a363a2f774d4032e72cfa1fb0ef` |
| `tts.js` | Text-to-speech SSML helper | `530d34605b758a5e2260438964a85bb9909bcb49e8848e303fe22cac63859026` |
| `footnotes.js` | Footnote handler (used by apps, not by `view.js`) | `d377b45d2ac05290c42873612ec0a92e640938e8be8ed850a467133a883388de` |
| `comic-book.js` | CBZ support (lazy) | `7f3bf77561ca77300d5244015fcb1f73805787db246928074dc49fb56c88762e` |
| `fb2.js` | FB2 support (lazy) | `09a7890bf191f1b6c6dd435fae2868b86c75e73e00731b0051c02f2a998a180a` |
| `mobi.js` | MOBI/AZW3 support (lazy) | `016526df13a9f11ee6671a8c74346e1cf41fe6bdfe50165fdcbf744f015694f3` |
| `vendor/zip.js` | zip.js 2.8.22 (minified upstream build) | `2a0d43157e4a447c6e43351225758795b75a33e8dfec10c6767248df2182949a` |
| `vendor/fflate.js` | fflate 0.8.2 `unzlibSync` (minified upstream build) | `e63bcc21f83a43e5f71d5cbefd351ff4d4dbd57bef8b29ad65c8bd65752f6e6b` |
| `vendor/LICENSE-zipjs` | zip.js license (BSD-3-Clause) | `1b7ebc8d7889ed25491484ab2b102370742ca6c0b26650a0c62cc2269b579b84` |
| `vendor/LICENSE-fflate` | fflate license (MIT) | `805f6cb28bb8b6d3a0badd83c93bccd9671fa01a3b4b92b7042b0743325ac243` |

### Sub-dependencies

Upstream builds `vendor/zip.js` and `vendor/fflate.js` with Rollup and terser
(`rollup.config.js`, `rollup/*.js`), and the minified output carries no license header. The two
license files were therefore added from the published npm tarballs at the versions in upstream's
`package-lock.json`:

| Bundle | Package | Version | License | Copyright |
|---|---|---|---|---|
| `vendor/zip.js` | `@zip.js/zip.js` (`lib/zip-core.js`: `configure`, `ZipReader`, `BlobReader`, `TextWriter`, `BlobWriter`) | 2.8.22 | BSD-3-Clause | 2023 Gildas Lormeau |
| `vendor/fflate.js` | `fflate` (`unzlibSync`) | 0.8.2 | MIT | 2023 Arjun Barrett |

## Not vendored

- `pdf.js` (upstream's PDF adapter) and `vendor/pdfjs/` (Mozilla pdf.js, cmaps, standard fonts).
  `view.js` lazily imports `./pdf.js` for PDF input; the spike's Vite config
  (`spikes/foliate-view/vite.config.ts`) resolves that import to a stub that rejects PDFs.
- App and demo files: `reader.html`, `reader.js`, `ui/`, `dict.js`, `opds.js`,
  `uri-template.js`, `quote-image.js`.
- Dev files: `.git`, `.github/`, `.gitattributes`, `.gitignore`, `eslint.config.js`,
  `package.json`, `package-lock.json`, `rollup.config.js`, `rollup/`, `tests/`, `README.md`.

## Tooling

`vendor/` is ignored by ESLint (`eslint.config.js`) and Prettier (`.prettierignore`), so the
files stay byte-identical.

## How to update

1. Clone upstream into a scratch directory outside the repository and check out the new commit:
   `git clone https://github.com/johnfactotum/foliate-js && git -C foliate-js checkout <sha>`.
2. Review the upstream diff since the commit above, including `vendor/zip.js` and
   `vendor/fflate.js`, and whether `view.js` imports any new module.
3. Copy the files listed above over this directory (keep `VENDORED.md`). Do not copy `pdf.js`,
   `vendor/pdfjs/` or dev files.
4. If upstream's `package-lock.json` changed the zip.js or fflate version, refresh
   `vendor/LICENSE-zipjs` and `vendor/LICENSE-fflate` from the matching npm tarballs.
5. Update the commit, date and SHA-256 table here (`sha256sum $(find . -type f | sort)`), and
   keep "Local modifications: none" true. If a local patch is ever unavoidable, list it here and
   in ADR 003.
6. Run `npm run spike:foliate` (and CI's `PW_WEBKIT=1` job) before merging.
