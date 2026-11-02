// foliate-js reader harness (M0 §5.2). Stubs until Track C implements them.

export { TAURI_CSP } from "./csp";

/** Stub body (removed by the implementer). Takes the arguments so the parameters count as used. */
function notImplemented(...args: readonly unknown[]): never {
  throw new Error("not implemented", { cause: args });
}

export interface TocItem {
  label: string;
  href: string;
}

export interface ReaderLocation {
  fraction: number;
  sectionIndex: number;
}

export interface ReaderHandle {
  toc: TocItem[];
  dir: "ltr" | "rtl";
  next(): Promise<void>;
  prev(): Promise<void>;
  goToTocItem(index: number): Promise<void>;
  getLocation(): ReaderLocation;
  close(): void;
}

/** Opens EPUB bytes in a `<foliate-view>` inside `container`. */
export function openBook(container: HTMLElement, data: Uint8Array): Promise<ReaderHandle> {
  notImplemented(container, data);
}
