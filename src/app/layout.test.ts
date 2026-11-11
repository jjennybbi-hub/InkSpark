import { describe, expect, it } from "vitest";
import type { LayoutEntry } from "../contracts";
import { chapterOf, moveBy, moveTo, moveToChapter, orderPages } from "./layout";

const BASE: readonly LayoutEntry[] = [
  { kind: "page", id: "a" },
  { kind: "chapter", id: "c1", name: "One", pages: ["b", "c"] },
  { kind: "page", id: "d" },
  { kind: "chapter", id: "c2", name: "Two", pages: [] },
];

const ids = (layout: readonly LayoutEntry[]): string[] =>
  layout.flatMap((e) => (e.kind === "chapter" ? [`[${e.id}`, ...e.pages, "]"] : [e.id]));

describe("page layout moves", () => {
  it("drops a page before or after another page, in or out of chapters", () => {
    expect(
      ids(moveTo(BASE, { kind: "page", id: "a" }, { kind: "page", id: "c" }, "before")),
    ).toEqual(["[c1", "b", "a", "c", "]", "d", "[c2", "]"]);
    expect(
      ids(moveTo(BASE, { kind: "page", id: "b" }, { kind: "page", id: "d" }, "after")),
    ).toEqual(["a", "[c1", "c", "]", "d", "b", "[c2", "]"]);
  });

  it("drops a page into a chapter, at its end", () => {
    const moved = moveTo(BASE, { kind: "page", id: "a" }, { kind: "chapter", id: "c2" }, "into");
    expect(ids(moved)).toEqual(["[c1", "b", "c", "]", "d", "[c2", "a", "]"]);
  });

  it("never nests a chapter: dropped on a page inside one, it goes beside that chapter", () => {
    const moved = moveTo(BASE, { kind: "chapter", id: "c2" }, { kind: "page", id: "b" }, "before");
    expect(ids(moved)).toEqual(["a", "[c2", "]", "[c1", "b", "c", "]", "d"]);
    const into = moveTo(BASE, { kind: "chapter", id: "c2" }, { kind: "chapter", id: "c1" }, "into");
    expect(into.every((e) => e.kind === "page" || !e.pages.includes("c2"))).toBe(true);
  });

  it("keeps every page and leaves the input untouched", () => {
    const moved = moveTo(BASE, { kind: "chapter", id: "c1" }, { kind: "page", id: "d" }, "after");
    expect(
      ids(moved)
        .filter((x) => !x.startsWith("[") && x !== "]")
        .sort(),
    ).toEqual(["a", "b", "c", "d"]);
    expect(ids(BASE)).toEqual(["a", "[c1", "b", "c", "]", "d", "[c2", "]"]);
  });

  it("does nothing when dropped on itself or on something unknown", () => {
    expect(moveTo(BASE, { kind: "page", id: "a" }, { kind: "page", id: "a" }, "after")).toBe(BASE);
    expect(moveTo(BASE, { kind: "page", id: "a" }, { kind: "page", id: "zz" }, "after")).toBe(BASE);
  });

  it("moves up and down within a chapter or the top level only", () => {
    expect(ids(moveBy(BASE, { kind: "page", id: "c" }, -1))).toEqual([
      "a",
      "[c1",
      "c",
      "b",
      "]",
      "d",
      "[c2",
      "]",
    ]);
    expect(moveBy(BASE, { kind: "page", id: "b" }, -1)).toBe(BASE);
    expect(ids(moveBy(BASE, { kind: "chapter", id: "c1" }, 1))[0]).toBe("a");
  });

  it("moves a page to a chapter or out of one", () => {
    expect(chapterOf(moveToChapter(BASE, "a", "c2"), "a")).toBe("c2");
    expect(chapterOf(moveToChapter(BASE, "b", null), "b")).toBeNull();
  });

  it("orders pages as listed, keeping any the layout does not know", () => {
    const pages = ["d", "c", "b", "a", "new"].map((id) => ({ id, title: id, named: false }));
    expect(orderPages(pages, BASE).map((p) => p.id)).toEqual(["a", "b", "c", "d", "new"]);
  });
});
