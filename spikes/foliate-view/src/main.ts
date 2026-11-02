import "./style.css";
// Registers <foliate-view> up front, so open-time measurements exclude loading the module.
import "./foliate-element";
import { openBook } from "./harness";

if (document.querySelector("#reader") === null) {
  throw new Error("index.html must contain the #reader container");
}

// Exposes the harness to the Playwright tests (tests/helpers.ts declares the type).
Object.assign(window, { __reader: { openBook } });
