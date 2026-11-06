import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe";
import { FontPicker } from "./FontPicker";
import { DEFAULT_TEXT_FONT, TEXT_FONTS } from "./fonts";

function setup(): { onChange: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onChange = vi.fn();
  const { container } = render(
    <FontPicker
      label="Font family"
      options={TEXT_FONTS}
      value={DEFAULT_TEXT_FONT}
      onChange={onChange}
    />,
  );
  return { onChange, container };
}

describe("FontPicker", () => {
  it("names Arial as the starting font", () => {
    setup();
    expect(screen.getByRole("button", { name: "Font family: Arial" })).toBeInTheDocument();
  });

  it("shows every choice in its own font and has no axe violations", async () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button"));
    const georgia = screen.getByRole("option", { name: "Georgia" });
    expect(georgia.style.fontFamily).toContain("Georgia");
    expect(screen.getAllByRole("option")).toHaveLength(TEXT_FONTS.length);
    await expectNoAxeViolations(container);
  });

  it("works with the mouse and the keyboard", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "Georgia" }));
    expect(onChange).toHaveBeenLastCalledWith("Georgia, 'Times New Roman', serif");
    fireEvent.click(screen.getByRole("button"));
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(TEXT_FONTS[1]?.value);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
