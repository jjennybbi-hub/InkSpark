import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { commands, type DeletedPage, type PageSummary } from "../contracts";

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
  pages: readonly PageSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

interface MenuState {
  id: string;
  x: number;
  y: number;
}

/** The pages. Right-click one (or press the menu key on it) for a floating Rename/Delete menu. */
export function PageList({
  pages,
  currentId,
  onOpen,
  onRename,
  onDelete,
}: PageListProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);
  useDismiss(menu !== null, menuRoot, closeMenu);

  useEffect(() => {
    menuRoot.current?.querySelector("button")?.focus();
  }, [menu]);

  return (
    <>
      <ul>
        {pages.map((page) => {
          const title = page.title === "" ? "Untitled" : page.title;
          return (
            <li key={page.id}>
              {renaming === page.id ? (
                <RenameBox
                  title={page.title}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name !== null) {
                      onRename(page.id, name);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="page-link"
                  aria-current={page.id === currentId ? "page" : undefined}
                  aria-haspopup="menu"
                  onClick={() => {
                    onOpen(page.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const box = e.currentTarget.getBoundingClientRect();
                    setMenu({
                      id: page.id,
                      x: e.clientX === 0 ? box.left + 16 : e.clientX,
                      y: e.clientY === 0 ? box.bottom : e.clientY,
                    });
                  }}
                >
                  {title}
                </button>
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
          aria-label="Page"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenaming(menu.id);
              setMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDelete(menu.id);
              setMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </>
  );
}

function RenameBox({
  title,
  onDone,
}: {
  title: string;
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
      aria-label="Page name"
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
        title="Recently deleted"
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
                        onClick={() => void restore(item.id)}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${title} forever`}
                        title="Delete forever"
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
