import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { type JSX, useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";
import { FormatBar } from "./FormatBar";

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

interface Props {
  /** Changes when a different page is shown, so the editor swaps its content. */
  pageKey: string | null;
  markdown: string;
  onChange: (markdown: string) => void;
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
  return storage.markdown.getMarkdown();
}

export function RichEditor({ pageKey, markdown, onChange }: Props): JSX.Element {
  const loaded = useRef<string | null | undefined>(undefined);
  const latest = useRef(onChange);
  const content = useRef(markdown);
  /** True while a page is being loaded, so loading is never mistaken for typing. */
  const loading = useRef(false);
  useEffect(() => {
    latest.current = onChange;
    content.current = markdown;
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false, hardBreak: false }),
      AlignedParagraph,
      AlignedHeading.configure({ levels: [1, 2, 3] }),
      PlainBreak,
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Markdown.configure({ html: true, breaks: true, tightLists: true, linkify: false }),
    ],
    content: "",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Page text",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!loading.current) {
        latest.current(readMarkdown(e));
      }
    },
  });

  useEffect(() => {
    if (loaded.current === pageKey) {
      return;
    }
    loaded.current = pageKey;
    loading.current = true;
    editor.setEditable(pageKey !== null, false);
    editor.commands.setContent(content.current, { emitUpdate: false });
    loading.current = false;
    editor.commands.setTextSelection(0);
  }, [editor, pageKey]);

  return (
    <div className="rich">
      <div className="page-scroll">
        <EditorContent editor={editor} className="page" />
        <FormatBar editor={editor} />
      </div>
    </div>
  );
}
