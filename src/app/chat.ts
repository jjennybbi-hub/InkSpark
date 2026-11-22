import { type Editor, Extension, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Chat history: a section of lines like `Annie: hello`. The words stay exactly as typed; the
 * speaker is just the text before the first colon, so the page reads the same in any app.
 */

const SPEAKER = /^([^:\n]{1,40}):[  ]?/;

/** The speaker of a line, or "" for a line with no `Name:` at the start. */
export function speakerOf(text: string): string {
  return SPEAKER.exec(text)?.[1]?.trim() ?? "";
}

/** How many characters `Name: ` takes at the start of a line. */
function prefixLength(text: string): number {
  return SPEAKER.exec(text)?.[0].length ?? 0;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

interface MarkdownState {
  write: (text: string) => void;
  ensureNewLine: () => void;
  renderContent: (node: PMNode) => void;
  renderInline: (node: PMNode) => void;
  closeBlock: (node: PMNode) => void;
}

/** One message. Its text includes the `Name: ` part. */
export const ChatLine = Node.create({
  name: "chatLine",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "p", context: "chatSection/", priority: 100 }];
  },
  renderHTML() {
    return ["p", 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          state.renderInline(node);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** A run of chat lines. `me` is the speaker whose bubbles sit on the right. */
export const ChatSection = Node.create({
  name: "chatSection",
  group: "block",
  content: "chatLine+",
  isolating: true,
  addAttributes() {
    return {
      me: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-chat") ?? "",
        renderHTML: (attrs: { me?: unknown }) => ({
          "data-chat": typeof attrs.me === "string" ? attrs.me : "",
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-chat]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, class: "chat" }, 0];
  },
  addStorage() {
    return {
      markdown: {
        // Saved as a small HTML wrapper around plain `Name: words` lines.
        serialize(state: MarkdownState, node: PMNode) {
          state.write(`<div data-chat="${escapeAttr(String(node.attrs.me ?? ""))}">`);
          state.ensureNewLine();
          state.write("\n");
          state.renderContent(node);
          state.write("</div>");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

export interface ChatContext {
  node: PMNode;
  /** Position just before the chat section. */
  pos: number;
  line: PMNode;
  /** Position just before the line. */
  linePos: number;
}

/** The chat section and line holding the cursor, if any. */
export function chatAt(state: EditorState): ChatContext | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "chatSection") {
      const line = $from.node(depth + 1);
      return { node, pos: $from.before(depth), line, linePos: $from.before(depth + 1) };
    }
  }
  return null;
}

/** Speakers in the order they first speak in a section. */
export function speakersIn(section: PMNode): string[] {
  const names: string[] = [];
  section.forEach((line) => {
    const name = speakerOf(line.textContent);
    if (name !== "" && !names.includes(name)) {
      names.push(name);
    }
  });
  return names;
}

/** Every speaker named in any chat on the page. */
export function speakersOnPage(doc: PMNode): string[] {
  const names: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "chatSection") {
      return true;
    }
    for (const name of speakersIn(node)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
    return false;
  });
  return names;
}

/** Who speaks after `current`: the last other speaker above, else the next name in `pool`. */
export function nextSpeaker(section: PMNode, index: number, pool: readonly string[]): string {
  const current = speakerOf(section.child(index).textContent);
  for (let i = index - 1; i >= 0; i -= 1) {
    const name = speakerOf(section.child(i).textContent);
    if (name !== "" && name !== current) {
      return name;
    }
  }
  return pool.find((name) => name !== current) ?? current;
}

function cycle(list: readonly string[], current: string, step: number): string {
  if (list.length === 0) {
    return current;
  }
  const at = list.indexOf(current);
  const next = at === -1 ? (step > 0 ? 0 : list.length - 1) : at + step;
  return list[(next + list.length) % list.length] ?? current;
}

export interface ChatOptions {
  /** Character names from the cast list, so Tab can offer people who have not spoken yet. */
  cast: () => readonly string[];
}

/** Replaces the speaker of the line starting at `linePos` (its `Name: ` part only). */
function setSpeaker(editor: Editor, linePos: number, line: PMNode, name: string): boolean {
  const start = linePos + 1;
  const cut = prefixLength(line.textContent);
  const prefix = name === "" ? "" : `${name}: `;
  const { tr, selection } = editor.state;
  const offset = Math.max(0, selection.from - start - cut);
  tr.insertText(prefix, start, start + cut);
  tr.setSelection(TextSelection.create(tr.doc, start + prefix.length + offset));
  editor.view.dispatch(tr);
  return true;
}

function pool(section: PMNode, cast: readonly string[]): string[] {
  const names = speakersIn(section);
  for (const name of cast) {
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function indexOfLine(ctx: ChatContext): number {
  let index = 0;
  ctx.node.forEach((_, offset, i) => {
    if (ctx.pos + 1 + offset === ctx.linePos) {
      index = i;
    }
  });
  return index;
}

function cycleSpeaker(editor: Editor, ctx: ChatContext, cast: readonly string[], step: number) {
  const current = speakerOf(ctx.line.textContent);
  return setSpeaker(editor, ctx.linePos, ctx.line, cycle(pool(ctx.node, cast), current, step));
}

const chatKey = new PluginKey("chatLook");

function decorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "chatSection") {
      return true;
    }
    const me = String(node.attrs.me ?? "");
    let previous = "\u0000";
    node.forEach((line, offset) => {
      const linePos = pos + 1 + offset;
      const text = line.textContent;
      const name = speakerOf(text);
      const cut = prefixLength(text);
      const side = name === "" ? "none" : name === me ? "me" : "them";
      decos.push(
        Decoration.node(linePos, linePos + line.nodeSize, {
          class: "chat-line",
          "data-side": side,
          "data-initial": name.slice(0, 1).toUpperCase(),
          "data-first": String(name !== previous),
          "data-empty": String(text.slice(cut).trim() === ""),
        }),
      );
      if (cut > 0) {
        decos.push(
          Decoration.inline(linePos + 1, linePos + 1 + cut, {
            class: "chat-name",
            title: "Click to change who is speaking (or press Tab)",
          }),
        );
      }
      previous = name;
    });
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** Bubbles, sides and the keys: Enter for the next speaker, Tab to change speaker. */
export const ChatKeys = Extension.create<ChatOptions>({
  name: "chatKeys",
  priority: 200,
  addOptions() {
    return { cast: () => [] };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const ctx = chatAt(editor.state);
        if (ctx === null || !editor.state.selection.empty) {
          return false;
        }
        const text = ctx.line.textContent;
        const index = indexOfLine(ctx);
        const words = text.slice(prefixLength(text)).trim();
        const { tr } = editor.state;
        if (words === "" && index === ctx.node.childCount - 1) {
          // Enter on an empty last line leaves the chat for a normal paragraph.
          const sectionEnd = ctx.pos + ctx.node.nodeSize;
          const paragraph = editor.schema.nodes.paragraph?.create();
          if (paragraph === undefined) {
            return false;
          }
          if (ctx.node.childCount === 1) {
            tr.replaceWith(ctx.pos, sectionEnd, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, ctx.pos + 1));
          } else {
            tr.delete(ctx.linePos, ctx.linePos + ctx.line.nodeSize);
            const after = tr.mapping.map(sectionEnd);
            tr.insert(after, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
          }
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        const next = nextSpeaker(ctx.node, index, this.options.cast());
        const prefix = next === "" ? "" : `${next}: `;
        tr.split(editor.state.selection.from);
        const start = tr.selection.from;
        if (prefix !== "") {
          tr.insertText(prefix, start);
        }
        tr.setSelection(TextSelection.create(tr.doc, start + prefix.length));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      Tab: ({ editor }) => {
        const ctx = chatAt(editor.state);
        return ctx !== null && cycleSpeaker(editor, ctx, this.options.cast(), 1);
      },
      "Shift-Tab": ({ editor }) => {
        const ctx = chatAt(editor.state);
        return ctx !== null && cycleSpeaker(editor, ctx, this.options.cast(), -1);
      },
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: chatKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
        },
        props: {
          decorations: (state) => chatKey.getState(state) as DecorationSet,
          handleDOMEvents: {
            // Clicking a name, or the picture circle beside a bubble, changes who speaks.
            mousedown: (view, event) => {
              const target = event.target as HTMLElement | null;
              const line = target?.closest(".chat-line");
              if (target === null || !(line instanceof HTMLElement)) {
                return false;
              }
              const onName = target.closest(".chat-name") !== null;
              const box = line.getBoundingClientRect();
              const onCircle =
                target === line &&
                (line.dataset.side === "me" ? event.clientX > box.right : event.clientX < box.left);
              if (!onName && !onCircle) {
                return false;
              }
              const found = view.posAtDOM(line, 0) - 1;
              const lineNode = view.state.doc.nodeAt(found);
              const $pos = view.state.doc.resolve(found);
              const section = $pos.parent;
              if (lineNode === null || section.type.name !== "chatSection") {
                return false;
              }
              event.preventDefault();
              const current = speakerOf(lineNode.textContent);
              const name = cycle(pool(section, options.cast()), current, 1);
              const start = found + 1;
              const cut = prefixLength(lineNode.textContent);
              const prefix = name === "" ? "" : `${name}: `;
              const tr = view.state.tr.insertText(prefix, start, start + cut);
              tr.setSelection(TextSelection.create(tr.doc, start + prefix.length));
              view.dispatch(tr);
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});

export type Format = "normal" | "chat";

/** Where the section holding the cursor starts and ends: from one heading to the next. */
export function sectionRange(state: EditorState): { from: number; to: number } {
  const doc = state.doc;
  const at = state.selection.$from.index(0);
  const isHeading = (i: number): boolean => doc.child(i).type.name === "heading";
  let first = at;
  if (at < doc.childCount && isHeading(at)) {
    first = at + 1;
  } else {
    while (first > 0 && !isHeading(first - 1)) {
      first -= 1;
    }
  }
  let last = first;
  while (last + 1 < doc.childCount && !isHeading(last + 1)) {
    last += 1;
  }
  let from = 0;
  for (let i = 0; i < first; i += 1) {
    from += doc.child(i).nodeSize;
  }
  let to = from;
  for (let i = first; i <= last && i < doc.childCount; i += 1) {
    to += doc.child(i).nodeSize;
  }
  return { from, to };
}

/**
 * Switches the top-level blocks between `from` and `to` to `format`. Only the look changes:
 * every line keeps its words. Normal paragraphs in a row become one chat; chats become paragraphs.
 */
export function setFormat(editor: Editor, format: Format, from: number, to: number): void {
  const { schema } = editor.state;
  const chat = schema.nodes.chatSection;
  const line = schema.nodes.chatLine;
  const paragraph = schema.nodes.paragraph;
  if (chat === undefined || line === undefined || paragraph === undefined) {
    return;
  }
  const doc = editor.state.doc;
  const out: PMNode[] = [];
  let run: PMNode[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      const speakers = run.map((p) => speakerOf(p.textContent)).filter((n) => n !== "");
      out.push(chat.create({ me: speakers[0] ?? "" }, run));
      run = [];
    }
  };
  doc.nodesBetween(from, to, (node) => {
    if (format === "chat" && node.type === paragraph) {
      run.push(line.create(null, node.content));
    } else if (format === "chat" && node.type === chat) {
      node.forEach((l) => run.push(l));
    } else {
      flush();
      if (format === "normal" && node.type === chat) {
        node.forEach((l) => out.push(paragraph.create(null, l.content)));
      } else {
        out.push(node);
      }
    }
    return false;
  });
  flush();
  const tr = editor.state.tr.replaceWith(from, to, out);
  editor.view.dispatch(tr.scrollIntoView());
}

/** Sets who sits on the right in the chat holding the cursor. */
export function setMe(editor: Editor, me: string): void {
  const ctx = chatAt(editor.state);
  if (ctx !== null) {
    editor.view.dispatch(editor.state.tr.setNodeAttribute(ctx.pos, "me", me));
  }
}

/** Renames `from` to `to` on the page: chat speakers and whole-word mentions in the text. */
export function renameOnPage(editor: Editor, from: string, to: string): void {
  if (from === "" || from === to) {
    return;
  }
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
  const { tr } = editor.state;
  const edits: { from: number; to: number }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === "chatSection" && node.attrs.me === from) {
      tr.setNodeAttribute(pos, "me", to);
    }
    if (!node.isText || node.text === undefined) {
      return true;
    }
    for (const match of node.text.matchAll(word)) {
      edits.push({ from: pos + match.index, to: pos + match.index + from.length });
    }
    return false;
  });
  for (const edit of edits.reverse()) {
    tr.insertText(to, edit.from, edit.to);
  }
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
}
