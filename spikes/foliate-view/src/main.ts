import "./style.css";
// Intentional static + dynamic import: this static import registers <foliate-view> at page load,
// so open-time measurements exclude fetching the module. harness.ts also imports it dynamically
// (a no-op here) so that harness.ts stays importable in Node, e.g. by src/csp.test.ts.
import "./foliate-element";
import { openBook } from "./harness";

if (document.querySelector("#reader") === null) {
  throw new Error("index.html must contain the #reader container");
}

// Exposes the harness to the Playwright tests (tests/helpers.ts declares the type).
Object.assign(window, { __reader: { openBook } });
