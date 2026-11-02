import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { AppInfo } from "../contracts";
import { loadAppInfo } from "./appInfo";

const MOCK_INFO: AppInfo = {
  name: "InkSpark",
  version: "9.8.7",
  os: "linux",
  arch: "x86_64",
  tauriVersion: "2.12.4",
};

afterEach(() => {
  clearMocks();
});

describe("loadAppInfo", () => {
  it("resolves to the object returned by the app_info command", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "app_info") {
        return MOCK_INFO;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await expect(loadAppInfo()).resolves.toEqual(MOCK_INFO);
    expect(calls).toEqual(["app_info"]);
  });

  it("rejects when the IPC call throws", async () => {
    mockIPC(() => {
      throw new Error("ipc exploded");
    });

    await expect(loadAppInfo()).rejects.toThrow("ipc exploded");
  });

  it("rejects when the IPC call returns a rejected promise", async () => {
    mockIPC(() => Promise.reject(new Error("ipc rejected")));

    await expect(loadAppInfo()).rejects.toThrow("ipc rejected");
  });
});
