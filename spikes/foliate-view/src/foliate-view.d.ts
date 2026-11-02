// Types for the parts of upstream foliate-js (vendor/foliate-js/view.js) that the harness uses.
// Upstream is plain JavaScript without declarations; these mirror its runtime shapes.

export interface FoliateTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[] | null;
}

/**
 * `detail` of the `data` event on `book.transformTarget` (epub.js `Loader#createURL`). Listeners
 * may replace `data` and `type` before the resource becomes a blob: URL.
 */
export interface FoliateDataDetail {
  /** The resource's path inside the EPUB (read-only). */
  readonly name: string;
  data: string | Blob | Promise<string | Blob>;
  type: string;
}

export interface FoliateBook {
  toc?: FoliateTocItem[];
  /** From the spine's `page-progression-direction`. */
  dir?: string;
  sections: unknown[];
  /** Dispatches `data` events (`CustomEvent<FoliateDataDetail>`); EPUB only. */
  transformTarget?: EventTarget;
  /** Reads a file from the EPUB container by path. */
  loadText?: (name: string) => Promise<string | null>;
}

/** `detail` of the `relocate` event (view.js `#onRelocate`, progress.js `getProgress`). */
export interface FoliateRelocateDetail {
  fraction?: number;
  section?: { current: number; total: number };
}

export interface FoliateView extends HTMLElement {
  readonly book?: FoliateBook;
  open(book: Blob): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  close(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "foliate-view": FoliateView;
  }
}
