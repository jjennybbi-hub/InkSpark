import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { PageList, RecentlyDeleted } from "./PageList";

const PAGES = [{ id: "p1", title: "Chapter one", named: false }];

function setup(): { onRename: ReturnType<typeof vi.fn>; onDelete: ReturnType<typeof vi.fn> } {
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <PageList
      pages={PAGES}
      currentId="p1"
      onOpen={vi.fn()}
      onRename={onRename}
      onDelete={onDelete}
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
