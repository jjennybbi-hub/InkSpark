// foliate-js reader harness (M0 §5.2): a thin wrapper around upstream `<foliate-view>`.
// The vendored module has no type declarations, so the parts this harness uses are typed in
// `foliate-view.d.ts`. It is loaded lazily (`foliate-element.ts`) to keep this file Node-safe.
import type { FoliateRelocateDetail, FoliateTocItem } from "./foliate-view";
import { inlineStylesheets } from "./inline-styles";

export { TAURI_CSP } from "./csp";

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

const EPUB_MEDIA_TYPE = "application/epub+zip";

/** Depth-first flattening, so nested navs keep reading order. */
function flattenToc(items: readonly FoliateTocItem[] | undefined): TocItem[] {
  const flat: TocItem[] = [];
  for (const item of items ?? []) {
    if (item.href !== undefined) {
      flat.push({ label: item.label?.trim() ?? "", href: item.href });
    }
    flat.push(...flattenToc(item.subitems ?? undefined));
  }
  return flat;
}

/** Opens EPUB bytes in a `<foliate-view>` inside `container`. */
export async function openBook(container: HTMLElement, data: Uint8Array): Promise<ReaderHandle> {
  await import("./foliate-element");
  const view = document.createElement("foliate-view");
  view.setAttribute("aria-label", "Book");
  let location: ReaderLocation = { fraction: 0, sectionIndex: 0 };
  view.addEventListener("relocate", (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as FoliateRelocateDetail;
    location = {
      fraction: detail.fraction ?? location.fraction,
      sectionIndex: detail.section?.current ?? location.sectionIndex,
    };
  });
  container.append(view);

  try {
    // Copy into a fresh ArrayBuffer-backed array: Blob parts may not be SharedArrayBuffer views.
    const file = new File([new Uint8Array(data)], "book.epub", { type: EPUB_MEDIA_TYPE });
    await view.open(file);
    if (view.book !== undefined) inlineStylesheets(view.book);
    await view.goTo(0);
  } catch (error) {
    view.close();
    view.remove();
    throw error;
  }

  const book = view.book;
  const toc = flattenToc(book?.toc);
  let closed = false;

  return {
    toc,
    dir: book?.dir === "rtl" ? "rtl" : "ltr",
    next: () => view.next(),
    prev: () => view.prev(),
    async goToTocItem(index: number): Promise<void> {
      const item = toc[index];
      if (item === undefined) {
        throw new RangeError(`TOC index ${String(index)} is outside 0..${String(toc.length - 1)}`);
      }
      await view.goTo(item.href);
    },
    getLocation: () => ({ ...location }),
    close(): void {
      if (closed) return;
      closed = true;
      view.close();
      view.remove();
    },
  };
}
