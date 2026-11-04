import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichEditor } from "./RichEditor";
import { PRESET_THEMES, parseThemeFile, themeToFile } from "./themes";

/** Loads a page, makes a one-character edit, and returns the Markdown that would be saved. */
async function roundTrip(source: string): Promise<string> {
  const saved: string[] = [];
  const { container } = render(
    <RichEditor
      pageKey="a"
      markdown={source}
      onChange={(m) => {
        saved.push(m);
      }}
    />,
  );
  await waitFor(() => {
    expect(container.querySelector(".ProseMirror")?.textContent).not.toBe("");
  });
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    last = n;
  }
  if (last === null) {
    throw new Error("no text in the page");
  }
  last.textContent = `${last.textContent ?? ""}!`;
  await waitFor(() => {
    expect(saved.length).toBeGreaterThan(0);
  });
  return saved[saved.length - 1] ?? "";
}

describe("page formatting round trip", () => {
  it("keeps a plain page's lines unchanged", async () => {
    expect(await roundTrip("Chapter one\nIt began.")).toBe("Chapter one\nIt began.!");
  });

  it("saves basic formatting as Markdown", async () => {
    expect(await roundTrip("# Title\n\nSome **bold** and *italic* text")).toBe(
      "# Title\n\nSome **bold** and *italic* text!",
    );
  });

  it("keeps font size and colour as inline HTML spans", async () => {
    const out = await roundTrip('<span style="font-size: 24px; color: #ff0000">big</span> end');
    expect(out).toContain("<span");
    expect(out).toContain("font-size: 24px");
    expect(out).toMatch(/color: (#ff0000|rgb\(255, 0, 0\))/);
  });
});

describe("themes", () => {
  it("has at least twelve presets with unique ids", () => {
    expect(PRESET_THEMES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PRESET_THEMES.map((t) => t.id)).size).toBe(PRESET_THEMES.length);
  });

  it("exports and imports a theme file, and rejects bad files", () => {
    const first = PRESET_THEMES[0];
    if (first === undefined) {
      throw new Error("no presets");
    }
    const back = parseThemeFile(themeToFile(first));
    expect(back).toMatchObject({ name: first.name, bg: first.bg, text: first.text });
    expect(parseThemeFile("not json")).toBeNull();
    expect(
      parseThemeFile('{"name":"x","bg":"red","text":"#000000","accent":"#000000"}'),
    ).toBeNull();
  });
});
