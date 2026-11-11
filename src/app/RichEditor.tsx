import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { type JSX, useEffect, useRef } from "react";
import { editorExtensions } from "./editorExtensions";
import { FormatBar } from "./FormatBar";

interface Props {
  /** Changes when a different page is shown, so the editor swaps its content. */
  pageKey: string | null;
  markdown: string;
  onChange: (markdown: string) => void;
  textFont?: string | undefined;
  /** A search match to select and scroll to; a new object each time asks again. */
  find?: FindRequest | null | undefined;
}

export interface FindRequest {
  query: string;
  /** Which match on the page, counting from 0. */
  nth: number;
}

/** Where the `nth` case-insensitive match of `query` sits in the editor, else the first one. */
export function findRange(
  editor: Editor,
  query: string,
  nth: number,
): { from: number; to: number } | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return null;
  }
  const found: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    // Map each character of the block's text to its document position.
    let text = "";
    const at: number[] = [];
    node.descendants((child, offset) => {
      if (child.isText && child.text !== undefined) {
        for (let i = 0; i < child.text.length; i += 1) {
          text += child.text[i] ?? "";
          at.push(pos + 1 + offset + i);
        }
      }
      return true;
    });
    const lower = text.toLowerCase();
    let i = lower.indexOf(needle);
    while (i !== -1) {
      const from = at[i];
      const last = at[i + needle.length - 1];
      if (from !== undefined && last !== undefined) {
        found.push({ from, to: last + 1 });
      }
      i = lower.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return found[nth] ?? found[0] ?? null;
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
  return storage.markdown.getMarkdown();
}

export function RichEditor({ pageKey, markdown, onChange, textFont, find }: Props): JSX.Element {
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
    extensions: editorExtensions(),
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

  // Runs after the page swap above, so the match is found in the right page.
  useEffect(() => {
    if (find === null || find === undefined) {
      return;
    }
    const range = findRange(editor, find.query, find.nth);
    if (range !== null) {
      editor.chain().focus().setTextSelection(range).scrollIntoView().run();
    }
  }, [editor, find, pageKey]);

  return (
    <div className="rich">
      <div className="page-scroll">
        <EditorContent editor={editor} className="page" />
        <FormatBar editor={editor} textFont={textFont} pageKey={pageKey} />
      </div>
    </div>
  );
}
