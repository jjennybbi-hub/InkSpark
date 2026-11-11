import { type JSX, useEffect, useRef, useState } from "react";
import { type PageVersion, commands } from "../contracts";

interface Props {
  project: string;
  pageId: string | null;
  /** Saves the page first, so the newest typing is in the list. False if it could not be. */
  saveFirst: () => Promise<boolean>;
  /** Puts this text back on the page; the text it replaces becomes a version. */
  onRestore: (text: string) => Promise<boolean>;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Old versions float in a side sheet over the right edge, so opening it moves nothing. */
export function VersionsSheet({ project, pageId, saveFirst, onRestore }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [note, setNote] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const load = async (): Promise<void> => {
    setChosen(null);
    setPreview("");
    setVersions([]);
    if (pageId === null) {
      return;
    }
    if (!(await saveFirst())) {
      setNote("The page could not be saved yet, so the newest versions may be missing.");
    }
    const result = await commands.listVersions(project, pageId);
    if (result.status === "error") {
      setNote(`Could not list versions: ${result.error.message}`);
      return;
    }
    setVersions(result.data);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = async (stamp: string): Promise<void> => {
    if (pageId === null) {
      return;
    }
    setNote("");
    const result = await commands.readVersion(project, pageId, stamp);
    if (result.status === "error") {
      setNote(`Could not open that version: ${result.error.message}`);
      return;
    }
    setChosen(stamp);
    setPreview(result.data);
  };

  const restore = async (): Promise<void> => {
    if (await onRestore(preview)) {
      setNote("Restored. The text it replaced is now the newest version.");
      await load();
    } else {
      setNote("Nothing was restored; the page is unchanged.");
    }
  };

  return (
    <div className="versions-menu" ref={root}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Old versions"
        title="Old versions: see and restore earlier saves of this page"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={pageId === null}
        onClick={() => {
          setNote("");
          if (!open) {
            void load();
          }
          setOpen((v) => !v);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3.2l2 1.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="versions-sheet" role="dialog" aria-label="Old versions">
          <div className="versions-head">
            <h2>Old versions</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close old versions"
              title="Close (Esc)"
              onClick={() => {
                setOpen(false);
              }}
            >
              ×
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="hint">No earlier versions of this page yet.</p>
          ) : (
            <ul className="versions-list">
              {versions.map((v) => (
                <li key={v.stamp}>
                  <button
                    type="button"
                    aria-pressed={chosen === v.stamp}
                    onClick={() => void show(v.stamp)}
                  >
                    {WHEN.format(new Date(v.savedAt ?? Number(v.stamp)))}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chosen !== null && (
            <>
              <pre className="versions-preview" aria-label="Version text" tabIndex={0}>
                {preview}
              </pre>
              <button type="button" onClick={() => void restore()}>
                Restore this version
              </button>
            </>
          )}
          {note !== "" && (
            <p className="hint" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
