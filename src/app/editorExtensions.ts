import type { Extensions } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Markdown } from "tiptap-markdown";

interface MarkdownState {
  write: (text: string) => void;
  repeat: (text: string, times: number) => string;
  renderInline: (node: PMNode) => void;
  closeBlock: (node: PMNode) => void;
}

function innerHtml(node: PMNode): string {
  const holder = document.createElement("div");
  holder.append(DOMSerializer.fromSchema(node.type.schema).serializeFragment(node.content));
  return holder.innerHTML;
}

/** Aligned blocks have no Markdown form, so they are saved as a small HTML block. */
function alignedTag(node: PMNode): string | null {
  const align: unknown = node.attrs.textAlign;
  return typeof align === "string" && align !== "left" ? align : null;
}

const AlignedParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          const align = alignedTag(node);
          if (align === null) {
            state.renderInline(node);
          } else {
            state.write(`<p style="text-align: ${align}">${innerHtml(node)}</p>`);
          }
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

const AlignedHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNode) {
          const align = alignedTag(node);
          const level = Number(node.attrs.level);
          if (align === null) {
            state.write(`${state.repeat("#", level)} `);
            state.renderInline(node);
          } else {
            state.write(
              `<h${String(level)} style="text-align: ${align}">${innerHtml(node)}</h${String(level)}>`,
            );
          }
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** Plain pages keep their single line breaks: a break is written as a bare newline. */
const PlainBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState) {
          state.write("\n");
        },
        parse: {},
      },
    };
  },
});

/** The editor's document rules, shared with export so a page reads the same in both. */
export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({ paragraph: false, heading: false, hardBreak: false }),
    AlignedParagraph,
    AlignedHeading.configure({ levels: [1, 2, 3] }),
    PlainBreak,
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Markdown.configure({ html: true, breaks: true, tightLists: true, linkify: false }),
  ];
}
