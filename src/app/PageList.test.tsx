import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import type { LayoutEntry } from "../contracts";
import { PageList, RecentlyDeleted } from "./PageList";

const PAGES = [
  { id: "p1", title: "Chapter one", named: false },
  { id: "p2", title: "Scene", named: false },
];
const LAYOUT: LayoutEntry[] = [
  { kind: "page", id: "p1" },
  { kind: "chapter", id: "c1", name: "Part one", pages: ["p2"] },
];
const onLayout = vi.fn();
const onRemoveChapter = vi.fn();

function setup(): { onRename: ReturnType<typeof vi.fn>; onDelete: ReturnType<typeof vi.fn> } {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <PageList
      project="/tmp/b"
      pages={PAGES}
      layout={LAYOUT}
      currentId="p1"
      onOpen={vi.fn()}
      onAddPage={vi.fn()}
      onAddChapter={vi.fn(() => Promise.resolve(null))}
      onRename={onRename}
      onDelete={onDelete}
      onLayout={onLayout}
      onRenameChapter={vi.fn()}
      onRemoveChapter={onRemoveChapter}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Chapter one" }));
  return { onRename, onDelete };
}

describe("PageList", () => {
  it("deletes from the right-click menu", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renames with Enter, once", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "Page name" });
    fireEvent.change(box, { target: { value: "New name" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("p1", "New name");
  });

  it("Escape cancels a rename", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Page name" }), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Escape closes the menu", () => {
    setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("chapters", () => {
  it("moves a page into a chapter from the menu", () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Part one" }));
    expect(onLayout).toHaveBeenLastCalledWith([
      { kind: "chapter", id: "c1", name: "Part one", pages: ["p2", "p1"] },
    ]);
  });

  it("folds a chapter, and removing one keeps its pages", () => {
    setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Scene" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fold Part one" }));
    expect(screen.queryByRole("button", { name: "Scene" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Part one, chapter/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove chapter/ }));
    expect(onRemoveChapter).toHaveBeenCalledWith("c1");
  });

  it("offers New page and New chapter under +", () => {
    setup();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("menuitem", { name: "New page" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "New chapter" })).toBeTruthy();
  });
});

describe("RecentlyDeleted", () => {
  const open = async (calls: string[]): Promise<ReturnType<typeof vi.fn>> => {
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "list_deleted") {
        return [{ id: "p2", title: "Old page" }];
      }
      if (cmd === "restore_page") {
        return PAGES;
      }
      return null;
    });
    const onRestored = vi.fn();
    render(<RecentlyDeleted project="/tmp/b" onRestored={onRestored} onProblem={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Recently deleted" }));
    await screen.findByText("Old page");
    return onRestored;
  };

  it("restores a page", async () => {
    const onRestored = await open([]);
    fireEvent.click(screen.getByRole("button", { name: "Restore Old page" }));
    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledWith(PAGES, "p2");
    });
    expect(screen.queryByText("Old page")).toBeNull();
  });

  it("asks before erasing, and Keep erases nothing", async () => {
    const calls: string[] = [];
    await open(calls);
    fireEvent.click(screen.getByRole("button", { name: "Delete Old page forever" }));
    expect(calls).not.toContain("erase_page");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(calls).not.toContain("erase_page");
    fireEvent.click(screen.getByRole("button", { name: "Delete Old page forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => {
      expect(calls).toContain("erase_page");
    });
  });

  it("has no accessibility problems", async () => {
    await open([]);
    await expectNoAxeViolations(document.body);
  });
});
