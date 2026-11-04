import { EXCERPTS } from "./excerpts";
import { PROMPTS, type Prompt } from "./prompts";

/** Real public-domain text, always shown with its author and work. */
export const EXCERPT_PROMPTS: readonly Prompt[] = EXCERPTS.map((e) => ({
  text: e.text,
  source: "human",
  credit: `${e.author}, ${e.work}`,
}));

/**
 * 64-bit FNV-1a as 16 hex digits, matching what Rust accepts in `markPromptSeen`. The source is
 * part of the hashed text, so an AI-drafted and a human prompt can never share a seen entry.
 */
export function promptHash(prompt: Prompt): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(`${prompt.source}\n${prompt.text}`)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Picks a prompt whose hash is not in `seen`, or `null` when every prompt has been shown.
 * Excerpts and app prompts are dealt half and half while both last, and never repeat.
 * `random` is injectable for tests.
 */
export function pickPrompt(
  seen: ReadonlySet<string>,
  random: () => number = Math.random,
  prompts: readonly Prompt[] = PROMPTS,
  excerpts: readonly Prompt[] = EXCERPT_PROMPTS,
): Prompt | null {
  const fresh = (list: readonly Prompt[]): Prompt[] => list.filter((p) => !seen.has(promptHash(p)));
  const own = fresh(prompts);
  const real = fresh(excerpts);
  const pool = own.length === 0 ? real : real.length === 0 ? own : random() < 0.5 ? real : own;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
