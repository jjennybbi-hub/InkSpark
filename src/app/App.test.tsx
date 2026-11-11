import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { App } from "./App";

const ENCOURAGEMENT = /goal|streak|great job|keep going|words today|well done|badge/i;

interface Call {
  cmd: string;
  args: Record<string, unknown>;
}

function mockProject(calls: Call[]): void {
  localStorage.setItem("inkspark.lastProject", "/tmp/book");
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "open_project") {
      return [{ id: "p1", title: "Chapter one" }];
    }
    if (cmd === "read_page") {
      return "Chapter one\nIt began.";
    }
    if (cmd === "save_page") {
      return null;
    }
    if (cmd === "list_ideas") {
      return [];
    }
    if (cmd === "get_layout") {
      return [{ kind: "page", id: "p1" }];
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
}

/** Types into the page the way a browser reports it: the text node changes and ProseMirror reads it. */
async function typeInto(editor: HTMLElement, suffix: string): Promise<void> {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    last = n;
  }
  if (last === null) {
    throw new Error("no text in the editor");
  }
  last.textContent = `${last.textContent ?? ""}${suffix}`;
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Saving");
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App", () => {
  it("exports all pages to the chosen place, as one Word file, with nothing moved", async () => {
    const calls: Call[] = [];
    localStorage.setItem("inkspark.lastProject", "/tmp/book");
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "open_project") {
        return [
          { id: "p1", title: "One" },
          { id: "p2", title: "Two" },
        ];
      }
      if (cmd === "read_page") {
        return "Some **bold** words";
      }
      if (cmd === "list_ideas") {
        return [];
      }
      if (cmd === "plugin:dialog|save") {
        return "/tmp/out/book.docx";
      }
      if (cmd === "export_docx") {
        return "/tmp/out/book.docx";
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole("button", { name: "Export all pages as Word" }));
    expect(await screen.findByText("Saved to /tmp/out/book.docx")).toBeInTheDocument();
    const sent = calls.find((c) => c.cmd === "export_docx")?.args;
    expect(sent?.dest).toBe("/tmp/out/book.docx");
    const doc = sent?.doc as { blocks: { pageBreak: boolean }[] };
    expect(doc.blocks.map((b) => b.pageBreak)).toEqual([false, true]);
  });

  it("offers to choose a folder when none is remembered", () => {
    mockIPC(() => undefined);
    render(<App />);
    expect(screen.getByRole("button", { name: "Choose a folder to write in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "InkSpark" })).toBeInTheDocument();
  });

  it("reopens the last project and shows its page", async () => {
    mockProject([]);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "Page text" });
    await waitFor(() => {
      expect(editor).toHaveTextContent("Chapter oneIt began.");
    });
    expect(screen.getByRole("button", { name: "Chapter one" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("autosaves about a second after typing stops", async () => {
    const calls: Call[] = [];
    mockProject(calls);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "Page text" });
    await waitFor(() => {
      expect(editor).toHaveTextContent("Chapter oneIt began.");
    });
    await typeInto(editor, " slowly.");
    expect(calls.some((c) => c.cmd === "save_page")).toBe(false);
    await waitFor(
      () => {
        expect(calls.some((c) => c.cmd === "save_page")).toBe(true);
      },
      { timeout: 2500 },
    );
    const save = calls.find((c) => c.cmd === "save_page");
    expect(save?.args).toMatchObject({ id: "p1", content: "Chapter one\nIt began. slowly." });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Saved");
    });
  });

  it("saves at once on Cmd+S", async () => {
    const calls: Call[] = [];
    mockProject(calls);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "Page text" });
    await waitFor(() => {
      expect(editor).toHaveTextContent("Chapter oneIt began.");
    });
    await typeInto(editor, " more");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "save_page")).toBe(true);
    });
  });

  it("shows no goal, streak or encouragement copy and has no axe violations", async () => {
    mockProject([]);
    const { container } = render(<App />);
    await screen.findByRole("textbox", { name: "Page text" });
    expect(document.body.textContent ?? "").not.toMatch(ENCOURAGEMENT);
    await expectNoAxeViolations(container);
  });
});
