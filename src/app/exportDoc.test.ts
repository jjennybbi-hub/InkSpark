import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./appearance";
import { buildDocx, buildMarkdown, fileNameFrom, hexColor, pageToBlocks } from "./exportDoc";

describe("export", () => {
  it("carries bold, italic and headings", () => {
    const [heading, body] = pageToBlocks("# Title\n\nSome **bold** and *soft* words");
    expect(heading?.heading).toBe(1);
    expect(heading?.runs[0]?.text).toBe("Title");
    expect(body?.runs.find((r) => r.bold)?.text).toBe("bold");
    expect(body?.runs.find((r) => r.italic)?.text).toBe("soft");
  });

  it("carries a chosen font, size, colour and alignment", () => {
    const [block] = pageToBlocks(
      '<p style="text-align: center"><span style="font-family: \'Courier New\', monospace; font-size: 20px; color: #ff0000">Hi</span></p>',
    );
    expect(block?.align).toBe("center");
    expect(block?.runs[0]).toMatchObject({
      font: "Courier New",
      halfPoints: 30,
      color: "FF0000",
    });
  });

  it("keeps single line breaks", () => {
    const [block] = pageToBlocks("one\ntwo");
    expect(block?.runs.map((r) => r.text)).toEqual(["one", "\n", "two"]);
  });

  it("numbers separate lists separately and marks only the first paragraph of an item", () => {
    const blocks = pageToBlocks("1. a\n2. b\n\nbreak\n\n1. c");
    const lists = blocks.map((b) => b.list?.id ?? null);
    expect(lists[0]).toBe(lists[1]);
    expect(lists[2]).toBeNull();
    expect(lists[3]).not.toBe(lists[0]);
    expect(lists[3]).not.toBeNull();
  });

  it("uses the writer's font and size as the Word default", () => {
    const doc = buildDocx(["x"], { ...DEFAULTS, font: "sans", size: 20 });
    expect(doc).toMatchObject({ font: "Arial", halfPoints: 30 });
  });

  it("starts each later page on a new sheet and skips blank pages", () => {
    const doc = buildDocx(["First\n\nmore", "  ", "Second"], DEFAULTS);
    expect(doc.blocks.map((b) => b.pageBreak)).toEqual([false, false, true]);
  });

  it("joins Markdown pages in order without changing their words", () => {
    expect(buildMarkdown(["# One\n", "", "Two **b**"])).toBe("# One\n\n---\n\nTwo **b**\n");
  });

  it("normalises colours and file names", () => {
    expect(hexColor("#abc")).toBe("AABBCC");
    expect(hexColor("rgb(255, 0, 16)")).toBe("FF0010");
    expect(hexColor("red")).toBeNull();
    expect(fileNameFrom('a/b:"c"?')).toBe("abc");
    expect(fileNameFrom("  ")).toBe("Untitled");
  });
});
