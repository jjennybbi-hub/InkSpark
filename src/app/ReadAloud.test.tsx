import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadAloud, speechChunks } from "./ReadAloud";

const spoken: { text: string; onend?: () => void }[] = [];
const cancel = vi.fn();

beforeEach(() => {
  spoken.length = 0;
  cancel.mockClear();
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      cancel,
      speak: (u: { text: string; onend?: () => void }) => {
        spoken.push(u);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "speechSynthesis");
  document.body.innerHTML = "";
});

function renderWithPage(): void {
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = '<div class="ProseMirror"><p>First line.</p><p>Second line.</p></div>';
  document.body.append(page);
  render(<ReadAloud pageKey="p1" />);
}

describe("read aloud", () => {
  it("splits long text without losing words", () => {
    const text = `${"word ".repeat(800)}\n\nend`;
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1500)).toBe(true);
    expect(chunks.join(" ").split(" ").length).toBe(801);
  });

  it("reads the whole page when nothing is selected, then can be stopped", () => {
    renderWithPage();
    expect(spoken).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(spoken.map((u) => u.text)).toEqual(["First line.", "Second line."]);
    fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeInTheDocument();
  });

  it("says so calmly when speech is unavailable", () => {
    Reflect.deleteProperty(window, "speechSynthesis");
    renderWithPage();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(screen.getByRole("status")).toHaveTextContent("isn't available");
  });
});
