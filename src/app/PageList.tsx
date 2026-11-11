import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { commands, type DeletedPage, type LayoutEntry, type PageSummary } from "../contracts";
import { chapterOf, moveBy, moveTo, moveToChapter, type Place, type Ref } from "./layout";

function TrashIcon(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
    </svg>
  );
}

/** Closes an overlay on Escape or a press outside it. */
function useDismiss(
  active: boolean,
  root: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, root, close]);
}

interface PageListProps {
  project: string;
  pages: readonly PageSummary[];
  layout: readonly LayoutEntry[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onAddPage: () => void;
  onAddChapter: () => Promise<string | null>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onLayout: (next: readonly LayoutEntry[]) => void;
  onRenameChapter: (id: string, name: string) => void;
  onRemoveChapter: (id: string) => void;
}

interface MenuState {
  ref: Ref;
  x: number;
  y: number;
}

interface Drag {
  ref: Ref;
  x: number;
  y: number;
  moving: boolean;
}

interface Drop {
  ref: Ref;
  place: Place;
}

const DRAG_START = 5;

function collapsedKey(project: string): string {
  return `inkspark.collapsed:${project}`;
}

function loadCollapsed(project: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(collapsedKey(project)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(project: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(collapsedKey(project), JSON.stringify([...ids]));
  } catch {
    // Remembering folded chapters is a convenience only.
  }
}

/** Finds the row under the pointer and which part of it, for a drop. */
function dropAt(x: number, y: number, dragged: Ref): Drop | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-kind]");
  const kind = row?.dataset.dropKind;
  const id = row?.dataset.dropId;
  if (
    row === null ||
    row === undefined ||
    id === undefined ||
    (kind !== "page" && kind !== "chapter")
  ) {
    return null;
  }
  const box = row.getBoundingClientRect();
  const share = box.height === 0 ? 0.5 : (y - box.top) / box.height;
  if (kind === "chapter" && dragged.kind === "page") {
    return { ref: { kind, id }, place: share < 0.3 ? "before" : "into" };
  }
  return { ref: { kind, id }, place: share < 0.5 ? "before" : "after" };
}

/**
 * The pages, grouped in chapters. Drag a row to move it; right-click (or the menu key) for a
 * floating menu. Everything floats or is drawn in place, so the column never shifts.
 */
