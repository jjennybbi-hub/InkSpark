import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const BAN_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
const BAN_MESSAGE = "Writes go through the Rust storage module (CLAUDE.md).";

interface BannedCase {
  readonly label: string;
  readonly code: string;
  readonly isStaticImport: boolean;
}

const BANNED: readonly BannedCase[] = [
  {
    label: "named import from @tauri-apps/plugin-fs",
    code: 'import { writeTextFile } from "@tauri-apps/plugin-fs";\n\nexport const w = writeTextFile;\n',
    isStaticImport: true,
  },
  {
    label: "default import from node:fs",
    code: 'import fs from "node:fs";\n\nexport const f = fs;\n',
    isStaticImport: true,
  },
  {
    label: "named import from fs/promises",
    code: 'import { writeFile } from "fs/promises";\n\nexport const w = writeFile;\n',
    isStaticImport: true,
  },
  {
    label: "named import from @tauri-apps/api/fs",
    code: 'import { writeFile } from "@tauri-apps/api/fs";\n\nexport const w = writeFile;\n',
    isStaticImport: true,
  },
  {
    label: "subpath import from @tauri-apps/plugin-fs/*",
    code: 'import * as sub from "@tauri-apps/plugin-fs/sub";\n\nexport const s = sub;\n',
    isStaticImport: true,
  },
  {
    label: "dynamic import of node:fs/promises",
    code: 'export async function load(): Promise<unknown> {\n  return await import("node:fs/promises");\n}\n',
    isStaticImport: false,
  },
  {
    label: 'require("fs")',
    code: 'const fs: unknown = require("fs");\n\nexport { fs };\n',
    isStaticImport: false,
  },
];

const BANNED_PATHS = ["src/x.ts", "spikes/editor-text/src/x.ts"] as const;

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages);
}

function describeMessages(messages: readonly Linter.LintMessage[]): string {
  if (messages.length === 0) {
    return "(no messages)";
  }
  return messages
    .map((m) => `${String(m.ruleId)} [severity ${String(m.severity)}]: ${m.message}`)
    .join("\n");
}

describe("fs-write ban (AC-4)", { timeout: 120_000 }, () => {
  for (const filePath of BANNED_PATHS) {
    describe(filePath, () => {
      it.each(BANNED)("reports $label", async ({ code, isStaticImport }) => {
        const messages = await lint(code, filePath);
        const fatal = messages.filter((m) => m.fatal === true);
        expect(fatal, describeMessages(fatal)).toEqual([]);

        const hits = messages.filter(
          (m) => m.ruleId !== null && BAN_RULES.has(m.ruleId) && m.severity === 2,
        );
        expect(hits.length, describeMessages(messages)).toBeGreaterThan(0);

        if (isStaticImport) {
          const importHits = hits.filter((m) => m.ruleId === "no-restricted-imports");
          expect(importHits.length, describeMessages(messages)).toBeGreaterThan(0);
          for (const hit of importHits) {
            expect(hit.message).toContain(BAN_MESSAGE);
          }
        }
      });
    });
  }

  it("allows importing invoke from @tauri-apps/api/core with zero errors", async () => {
    const code =
      'import { invoke } from "@tauri-apps/api/core";\n\nexport function ping(): Promise<string> {\n  return invoke<string>("ping");\n}\n';
    const messages = await lint(code, "src/x.ts");
    const errors = messages.filter((m) => m.severity === 2);
    expect(errors, describeMessages(errors)).toEqual([]);
  });
});
