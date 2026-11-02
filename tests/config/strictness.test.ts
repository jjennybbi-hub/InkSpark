import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import ts from "typescript";
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

function tomlStringArray(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return [...raw.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** Reads a lint level written either as `"forbid"` or as `{ level = "forbid", ... }`. */
function lintLevel(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return tomlString(raw) ?? /level\s*=\s*"([^"]*)"/.exec(raw)?.[1];
}

/** Looks up a dotted path across `[table]` headers and dotted keys (`a.b.c` in any split). */
function tomlLookup(tables: Map<string, Map<string, string>>, dotted: string): string | undefined {
  const parts = dotted.split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    const table = tables.get(parts.slice(0, i).join("."));
    const value = table?.get(parts.slice(i).join("."));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readText(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8").replace(/^﻿/, "");
}

function readToml(relative: string): Map<string, Map<string, string>> {
  return readTomlTables(readText(relative));
}

function parsedTsconfig(relative: string): ts.CompilerOptions {
  const file = path.join(repoRoot, relative);
  const read = ts.readConfigFile(file, (p) => ts.sys.readFile(p));
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file));
  return parsed.options;
}

/** Crate roots that must carry the crate-level unsafe attribute. */
function crateRoots(memberDir: string): string[] {
  const srcDir = path.join(repoRoot, memberDir, "src");
  const roots = ["lib.rs", "main.rs"]
    .map((name) => path.join(srcDir, name))
    .filter((file) => existsSync(file));
  const binDir = path.join(srcDir, "bin");
  if (existsSync(binDir)) {
    for (const name of readdirSync(binDir)) {
      if (name.endsWith(".rs")) {
        roots.push(path.join(binDir, name));
      }
    }
  }
  return roots;
}

function hasInnerAttribute(source: string, attribute: string): boolean {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*#!\\[\\s*${escaped}\\s*\\]`, "m").test(source);
}

const UNSAFE_EXCEPTION = "spikes/macos-speech";

describe("TypeScript strictness (AC-7)", () => {
  it.each(["tsconfig.app.json", "tsconfig.node.json"])("%s is strict", (file) => {
    const options = parsedTsconfig(file);
    expect(options.strict).toBe(true);
    expect(options.noUncheckedIndexedAccess).toBe(true);
  });

  it("tsconfig.app.json enables the extra strictness flags from M0 §3.5", () => {
    const options = parsedTsconfig("tsconfig.app.json");
    expect(options.exactOptionalPropertyTypes).toBe(true);
    expect(options.noImplicitOverride).toBe(true);
    expect(options.verbatimModuleSyntax).toBe(true);
  });
});

describe("ESLint and Prettier strictness (AC-7)", () => {
  function severity(entry: Linter.RuleEntry | undefined): number {
    const level: unknown = Array.isArray(entry) ? entry[0] : entry;
    if (level === "error" || level === 2) {
      return 2;
    }
    if (level === "warn" || level === 1) {
      return 1;
    }
    return 0;
  }

  it(
    "applies typescript-eslint strict type-checked rules to src",
    { timeout: 60_000 },
    async () => {
      const eslint = new ESLint({ cwd: repoRoot });
      const config = (await eslint.calculateConfigForFile("src/app/App.tsx")) as
        | Linter.Config
        | undefined;
      const rules = config?.rules ?? {};
      expect(severity(rules["@typescript-eslint/no-explicit-any"])).toBe(2);
      expect(severity(rules["@typescript-eslint/no-unsafe-assignment"])).toBe(2);
      expect(severity(rules["@typescript-eslint/no-non-null-assertion"])).toBe(2);
      expect(severity(rules["@typescript-eslint/ban-ts-comment"])).toBe(2);
    },
  );

  it(".prettierrc.json sets printWidth 100 and LF line endings", () => {
    const config = JSON.parse(readText(".prettierrc.json")) as unknown;
    expect(config).toMatchObject({ printWidth: 100, endOfLine: "lf" });
  });
});

describe("Rust strictness (AC-7)", () => {
  const root = readToml("Cargo.toml");
  const members = tomlStringArray(tomlLookup(root, "workspace.members"));

  it("root Cargo.toml forbids unsafe code workspace-wide", () => {
    expect(lintLevel(tomlLookup(root, "workspace.lints.rust.unsafe_code"))).toBe("forbid");
  });

  it("root Cargo.toml lists src-tauri as a workspace member", () => {
    expect(members).toContain("src-tauri");
  });

  for (const member of members.filter((m) => m !== UNSAFE_EXCEPTION)) {
    describe(member, () => {
      it("inherits the workspace lints", () => {
        const manifest = readToml(path.posix.join(member, "Cargo.toml"));
        const inherits =
          tomlLookup(manifest, "lints.workspace") === "true" ||
          tomlLookup(manifest, "lints") === "{ workspace = true }";
        expect(inherits).toBe(true);
      });

      it("has #![forbid(unsafe_code)] in every crate root", () => {
        const roots = crateRoots(member);
        expect(roots.length, `${member} has no src/lib.rs or src/main.rs`).toBeGreaterThan(0);
        for (const file of roots) {
          const source = readFileSync(file, "utf8");
          expect(hasInnerAttribute(source, "forbid(unsafe_code)"), file).toBe(true);
        }
      });
    });
  }

  if (members.includes(UNSAFE_EXCEPTION)) {
    describe(`${UNSAFE_EXCEPTION} (the only unsafe exception)`, () => {
      it("does not inherit the workspace forbid", () => {
        const manifest = readToml(path.posix.join(UNSAFE_EXCEPTION, "Cargo.toml"));
        expect(tomlLookup(manifest, "lints.workspace")).not.toBe("true");
        expect(lintLevel(tomlLookup(manifest, "lints.rust.unsafe_code"))).toBe("deny");
      });

      it("has #![deny(unsafe_code)] in its crate root", () => {
        const roots = crateRoots(UNSAFE_EXCEPTION).filter((file) =>
          /[\\/](lib|main)\.rs$/.test(file),
        );
        expect(roots.length).toBeGreaterThan(0);
        for (const file of roots) {
          const source = readFileSync(file, "utf8");
          expect(hasInnerAttribute(source, "deny(unsafe_code)"), file).toBe(true);
        }
      });
    });
  }

  it("rust-toolchain.toml pins an exact channel with rustfmt and clippy", () => {
    const toolchain = readToml("rust-toolchain.toml");
    const channel = tomlString(tomlLookup(toolchain, "toolchain.channel"));
    expect(channel).toMatch(/^\d+\.\d+\.\d+$/);
    const components = tomlStringArray(tomlLookup(toolchain, "toolchain.components"));
    expect(components).toEqual(expect.arrayContaining(["rustfmt", "clippy"]));
  });
});