export function PageList({
  project,
  pages,
  layout,
  currentId,
  onOpen,
  onAddPage,
  onAddChapter,
  onRename,
  onDelete,
  onLayout,
  onRenameChapter,
  onRemoveChapter,
}: PageListProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<Ref | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(project));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const justDragged = useRef(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);
  useDismiss(menu !== null, menuRoot, closeMenu);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chapterList = layout.filter(
    (e): e is Extract<LayoutEntry, { kind: "chapter" }> => e.kind === "chapter",
  );

  useEffect(() => {
    menuRoot.current?.querySelector("button")?.focus();
  }, [menu]);

  // Dragging listens on the window, so it keeps working when the pointer leaves a row.
  useEffect(() => {
    if (drag === null) {
      return;
    }
    const onMove = (e: PointerEvent): void => {
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_START) {
        return;
      }
      if (!drag.moving) {
        setDrag({ ...drag, moving: true });
      }
      setDrop(dropAt(e.clientX, e.clientY, drag.ref));
    };
    const onUp = (): void => {
      if (drag.moving) {
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 0);
        if (drop !== null) {
          const next = moveTo(layout, drag.ref, drop.ref, drop.place);
          if (next !== layout) {
            onLayout(next);
          }
        }
      }
      setDrag(null);
      setDrop(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setDrag(null);
        setDrop(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, drop, layout, onLayout]);

  const toggle = (id: string): void => {
    const next = new Set(collapsed);
    if (!next.delete(id)) {
      next.add(id);
    }
    setCollapsed(next);
    saveCollapsed(project, next);
  };

  const rowProps = (ref: Ref) => ({
    "data-drop-kind": ref.kind,
    "data-drop-id": ref.id,
    "data-drop":
      drop !== null && drop.ref.kind === ref.kind && drop.ref.id === ref.id
        ? drop.place
        : undefined,
    "data-dragging":
      drag?.moving === true && drag.ref.kind === ref.kind && drag.ref.id === ref.id
        ? true
        : undefined,
  });

  const handleProps = (ref: Ref) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button === 0) {
        setDrag({ ref, x: e.clientX, y: e.clientY, moving: false });
      }
    },
    onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      setMenu({
        ref,
        x: e.clientX === 0 ? box.left + 16 : e.clientX,
        y: e.clientY === 0 ? box.bottom : e.clientY,
      });
    },
  });

  const pageRow = (id: string): JSX.Element | null => {
    const page = byId.get(id);
    if (page === undefined) {
      return null;
    }
    const ref: Ref = { kind: "page", id };
    const title = page.title === "" ? "Untitled" : page.title;
    return (
      <li key={id} {...rowProps(ref)}>
        {renaming?.kind === "page" && renaming.id === id ? (
          <RenameBox
            title={page.title}
            label="Page name"
            onDone={(name) => {
              setRenaming(null);
              if (name !== null) {
                onRename(id, name);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="page-link"
            aria-current={id === currentId ? "page" : undefined}
            aria-haspopup="menu"
            title="Open this page. Drag to move it; right-click for more."
            {...handleProps(ref)}
            onClick={() => {
              if (!justDragged.current) {
                onOpen(id);
              }
            }}
          >
            {title}
          </button>
        )}
      </li>
    );
  };

  const menuItem = (label: string, act: () => void): JSX.Element => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={() => {
        setMenu(null);
        act();
      }}
    >
      {label}
    </button>
  );

  const menuItems = (ref: Ref): JSX.Element[] => {
    const items = [
      menuItem("Rename", () => {
        setRenaming(ref);
      }),
      menuItem("Move up", () => {
        const next = moveBy(layout, ref, -1);
        if (next !== layout) {
          onLayout(next);
        }
      }),
      menuItem("Move down", () => {
        const next = moveBy(layout, ref, 1);
        if (next !== layout) {
          onLayout(next);
        }
      }),
    ];
    if (ref.kind === "chapter") {
      items.push(
        menuItem("Remove chapter (keeps its pages)", () => {
          onRemoveChapter(ref.id);
        }),
      );
      return items;
    }
    const home = chapterOf(layout, ref.id);
    for (const chapter of chapterList) {
      if (chapter.id !== home) {
        items.push(
          menuItem(`Move to ${chapter.name}`, () => {
            onLayout(moveToChapter(layout, ref.id, chapter.id));
          }),
        );
      }
    }
    if (home !== null) {
      items.push(
        menuItem("Move out of chapter", () => {
          onLayout(moveToChapter(layout, ref.id, null));
        }),
      );
    }
    items.push(
      menuItem("Delete", () => {
        onDelete(ref.id);
      }),
    );
    return items;
  };

  return (
    <>
      <div className="pages-actions">
        <NewMenu
          onAddPage={onAddPage}
          onAddChapter={() => {
            void onAddChapter().then((id) => {
              if (id !== null) {
                setRenaming({ kind: "chapter", id });
              }
            });
          }}
        />
      </div>
      <ul className="page-tree" data-dragging={drag?.moving === true ? true : undefined}>
        {layout.map((entry) => {
          if (entry.kind === "page") {
            return pageRow(entry.id);
          }
          const ref: Ref = { kind: "chapter", id: entry.id };
          const open = !collapsed.has(entry.id);
          return (
            <li key={entry.id} className="chapter">
              <div className="chapter-row" {...rowProps(ref)}>
                <button
                  type="button"
                  className="chapter-fold"
                  aria-expanded={open}
                  aria-label={`${open ? "Fold" : "Show"} ${entry.name}`}
                  title={open ? "Fold: hide this chapter's pages" : "Show this chapter's pages"}
                  onClick={() => {
                    toggle(entry.id);
                  }}
                >
                  <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                </button>
                {renaming?.kind === "chapter" && renaming.id === entry.id ? (
                  <RenameBox
                    title={entry.name}
                    label="Chapter name"
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null && name.trim() !== "") {
                        onRenameChapter(entry.id, name);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="page-link chapter-name"
                    aria-haspopup="menu"
                    title="Chapter. Drag to move it; right-click for more."
                    {...handleProps(ref)}
                    onClick={() => {
                      if (!justDragged.current) {
                        toggle(entry.id);
                      }
                    }}
                  >
                    {entry.name}
                    <span className="visually-hidden">, chapter, {entry.pages.length} pages</span>
                  </button>
                )}
              </div>
              {open && entry.pages.length > 0 && (
                <ul aria-label={entry.name}>{entry.pages.map(pageRow)}</ul>
              )}
            </li>
          );
        })}
      </ul>
      {menu !== null && (
        <div
          ref={menuRoot}
          className="page-menu"
          role="menu"
          aria-label={menu.ref.kind === "chapter" ? "Chapter" : "Page"}
          style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 280) }}
        >
          {menuItems(menu.ref)}
        </div>
      )}
    </>
  );
}

