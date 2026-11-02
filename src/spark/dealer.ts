import { PROMPTS } from "./prompts";

/** 64-bit FNV-1a as 16 hex digits, matching what Rust accepts in `markPromptSeen`. */
export function promptHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
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
  prompts: readonly string[] = PROMPTS,
): string | null {
  const unseen = prompts.filter((p) => !seen.has(promptHash(p)));
  return unseen[Math.floor(random() * unseen.length)] ?? null;
}
