import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    throw new Error(`unexpected command: ${cmd}`);
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App", () => {
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
      expect(editor).toHaveValue("Chapter one\nIt began.");
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
      expect(editor).toHaveValue("Chapter one\nIt began.");
    });
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "Chapter one\nIt began slowly." } });
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Saving");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(calls.some((c) => c.cmd === "save_page")).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const save = calls.find((c) => c.cmd === "save_page");
    expect(save?.args).toMatchObject({ id: "p1", content: "Chapter one\nIt began slowly." });
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Saved");
  });

  it("saves at once on Cmd+S", async () => {
    const calls: Call[] = [];
    mockProject(calls);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "Page text" });
    await waitFor(() => {
      expect(editor).toHaveValue("Chapter one\nIt began.");
    });
    fireEvent.change(editor, { target: { value: "changed" } });
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