/** The "+" button: a small floating menu with New page and New chapter. */
function NewMenu({
  onAddPage,
  onAddChapter,
}: {
  onAddPage: () => void;
  onAddChapter: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, root, close);
  useEffect(() => {
    if (open) {
      root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    }
  }, [open]);
  return (
    <span className="new-menu" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="New"
        title="New: add a page or a chapter"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        +
      </button>
      {open && (
        <div className="page-menu new-menu-list" role="menu" aria-label="New">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddPage();
            }}
          >
            New page
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddChapter();
            }}
          >
            New chapter
          </button>
        </div>
      )}
    </span>
  );
}

function RenameBox({
  title,
  label,
  onDone,
}: {
  title: string;
  label: string;
  onDone: (name: string | null) => void;
}): JSX.Element {
  const finished = useRef(false);
  const finish = (name: string | null): void => {
    if (!finished.current) {
      finished.current = true;
      onDone(name);
    }
  };
  return (
    <input
      className="page-rename"
      type="text"
      aria-label={label}
      defaultValue={title}
      maxLength={80}
      autoFocus
      onFocus={(e) => {
        e.target.select();
      }}
      onBlur={(e) => {
        finish(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      }}
    />
  );
}

interface RecentlyDeletedProps {
  project: string;
  onRestored: (pages: PageSummary[], id: string) => void;
  onProblem: (message: string) => void;
}

/** A trash button with a floating list of deleted pages, which can be restored or erased. */
export function RecentlyDeleted({
  project,
  onRestored,
  onProblem,
}: RecentlyDeletedProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DeletedPage[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirming(null);
  }, []);
  useDismiss(open, root, close);

  const toggle = async (): Promise<void> => {
    if (open) {
      close();
      return;
    }
    const result = await commands.listDeleted(project);
    if (result.status === "error") {
      onProblem(`Could not list deleted pages: ${result.error.message}`);
      return;
    }
    setItems(result.data);
    setOpen(true);
  };

  const restore = async (id: string): Promise<void> => {
    const result = await commands.restorePage(project, id);
    if (result.status === "error") {
      onProblem(`Could not restore that page: ${result.error.message}`);
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== id));
    onRestored(result.data, id);
  };

  const erase = async (id: string): Promise<void> => {
    const result = await commands.erasePage(project, id);
    setConfirming(null);
    if (result.status === "error") {
      onProblem(`Could not delete that page: ${result.error.message}`);
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="recently-deleted" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Recently deleted"
        title="Recently deleted: bring back or permanently delete pages"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <TrashIcon />
      </button>
      {open && (
        <div className="deleted-panel" role="dialog" aria-label="Recently deleted">
          <h2>Recently deleted</h2>
          {items.length === 0 && <p className="hint">Nothing here.</p>}
          <ul>
            {items.map((item) => {
              const title = item.title === "" ? "Untitled" : item.title;
              return (
                <li key={item.id}>
                  <span className="deleted-title" title={title}>
                    {title}
                  </span>
                  {confirming === item.id ? (
                    <>
                      <button type="button" onClick={() => void erase(item.id)}>
                        Delete forever
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(null);
                        }}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={`Restore ${title}`}
                        title="Put this page back in the list"
                        onClick={() => void restore(item.id)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${title} forever`}
                        title="Delete forever: asks you first"
                        onClick={() => {
                          setConfirming(item.id);
                        }}
                      >
                        ×
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
