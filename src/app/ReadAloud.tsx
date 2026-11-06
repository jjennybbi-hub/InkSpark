import { type JSX, useEffect, useRef, useState } from "react";

const MAX_CHUNK = 1500;

/** Long text is spoken in pieces, because speech engines can stop partway through a long one. */
export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const line of text.split(/\n+/)) {
    let rest = line.trim();
    while (rest.length > MAX_CHUNK) {
      const window = rest.slice(0, MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf(" "));
      const end = cut > 0 ? cut + 1 : MAX_CHUNK;
      chunks.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest !== "") {
      chunks.push(rest);
    }
  }
  return chunks;
}

/** The selected writing if there is any, otherwise the whole page. */
function textToRead(): string {
  const page = document.querySelector<HTMLElement>(".page .ProseMirror");
  if (page === null) {
    return "";
  }
  const selection = window.getSelection();
  const picked = selection?.toString() ?? "";
  if (picked.trim() !== "" && selection !== null && page.contains(selection.anchorNode)) {
    return picked;
  }
  return Array.from(page.children, (block) => block.textContent).join("\n");
}

function speech(): SpeechSynthesis | null {
  return "speechSynthesis" in window ? window.speechSynthesis : null;
}

/** Hears the selection, or the whole page, in the computer's own voice. Runs only on request. */
export function ReadAloud({ pageKey }: { pageKey: string | null }): JSX.Element {
  const [speaking, setSpeaking] = useState(false);
  const [note, setNote] = useState("");
  const run = useRef(0);

  const stop = (): void => {
    run.current += 1;
    speech()?.cancel();
    setSpeaking(false);
  };

  // Stop when the page changes or this control goes away.
  useEffect(() => {
    return () => {
      run.current += 1;
      speech()?.cancel();
      setSpeaking(false);
    };
  }, [pageKey]);

  useEffect(() => {
    if (!speaking) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        run.current += 1;
        speech()?.cancel();
        setSpeaking(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [speaking]);

  const start = (): void => {
    const synth = speech();
    if (synth === null) {
      setNote("Read aloud isn't available on this computer.");
      return;
    }
    const chunks = speechChunks(textToRead());
    if (chunks.length === 0) {
      return;
    }
    setNote("");
    synth.cancel();
    run.current += 1;
    const mine = run.current;
    setSpeaking(true);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.onerror = () => {
        if (run.current === mine) {
          run.current += 1;
          synth.cancel();
          setSpeaking(false);
          setNote("Read aloud couldn't start on this computer.");
        }
      };
      if (index === chunks.length - 1) {
        utterance.onend = () => {
          if (run.current === mine) {
            setSpeaking(false);
          }
        };
      }
      synth.speak(utterance);
    });
  };

  const label = speaking ? "Stop reading" : "Read aloud";
  return (
    <span
      className="fmt-tip-target"
      data-tip={speaking ? "Stop reading (Esc)" : "Read aloud: hear the selected text spoken"}
    >
      <button
        type="button"
        className="fmt-btn"
        aria-label={label}
        aria-pressed={speaking}
        // Keeps the text selection when the button is clicked.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          if (speaking) {
            stop();
          } else {
            start();
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          {speaking ? (
            <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
          ) : (
            <path
              d="M2 6v4h2.5L8 13V3L4.5 6H2zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.4 6.4 0 0 1 0 9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </button>
      {note !== "" && (
        <p className="popover read-note" role="status">
          {note}
        </p>
      )}
    </span>
  );
}
