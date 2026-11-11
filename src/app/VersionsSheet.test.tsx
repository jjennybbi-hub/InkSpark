import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { VersionsSheet } from "./VersionsSheet";

const STAMP = "00000001700000000000";

function mock(): void {
  mockIPC((cmd, args) => {
    if (cmd === "list_versions") {
      return [{ stamp: STAMP, savedAt: 1700000000000 }];
    }
    if (cmd === "read_version") {
      expect((args as { stamp: string }).stamp).toBe(STAMP);
      return "The older words.";
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
}

describe("VersionsSheet", () => {
  it("lists versions, previews one read-only, and restores it", async () => {
    mock();
    const saveFirst = vi.fn(() => Promise.resolve(true));
    const onRestore = vi.fn(() => Promise.resolve(true));
    const { container } = render(
      <VersionsSheet project="/b" pageId="p1" saveFirst={saveFirst} onRestore={onRestore} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Old versions" }));
    const sheet = await screen.findByRole("dialog", { name: "Old versions" });
    expect(saveFirst).toHaveBeenCalled();
    const entry = await waitFor(() => {
      const items = sheet.querySelectorAll(".versions-list button");
      expect(items).toHaveLength(1);
      return items[0] as HTMLElement;
    });
    fireEvent.click(entry);
    expect(await screen.findByLabelText("Version text")).toHaveTextContent("The older words.");
    expect(screen.queryByRole("textbox")).toBeNull();
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith("The older words.");
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/newest version/);
  });

  it("closes with Escape", async () => {
    mock();
    render(
      <VersionsSheet
        project="/b"
        pageId="p1"
        saveFirst={() => Promise.resolve(true)}
        onRestore={() => Promise.resolve(true)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Old versions" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
