import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichEditor } from "./RichEditor";
import { DEFAULTS, LOOK_WIDTH, applyAppearance, loadAppearance } from "./appearance";
import {
  PRESET_THEMES,
  THEME_GROUPS,
  makeCustomTheme,
  parseThemeFile,
  themeAtmosphere,
  themeStyle,
  themeUi,
  themeToFile,
} from "./themes";

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

describe("reading looks", () => {
  it("sets line spacing, paragraph spacing and a width in characters", () => {
    applyAppearance({ ...DEFAULTS, look: "relaxed", width: LOOK_WIDTH.relaxed }, []);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--line-spacing")).toBe("2");
    expect(style.getPropertyValue("--paragraph-spacing")).toBe("1em");
    expect(style.getPropertyValue("--page-width")).toBe("50ch");
  });

  it("keeps today's look for settings saved before looks existed", () => {
    localStorage.setItem("inkspark.appearance", JSON.stringify({ themeId: "paper", size: 20 }));
    expect(loadAppearance()).toMatchObject({ look: "open", width: "medium", zoom: 100 });
  });
});

describe("theme groups", () => {
  it("places every preset theme in exactly one group", () => {
    const grouped = THEME_GROUPS.flatMap((g) => [...g.ids]).sort();
    expect(grouped).toEqual(PRESET_THEMES.map((t) => t.id).sort());
  });
});

describe("theme families", () => {
  const lum = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    const ch = [16, 8, 0].map((s) => {
      const c = ((n >> s) & 255) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };

  it("gives every preset a family, with readable text", () => {
    for (const t of PRESET_THEMES) {
      expect(["paper", "focus", "contrast", "soft"]).toContain(themeStyle(t));
      expect(ratio(t.bg, t.text)).toBeGreaterThanOrEqual(themeStyle(t) === "contrast" ? 15 : 7);
    }
  });

  it("puts custom themes in Paper or Focus by brightness", () => {
    expect(themeStyle(makeCustomTheme("Mine", "#111111", "#eeeeee", "#88aaff"))).toBe("focus");
    expect(themeStyle(makeCustomTheme("Mine", "#ffffff", "#111111", "#3355aa"))).toBe("paper");
  });
});

describe("theme atmospheres", () => {
  it("gives each mood theme its own atmosphere, and none to contrast and custom themes", () => {
    const moods = PRESET_THEMES.filter((t) => themeStyle(t) !== "contrast");
    const atmos = moods.map((t) => themeAtmosphere(t));
    expect(atmos.every((a) => a !== "none")).toBe(true);
    expect(new Set(atmos).size).toBe(moods.length);
    for (const t of PRESET_THEMES.filter((p) => themeStyle(p) === "contrast")) {
      expect(themeAtmosphere(t)).toBe("none");
    }
    expect(themeAtmosphere(makeCustomTheme("Mine", "#ffffff", "#111111", "#3355aa"))).toBe("none");
  });
});

describe("theme interface designs", () => {
  it("gives every preset its own lettering and shape, and none to custom themes", () => {
    const designs = PRESET_THEMES.map((t) => themeUi(t));
    expect(designs.every((d) => d !== undefined && d.font.length > 0)).toBe(true);
    expect(themeUi(makeCustomTheme("Mine", "#ffffff", "#111111", "#3355aa"))).toBeUndefined();
  });
});
