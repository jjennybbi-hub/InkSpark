// Editor text spike harness (M0 §4.1). Stubs until Track B implements them.
import type { Editor } from "@tiptap/core";

/** Stub body (removed by the implementer). Takes the arguments so the parameters count as used. */
function notImplemented(...args: readonly unknown[]): never {
  throw new Error("not implemented", { cause: args });
}

export type WritingMode = "ltr" | "rtl" | "vertical-rl" | "vertical-lr";

export const WRITING_MODES: readonly WritingMode[] = ["ltr", "rtl", "vertical-rl", "vertical-lr"];

export type SampleLang = "en" | "ja" | "ar" | "he";

/** Deterministic sample text; paragraphs are separated by "\n\n". */
export function generateText(lang: SampleLang, chars: number, seed: number): string {
  notImplemented(lang, chars, seed);
}

/** Sets `dir` and `style.writingMode` (plus `text-orientation: mixed`) on `host`. */
export function applyWritingMode(host: HTMLElement, mode: WritingMode): void {
  notImplemented(host, mode);
}

export interface SpikeEditorHandle {
  readonly mode: WritingMode;
  readonly editor: Editor;
  getText(): string;
  getSelection(): { from: number; to: number };
  setText(text: string): void;
  coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number };
  destroy(): void;
}

export function createSpikeEditor(
  host: HTMLElement,
  mode: WritingMode,
  initialText?: string,
): SpikeEditorHandle {
  notImplemented(host, mode, initialText);
}

/**
 * Per sample: `insertContent("a")`, then await `requestAnimationFrame`; the time is measured from
 * before the dispatch to after the frame.
 */
export function measureInputLatency(
  h: SpikeEditorHandle,
  samples: number,
): Promise<{ p50: number; p95: number }> {
  notImplemented(h, samples);
}
