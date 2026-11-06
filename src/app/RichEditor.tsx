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
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
  return storage.markdown.getMarkdown();
}

export function RichEditor({ pageKey, markdown, onChange, textFont }: Props): JSX.Element {
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

  return (
    <div className="rich">
      <div className="page-scroll">
        <EditorContent editor={editor} className="page" />
        <FormatBar editor={editor} textFont={textFont} pageKey={pageKey} />
      </div>
    </div>
  );
}
