import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { type JSX, useEffect, useRef, useState } from "react";
import { editorExtensions } from "./editorExtensions";
import { FormatBar } from "./FormatBar";
import type { CastEntry } from "../contracts";
import { renameOnPage, speakersOnPage } from "./chat";
import { ChatTools } from "./ChatTools";

interface Props {
  /** Changes when a different page is shown, so the editor swaps its content. */
  pageKey: string | null;
  markdown: string;
  onChange: (markdown: string) => void;
  textFont?: string | undefined;
  /** A search match to select and scroll to; a new object each time asks again. */
  find?: FindRequest | null | undefined;
  /** The project's cast list, for chat speakers and @ suggestions. */
  cast?: readonly CastEntry[] | undefined;
  /** A cast rename to carry out on this page; a new object each time asks again. */
  rename?: { from: string; to: string } | null | undefined;
  /** Called with the chat speakers on the page, shortly after typing stops. */
  onSpeakers?: ((names: string[]) => void) | undefined;
}

const SPEAKERS_MS = 1500;

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

export function RichEditor({
  pageKey,
  markdown,
  onChange,
  textFont,
  find,
  cast = [],
  rename,
  onSpeakers,
}: Props): JSX.Element {
  // Read when Tab or Enter is pressed in a chat, never during render.
  const [castBox] = useState(() => {
    const box = { names: [] as string[], read: (): readonly string[] => box.names };
    return box;
  });
  const speakersOut = useRef(onSpeakers);
  const speakerTimer = useRef<number | undefined>(undefined);
  const loaded = useRef<string | null | undefined>(undefined);
  const latest = useRef(onChange);
  const content = useRef(markdown);
  useEffect(() => {
    latest.current = onChange;
    content.current = markdown;
    speakersOut.current = onSpeakers;
    castBox.names = cast.filter((c) => c.kind === "character").map((c) => c.name);
  });

  const editor = useEditor({
    extensions: editorExtensions(castBox.read),
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
      // Loading a page passes emitUpdate: false, so this runs only for real edits.
      latest.current(readMarkdown(e));
      window.clearTimeout(speakerTimer.current);
      speakerTimer.current = window.setTimeout(() => {
        speakersOut.current?.(speakersOnPage(e.state.doc));
      }, SPEAKERS_MS);
    },
  });

  useEffect(() => {
    if (loaded.current === pageKey) {
      return;
    }
    loaded.current = pageKey;
    editor.setEditable(pageKey !== null, false);
    editor.commands.setContent(content.current, { emitUpdate: false });
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

  useEffect(() => {
    if (rename !== null && rename !== undefined) {
      renameOnPage(editor, rename.from, rename.to);
    }
  }, [editor, rename]);

  useEffect(
    () => () => {
      window.clearTimeout(speakerTimer.current);
    },
    [],
  );

  return (
    <div className="rich">
      <ChatTools editor={editor} names={cast.map((c) => c.name)} />
      <div className="page-scroll">
        <EditorContent editor={editor} className="page" />
        <FormatBar editor={editor} textFont={textFont} pageKey={pageKey} />
      </div>
    </div>
  );
}
