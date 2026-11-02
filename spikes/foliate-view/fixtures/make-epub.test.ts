// @vitest-environment node
import { unzipSync, type Unzipped } from "fflate";
import { describe, expect, it } from "vitest";
import { makeFixtureEpub } from "./make-epub";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MIMETYPE = "application/epub+zip";

const decoder = new TextDecoder("utf-8");

function text(files: Unzipped, name: string): string {
  const entry = files[name];
  if (entry === undefined) {
    throw new Error(`missing zip entry ${name}`);
  }
  return decoder.decode(entry);
}

function opfPath(files: Unzipped): string {
  const container = text(files, "META-INF/container.xml");
  const match = /<rootfile\b[^>]*\bfull-path="([^"]+)"/.exec(container);
  const fullPath = match?.[1];
  if (fullPath === undefined) {
    throw new Error("container.xml has no rootfile full-path");
  }
  return fullPath;
}

function spineItemCount(opf: string): number {
  const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/.exec(opf)?.[1];
  if (spine === undefined) {
    throw new Error("OPF has no <spine>");
  }
  return spine.match(/<itemref\b/g)?.length ?? 0;
}

function xhtmlTexts(files: Unzipped): string[] {
  return Object.keys(files)
    .filter((name) => /\.x?html?$/i.test(name))
    .map((name) => text(files, name));
}

describe("makeFixtureEpub", () => {
  it("writes mimetype as the first local file header, stored uncompressed", () => {
    const bytes = makeFixtureEpub();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getUint32(0, true)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    const generalPurposeFlags = view.getUint16(6, true);
    const compressionMethod = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const uncompressedSize = view.getUint32(22, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const name = decoder.decode(bytes.subarray(30, 30 + nameLength));

    expect(name).toBe("mimetype");
    expect(compressionMethod).toBe(0);
    expect(generalPurposeFlags & 0x0001).toBe(0); // not encrypted
    expect(generalPurposeFlags & 0x0008).toBe(0); // sizes in the header, no data descriptor
    expect(extraLength).toBe(0);
    expect(compressedSize).toBe(MIMETYPE.length);
    expect(uncompressedSize).toBe(MIMETYPE.length);

    const dataStart = 30 + nameLength + extraLength;
    const content = decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize));
    expect(content).toBe(MIMETYPE);
  });

  it("unzips with mimetype first and the EPUB media type as its content", () => {
    const files = unzipSync(makeFixtureEpub());
    expect(Object.keys(files)[0]).toBe("mimetype");
    expect(text(files, "mimetype")).toBe(MIMETYPE);
  });

  it("has a container.xml that points at an OPF present in the archive", () => {
    const files = unzipSync(makeFixtureEpub());
    const path = opfPath(files);
    expect(path).toMatch(/\.opf$/);
    expect(files[path]).toBeDefined();
    expect(text(files, path)).toMatch(/<package\b[^>]*\bversion="3\.0"/);
  });

  it("has one spine item per chapter by default (5)", () => {
    const files = unzipSync(makeFixtureEpub());
    expect(spineItemCount(text(files, opfPath(files)))).toBe(5);
  });

  it.each([1, 3, 8])("has one spine item per chapter when chapters is %i", (chapters) => {
    const files = unzipSync(makeFixtureEpub({ chapters }));
    expect(spineItemCount(text(files, opfPath(files)))).toBe(chapters);
  });

  it("declares a nav document in the manifest", () => {
    const files = unzipSync(makeFixtureEpub());
    const opf = text(files, opfPath(files));
    expect(opf).toMatch(/<item\b[^>]*\bproperties="[^"]*\bnav\b[^"]*"/);
  });

  it("includes Hebrew RTL, Japanese vertical-rl content and a PNG by default", () => {
    const files = unzipSync(makeFixtureEpub());
    const docs = xhtmlTexts(files);
    expect(docs.some((doc) => /[֐-׿]/.test(doc))).toBe(true);
    expect(docs.some((doc) => /[぀-ヿ一-鿿]/.test(doc))).toBe(true);

    const allText = Object.keys(files)
      .filter((name) => /\.(x?html?|css)$/i.test(name))
      .map((name) => text(files, name))
      .join("\n");
    expect(allText).toContain("vertical-rl");

    const pngs = Object.entries(files).filter(([name]) => /\.png$/i.test(name));
    expect(pngs.length).toBeGreaterThanOrEqual(1);
    for (const [, data] of pngs) {
      expect(Array.from(data.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });

  it("omits the RTL chapter, vertical chapter and image when disabled", () => {
    const files = unzipSync(
      makeFixtureEpub({ includeRtl: false, includeVertical: false, includeImage: false }),
    );
    const docs = xhtmlTexts(files);
    expect(docs.some((doc) => /[֐-׿]/.test(doc))).toBe(false);
    expect(docs.some((doc) => doc.includes("vertical-rl"))).toBe(false);
    expect(Object.keys(files).some((name) => /\.png$/i.test(name))).toBe(false);
  });

  it("is byte-identical for identical options", () => {
    expect(makeFixtureEpub()).toEqual(makeFixtureEpub());
    const opts = { chapters: 7, wordsPerChapter: 200, includeImage: false };
    expect(makeFixtureEpub(opts)).toEqual(makeFixtureEpub({ ...opts }));
  });

  it("grows with wordsPerChapter", () => {
    const small = unzipSync(makeFixtureEpub({ wordsPerChapter: 100 }));
    const large = unzipSync(makeFixtureEpub({ wordsPerChapter: 2000 }));
    const size = (files: Unzipped): number =>
      xhtmlTexts(files).reduce((sum, doc) => sum + doc.length, 0);
    expect(size(large)).toBeGreaterThan(size(small));
  });
});
