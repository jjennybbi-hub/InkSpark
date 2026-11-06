import { type JSX, useSyncExternalStore } from "react";
import type { FontOption } from "./fonts";

const DB_NAME = "inkspark-fonts";
const STORE = "fonts";
const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A tray with an arrow going up: the usual picture for bringing in a file. */
export function ImportIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/** A tray with an arrow going down. */
export function DownloadIcon(): JSX.Element {
  return (
    <svg {...ICON}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

let fonts: readonly FontOption[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly FontOption[]): void {
  fonts = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export function useCustomFonts(): readonly FontOption[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => fonts,
  );
}

/** The menu name of a font file: "My-Font.woff2" becomes "My-Font". */
export function fontNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim();
}

/** Unknown fonts fall back to Arial, for example if the saved copy is ever lost. */
export function fontOptionFor(name: string): FontOption {
  return { label: name, value: `'${name}', Arial, Helvetica, sans-serif` };
}

async function register(name: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(name, data);
  await face.load();
  document.fonts.add(face);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Font storage is unavailable"));
    };
  });
}

/** Loads the fonts imported earlier. A font that cannot load is simply left out of the menus. */
export async function restoreCustomFonts(): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof FontFace === "undefined") {
    return;
  }
  try {
    const db = await openDb();
    const entries = await new Promise<{ names: string[]; data: unknown[] }>((resolve, reject) => {
      const store = db.transaction(STORE).objectStore(STORE);
      const keys = store.getAllKeys();
      const values = store.getAll();
      values.onsuccess = () => {
        resolve({ names: keys.result.map(String), data: values.result });
      };
      values.onerror = () => {
        reject(values.error ?? new Error("Fonts could not be read"));
      };
    });
    const loaded: FontOption[] = [];
    for (const [index, name] of entries.names.entries()) {
      const data = entries.data[index];
      if (data instanceof ArrayBuffer) {
        try {
          await register(name, data);
          loaded.push(fontOptionFor(name));
        } catch {
          // A damaged font must not stop the others or the app.
        }
      }
    }
    publish(loaded);
  } catch {
    // Writing still works with the built-in fonts.
  }
}

/** Checks the file really is a font, keeps a copy, and adds it to every font menu. */
export async function importFontFile(file: File): Promise<FontOption | "failed"> {
  const name = fontNameFromFile(file.name);
  if (name === "") {
    return "failed";
  }
  try {
    const data = await file.arrayBuffer();
    await register(name, data);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, name);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error("The font could not be kept"));
      };
    });
    const option = fontOptionFor(name);
    publish([...fonts.filter((f) => f.label !== name), option]);
    return option;
  } catch {
    return "failed";
  }
}

/** Asks for a font file. Resolves to null if the writer cancels. */
export function pickAndImportFont(): Promise<FontOption | "failed" | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff,.woff2";
    input.addEventListener("cancel", () => {
      resolve(null);
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
      } else {
        void importFontFile(file).then(resolve);
      }
    });
    input.click();
  });
}
