import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/**
 * Minimal TOML reader for the config files we own: `[table]` headers, `key = value` lines
 * (dotted keys kept verbatim) and multi-line arrays. Values are returned as raw text.
 */
function readTomlTables(text: string): Map<string, Map<string, string>> {
  const tables = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  tables.set("", current);
  let pendingKey: string | undefined;
  let pendingValue = "";
  const depth = (s: string): number =>
    (s.match(/\[/g)?.length ?? 0) - (s.match(/\]/g)?.length ?? 0);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#[^"']*$/, "").trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (pendingKey !== undefined) {
      pendingValue = `${pendingValue} ${line}`;
      if (depth(pendingValue) <= 0) {
        current.set(pendingKey, pendingValue);
        pendingKey = undefined;
      }
      continue;
    }
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header?.[1] !== undefined) {
      const name = header[1].replace(/\s*\.\s*/g, ".").replace(/"/g, "");
      current = tables.get(name) ?? new Map<string, string>();
      tables.set(name, current);
      continue;
    }
    const kv = /^([A-Za-z0-9_.\-"\s]+?)\s*=\s*(.*)$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) {
      const key = kv[1].replace(/\s*\.\s*/g, ".").replace(/"/g, "");
      const value = kv[2].trim();
      if (depth(value) > 0) {
        pendingKey = key;
        pendingValue = value;
      } else {
        current.set(key, value);
      }
    }
  }
  return tables;
}

function tomlString(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^"([^"]*)"$|^'([^']*)'$/.exec(raw);
  return match?.[1] ?? match?.[2];
}

function readText(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8").replace(/^﻿/, "");
}

function readJsonRecord(relative: string): Record<string, unknown> {
  const value = JSON.parse(readText(relative)) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${relative} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function packageJsonVersion(): string {
  const version = readJsonRecord("package.json").version;
  if (typeof version !== "string") {
    throw new Error("package.json has no version string");
  }
  return version;
}

function cargoVersion(): string {
  const tables = readTomlTables(readText("src-tauri/Cargo.toml"));
  const pkg = tables.get("package");
  if (pkg === undefined) {
    throw new Error("src-tauri/Cargo.toml has no [package] table");
  }
  const direct = tomlString(pkg.get("version"));
  if (direct !== undefined) {
    return direct;
  }
  const inherits =
    pkg.get("version.workspace") === "true" || pkg.get("version") === "{ workspace = true }";
  if (inherits) {
    const root = readTomlTables(readText("Cargo.toml"));
    const inherited = tomlString(root.get("workspace.package")?.get("version"));
    if (inherited !== undefined) {
      return inherited;
    }
  }
  throw new Error("could not determine the src-tauri package version");
}

function tauriConfVersion(): string {
  const version = readJsonRecord("src-tauri/tauri.conf.json").version;
  if (typeof version !== "string") {
    throw new Error("tauri.conf.json has no version string");
  }
  if (version.endsWith("package.json")) {
    const pkgPath = path.relative(repoRoot, path.resolve(repoRoot, "src-tauri", version));
    const resolved = readJsonRecord(pkgPath).version;
    if (typeof resolved !== "string") {
      throw new Error(`${pkgPath} has no version string`);
    }
    return resolved;
  }
  return version;
}

describe("version alignment (AC-1)", () => {
  const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  it("package.json has a semver version", () => {
    expect(packageJsonVersion()).toMatch(SEMVER);
  });

  it("src-tauri/Cargo.toml version equals package.json", () => {
    expect(cargoVersion()).toBe(packageJsonVersion());
  });

  it("tauri.conf.json version equals package.json", () => {
    expect(tauriConfVersion()).toBe(packageJsonVersion());
  });
});
