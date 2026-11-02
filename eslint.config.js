// @ts-check
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const FS_WRITE_MESSAGE = "Writes go through the Rust storage module (CLAUDE.md).";
const root = import.meta.dirname;

/** @param {string} dir */
function listDir(dir) {
  const abs = path.join(root, dir);
  return existsSync(abs) ? readdirSync(abs, { withFileTypes: true }) : [];
}

/** @param {string[]} names */
function anyExcept(names) {
  return names.length === 0 ? "*" : `!(${names.join("|")})`;
}

/**
 * `<dir>/<glob>.ts(x)` matching only files that a tsconfig cannot claim.
 * The TypeScript project service claims only files that exist on disk, so when the package
 * has a tsconfig.json its existing files are excluded; without one, every file matches.
 * @param {string} dir
 * @param {boolean} hasTsconfig
 */
function unclaimedGlobs(dir, hasTsconfig) {
  const existing = hasTsconfig
    ? listDir(dir)
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
        .map((e) => e.name.replace(/\.tsx?$/, ""))
    : [];
  const name = anyExcept(existing);
  return [`${dir}/${name}.ts`, `${dir}/${name}.tsx`];
}

/**
 * Globs for top-level TypeScript files in `src/` and `spikes/<name>/src/` that no tsconfig can
 * claim: files that do not exist on disk (editor buffers, `ESLint#lintText` with a virtual path,
 * as in tests/lint/fs-write-ban.test.ts) and spikes that have no tsconfig.json yet. They are
 * linted against the default project (tsconfig.app.json options) instead of failing to parse.
 *
 * typescript-eslint rejects a file that matches `allowDefaultProject` *and* belongs to a
 * tsconfig, which is why existing files are excluded rather than matched with `*`.
 * @returns {string[]}
 */
function defaultProjectGlobs() {
  const spikes = listDir("spikes")
    .filter((e) => e.isDirectory() && existsSync(path.join(root, "spikes", e.name, "src")))
    .map((e) => e.name);
  return [
    ...unclaimedGlobs("src", true),
    ...spikes.flatMap((name) =>
      unclaimedGlobs(
        `spikes/${name}/src`,
        existsSync(path.join(root, "spikes", name, "tsconfig.json")),
      ),
    ),
    // Spikes that do not exist yet.
    ...unclaimedGlobs(`spikes/${anyExcept(spikes)}/src`, false),
  ];
}

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/target/**",
    "**/node_modules/**",
    "vendor/**",
    "src/contracts/bindings.ts",
    "src-tauri/gen/**",
    "**/results/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/coverage/**",
  ]),

  // Plain JavaScript (config files): recommended rules, no type information.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  // TypeScript: typescript-eslint strict + stylistic, type-checked (M0 §3.5).
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: defaultProjectGlobs(),
          defaultProject: "tsconfig.app.json",
        },
        tsconfigRootDir: root,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
    },
  },

  // Byte-order marks are matched on purpose in regexes that strip them from JSON/TOML input.
  {
    rules: {
      "no-irregular-whitespace": ["error", { skipRegExps: true }],
    },
  },

  // Tests guard DOM values defensively (`textContent ?? ""`) even where lib.dom types say
  // non-null; jsdom and WebKit do not always agree with the types.
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  // React hooks for the app and the spikes' browser code.
  {
    files: ["src/**/*.{ts,tsx}", "spikes/*/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Single write path: no filesystem writes from frontend code (AC-4).
  {
    files: ["src/**/*.{ts,tsx,js,jsx}", "spikes/*/src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "fs",
            "node:fs",
            "fs/promises",
            "node:fs/promises",
            "@tauri-apps/plugin-fs",
            "@tauri-apps/api/fs",
          ].map((name) => ({ name, message: FS_WRITE_MESSAGE })),
          patterns: [
            {
              group: ["@tauri-apps/plugin-fs/*", "node:fs/*", "fs/*"],
              message: FS_WRITE_MESSAGE,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression[source.value=/^(node:)?fs(\\/|$)|^@tauri-apps\\/(plugin-fs|api\\/fs)/]",
          message: FS_WRITE_MESSAGE,
        },
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?fs/]",
          message: FS_WRITE_MESSAGE,
        },
      ],
    },
  },

  // Node-side TypeScript: configs, config tests and E2E.
  {
    files: ["*.config.ts", "tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
]);
