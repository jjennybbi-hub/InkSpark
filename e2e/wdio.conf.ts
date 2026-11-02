/**
 * WebdriverIO + tauri-driver E2E configuration (M0 §3.8, ADR 007).
 *
 * Runs against the debug app binary built by `npm run tauri build -- --debug --no-bundle`.
 * Needs `tauri-driver` (cargo install tauri-driver --locked) and, on Linux, WebKitWebDriver
 * (the `webkit2gtk-driver` package). It cannot run in the cloud container: CI runs it on ubuntu.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const exe = process.platform === "win32" ? "inkspark.exe" : "inkspark";
const application = path.join(repoRoot, "target", "debug", exe);
const driverPath = process.env.TAURI_DRIVER_PATH ?? "tauri-driver";
const DRIVER_PORT = 4444;

let tauriDriver: ChildProcess | undefined;

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`tauri-driver did not listen on port ${String(port)} in time`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      // tauri-driver speaks classic WebDriver only; WebDriver BiDi would fail the session.
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforTimeout: 10_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 2,

  beforeSession: async () => {
    tauriDriver = spawn(driverPath, [], { stdio: ["ignore", "inherit", "inherit"] });
    tauriDriver.once("error", (error) => {
      console.error(`could not start ${driverPath}:`, error);
    });
    await waitForPort(DRIVER_PORT, 15_000);
  },

  afterSession: () => {
    tauriDriver?.kill();
    tauriDriver = undefined;
  },
};
