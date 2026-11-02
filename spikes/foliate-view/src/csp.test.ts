// @vitest-environment node
// `node:fs` is banned under spikes/*/src/** by the fs-write lint rule, so the Tauri config is
// read through a static JSON import resolved relative to this file
// (../../../src-tauri/tauri.conf.json, i.e. the same path as from import.meta.dirname).
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import { describe, expect, it } from "vitest";
import { TAURI_CSP } from "./harness";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredCsp(config: unknown): unknown {
  if (!isRecord(config)) return undefined;
  const app = config.app;
  if (!isRecord(app)) return undefined;
  const security = app.security;
  if (!isRecord(security)) return undefined;
  return security.csp;
}

describe("TAURI_CSP", () => {
  it("equals app.security.csp in src-tauri/tauri.conf.json", () => {
    const csp = configuredCsp(tauriConfig);
    expect(typeof csp).toBe("string");
    expect(TAURI_CSP).toBe(csp);
  });

  it("is a non-empty policy with a default-src directive", () => {
    expect(TAURI_CSP.trim().length).toBeGreaterThan(0);
    expect(TAURI_CSP).toMatch(/(^|;)\s*default-src\b/);
  });
});
