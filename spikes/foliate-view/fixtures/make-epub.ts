// Deterministic EPUB 3 fixture builder (M0 §5.2). Node and browser safe; uses fflate with a
// fixed mtime, so identical options always give identical bytes.
import { zipSync, zlibSync, type Zippable } from "fflate";

export interface FixtureOptions {
  chapters?: number;
  wordsPerChapter?: number;
  includeRtl?: boolean;
  includeVertical?: boolean;
  includeImage?: boolean;
}

interface ResolvedOptions {
  chapters: number;
  wordsPerChapter: number;
  includeRtl: boolean;
  includeVertical: boolean;
  includeImage: boolean;
}

type ChapterKind = "plain" | "rtl" | "vertical";

interface Chapter {
  id: string;
  href: string;
  title: string;
  kind: ChapterKind;
  hasImage: boolean;
  hasFootnote: boolean;
}

const OEBPS = "OEBPS";
const IMAGE_HREF = "images/figure.png";
const STYLE_HREF = "styles.css";
/** Slots (0-based spine positions) of the special chapters when the book is long enough. */
const RTL_SLOT = 2;
const VERTICAL_SLOT = 3;
const IMAGE_SLOT = 1;

/**
 * Local-time components, so the DOS timestamps fflate writes do not depend on the time zone.
 * DOS time cannot represent dates before 1980.
 */
const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);
const MODIFIED = "2026-01-01T00:00:00Z";
const IDENTIFIER = "urn:uuid:5d1c2b47-2f6e-4f53-9c0e-6a8a8f0b7c11";

// Neutral word lists for filler text (not quotes: words in a fixed rotation).
const EN_WORDS = [
  "river",
  "lantern",
  "harbor",
  "quiet",
  "morning",
  "paper",
  "window",
  "garden",
  "stone",
  "letter",
  "orchard",
  "candle",
  "meadow",
  "winter",
  "bridge",
  "summer",
  "valley",
  "thread",
  "pencil",
  "island",
  "market",
  "ladder",
  "willow",
  "shadow",
];
const HE_WORDS = [
  "שלום",
  "ספר",
  "בית",
  "אור",
  "מים",
  "יום",
  "לילה",
  "דרך",
  "עץ",
  "שמש",
  "ים",
  "עיר",
  "חלון",
  "גן",
  "אבן",
  "מכתב",
];
const JA_WORDS = [
  "川",
  "灯り",
  "港",
  "静か",
  "朝",
  "紙",
  "窓",
  "庭",
  "石",
  "手紙",
  "果樹園",
  "蝋燭",
  "草原",
  "冬",
  "橋",
  "夏",
];

const WORDS_PER_PARAGRAPH = 60;

function resolveOptions(opts: FixtureOptions | undefined): ResolvedOptions {
  const chapters = Math.floor(opts?.chapters ?? 5);
  const wordsPerChapter = Math.floor(opts?.wordsPerChapter ?? 400);
  if (!Number.isFinite(chapters) || chapters < 1) {
    throw new RangeError(`chapters must be >= 1, got ${String(opts?.chapters)}`);
  }
  if (!Number.isFinite(wordsPerChapter) || wordsPerChapter < 1) {
    throw new RangeError(`wordsPerChapter must be >= 1, got ${String(opts?.wordsPerChapter)}`);
  }
  return {
    chapters,
    wordsPerChapter,
    includeRtl: opts?.includeRtl ?? true,
    includeVertical: opts?.includeVertical ?? true,
    includeImage: opts?.includeImage ?? true,
  };
}

