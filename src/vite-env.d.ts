/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Feature-flag overrides, e.g. `"readerView,-dictation"` (docs/feature-flags.md). */
  readonly VITE_INKSPARK_FLAGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
