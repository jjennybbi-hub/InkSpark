import { type JSX, useEffect, useRef, useState } from "react";
import { type SearchHit, commands } from "../contracts";

interface Props {
  project: string;
  /** Opens a live page at one of its matches. */
  onOpen: (hit: SearchHit, query: string) => void;
  /** Puts a deleted page back, then opens it at the match. */
  onRestore: (hit: SearchHit, query: string) => void;
}

const WAIT_MS = 150;

/** Matches next to each other share a page heading, in the order they came. */
export function groupByPage(hits: readonly SearchHit[]): [SearchHit, ...SearchHit[]][] {
  const groups: [SearchHit, ...SearchHit[]][] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last?.[0].id === hit.id) {
      last.push(hit);
    } else {
      groups.push([hit]);
    }
  }
  return groups;
}

/** Starts the text before a match at a whole word, with "…" when something was cut. */
export function trimStart(before: string): string {
  const cut = before.trimStart();
  const space = cut.indexOf(" ");
  if (cut.length < 30 || space === -1) {
    return cut;
  }
  return `…${cut.slice(space + 1)}`;
}

/** Ends the text after a match at a whole word, with "…" when something was cut. */
export function trimEnd(after: string): string {
  const cut = after.trimEnd();
  const space = cut.lastIndexOf(" ");
  if (cut.length < 30 || space === -1) {
    return cut;
  }
  return `${cut.slice(0, space)}…`;
}

/**
 * Search across every page. The field sits at the top of the page list; results float over the
 * list and never move anything. ⌘F jumps here.
 */
export function SearchBox({ project, onOpen, onRestore }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<SearchHit | null>(null);
  // The page list clips its contents, so the results float at a fixed spot under the field.
  const [place, setPlace] = useState<{ top: number; left: number } | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    const timer = window.setTimeout(() => {
      if (query.trim() === "") {
        setHits([]);
        return;
      }
      commands.searchPages(project, query).then(
        (result) => {
          if (!stale) {
            setHits(result.status === "ok" ? result.data : []);
          }
        },
        () => {
          if (!stale) {
            setHits([]);
          }
        },
      );
    }, WAIT_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [project, query]);

  const reveal = (): void => {
    const rect = field.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setPlace({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
        reveal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const close = (): void => {
    setOpen(false);
    setAsking(null);
  };

  const pick = (hit: SearchHit): void => {
    if (hit.deleted) {
      setAsking(hit);
      return;
    }
    close();
    onOpen(hit, query);
  };

  const showing = open && query.trim() !== "";

  return (
    <div
      className="search"
      ref={box}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget)) {
          close();
        }
      }}
    >
      <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={field}
        type="search"
        aria-label="Search all pages"
        title="Search all pages (⌘F)"
        placeholder="Search all pages  ⌘F"
        value={query}
        onFocus={reveal}
        onChange={(event) => {
          setQuery(event.target.value);
          reveal();
          setAsking(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
            field.current?.blur();
          } else if (event.key === "Enter" && hits[0] !== undefined) {
            pick(hits[0]);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            box.current?.querySelector<HTMLButtonElement>(".search-hit")?.focus();
          }
        }}
      />
      {showing && (
        <div
          className="search-results"
          id="search-results"
          role="region"
          aria-label="Results"
          style={place}
        >
          {asking !== null ? (
            <div className="search-ask">
              <p>“{asking.title || "Untitled"}” is in Recently Deleted.</p>
              <button
                type="button"
                onClick={() => {
                  close();
                  onRestore(asking, query);
                }}
              >
                Restore and open
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking(null);
                }}
              >
                Back
              </button>
            </div>
          ) : hits.length === 0 ? (
            <p className="search-none">Nothing found</p>
          ) : (
            <ul
              onKeyDown={(event) => {
                const items = [
                  ...(box.current?.querySelectorAll<HTMLButtonElement>(".search-hit") ?? []),
                ];
                const at = items.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  items[at + 1]?.focus();
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  (items[at - 1] ?? field.current)?.focus();
                } else if (event.key === "Escape") {
                  close();
                  field.current?.focus();
                }
              }}
            >
              {groupByPage(hits).map((group) => (
                <li key={group[0].id} className="search-group">
                  <div className="search-title">
                    <span className="search-name">{group[0].title || "Untitled"}</span>
                    {group[0].deleted && <span className="search-tag">Deleted</span>}
                  </div>
                  {group.map((hit) => (
                    <button
                      key={String(hit.nth)}
                      type="button"
                      className="search-hit"
                      aria-label={`${group[0].title || "Untitled"}: ${hit.before}${hit.matched}${hit.after}`}
                      onClick={() => {
                        pick(hit);
                      }}
                    >
                      {trimStart(hit.before)}
                      <mark>{hit.matched}</mark>
                      {trimEnd(hit.after)}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
