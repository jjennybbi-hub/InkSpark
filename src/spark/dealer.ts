import { PROMPTS, type Prompt } from "./prompts";

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
 * `random` is injectable for tests.
 */
export function pickPrompt(
  seen: ReadonlySet<string>,
  random: () => number = Math.random,
  prompts: readonly Prompt[] = PROMPTS,
): Prompt | null {
  const unseen = prompts.filter((p) => !seen.has(promptHash(p)));
  return unseen[Math.floor(random() * unseen.length)] ?? null;
}
