import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppInfo } from "../contracts";
import { expectNoAxeViolations } from "../test/axe";
import { App } from "./App";

const MOCK_INFO: AppInfo = {
  name: "InkSpark",
  version: "3.1.4-test",
  os: "linux",
  arch: "x86_64",
  tauriVersion: "2.12.4",
};

const FORBIDDEN_ROLES = ["button", "dialog", "alert", "status", "alertdialog"] as const;
const ENCOURAGEMENT = /goal|streak|great job|keep going|words today|well done|badge/i;

function mockAppInfo(): void {
  mockIPC((cmd) => {
    if (cmd === "app_info") {
      return MOCK_INFO;
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
}

async function renderLoadedApp(): Promise<{ container: HTMLElement; main: HTMLElement }> {
  mockAppInfo();
  const { container } = render(<App />);
  const main = screen.getByRole("main", { name: "InkSpark" });
  await waitFor(() => {
    expect(main).toHaveAttribute("data-app-version", MOCK_INFO.version);
  });
  return { container, main };
}

afterEach(() => {
  clearMocks();
});

describe("App shell", () => {
  it("renders a single main landmark named InkSpark", async () => {
    await renderLoadedApp();
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(screen.getByRole("main", { name: "InkSpark" })).toHaveAttribute(
      "data-testid",
      "app-shell",
    );
  });

  it("sets data-app-version to the version reported by app_info", async () => {
    const { main } = await renderLoadedApp();
    expect(main.getAttribute("data-app-version")).toBe(MOCK_INFO.version);
  });

  it("starts with an empty data-app-version until app_info resolves", () => {
    mockIPC(() => new Promise<never>(() => undefined));
    render(<App />);
    expect(screen.getByRole("main", { name: "InkSpark" })).toHaveAttribute("data-app-version", "");
  });

  it("has a level-1 heading named InkSpark", async () => {
    await renderLoadedApp();
    expect(screen.getByRole("heading", { level: 1, name: "InkSpark" })).toBeInTheDocument();
  });

  it.each(FORBIDDEN_ROLES)("renders no %s elements", async (role) => {
    await renderLoadedApp();
    expect(screen.queryAllByRole(role)).toHaveLength(0);
  });

  it("shows no text besides the hidden InkSpark heading", async () => {
    const { container } = await renderLoadedApp();
    expect((container.textContent ?? "").trim()).toBe("InkSpark");
  });

  it("shows no goal, streak or encouragement copy", async () => {
    await renderLoadedApp();
    expect(document.body.textContent ?? "").not.toMatch(ENCOURAGEMENT);
  });

  it("has no axe violations", async () => {
    const { container } = await renderLoadedApp();
    await expectNoAxeViolations(container);
  });
});
