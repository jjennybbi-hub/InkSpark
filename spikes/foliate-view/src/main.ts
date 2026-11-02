import { openBook } from "./harness";

// Exposes the harness to the Playwright tests (tests/helpers.ts declares the type).
Object.assign(window, { __reader: { openBook } });
