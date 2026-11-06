import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { PromptCard } from "./PromptCard";

/** jsdom has no movementX on its mouse events, so it is set by hand. */
function moveMouse(distance: number): void {
  const event = new MouseEvent("mousemove", { bubbles: true });
  Object.defineProperty(event, "movementX", { value: distance });
  Object.defineProperty(event, "movementY", { value: 0 });
  fireEvent(window, event);
}

function isFaded(): string | null {
  return screen.getByTestId("prompt-card").getAttribute("data-faded");
}

describe("PromptCard", () => {
  it("starts visible and shows the words and their source", () => {
    render(<PromptCard text="A radio" credit="An Author, A Work" onClose={vi.fn()} />);
    expect(isFaded()).toBe("false");
    expect(screen.getByText("A radio")).toBeTruthy();
    expect(screen.getByText(/An Author, A Work/)).toBeTruthy();
  });

  it.each(["a", " ", "Enter", "Backspace"])("fades when %s is typed", (key) => {
    render(<PromptCard text="A radio" credit="" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key });
    expect(isFaded()).toBe("true");
  });

  it("stays visible for shortcuts and keys that do not type", () => {
    render(<PromptCard text="A radio" credit="" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    fireEvent.keyDown(window, { key: "Shift" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(isFaded()).toBe("false");
  });

  it("comes back when the mouse moves, and stays open afterwards", () => {
    render(<PromptCard text="A radio" credit="" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a" });
    moveMouse(10);
    expect(isFaded()).toBe("false");
    fireEvent.keyDown(window, { key: "b" });
    expect(isFaded()).toBe("true");
  });

  it("ignores a mouse event with no real movement, and a tiny nudge", () => {
    render(<PromptCard text="A radio" credit="" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a" });
    moveMouse(0);
    moveMouse(1);
    expect(isFaded()).toBe("true");
  });

  it("comes back on Tab, so it can be reached by keyboard", () => {
    render(<PromptCard text="A radio" credit="" onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(isFaded()).toBe("false");
  });

  it("can still be closed, and has no accessibility problems", async () => {
    const onClose = vi.fn();
    const { container } = render(<PromptCard text="A radio" credit="" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close prompt" }));
    expect(onClose).toHaveBeenCalledOnce();
    await expectNoAxeViolations(container);
  });
});
