import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { RichEditor } from "./RichEditor";
import { SearchBox } from "./SearchBox";

const HITS = [
  {
    id: "p1",
    title: "Opening",
    deleted: false,
    nth: 0,
    before: "the ",
    matched: "lantern",
    after: " glowed",
  },
  { id: "p9", title: "Old", deleted: true, nth: 0, before: "", matched: "Lantern", after: "" },
];

function setup(): { onOpen: ReturnType<typeof vi.fn>; onRestore: ReturnType<typeof vi.fn> } {
  mockIPC((cmd) => (cmd === "search_pages" ? HITS : null));
  const onOpen = vi.fn();
  const onRestore = vi.fn();
  render(
    <main>
      <SearchBox project="/tmp/s" onOpen={onOpen} onRestore={onRestore} />
    </main>,
  );
  return { onOpen, onRestore };
}

async function search(word: string): Promise<void> {
  const field = screen.getByRole("searchbox", { name: "Search all pages" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: word } });
  await screen.findByText("Opening");
}

describe("SearchBox", () => {
  it("lists matches and opens a live page at its match", async () => {
    const { onOpen } = setup();
    await search("lantern");
    fireEvent.click(screen.getByRole("button", { name: /^Opening:/ }));
    expect(onOpen).toHaveBeenCalledWith(HITS[0], "lantern");
  });

  it("marks deleted pages and asks before restoring", async () => {
    const { onOpen, onRestore } = setup();
    await search("lantern");
    expect(screen.getByText("Deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Old:/ }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore and open" }));
    expect(onRestore).toHaveBeenCalledWith(HITS[1], "lantern");
  });

  it("⌘F focuses the search field", () => {
    setup();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("has no accessibility problems", async () => {
    setup();
    await search("lantern");
    await expectNoAxeViolations(document.body);
  });
});

describe("RichEditor find", () => {
  it("selects the asked-for match", async () => {
    // jsdom has no layout; scrolling the match into view needs these to exist.
    const empty = (): DOMRectList => [] as unknown as DOMRectList;
    const rect = (): DOMRect => new DOMRect();
    Range.prototype.getClientRects = empty;
    Range.prototype.getBoundingClientRect = rect;
    (Text.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = empty;
    const { container, rerender } = render(
      <RichEditor pageKey="a" markdown={"one Lantern\n\ntwo lantern"} onChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toContain("two");
    });
    act(() => {
      rerender(
        <RichEditor
          pageKey="a"
          markdown={"one Lantern\n\ntwo lantern"}
          onChange={vi.fn()}
          find={{ query: "lantern", nth: 1 }}
        />,
      );
    });
    await waitFor(() => {
      expect(window.getSelection()?.toString()).toBe("lantern");
    });
  });
});

describe("result tidying", () => {
  it("cuts snippets at whole words and groups a page's matches", async () => {
    const { groupByPage, trimEnd, trimStart } = await import("./SearchBox");
    expect(trimStart("s of something very shocking. You could ")).toBe(
      "…of something very shocking. You could ",
    );
    expect(trimEnd(" by the way his eye opened wide and his")).toBe(
      " by the way his eye opened wide and…",
    );
    expect(trimStart("short ")).toBe("short ");
    const a = { ...HITS[0], nth: 1 } as (typeof HITS)[0];
    expect(groupByPage([HITS[0], a, HITS[1]] as typeof HITS).map((g) => g.length)).toEqual([2, 1]);
  });
});
