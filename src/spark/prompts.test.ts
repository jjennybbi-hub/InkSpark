import { describe, expect, it } from "vitest";
import { pickPrompt, promptHash } from "./dealer";
import { AI_DRAFTED_PROMPTS, HUMAN_PROMPTS, PROMPTS } from "./prompts";

describe("PROMPTS", () => {
  it("has 200 unique AI-drafted prompts with distinct hashes", () => {
    expect(AI_DRAFTED_PROMPTS).toHaveLength(200);
    expect(new Set(PROMPTS.map((p) => p.text)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map(promptHash)).size).toBe(PROMPTS.length);
    expect(PROMPTS.every((p) => p.text.trim() === p.text && p.text.length > 10)).toBe(true);
  });

  it("keeps sources apart: every prompt carries its own source", () => {
    expect(AI_DRAFTED_PROMPTS.every((p) => p.source === "ai-drafted")).toBe(true);
    expect(HUMAN_PROMPTS.every((p) => p.source === "human")).toBe(true);
    expect(PROMPTS).toHaveLength(HUMAN_PROMPTS.length + AI_DRAFTED_PROMPTS.length);
  });

  it("gives the same text a different hash per source", () => {
    const text = "Write about a door.";
    expect(promptHash({ text, source: "ai-drafted" })).not.toBe(
      promptHash({ text, source: "human" }),
    );
  });
});

describe("pickPrompt", () => {
  it("never repeats and returns null once all are seen", () => {
    const seen = new Set<string>();
    const dealt = new Set<string>();
    PROMPTS.forEach(() => {
      const p = pickPrompt(seen);
      expect(p).not.toBeNull();
      if (p === null) {
        return;
      }
      expect(dealt.has(p.text)).toBe(false);
      dealt.add(p.text);
      seen.add(promptHash(p));
    });
    expect(pickPrompt(seen)).toBeNull();
  });
});
