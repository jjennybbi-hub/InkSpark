import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { TAURI_CSP } from "./src/csp";

const FOLIATE_DIR = path.resolve(import.meta.dirname, "../../vendor/foliate-js");
const PDF_STUB_ID = "\0inkspark:foliate-pdf-unsupported";

/**
 * vendor/foliate-js omits upstream's PDF adapter and pdf.js (M0 §5.2). `view.js` still has a
 * lazy `import('./pdf.js')` for PDF input, so resolve it to a module that rejects PDFs instead
 * of editing the vendored file.
 */
function foliatePdfUnsupported(): Plugin {
  return {
    name: "inkspark:foliate-pdf-unsupported",
    resolveId(source, importer) {
      if (source === "./pdf.js" && importer === path.join(FOLIATE_DIR, "view.js")) {
        return PDF_STUB_ID;
      }
      return null;
    },
    load(id) {
      if (id !== PDF_STUB_ID) return null;
      return [
        "export const makePDF = async () => {",
        '  throw new Error("PDF is not supported: pdf.js is not vendored (ADR 003)");',
        "};",
      ].join("\n");
    },
  };
}

// The preview (and dev) server sends InkSpark's Tauri CSP, so the spike runs under the app's
// policy and violations are real (M0 §5.2).
const headers = { "Content-Security-Policy": TAURI_CSP };

export default defineConfig({
  plugins: [foliatePdfUnsupported()],
  server: { headers },
  preview: { headers },
});