function planChapters(opts: ResolvedOptions): Chapter[] {
  const imageSlot = Math.min(IMAGE_SLOT, opts.chapters - 1);
  return Array.from({ length: opts.chapters }, (_, slot): Chapter => {
    let kind: ChapterKind = "plain";
    if (opts.includeRtl && slot === RTL_SLOT) kind = "rtl";
    if (opts.includeVertical && slot === VERTICAL_SLOT) kind = "vertical";
    const number = String(slot + 1).padStart(3, "0");
    const titles: Record<ChapterKind, string> = {
      plain: `Chapter ${String(slot + 1)}`,
      rtl: `Chapter ${String(slot + 1)} (Hebrew, right to left)`,
      vertical: `Chapter ${String(slot + 1)} (Japanese, vertical)`,
    };
    return {
      id: `chapter-${number}`,
      href: `chapter-${number}.xhtml`,
      title: titles[kind],
      kind,
      hasImage: opts.includeImage && slot === imageSlot && kind === "plain",
      hasFootnote: slot === 0,
    };
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filler(
  words: readonly string[],
  count: number,
  seed: number,
  separator: string,
): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // A fixed linear rotation keeps the text deterministic without a PRNG.
    const word = words[(i * 7 + seed * 3) % words.length] ?? "";
    current.push(word);
    if (current.length === WORDS_PER_PARAGRAPH || i === count - 1) {
      paragraphs.push(`${current.join(separator)}${separator === "" ? "。" : "."}`);
      current = [];
    }
  }
  return paragraphs;
}

function chapterXhtml(chapter: Chapter, slot: number, opts: ResolvedOptions): string {
  const lang = chapter.kind === "rtl" ? "he" : chapter.kind === "vertical" ? "ja" : "en";
  const htmlAttrs =
    chapter.kind === "rtl" ? ` dir="rtl"` : chapter.kind === "vertical" ? ` class="vertical"` : "";
  const words =
    chapter.kind === "rtl" ? HE_WORDS : chapter.kind === "vertical" ? JA_WORDS : EN_WORDS;
  const separator = chapter.kind === "vertical" ? "" : " ";
  const body: string[] = [`<h1>${escapeXml(chapter.title)}</h1>`];
  const paragraphs = filler(words, opts.wordsPerChapter, slot, separator);
  paragraphs.forEach((paragraph, index) => {
    if (index === 0 && chapter.hasFootnote) {
      body.push(
        `<p>${escapeXml(paragraph)}<a epub:type="noteref" id="noteref-1" href="#note-1">1</a></p>`,
      );
    } else {
      body.push(`<p>${escapeXml(paragraph)}</p>`);
    }
    if (index === 0 && chapter.hasImage) {
      body.push(
        `<figure><img src="${IMAGE_HREF}" alt="A blue and orange gradient" width="128" height="64"/>` +
          `<figcaption>Figure 1. A generated gradient.</figcaption></figure>`,
      );
    }
  });
  if (chapter.hasFootnote) {
    body.push(
      `<aside epub:type="footnote" id="note-1"><p><a href="#noteref-1">1.</a> ` +
        `A footnote that the reader can show in place.</p></aside>`,
    );
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" ` +
      `lang="${lang}" xml:lang="${lang}"${htmlAttrs}>`,
    `<head>`,
    `<meta charset="UTF-8"/>`,
    `<title>${escapeXml(chapter.title)}</title>`,
    `<link rel="stylesheet" type="text/css" href="${STYLE_HREF}"/>`,
    `</head>`,
    `<body>`,
    `<section epub:type="chapter">`,
    ...body,
    `</section>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

function navXhtml(chapters: readonly Chapter[]): string {
  const items = chapters.map(
    (chapter) => `<li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">`,
    `<head><meta charset="UTF-8"/><title>Contents</title></head>`,
    `<body>`,
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>`,
    ...items,
    `</ol></nav>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

function stylesheet(opts: ResolvedOptions): string {
  const rules = [
    `body { font-family: serif; line-height: 1.5; }`,
    `h1 { font-size: 1.5em; }`,
    `figure { margin: 1em 0; text-align: center; }`,
    `aside[epub|type~="footnote"] { font-size: 0.9em; }`,
  ];
  if (opts.includeVertical) {
    rules.push(`html.vertical { writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }`);
  }
  return [`@namespace epub "http://www.idpf.org/2007/ops";`, ...rules, ``].join("\n");
}

function packageOpf(chapters: readonly Chapter[], opts: ResolvedOptions): string {
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="${STYLE_HREF}" media-type="text/css"/>`,
    ...(opts.includeImage
      ? [`<item id="figure" href="${IMAGE_HREF}" media-type="image/png"/>`]
      : []),
    ...chapters.map(
      (chapter) =>
        `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`,
    ),
  ];
  const spine = chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">`,
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `<dc:identifier id="book-id">${IDENTIFIER}</dc:identifier>`,
    `<dc:title>InkSpark reader fixture</dc:title>`,
    `<dc:language>en</dc:language>`,
    `<meta property="dcterms:modified">${MODIFIED}</meta>`,
    `</metadata>`,
    `<manifest>`,
    ...manifest,
    `</manifest>`,
    `<spine>`,
    ...spine,
    `</spine>`,
    `</package>`,
    ``,
  ].join("\n");
}

const CONTAINER_XML = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">`,
  `<rootfiles>`,
  `<rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>`,
  `</rootfiles>`,
  `</container>`,
  ``,
].join("\n");

// --- PNG ---------------------------------------------------------------------------------------

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** A small RGB gradient PNG (128×64), built byte by byte so it is deterministic. */
function makePng(width = 128, height = 64): Uint8Array {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // compression, filter and interlace methods stay 0

  const stride = 1 + width * 3;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = Math.round((255 * x) / (width - 1));
      raw[offset + 1] = 96;
      raw[offset + 2] = Math.round((255 * y) / (height - 1));
    }
  }

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

// --- EPUB --------------------------------------------------------------------------------------

/**
 * Defaults: 5 chapters (including one Hebrew RTL and one Japanese vertical-rl), nav, CSS,
 * one PNG and a footnote link.
 */
export function makeFixtureEpub(opts?: FixtureOptions): Uint8Array {
  const options = resolveOptions(opts);
  const chapters = planChapters(options);
  const encoder = new TextEncoder();
  const text = (value: string): Uint8Array => encoder.encode(value);

  // Insertion order is archive order: `mimetype` must come first and be stored (level 0).
  const files: Zippable = {
    mimetype: [text("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": text(CONTAINER_XML),
    [`${OEBPS}/content.opf`]: text(packageOpf(chapters, options)),
    [`${OEBPS}/nav.xhtml`]: text(navXhtml(chapters)),
    [`${OEBPS}/${STYLE_HREF}`]: text(stylesheet(options)),
  };
  if (options.includeImage) {
    files[`${OEBPS}/${IMAGE_HREF}`] = [makePng(), { level: 0 }];
  }
  chapters.forEach((chapter, slot) => {
    files[`${OEBPS}/${chapter.href}`] = text(chapterXhtml(chapter, slot, options));
  });

  return zipSync(files, { level: 6, mtime: FIXED_MTIME });
}
