import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tauriDir = path.join(repoRoot, "src-tauri");

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  return JSON.parse(text) as unknown;
}

function readRecord(file: string): JsonRecord {
  const value = readJson(file);
  if (!isRecord(value)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return value;
}

function getRecord(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`expected "${key}" to be an object`);
  }
  return value;
}

function permissionId(permission: unknown): string {
  if (typeof permission === "string") {
    return permission;
  }
  if (isRecord(permission) && typeof permission.identifier === "string") {
    return permission.identifier;
  }
  throw new Error(`unrecognised capability permission: ${JSON.stringify(permission)}`);
}

const conf = readRecord(path.join(tauriDir, "tauri.conf.json"));

describe("tauri.conf.json (AC-4)", () => {
  it("names the product InkSpark", () => {
    expect(conf.productName).toBe("InkSpark");
  });

  it("names the main binary inkspark", () => {
    expect(conf.mainBinaryName).toBe("inkspark");
  });

  it("has an identifier that does not end with .app", () => {
    expect(typeof conf.identifier).toBe("string");
    const identifier = String(conf.identifier);
    expect(identifier.length).toBeGreaterThan(0);
    expect(identifier.toLowerCase().endsWith(".app")).toBe(false);
  });

  it("sets a CSP string that allows blob: frames and never unsafe-eval", () => {
    const security = getRecord(getRecord(conf, "app"), "security");
    const csp = security.csp;
    expect(csp).not.toBeNull();
    expect(typeof csp).toBe("string");
    const cspText = String(csp);
    expect(cspText).toContain("frame-src 'self' blob:");
    expect(cspText).not.toContain("unsafe-eval");
  });

  it("declares a single window titled InkSpark", () => {
    const windows = getRecord(conf, "app").windows;
    expect(Array.isArray(windows)).toBe(true);
    const list = windows as unknown[];
    expect(list).toHaveLength(1);
    const first = list[0];
    if (!isRecord(first)) {
      throw new Error("window config is not an object");
    }
    expect(first.title).toBe("InkSpark");
  });
});

describe("Tauri capabilities (AC-4)", () => {
  const capDir = path.join(tauriDir, "capabilities");
  const capFiles = readdirSync(capDir).filter((name) => name.toLowerCase().endsWith(".json"));

  it("has at least the default capability file", () => {
    expect(capFiles).toContain("default.json");
  });

  it.each(capFiles)("%s grants no fs: or shell: permission", (file) => {
    const cap = readRecord(path.join(capDir, file));
    const permissions = cap.permissions;
    expect(Array.isArray(permissions)).toBe(true);
    const ids = (permissions as unknown[]).map(permissionId);
    for (const id of ids) {
      expect(id.startsWith("fs:"), `permission ${id}`).toBe(false);
      expect(id.startsWith("shell:"), `permission ${id}`).toBe(false);
    }
  });

  it("default.json holds only core:default, window close and the folder picker", () => {
    const cap = readRecord(path.join(capDir, "default.json"));
    const permissions = cap.permissions;
    expect(Array.isArray(permissions)).toBe(true);
    expect((permissions as unknown[]).map(permissionId)).toEqual([
      "core:default",
      "core:window:allow-destroy",
      "dialog:allow-open",
    ]);
  });
});

describe("no filesystem plugin is installed (AC-4)", () => {
  const DEP_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  it("package.json does not depend on @tauri-apps/plugin-fs", () => {
    const pkg = readRecord(path.join(repoRoot, "package.json"));
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (deps === undefined) {
        continue;
      }
      if (!isRecord(deps)) {
        throw new Error(`package.json ${field} is not an object`);
      }
      expect(Object.keys(deps), field).not.toContain("@tauri-apps/plugin-fs");
    }
  });

  it("src-tauri/Cargo.toml does not depend on tauri-plugin-fs", () => {
    const cargo = readFileSync(path.join(tauriDir, "Cargo.toml"), "utf8");
    expect(cargo).not.toMatch(/tauri-plugin-fs/);
  });
});
