// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  WRITING_MODES,
  applyWritingMode,
  createSpikeEditor,
  generateText,
  type SampleLang,
  type SpikeEditorHandle,
  type WritingMode,
} from "./harness";

const LANGS: readonly SampleLang[] = ["en", "ja", "ar", "he"];

const SCRIPT: Record<SampleLang, RegExp> = {
  en: /[A-Za-z]/,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ar: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
};

const hosts: HTMLElement[] = [];
const handles: SpikeEditorHandle[] = [];

function newHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

afterEach(() => {
  for (const h of handles.splice(0)) h.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe("WRITING_MODES", () => {
  it("lists the four modes", () => {
    expect([...WRITING_MODES]).toEqual(["ltr", "rtl", "vertical-rl", "vertical-lr"]);
  });
});

describe("generateText", () => {
  for (const lang of LANGS) {
    describe(lang, () => {
      it("is deterministic per seed", () => {
        expect(generateText(lang, 2_000, 42)).toBe(generateText(lang, 2_000, 42));
        expect(generateText(lang, 2_000, 1)).not.toBe(generateText(lang, 2_000, 2));
      });

      for (const chars of [200, 5_000, 50_000]) {
        it(`has ${String(chars)} characters within one paragraph`, () => {
          const text = generateText(lang, chars, 3);
          const paragraphs = text.split("\n\n");
          const longest = Math.max(...paragraphs.map((p) => p.length));
          expect(Math.abs(text.length - chars)).toBeLessThanOrEqual(longest + 2);
        });
      }

      it('separates non-empty paragraphs with "\\n\\n"', () => {
        const paragraphs = generateText(lang, 5_000, 4).split("\n\n");
        expect(paragraphs.length).toBeGreaterThan(1);
        for (const p of paragraphs) expect(p.length).toBeGreaterThan(0);
      });

      it("uses the language's script", () => {
        expect(generateText(lang, 500, 5)).toMatch(SCRIPT[lang]);
      });
    });
  }
});

describe("applyWritingMode", () => {
  it('sets dir="rtl" for rtl', () => {
    const host = newHost();
    applyWritingMode(host, "rtl");
    expect(host.getAttribute("dir")).toBe("rtl");
  });

  it("keeps ltr horizontal and not rtl, even after rtl", () => {
    const host = newHost();
    applyWritingMode(host, "rtl");
    applyWritingMode(host, "ltr");
    expect(host.getAttribute("dir")).not.toBe("rtl");
    expect(["", "horizontal-tb"]).toContain(host.style.writingMode);
  });

  for (const mode of ["vertical-rl", "vertical-lr"] as const) {
    it(`sets style.writingMode for ${mode}`, () => {
      const host = newHost();
      applyWritingMode(host, mode);
      expect(host.style.writingMode).toBe(mode);
    });
  }

  it("clears a vertical writing mode when switched back to ltr", () => {
    const host = newHost();
    applyWritingMode(host, "vertical-rl");
    applyWritingMode(host, "ltr");
    expect(["", "horizontal-tb"]).toContain(host.style.writingMode);
  });
});

describe("createSpikeEditor", () => {
  function create(mode: WritingMode, initialText?: string): SpikeEditorHandle {
    const h =
      initialText === undefined
        ? createSpikeEditor(newHost(), mode)
        : createSpikeEditor(newHost(), mode, initialText);
    handles.push(h);
    return h;
  }

  for (const mode of ["ltr", "rtl", "vertical-rl", "vertical-lr"] as const) {
    it(`exposes its mode (${mode})`, () => {
      expect(create(mode).mode).toBe(mode);
    });
  }

  it("starts with the initial text", () => {
    expect(create("ltr", "Hello world").getText()).toBe("Hello world");
  });

  it("round-trips setText/getText for multi-paragraph text in every language", () => {
    const h = create("ltr");
    for (const lang of LANGS) {
      const text = generateText(lang, 3_000, 11);
      h.setText(text);
      expect(h.getText()).toBe(text);
    }
  });

  it("round-trips an empty doc", () => {
    const h = create("rtl", "שלום");
    h.setText("");
    expect(h.getText()).toBe("");
  });

  it("returns a selection inside the doc", () => {
    const h = create("vertical-rl", "あいうえお");
    const { from, to } = h.getSelection();
    expect(Number.isInteger(from)).toBe(true);
    expect(Number.isInteger(to)).toBe(true);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThanOrEqual(from);
    expect(to).toBeLessThanOrEqual(h.editor.state.doc.content.size);
  });
});
