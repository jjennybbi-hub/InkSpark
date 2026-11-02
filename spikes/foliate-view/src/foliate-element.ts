// Registers upstream `<foliate-view>` (a side effect of vendor/foliate-js/view.js). The harness
// imports this module lazily, so `harness.ts` (and `TAURI_CSP`) stay importable in Node, where
// foliate's DOM globals do not exist.
import "../../../vendor/foliate-js/view.js";
