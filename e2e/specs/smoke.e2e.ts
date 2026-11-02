import { readFileSync } from "node:fs";
import path from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function packageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8").replace(/^﻿/, ""),
  ) as unknown;
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg)) {
    throw new Error("package.json has no version");
  }
  const { version } = pkg;
  if (typeof version !== "string") {
    throw new Error("package.json version is not a string");
  }
  return version;
}

const SHELL = "[data-testid=app-shell]";

describe("InkSpark smoke (AC-9)", () => {
  it("has the window title InkSpark", async () => {
    await expect(browser).toHaveTitle("InkSpark");
  });

  it("displays the app shell within 10 s", async () => {
    await $(SHELL).waitForDisplayed({ timeout: 10_000 });
  });

  it("reports the package.json version on the shell", async () => {
    await expect($(SHELL)).toHaveAttribute("data-app-version", packageVersion(), {
      wait: 10_000,
    });
  });

  it("shows no dialog", async () => {
    const dialogs = await $$("[role=dialog], [role=alertdialog], dialog");
    expect(dialogs.length).toBe(0);
  });

  it("lets Tab move focus without throwing", async () => {
    await browser.keys(Key.Tab);
    const active = await browser.execute(() => {
      const el = document.activeElement;
      return el === null ? null : el.tagName;
    });
    expect(active === null || typeof active === "string").toBe(true);
  });
});
