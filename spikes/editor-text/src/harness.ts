// Editor text spike harness (M0 §4.1): TipTap 3 editors in four writing modes, deterministic
// sample text and an input-latency probe. Spike code only; nothing here ships in the app.
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export type WritingMode = "ltr" | "rtl" | "vertical-rl" | "vertical-lr";

export const WRITING_MODES: readonly WritingMode[] = ["ltr", "rtl", "vertical-rl", "vertical-lr"];

export type SampleLang = "en" | "ja" | "ar" | "he";

const PARAGRAPH_SEPARATOR = "\n\n";

interface LangSpec {
  /** Word (or, for Japanese, phrase) pool. */
  readonly words: readonly string[];
  /** Joins words inside a sentence. */
  readonly wordJoin: string;
  /** Ends a sentence. */
  readonly stop: string;
  /** Joins sentences inside a paragraph. */
  readonly sentenceJoin: string;
}

/** Splits a space-separated word list. */
function words(list: string): readonly string[] {
  return list.split(" ");
}

const LANGS: Record<SampleLang, LangSpec> = {
  en: {
    words: words(
      "the quiet river carried a letter past old stone houses where nobody " +
        "remembered her name and morning light fell on empty tables while rain " +
        "kept moving through narrow streets of town with small boats waiting " +
        "for evening wind",
    ),
    wordJoin: " ",
    stop: ".",
    sentenceJoin: " ",
  },
  ja: {
    words: words(
      "静かな 川が 古い 手紙を 運んで いった 朝の 光は 誰もいない 机の 上に 落ちて 雨が 細い 道を 通り 抜けて 小さな 舟が 夕方の " +
        "風を 待って いる 町の 名前を 覚えて いない 人々は 窓を 開けた 縦書きの 文章 ひらがな カタカナ 漢字 ゆっくりと",
    ),
    wordJoin: "",
    stop: "。",
    sentenceJoin: "",
  },
  ar: {
    words: words(
      "النهر الهادئ حمل رسالة قديمة عبر البيوت الحجرية حيث لا أحد يتذكر اسمها " +
        "وضوء الصباح سقط على الطاولات الفارغة بينما المطر يمشي في الشوارع " +
        "الضيقة للمدينة مع قوارب صغيرة تنتظر ريح المساء",
    ),
    wordJoin: " ",
    stop: ".",
    sentenceJoin: " ",
  },
  he: {
    words: words(
      "הנהר השקט נשא מכתב ישן ליד בתי האבן שבהם איש לא זכר את שמה ואור הבוקר " +
        "נפל על שולחנות ריקים בזמן שהגשם עבר ברחובות הצרים של העיר עם סירות " +
        "קטנות שמחכות לרוח הערב",
    ),
    wordJoin: " ",
    stop: ".",
    sentenceJoin: " ",
  },
};

/** mulberry32: a small deterministic PRNG returning floats in [0, 1). */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], rand: () => number): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

function between(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * Deterministic sample text of `chars` UTF-16 code units (fewer only when the cut lands on
 * whitespace), in the script of `lang`. Paragraphs are separated by "\n\n" and never empty.
 */
export function generateText(lang: SampleLang, chars: number, seed: number): string {
  if (chars <= 0) return "";
  const spec = LANGS[lang];
  const rand = prng(seed);
  const paragraphs: string[] = [];
  let length = 0;
  while (length < chars) {
    const sentences: string[] = [];
    const sentenceCount = between(2, 6, rand);
    for (let s = 0; s < sentenceCount; s += 1) {
      const words: string[] = [];
      const wordCount = between(5, 14, rand);
      for (let w = 0; w < wordCount; w += 1) words.push(pick(spec.words, rand));
      sentences.push(words.join(spec.wordJoin) + spec.stop);
    }
    const paragraph = sentences.join(spec.sentenceJoin);
    length += (paragraphs.length === 0 ? 0 : PARAGRAPH_SEPARATOR.length) + paragraph.length;
    paragraphs.push(paragraph);
  }
  // Cut to the exact length; trailing whitespace would leave an empty or space-ended paragraph.
  return paragraphs.join(PARAGRAPH_SEPARATOR).slice(0, chars).trimEnd();
}

/** Sets `dir` and `style.writingMode` (plus `text-orientation: mixed`) on `host`. */
export function applyWritingMode(host: HTMLElement, mode: WritingMode): void {
  host.dataset.writingMode = mode;
  if (mode === "ltr" || mode === "rtl") {
    host.setAttribute("dir", mode);
    host.style.writingMode = "horizontal-tb";
    host.style.removeProperty("text-orientation");
    return;
  }
  // Vertical text keeps the default (top-to-bottom) inline direction.
  host.setAttribute("dir", "ltr");
  host.style.writingMode = mode;
  host.style.setProperty("text-orientation", "mixed");
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

/** Plain text → doc JSON: one paragraph per "\n\n"-separated block, empty blocks stay empty. */
function textToDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .split(PARAGRAPH_SEPARATOR)
      .map((block) =>
        block === ""
          ? { type: "paragraph" }
          : { type: "paragraph", content: [{ type: "text", text: block }] },
      ),
  };
}

export function createSpikeEditor(
  host: HTMLElement,
  mode: WritingMode,
  initialText?: string,
): SpikeEditorHandle {
  applyWritingMode(host, mode);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit],
    content: textToDoc(initialText ?? ""),
    editorProps: {
      attributes: {
        "aria-label": `Spike editor (${mode})`,
        "aria-multiline": "true",
        role: "textbox",
        spellcheck: "false",
      },
    },
  });

  return {
    mode,
    editor,
    getText: () => editor.getText({ blockSeparator: PARAGRAPH_SEPARATOR }),
    getSelection: () => {
      const { from, to } = editor.state.selection;
      return { from, to };
    },
    setText: (text) => {
      // Loading text replaces the doc and is not an undoable edit.
      editor
        .chain()
        .setMeta("addToHistory", false)
        .setContent(textToDoc(text), { emitUpdate: false })
        .run();
    },
    coordsAtPos: (pos) => {
      const { left, top, right, bottom } = editor.view.coordsAtPos(pos);
      return { left, top, right, bottom };
    },
    destroy: () => {
      editor.destroy();
    },
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Per sample (M0 §4.1, as amended): the time from just before `insertContent("a")` to just after a
 * forced synchronous layout (`coordsAtPos` of the caret plus `getBoundingClientRect` of the editor
 * DOM). The `requestAnimationFrame` wait before the next sample is not timed, so the result is the
 * editor's own work and not the display's refresh interval.
 */
export async function measureInputLatency(
  h: SpikeEditorHandle,
  samples: number,
): Promise<{ p50: number; p95: number }> {
  const times: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    h.editor.commands.insertContent("a");
    h.coordsAtPos(h.getSelection().from);
    h.editor.view.dom.getBoundingClientRect();
    times.push(performance.now() - start);
    await nextFrame();
  }
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95) };
}
