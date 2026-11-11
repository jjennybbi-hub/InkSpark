import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import {
  type AppInfo,
  type Idea,
  type LayoutEntry,
  type PageSummary,
  commands,
} from "../contracts";
import { pickPrompt, promptHash } from "../spark/dealer";
import { restoreCustomFonts } from "./customFonts";
import { orderPages } from "./layout";
import { PageList, RecentlyDeleted } from "./PageList";
import { PromptCard } from "./PromptCard";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { loadAppInfo } from "./appInfo";
import { ExportMenu } from "./ExportMenu";
import { type FindRequest, RichEditor } from "./RichEditor";
import { SearchBox } from "./SearchBox";
import { SettingsPopover } from "./SettingsPopover";
import {
  applyAppearance,
  loadAppearance,
  loadCustomThemes,
  saveAppearance,
  saveCustomThemes,
  type Appearance,
} from "./appearance";
import type { ThemeDef } from "./themes";
import "./shell.css";

const AUTOSAVE_MS = 1000;
const UNSAVED_NOTE =
  "Your page has changes that could not be saved yet, so nothing was closed or switched.";
const LAST_PROJECT_KEY = "inkspark.lastProject";

type SaveState = "saved" | "saving" | "failed";

interface Session {
  path: string;
  id: string;
  text: string;
  dirty: boolean;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/^#+\s*/, "")
    .slice(0, 80);
}

function rememberedProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function rememberProject(path: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, path);
  } catch {
    // Remembering the folder is a convenience only.
  }
}

/**
 * Session A: a list of pages on the left, a plain editor on the right. Saves ~1 s after typing
 * stops and on ⌘S; every write goes through Rust.
 */
