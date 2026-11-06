import { type CSSProperties, type JSX, useEffect, useRef, useState } from "react";
import { ImportIcon, pickAndImportFont } from "./customFonts";
import type { FontOption } from "./fonts";

const IMPORT_VALUE = "__import__";

const LIST_HEIGHT = 256;

interface Props {
  label: string;
  options: readonly FontOption[];
  value: string;
  onChange: (value: string) => void;
  /** Starts the list with a button that imports a font file and picks it. */
  canImport?: boolean;
}

/** A font menu whose choices each appear in their own font. It floats, so nothing moves. */
export function FontPicker({
  label,
  options,
  value,
  onChange,
  canImport = false,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [problem, setProblem] = useState(false);
  const current = options.find((o) => o.value === value);
  const rows: readonly FontOption[] = canImport
    ? [{ label: "Import font", value: IMPORT_VALUE }, ...options]
    : options;

  useEffect(() => {
    if (!open) {
      return;
    }
    list.current?.focus();
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const item = list.current?.children[active];
      // Test environments have no layout, so no scrolling either.
      if (item !== undefined && "scrollIntoView" in item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [open, active]);

  const show = (): void => {
    const box = button.current?.getBoundingClientRect();
    if (box !== undefined) {
      const below = box.bottom + LIST_HEIGHT + 8 <= window.innerHeight;
      setPlace({
        left: Math.max(8, Math.min(box.left, window.innerWidth - 240)),
        ...(below ? { top: box.bottom + 4 } : { bottom: window.innerHeight - box.top + 4 }),
      });
    }
    setActive(
      Math.max(
        0,
        rows.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };

  const importFont = async (): Promise<void> => {
    const result = await pickAndImportFont();
    if (result === "failed") {
      setProblem(true);
    } else if (result !== null) {
      setProblem(false);
      setOpen(false);
      onChange(result.value);
    }
  };

  const choose = (option: FontOption | undefined): void => {
    if (option?.value === IMPORT_VALUE) {
      void importFont();
      return;
    }
    setOpen(false);
    if (option !== undefined) {
      onChange(option.value);
    }
  };

  return (
    <span className="font-picker fmt-tip-target" ref={root} data-tip={label}>
      <button
        ref={button}
        type="button"
        className="fmt-btn font-picker-btn"
        aria-label={`${label}: ${current?.label ?? "Custom"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: value }}
        // Keeps the text selection in the writing.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            show();
          }
        }}
      >
        <span className="font-picker-name">{current?.label ?? "Custom"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          ref={list}
          className="font-list"
          role="listbox"
          aria-label={label}
          tabIndex={0}
          aria-activedescendant={`${label}-${String(active)}`}
          style={place}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(rows.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              choose(rows[active]);
            } else if (e.key === "Escape") {
              // Closes only this list, not the panel around it.
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {rows.map((option, index) => (
            <li
              key={option.label}
              id={`${label}-${String(index)}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              className={option.value === IMPORT_VALUE ? "font-import-row" : undefined}
              style={option.value === IMPORT_VALUE ? undefined : { fontFamily: option.value }}
              onMouseEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                choose(option);
              }}
            >
              {option.value === IMPORT_VALUE ? (
                <>
                  <ImportIcon />
                  {problem ? "That file could not be read as a font" : option.label}
                </>
              ) : (
                option.label
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
