import { save } from "@tauri-apps/plugin-dialog";
import { type JSX, useEffect, useRef, useState } from "react";
import { type PageSummary, commands } from "../contracts";
import type { Appearance } from "./appearance";
import { buildDocx, buildMarkdown, fileNameFrom } from "./exportDoc";

type Scope = "page" | "all";
type Format = "md" | "docx";

const FILTERS: Record<Format, { name: string; extensions: string[] }> = {
  md: { name: "Markdown", extensions: ["md"] },
  docx: { name: "Word document", extensions: ["docx"] },
};

interface Props {
  project: string;
  pages: readonly PageSummary[];
  currentId: string | null;
  appearance: Appearance;
  saveFirst: () => Promise<boolean>;
}

/** Export floats over the page, so opening it moves nothing. */
export function ExportMenu({
  project,
  pages,
  currentId,
  appearance,
  saveFirst,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
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
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (scope: Scope, format: Format): Promise<void> => {
    setNote("");
    const chosen = scope === "all" ? pages : pages.filter((p) => p.id === currentId);
    const name =
      scope === "all"
        ? (project.split(/[/\\]/).filter(Boolean).pop() ?? "")
        : (chosen[0]?.title ?? "");
    try {
      const dest = await save({
        defaultPath: `${fileNameFrom(name)}.${format}`,
        filters: [FILTERS[format]],
      });
      if (dest === null) {
        return;
      }
      if (!(await saveFirst())) {
        setNote("The page could not be saved yet, so nothing was exported.");
        return;
      }
      const texts: string[] = [];
      for (const page of chosen) {
        const read = await commands.readPage(project, page.id);
        if (read.status === "error") {
          setNote(`Nothing was exported: ${read.error.message}`);
          return;
        }
        texts.push(read.data);
      }
      const result =
        format === "md"
          ? await commands.exportMarkdown(project, dest, buildMarkdown(texts))
          : await commands.exportDocx(project, dest, buildDocx(texts, appearance));
      setNote(
        result.status === "ok"
          ? `Saved to ${result.data}`
          : `Nothing was exported: ${result.error.message}`,
      );
    } catch (error: unknown) {
      setNote(`Nothing was exported: ${String(error)}`);
    }
  };

  const action = (scope: Scope, format: Format, label: string, what: string): JSX.Element => (
    <button
      type="button"
      aria-label={`Export ${what} as ${label}`}
      disabled={scope === "page" && currentId === null}
      onClick={() => void run(scope, format)}
    >
      {label}
    </button>
  );

  return (
    <div className="export-menu" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Export"
        title="Export"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setNote("");
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 10V2M5 5l3-3 3 3M3 9v4.5h10V9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Export">
          <h2>This page</h2>
          <div className="export-actions">
            {action("page", "md", "Markdown", "this page")}
            {action("page", "docx", "Word", "this page")}
          </div>
          <h2>All pages, as one file</h2>
          <div className="export-actions">
            {action("all", "md", "Markdown", "all pages")}
            {action("all", "docx", "Word", "all pages")}
          </div>
          {note !== "" && (
            <p className="hint export-result" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
