import { useEffect, useState, type JSX } from "react";

/** Keeps a resting hand on the trackpad from bringing the card back mid-sentence. */
const MOUSE_TRAVEL_TO_SHOW = 4;

function isTypingKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  return event.key.length === 1 || ["Enter", "Backspace", "Delete"].includes(event.key);
}

interface PromptCardProps {
  text: string;
  credit: string;
  onClose: () => void;
}

/**
 * The dealt prompt. It fades while the writer types, so the words behind it can be read, and comes
 * back when the mouse moves (or Tab is pressed, for keyboard use). Dealing a new prompt remounts it.
 */
export function PromptCard({ text, credit, onClose }: PromptCardProps): JSX.Element {
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    let travel = 0;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Tab") {
        setFaded(false);
      } else if (isTypingKey(event)) {
        travel = 0;
        setFaded(true);
      }
    };
    const onMouseMove = (event: MouseEvent): void => {
      travel += Math.abs(event.movementX) + Math.abs(event.movementY);
      if (travel >= MOUSE_TRAVEL_TO_SHOW) {
        setFaded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <div className="prompt-card" data-testid="prompt-card" data-faded={faded}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Close prompt"
        title="Close prompt"
        onClick={onClose}
      >
        ×
      </button>
      <p>
        {text}
        {credit !== "" && <span className="prompt-credit"> — {credit}</span>}
      </p>
    </div>
  );
}
