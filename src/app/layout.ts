import type { LayoutEntry, PageSummary } from "../contracts";

type Chapter = Extract<LayoutEntry, { kind: "chapter" }>;

/** A row of the page list: a page or a chapter, by id. */
export interface Ref {
  kind: "page" | "chapter";
  id: string;
}

/** Where a dragged row lands relative to the row under it. "into" puts a page inside a chapter. */
export type Place = "before" | "after" | "into";

function copy(layout: readonly LayoutEntry[]): LayoutEntry[] {
  return layout.map((e) => (e.kind === "chapter" ? { ...e, pages: [...e.pages] } : { ...e }));
}

function chapters(layout: readonly LayoutEntry[]): Chapter[] {
  return layout.filter((e): e is Chapter => e.kind === "chapter");
}

/** Removes a row (mutating `layout`) and returns it as a top-level entry, or null if absent. */
function take(layout: LayoutEntry[], ref: Ref): LayoutEntry | null {
  const top = layout.findIndex((e) => e.kind === ref.kind && e.id === ref.id);
  if (top >= 0) {
    return layout.splice(top, 1)[0] ?? null;
  }
  if (ref.kind === "page") {
    for (const chapter of chapters(layout)) {
      const index = chapter.pages.indexOf(ref.id);
      if (index >= 0) {
        chapter.pages.splice(index, 1);
        return { kind: "page", id: ref.id };
      }
    }
  }
  return null;
}

/** The chapter a page is in, or null when it is at the top level. */
export function chapterOf(layout: readonly LayoutEntry[], pageId: string): string | null {
  return chapters(layout).find((c) => c.pages.includes(pageId))?.id ?? null;
}

/** Pages in list order, for exports and for opening a neighbour. */
export function orderPages(
  pages: readonly PageSummary[],
  layout: readonly LayoutEntry[],
): PageSummary[] {
  const ids = layout.flatMap((e) => (e.kind === "chapter" ? e.pages : [e.id]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ordered = ids.flatMap((id) => {
    const page = byId.get(id);
    return page === undefined ? [] : [page];
  });
  const missing = pages.filter((p) => !ids.includes(p.id));
  return [...ordered, ...missing];
}

/** Moves a row next to (or, for a page onto a chapter, into) another. Chapters never nest. */
export function moveTo(
  layout: readonly LayoutEntry[],
  dragged: Ref,
  target: Ref,
  place: Place,
): readonly LayoutEntry[] {
  if (dragged.kind === target.kind && dragged.id === target.id) {
    return layout;
  }
  const next = copy(layout);
  const item = take(next, dragged);
  if (item === null) {
    return layout;
  }
  const at = (index: number): number => (place === "before" ? index : index + 1);
  const top = next.findIndex((e) => e.kind === target.kind && e.id === target.id);
  if (top >= 0) {
    const chapter = next[top];
    if (place === "into" && item.kind === "page" && chapter?.kind === "chapter") {
      chapter.pages.push(item.id);
    } else {
      next.splice(at(top), 0, item);
    }
    return next;
  }
  for (const [index, chapter] of next.entries()) {
    const inner = chapter.kind === "chapter" ? chapter.pages.indexOf(target.id) : -1;
    if (chapter.kind === "chapter" && inner >= 0) {
      if (item.kind === "page") {
        chapter.pages.splice(at(inner), 0, item.id);
      } else {
        next.splice(at(index), 0, item);
      }
      return next;
    }
  }
  return layout;
}

/** Swaps a row with its neighbour above (-1) or below (1), within its own chapter or level. */
export function moveBy(
  layout: readonly LayoutEntry[],
  ref: Ref,
  step: -1 | 1,
): readonly LayoutEntry[] {
  const next = copy(layout);
  const swap = (list: unknown[], index: number): boolean => {
    const other = index + step;
    const a = list[index];
    const b = list[other];
    if (index < 0 || a === undefined || b === undefined) {
      return false;
    }
    list[index] = b;
    list[other] = a;
    return true;
  };
  if (
    swap(
      next,
      next.findIndex((e) => e.kind === ref.kind && e.id === ref.id),
    )
  ) {
    return next;
  }
  const home = chapters(next).find((c) => ref.kind === "page" && c.pages.includes(ref.id));
  if (home !== undefined && swap(home.pages, home.pages.indexOf(ref.id))) {
    return next;
  }
  return layout;
}

/** Puts a page at the end of a chapter, or at the end of the list when `chapterId` is null. */
export function moveToChapter(
  layout: readonly LayoutEntry[],
  pageId: string,
  chapterId: string | null,
): readonly LayoutEntry[] {
  const next = copy(layout);
  const item = take(next, { kind: "page", id: pageId });
  if (item === null) {
    return layout;
  }
  const chapter = chapters(next).find((c) => c.id === chapterId);
  if (chapter === undefined) {
    next.push(item);
  } else {
    chapter.pages.push(pageId);
  }
  return next;
}
