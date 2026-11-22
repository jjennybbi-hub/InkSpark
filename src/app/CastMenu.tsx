import { type JSX, useEffect, useRef, useState } from "react";
import type { CastEntry, CastKind } from "../contracts";

const KINDS: { kind: CastKind; title: string; one: string }[] = [
  { kind: "character", title: "Characters", one: "character" },
  { kind: "place", title: "Places", one: "place" },
  { kind: "event", title: "Events", one: "event" },
];

interface Props {
  cast: readonly CastEntry[];
  /** Saves a new list. */
  onChange: (next: CastEntry[]) => void;
  /** A name was renamed: update it on the open page too. */
  onRename: (from: string, to: string) => void;
}

/** The cast list floats over the page: characters, places and events for this project. */
export function CastMenu({ cast, onChange, onRename }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<CastKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

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
      if (e.key === "Escape" && editing === null && adding === null) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, editing, adding]);

  const add = (kind: CastKind, name: string): void => {
    const clean = name.trim();
    setAdding(null);
    if (clean !== "" && !cast.some((c) => c.name === clean)) {
      onChange([...cast, { name: clean, kind }]);
    }
  };

  const rename = (from: string, to: string): void => {
    const clean = to.trim();
    setEditing(null);
    if (clean === "" || clean === from || cast.some((c) => c.name === clean)) {
      return;
    }
    onChange(cast.map((c) => (c.name === from ? { ...c, name: clean } : c)));
    onRename(from, clean);
  };

  const field = (
    label: string,
    initial: string,
    done: (value: string) => void,
    cancel: () => void,
  ): JSX.Element => (
    <input
      aria-label={label}
      defaultValue={initial}
      autoFocus
      onBlur={(e) => {
        done(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          done(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    />
  );

  return (
    <div className="cast-menu" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Cast list"
        title="Cast list: this project's characters, places and events"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 20a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M16 5.5a3 3 0 0 1 0 5.5M18 14.5a5.5 5.5 0 0 1 3 5.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Cast list">
          {KINDS.map(({ kind, title, one }) => (
            <section key={kind} className="cast-group">
              <div className="cast-head">
                <h2>{title}</h2>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Add a ${one}`}
                  title={`Add a ${one}`}
                  onClick={() => {
                    setAdding(kind);
                  }}
                >
                  +
                </button>
              </div>
              <ul>
                {cast
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <li key={c.name}>
                      {editing === c.name ? (
                        field(
                          `New name for ${c.name}`,
                          c.name,
                          (v) => {
                            rename(c.name, v);
                          },
                          () => {
                            setEditing(null);
                          },
                        )
                      ) : (
                        <>
                          <span className="cast-name">{c.name}</span>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Rename ${c.name}`}
                            title={`Rename ${c.name}; the open page changes too`}
                            onClick={() => {
                              setEditing(c.name);
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove ${c.name}`}
                            title={`Remove ${c.name} from the list (pages keep the name)`}
                            onClick={() => {
                              onChange(cast.filter((x) => x.name !== c.name));
                            }}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                {adding === kind && (
                  <li>
                    {field(
                      `New ${one}`,
                      "",
                      (v) => {
                        add(kind, v);
                      },
                      () => {
                        setAdding(null);
                      },
                    )}
                  </li>
                )}
              </ul>
            </section>
          ))}
          <p className="hint">
            Names typed in a chat join the list by themselves. Type @ for names.
          </p>
        </div>
      )}
    </div>
  );
}
