// Deterministic EPUB 3 fixture builder (M0 §5.2). Node and browser safe; uses fflate with a
// fixed mtime. Stub until Track C implements it.

/** Stub body (removed by the implementer). Takes the arguments so the parameters count as used. */
function notImplemented(...args: readonly unknown[]): never {
  throw new Error("not implemented", { cause: args });
}

export interface FixtureOptions {
  chapters?: number;
  wordsPerChapter?: number;
  includeRtl?: boolean;
  includeVertical?: boolean;
  includeImage?: boolean;
}

/**
 * Defaults: 5 chapters (including one Hebrew RTL and one Japanese vertical-rl), nav, CSS,
 * one PNG and a footnote link.
 */
export function makeFixtureEpub(opts?: FixtureOptions): Uint8Array {
  notImplemented(opts);
}
