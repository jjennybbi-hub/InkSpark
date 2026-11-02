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

const TS_EXTS = ["ts", "tsx", "mts", "cts"];
const JS_EXTS = ["js", "jsx", "mjs", "cjs"];
const TS_EXT_RE = /\.(?:[cm]?ts|tsx)$/;
const LINTABLE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Frontend code covered by the single-write-path ban (AC-4). */
const BANNED_DIRS = ["src", "spikes/*/src"];
const ALL_EXTS = `{${[...TS_EXTS, ...JS_EXTS].join(",")}}`;
const BANNED_FILES = BANNED_DIRS.map((dir) => `${dir}/**/*.${ALL_EXTS}`);

/** @param {string} dir */
function listDir(dir) {
  const abs = path.join(root, dir);
  return existsSync(abs) ? readdirSync(abs, { withFileTypes: true }) : [];
}

/** @param {string} dir @returns {string[]} repo-relative paths of lintable files under `dir` */
function lintableFiles(dir) {
  return listDir(dir).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      return e.name === "node_modules" ? [] : lintableFiles(rel);
    }
    return e.isFile() && LINTABLE_RE.test(e.name) ? [rel] : [];
  });
}

/** @param {string} name @param {string} file */
const spikeHas = (name, file) => existsSync(path.join(root, "spikes", name, file));

const spikeNames = listDir("spikes")
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

/**
 * Spike test files are committed before their spike has a package.json/tsconfig (M0 §2 step 4).
 * Until then their existing files are left out of the root lint, like the typecheck and vitest
 * guards. Only files on disk are listed, so virtual paths such as `spikes/editor-text/src/x.ts`
 * (tests/lint/fs-write-ban.test.ts) are still linted and still hit the fs-write ban.
 */
const pendingSpikeFiles = spikeNames
  .filter((name) => !spikeHas(name, "package.json"))
  .flatMap((name) => lintableFiles(`spikes/${name}`));

/** @param {string[]} names */
function anyExcept(names) {
  return names.length === 0 ? "*" : `!(${names.join("|")})`;
}

/**
 * `<dir>/<glob>.<ts ext>` matching only files that a tsconfig cannot claim.
 * The TypeScript project service claims only files that exist on disk, so when the package
 * has a tsconfig.json its existing files are excluded; without one, every file matches.
 * @param {string} dir
 * @param {boolean} hasTsconfig
 */
function unclaimedGlobs(dir, hasTsconfig) {
  const existing = hasTsconfig
    ? listDir(dir)
        .filter((e) => e.isFile() && TS_EXT_RE.test(e.name))
        .map((e) => e.name.replace(TS_EXT_RE, ""))
    : [];
  const name = anyExcept([...new Set(existing)]);
  return TS_EXTS.map((ext) => `${dir}/${name}.${ext}`);
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
  const withSrc = spikeNames.filter((name) => spikeHas(name, "src"));
  return [
    ...unclaimedGlobs("src", true),
    ...withSrc.flatMap((name) =>
      unclaimedGlobs(`spikes/${name}/src`, spikeHas(name, "tsconfig.json")),
    ),
    // Spikes that do not exist yet.
    ...unclaimedGlobs(`spikes/${anyExcept(withSrc)}/src`, false),
  ];
}

const FS_MODULE = "^(node:)?(fs|module)(\\/|$)";
const FS_ANY = `${FS_MODULE}|^@tauri-apps\\/(plugin-fs|api\\/fs)`;

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/target/**",
    "**/node_modules/**",
    "vendor/**",
    ".claude/**",
    "src/contracts/bindings.ts",
    "src-tauri/gen/**",
    "**/results/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/coverage/**",
    ...pendingSpikeFiles,
  ]),

  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },

  // Plain JavaScript (config files): recommended rules, no type information.
  {
    files: [`**/*.{${JS_EXTS.join(",")}}`],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  // TypeScript: typescript-eslint strict + stylistic, type-checked (M0 §3.5).
  {
    files: [`**/*.{${TS_EXTS.join(",")}}`],
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
    files: BANNED_DIRS.map((dir) => `${dir}/**/*.{ts,tsx,js,jsx}`),
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Frontend JavaScript is parsed with the TypeScript parser (no type information), so a stray
  // annotation cannot turn into a fatal parse error that would hide the fs-write ban.
  {
    files: BANNED_DIRS.map((dir) => `${dir}/**/*.{${JS_EXTS.join(",")}}`),
    languageOptions: { parser: tseslint.parser },
  },

  // Single write path: no filesystem access from frontend code (AC-4). Inline eslint comments
  // are ignored here, so the ban cannot be silenced with `eslint-disable`.
  {
    files: BANNED_FILES,
    linterOptions: { noInlineConfig: true },
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
            // createRequire() would load fs behind the ban.
            "module",
            "node:module",
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
          selector: `ImportExpression[source.value=/${FS_ANY}/]`,
          message: FS_WRITE_MESSAGE,
        },
        {
          selector: `ImportExpression[source.type='TemplateLiteral'][source.quasis.0.value.cooked=/${FS_ANY}/]`,
          message: FS_WRITE_MESSAGE,
        },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=/${FS_ANY}/]`,
          message: FS_WRITE_MESSAGE,
        },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.cooked=/${FS_ANY}/]`,
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
