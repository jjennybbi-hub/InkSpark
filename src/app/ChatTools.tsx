import type { Editor } from "@tiptap/core";
import { type JSX, useEffect, useRef, useState } from "react";
import { type Format, chatAt, sectionRange, setFormat, setMe, speakersIn } from "./chat";

interface Spot {
  x: number;
  y: number;
}

const MENTION = /@([\p{L}\p{N}' -]{0,30})$/u;

/** Text typed after an `@` just before the cursor, and where the `@` sits. */
function mentionAt(editor: Editor): { query: string; from: number } | null {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) {
    return null;
  }
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = MENTION.exec(before);
  if (match === null) {
    return null;
  }
  return { query: match[1] ?? "", from: $from.pos - match[0].length };
}

/**
 * The writing-format icon beside the cursor's line, and the @ name suggestions. Both float over
 * the page and move nothing.
 */
export function ChatTools({
  editor,
  names,
}: {
  editor: Editor;
  /** Every cast name, for @ suggestions and the right-side picker. */
  names: readonly string[];
}): JSX.Element | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [inChat, setInChat] = useState<{ me: string; speakers: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [mention, setMention] = useState<{ query: string; from: number; at: Spot } | null>(null);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const matches =
    mention === null
      ? []
      : names.filter((n) => n.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6);

  useEffect(() => {
    const update = (): void => {
      if (!editor.isEditable || editor.view.dom.ownerDocument.activeElement !== editor.view.dom) {
        setMention(null);
        if (!open) {
          setSpot(null);
        }
        return;
      }
      const { $from } = editor.state.selection;
      const blockStart = $from.depth > 0 ? $from.start(1) : $from.pos;
      const block = editor.view.coordsAtPos(blockStart);
      const page = editor.view.dom.getBoundingClientRect();
      setSpot({ x: page.left - 36, y: block.top });
      const ctx = chatAt(editor.state);
      setInChat(
        ctx === null
          ? null
          : { me: String(ctx.node.attrs.me ?? ""), speakers: speakersIn(ctx.node) },
      );
      const found = mentionAt(editor);
      if (found === null) {
        setMention(null);
      } else {
        const at = editor.view.coordsAtPos(found.from);
        setMention({ ...found, at: { x: at.left, y: at.bottom } });
        setActive(0);
      }
    };
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    editor.on("focus", update);
    editor.on("blur", update);
    window.addEventListener("scroll", update, true);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
      editor.off("focus", update);
      editor.off("blur", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editor, open]);

  const pick = (name: string): void => {
    if (mention === null) {
      return;
    }
    const to = editor.state.selection.from;
    editor.chain().focus().insertContentAt({ from: mention.from, to }, name).run();
    setMention(null);
  };

  // Keys for the suggestions are caught before the editor sees them.
  useEffect(() => {
    if (matches.length === 0) {
      return;
    }
    const dom = editor.view.dom;
    const onKey = (event: KeyboardEvent): void => {
      const keys: Record<string, () => void> = {
        ArrowDown: () => {
          setActive((a) => (a + 1) % matches.length);
        },
        ArrowUp: () => {
          setActive((a) => (a - 1 + matches.length) % matches.length);
        },
        Enter: () => {
          pick(matches[active] ?? "");
        },
        Tab: () => {
          pick(matches[active] ?? "");
        },
        Escape: () => {
          setMention(null);
        },
      };
      const run = keys[event.key];
      if (run !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        run();
      }
    };
    dom.addEventListener("keydown", onKey, true);
    return () => {
      dom.removeEventListener("keydown", onKey, true);
    };
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        editor.commands.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, editor]);

  const apply = (format: Format, whole: boolean): void => {
    const range = whole
      ? { from: 0, to: editor.state.doc.content.size }
      : sectionRange(editor.state);
    setFormat(editor, format, range.from, range.to);
    setOpen(false);
    editor.commands.focus();
  };

  const rightChoices = inChat === null ? [] : [...new Set([...inChat.speakers, ...names])];

  return (
    <>
      {spot !== null && (
        <div className="format-switch" ref={root} style={{ left: spot.x, top: spot.y }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Writing format"
            title="Writing format: normal text or chat history, for this section or the whole page"
            aria-haspopup="dialog"
            aria-expanded={open}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {open && (
            <div className="popover" role="dialog" aria-label="Writing format">
              <h2>This section</h2>
              <div className="export-actions">
                <button
                  type="button"
                  onClick={() => {
                    apply("normal", false);
                  }}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    apply("chat", false);
                  }}
                >
                  Chat history
                </button>
              </div>
              <h2>Whole page</h2>
              <div className="export-actions">
                <button
                  type="button"
                  onClick={() => {
                    apply("normal", true);
                  }}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    apply("chat", true);
                  }}
                >
                  Chat history
                </button>
              </div>
              {inChat !== null && (
                <label className="format-me">
                  Right side (“me”) in this chat
                  <select
                    value={inChat.me}
                    onChange={(e) => {
                      setMe(editor, e.target.value);
                      setInChat({ ...inChat, me: e.target.value });
                    }}
                  >
                    <option value="">Nobody</option>
                    {rightChoices.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="hint">Your words stay the same; only the look changes.</p>
            </div>
          )}
        </div>
      )}
      {mention !== null && matches.length > 0 && (
        <ul
          className="mention-list"
          role="listbox"
          aria-label="Names from the cast list"
          style={{ left: mention.at.x, top: mention.at.y + 4 }}
        >
          {matches.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(name);
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
