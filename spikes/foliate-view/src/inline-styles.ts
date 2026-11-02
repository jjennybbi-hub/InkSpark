// Inlines EPUB stylesheets so book CSS works under InkSpark's Tauri CSP (ADR 003, "CSP findings").
//
// Upstream foliate-js turns every EPUB resource into a blob: URL, including linked CSS. The
// app CSP allows `style-src 'self' 'unsafe-inline'`, which does not match blob:, so every
// `<link rel="stylesheet" href="blob:…">` in a section is blocked. This uses foliate's public
// `book.transformTarget` hook to replace those links with `<style>` elements holding the same,
// already-processed CSS (url() references are blob: URLs, allowed by img-src/font-src).
//
// Known gaps (ADR 003): an `@import` inside book CSS still resolves to a blob: stylesheet and
// stays blocked. In sections foliate demotes to text/html, XMLSerializer escapes `<`, `>` and `&`
// in the inlined CSS, which breaks child combinators (upstream damages inline <style> the same way).
// Alternate stylesheets (`rel="alternate stylesheet"`) are left as links.
import type { FoliateBook, FoliateDataDetail } from "./foliate-view";

const CSS = "text/css";
const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["application/xhtml+xml", "text/html"]);
const STYLESHEET_LINKS = 'link[rel~="stylesheet" i][href]';
/** Base for resolving in-book relative paths with the URL parser; never fetched. */
const BOOK_BASE = "https://book.invalid/";

/** Resolves `href` against `from` the way foliate's `resolveURL` keys the manifest (decodeURI). */
function resolveInBook(href: string, from: string): string | null {
  try {
    const url = new URL(href, BOOK_BASE + from);
    if (url.origin !== new URL(BOOK_BASE).origin) return null;
    return decodeURI(url.pathname.slice(1));
  } catch {
    return null;
  }
}

function isAlternate(link: Element): boolean {
  return /\balternate\b/i.test(link.getAttribute("rel") ?? "");
}

function isDataDetail(value: unknown): value is FoliateDataDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "type" in value &&
    typeof value.type === "string" &&
    "data" in value
  );
}

async function asText(data: FoliateDataDetail["data"]): Promise<string> {
  const value = await data;
  return typeof value === "string" ? value : value.text();
}

/**
 * Registers the transform on `book`. Call after `<foliate-view>.open()` (so foliate's own CSS
 * transform runs first) and before the first section loads.
 */
export function inlineStylesheets(book: FoliateBook): void {
  const target = book.transformTarget;
  const loadText = book.loadText;
  if (target === undefined || loadText === undefined) return;

  /** Processed CSS by in-book path. Sections load after the stylesheets they link. */
  const cssByPath = new Map<string, Promise<string | null>>();

  async function inline(markup: string, name: string, type: string): Promise<string> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, type as DOMParserSupportedType);
    const links = Array.from(doc.querySelectorAll(STYLESHEET_LINKS));
    if (links.length === 0) return markup;

    // foliate has already rewritten the hrefs to blob: URLs, so read the originals (same
    // elements, same order) from the container.
    const original = await loadText?.(name);
    if (original === null || original === undefined) return markup;
    const originalLinks = Array.from(
      parser
        .parseFromString(original, type as DOMParserSupportedType)
        .querySelectorAll(STYLESHEET_LINKS),
    );
    if (originalLinks.length !== links.length) return markup;

    let changed = false;
    for (const [index, link] of links.entries()) {
      if (isAlternate(link)) continue;
      const href = originalLinks[index]?.getAttribute("href");
      const path = href === null || href === undefined ? null : resolveInBook(href, name);
      const css = path === null ? null : await (cssByPath.get(path) ?? null);
      if (css === null) continue;
      const style = doc.createElementNS(doc.documentElement.namespaceURI, "style");
      const media = link.getAttribute("media");
      if (media !== null) style.setAttribute("media", media);
      style.textContent = css;
      link.replaceWith(style);
      changed = true;
    }
    return changed ? new XMLSerializer().serializeToString(doc) : markup;
  }

  target.addEventListener("data", (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (!isDataDetail(detail)) return;
    if (detail.type === CSS) {
      // A stylesheet that fails to load keeps its <link>; foliate reports the failure itself.
      cssByPath.set(
        detail.name,
        asText(detail.data).catch(() => null),
      );
    } else if (DOCUMENT_TYPES.has(detail.type)) {
      const { name, type } = detail;
      // If inlining fails, the section still loads unmodified (its CSS is then blocked).
      detail.data = asText(detail.data).then((markup) =>
        inline(markup, name, type).catch(() => markup),
      );
    }
  });
}
