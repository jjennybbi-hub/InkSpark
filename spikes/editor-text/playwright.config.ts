import { defineConfig, devices } from "@playwright/test";

/** Fixed port for `vite preview` (M0 §4). */
const PORT = 4311;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  forbidOnly: process.env.CI !== undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: BASE_URL },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit decides the go/no-go; it runs in CI (`PW_WEBKIT=1`).
    ...(process.env.PW_WEBKIT === "1"
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
  webServer: {
    command: `vite build && vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
