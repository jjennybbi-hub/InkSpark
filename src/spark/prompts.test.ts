import { describe, expect, it } from "vitest";
import { pickPrompt, promptHash } from "./dealer";
import { PROMPTS } from "./prompts";

describe("PROMPTS", () => {
  it("has 200 unique, non-empty prompts with distinct hashes", () => {
    expect(PROMPTS).toHaveLength(200);
    expect(new Set(PROMPTS).size).toBe(200);
    expect(new Set(PROMPTS.map(promptHash)).size).toBe(200);
    expect(PROMPTS.every((p) => p.trim() === p && p.length > 10)).toBe(true);
  });
});

describe("pickPrompt", () => {
  it("never repeats and returns null once all are seen", () => {
    const seen = new Set<string>();
    const dealt = new Set<string>();
    PROMPTS.forEach(() => {
      const p = pickPrompt(seen);
      expect(p).not.toBeNull();
      expect(dealt.has(p ?? "")).toBe(false);
      dealt.add(p ?? "");
      seen.add(promptHash(p ?? ""));
    });
    expect(pickPrompt(seen)).toBeNull();
  });

  it("uses a 16-digit lowercase hex hash", () => {
    expect(promptHash("")).toBe("cbf29ce484222325");
  });
});
