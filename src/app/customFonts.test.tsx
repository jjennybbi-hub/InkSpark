import { describe, expect, it } from "vitest";
import { applyAppearance, DEFAULTS, loadAppearance } from "./appearance";
import { fontNameFromFile, fontOptionFor, importFontFile } from "./customFonts";

describe("imported fonts", () => {
  it("names a font after its file, without anything unsafe", () => {
    expect(fontNameFromFile("My-Font Bold.woff2")).toBe("My-Font Bold");
    expect(fontNameFromFile("a'b;c.ttf")).toBe("abc");
    expect(fontNameFromFile("'.ttf")).toBe("");
  });

  it("falls back to Arial", () => {
    expect(fontOptionFor("Mine").value).toBe("'Mine', Arial, Helvetica, sans-serif");
  });

  it("reports a file it cannot use", async () => {
    expect(await importFontFile(new File(["x"], "'.ttf"))).toBe("failed");
  });
});

describe("zoom", () => {
  it("only sets a display value", () => {
    applyAppearance({ ...DEFAULTS, zoom: 150 }, []);
    expect(document.documentElement.style.getPropertyValue("--zoom")).toBe("1.5");
  });

  it("ignores an old saved text font and impossible zooms", () => {
    localStorage.setItem(
      "inkspark.appearance",
      JSON.stringify({ textFont: "Georgia, serif", zoom: 900 }),
    );
    const loaded = loadAppearance();
    expect(loaded.zoom).toBe(100);
    expect(loaded).not.toHaveProperty("textFont");
  });
});