export function App(): JSX.Element {
  const [project, setProject] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [layout, setLayout] = useState<readonly LayoutEntry[]>([]);
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [message, setMessage] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [shelfOpen, setShelfOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [credit, setCredit] = useState("");
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [customThemes, setCustomThemes] = useState<ThemeDef[]>(loadCustomThemes);
  const [focusMode, setFocusMode] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [find, setFind] = useState<FindRequest | null>(null);

  useEffect(() => {
    loadAppInfo().then(setInfo, () => {
      setInfo(null);
    });
  }, []);
  const quickCapture = useRef<HTMLTextAreaElement>(null);
  const session = useRef<Session | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);

  /** Saves the current page now if it has unsaved text. Saves run one at a time, in order. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    const s = session.current;
    if (!s?.dirty) {
      return queue.current;
    }
    const content = s.text;
    s.dirty = false;
    setSaveState("saving");
    queue.current = queue.current.then(async () => {
      let failure = "";
      try {
        const result = await commands.savePage(s.path, s.id, content);
        if (result.status === "error") {
          failure = result.error.message;
        }
      } catch (error: unknown) {
        failure = String(error);
      }
      if (failure !== "") {
        s.dirty = true;
        setSaveState("failed");
        setMessage(`Could not save: ${failure}`);
      } else if (!s.dirty) {
        setSaveState("saved");
        setMessage("");
      }
    });
    return queue.current;
  }, []);

  /** Exports read from disk, so the page must be saved first. False if it could not be. */
  const saveFirst = useCallback(async (): Promise<boolean> => {
    await flush();
    return session.current?.dirty !== true;
  }, [flush]);

  const showPage = useCallback(
    async (path: string, id: string): Promise<void> => {
      await flush();
      const result = await commands.readPage(path, id);
      if (result.status === "error") {
        setMessage(`Could not open that page: ${result.error.message}`);
        return;
      }
      // Text typed while the page was loading (or a save that failed) must not be replaced.
      if (session.current?.dirty === true) {
        setMessage(UNSAVED_NOTE);
        return;
      }
      session.current = { path, id, text: result.data, dirty: false };
      setCurrentId(id);
      setText(result.data);
      setSaveState("saved");
      setMessage("");
    },
    [flush],
  );

  const openFolder = useCallback(
    async (path: string): Promise<void> => {
      await flush();
      if (session.current?.dirty === true) {
        setMessage(UNSAVED_NOTE);
        return;
      }
      const result = await commands.openProject(path);
      if (result.status === "error") {
        setMessage(`Could not open that folder: ${result.error.message}`);
        return;
      }
      rememberProject(path);
      setProject(path);
      setPages(result.data);
      setPrompt("");
      setCredit("");
      const shelf = await commands.listIdeas(path);
      setIdeas(shelf.status === "ok" ? shelf.data : []);
      const first = result.data[0];
      if (first !== undefined) {
        await showPage(path, first.id);
      }
    },
    [flush, showPage],
  );

  const chooseFolder = useCallback(async (): Promise<void> => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        await openFolder(picked);
      }
    } catch (error: unknown) {
      console.error("InkSpark could not open the folder picker:", error);
    }
  }, [openFolder]);

  const addPage = useCallback(async (): Promise<void> => {
    if (project === null) {
      return;
    }
    await flush();
    if (session.current?.dirty === true) {
      setMessage(UNSAVED_NOTE);
      return;
    }
    const result = await commands.createPage(project);
    if (result.status === "error") {
      setMessage(`Could not add a page: ${result.error.message}`);
      return;
    }
    setPages((prev) => [...prev, result.data]);
    await showPage(project, result.data.id);
  }, [flush, project, showPage]);

  const pageIds = pages.map((p) => p.id).join("\n");
  // The layout follows the set of pages: adding, deleting and restoring all change it.
  useEffect(() => {
    if (project === null) {
      return;
    }
    let stale = false;
    const flat = (): LayoutEntry[] =>
      pageIds === "" ? [] : pageIds.split("\n").map((id) => ({ kind: "page" as const, id }));
    // If chapters cannot be read, the pages still show, in a plain list.
    commands.getLayout(project).then(
      (result) => {
        if (!stale) {
          setLayout(result.status === "ok" ? result.data : flat());
        }
      },
      () => {
        if (!stale) {
          setLayout(flat());
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [project, pageIds]);

  const layoutCommand = async (
    pending: Promise<
      { status: "ok"; data: LayoutEntry[] } | { status: "error"; error: { message: string } }
    >,
  ): Promise<void> => {
    const result = await pending;
    if (result.status === "error") {
      setMessage(`Could not change the page list: ${result.error.message}`);
      return;
    }
    setLayout(result.data);
  };

  const saveLayout = async (next: readonly LayoutEntry[]): Promise<void> => {
    if (project === null) {
      return;
    }
    const before = layout;
    setLayout(next);
    const result = await commands.setLayout(project, [...next]);
    if (result.status === "error") {
      setLayout(before);
      setMessage(`Could not move that: ${result.error.message}`);
      return;
    }
    setLayout(result.data);
  };

  const addChapter = async (): Promise<string | null> => {
    if (project === null) {
      return null;
    }
    const result = await commands.addChapter(project, "New chapter");
    if (result.status === "error") {
      setMessage(`Could not add a chapter: ${result.error.message}`);
      return null;
    }
    setLayout(result.data.layout);
    return result.data.id;
  };

  const renamePage = async (id: string, name: string): Promise<void> => {
    if (project === null) {
      return;
    }
    const result = await commands.renamePage(project, id, name);
    if (result.status === "error") {
      setMessage(`Could not rename that page: ${result.error.message}`);
      return;
    }
    setPages((prev) => prev.map((p) => (p.id === id ? result.data : p)));
  };

  const deletePage = async (id: string): Promise<void> => {
    if (project === null) {
      return;
    }
    await flush();
    if (session.current?.dirty === true) {
      setMessage(UNSAVED_NOTE);
      return;
    }
    const result = await commands.deletePage(project, id);
    if (result.status === "error") {
      setMessage(`Could not delete that page: ${result.error.message}`);
      return;
    }
    const ordered = orderPages(pages, layout);
    const index = ordered.findIndex((p) => p.id === id);
    setPages(result.data);
    if (id === currentId) {
      const remaining = ordered.filter(
        (p) => p.id !== id && result.data.some((r) => r.id === p.id),
      );
      const next =
        remaining[Math.max(0, index)] ?? remaining[remaining.length - 1] ?? result.data[0];
      if (next !== undefined) {
        await showPage(project, next.id);
      }
    }
  };

  const openMatch = async (path: string, id: string, query: string, nth: number): Promise<void> => {
    if (id !== currentId) {
      await showPage(path, id);
    }
    setFind({ query, nth });
  };

  const restoreMatch = async (path: string, id: string, query: string, nth: number) => {
    const result = await commands.restorePage(path, id);
    if (result.status === "error") {
      setMessage(`Could not restore that page: ${result.error.message}`);
      return;
    }
    setPages(result.data);
    await openMatch(path, id, query, nth);
  };

  // Reopen the last project so the app opens straight to writing.
  useEffect(() => {
    const last = rememberedProject();
    if (last !== null) {
      queueMicrotask(() => {
        void openFolder(last);
      });
    }
  }, [openFolder]);

  useEffect(() => {
    void restoreCustomFonts();
  }, []);

  useEffect(() => {
    applyAppearance(appearance, customThemes);
    saveAppearance(appearance);
    saveCustomThemes(customThemes);
  }, [appearance, customThemes]);

  // "Follow system" tracks the operating system while the app is open.
  useEffect(() => {
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const redo = (): void => {
      applyAppearance(appearance, customThemes);
    };
    query?.addEventListener("change", redo);
    return () => {
      query?.removeEventListener("change", redo);
    };
  }, [appearance, customThemes]);

  // ⌘S / Ctrl+S saves now; hiding the window or closing it saves too.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFocusMode((v) => !v);
      } else if (event.key === "Escape") {
        setFocusMode(false);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "i"
      ) {
        event.preventDefault();
        setShelfOpen(true);
        window.setTimeout(() => quickCapture.current?.focus(), 0);
      }
    };
    const onHide = (): void => {
      void flush();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // Closing the window waits for the page to be saved; if it cannot be, the window stays open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          await flush();
          if (session.current?.dirty === true) {
            event.preventDefault();
            setMessage(UNSAVED_NOTE);
          }
        })
        .then((off) => {
          if (disposed) {
            off();
          } else {
            unlisten = off;
          }
        })
        .catch(() => {
          // Not running inside the desktop window (for example in tests).
        });
    } catch {
      // Same as above.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flush]);

  const onChange = (value: string): void => {
    const s = session.current;
    if (s === null) {
      return;
    }
    s.text = value;
    s.dirty = true;
    setText(value);
    setSaveState("saving");
    setPages((prev) =>
      prev.map((p) => (p.id === s.id && !p.named ? { ...p, title: firstLine(value) } : p)),
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flush();
    }, AUTOSAVE_MS);
  };

  const captureIdea = async (box: HTMLTextAreaElement): Promise<void> => {
    if (project === null || box.value.trim() === "") {
      return;
    }
    const result = await commands.addIdea(project, box.value);
    if (result.status === "error") {
      setMessage(`Could not save that idea: ${result.error.message}`);
      return;
    }
    box.value = "";
    setIdeas((prev) => [result.data, ...prev]);
  };

  const dealPrompt = async (): Promise<void> => {
    if (project === null) {
      return;
    }
    const seen = await commands.seenPrompts(project);
    const next = pickPrompt(new Set(seen.status === "ok" ? seen.data : []));
    if (next === null) {
      setPrompt("You have seen every prompt this app has to offer.");
      setCredit("");
      return;
    }
    setPrompt(next.text);
    setCredit(next.credit ?? "");
    await commands.markPromptSeen(project, promptHash(next));
  };

  const saveLabel =
    saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : "Not saved yet";

  return (
    <main
      className="app-shell"
      data-testid="app-shell"
      data-app-version={info?.version ?? ""}
      aria-label="InkSpark"
      data-focus={focusMode}
    >
      <h1 className="visually-hidden">InkSpark</h1>
      {project === null ? (
        <div className="welcome">
          <button type="button" onClick={() => void chooseFolder()}>
            Choose a folder to write in
          </button>
          {message !== "" && <p className="note">{message}</p>}
        </div>
      ) : (
        <div className="workspace">
          <nav className="pages" aria-label="Pages">
            <SearchBox
              key={`search-${project}`}
              project={project}
              onOpen={(hit, query) => void openMatch(project, hit.id, query, hit.nth)}
              onRestore={(hit, query) => void restoreMatch(project, hit.id, query, hit.nth)}
            />
            <PageList
              key={project}
              project={project}
              pages={pages}
              layout={layout}
              currentId={currentId}
              onOpen={(id) => void showPage(project, id)}
              onAddPage={() => void addPage()}
              onAddChapter={addChapter}
              onRename={(id, name) => void renamePage(id, name)}
              onDelete={(id) => void deletePage(id)}
              onLayout={(next) => void saveLayout(next)}
              onRenameChapter={(id, name) =>
                void layoutCommand(commands.renameChapter(project, id, name))
              }
              onRemoveChapter={(id) => void layoutCommand(commands.removeChapter(project, id))}
            />
            <div className="pages-actions">
              <button
                type="button"
                title="Change folder: open a different folder of pages"
                onClick={() => void chooseFolder()}
              >
                Change folder
              </button>
              <RecentlyDeleted
                project={project}
                onRestored={(restored, id) => {
                  setPages(restored);
                  void showPage(project, id);
                }}
                onProblem={setMessage}
              />
            </div>
          </nav>
          <section className="editor" aria-label="Editor">
            <ExportMenu
              project={project}
              pages={orderPages(pages, layout)}
              currentId={currentId}
              saveFirst={saveFirst}
            />
            <SettingsPopover
              value={appearance}
              project={project}
              customThemes={customThemes}
              onChange={setAppearance}
              onCustomThemes={setCustomThemes}
            />
            <RichEditor pageKey={currentId} markdown={text} onChange={onChange} find={find} />
            <div className="prompt-bar">
              <button
                type="button"
                title="Prompt: show a new writing prompt or passage. It fades as you type."
                onClick={() => void dealPrompt()}
              >
                Prompt
              </button>
              {prompt !== "" && (
                <PromptCard
                  key={prompt}
                  text={prompt}
                  credit={credit}
                  onClose={() => {
                    setPrompt("");
                    setCredit("");
                  }}
                />
              )}
            </div>
            <span
              className="save-dot"
              data-state={saveState}
              role="status"
              aria-label={saveLabel}
              title={`${saveLabel}. Saves by itself as you write; save now with ⌘S.`}
            />
            {message !== "" && <p className="note">{message}</p>}
          </section>
          <aside className="shelf" aria-label="Idea Shelf" data-open={shelfOpen}>
            <button
              type="button"
              aria-expanded={shelfOpen}
              title="Idea Shelf: show or hide your quick notes. Jump to it with ⌘⇧I."
              onClick={() => {
                setShelfOpen((v) => !v);
              }}
            >
              {shelfOpen ? "Hide ideas" : "Ideas"}
            </button>
            {shelfOpen && (
              <>
                <textarea
                  ref={quickCapture}
                  aria-label="Quick capture"
                  title="Quick capture: jot down an idea (⌘⇧I)"
                  placeholder="Jot an idea, then ⌘↵ (⌘⇧I to focus)"
                  rows={3}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void captureIdea(event.currentTarget);
                    }
                  }}
                />
                <ul>
                  {ideas.map((idea) => (
                    <li key={idea.id}>{idea.text}</li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
