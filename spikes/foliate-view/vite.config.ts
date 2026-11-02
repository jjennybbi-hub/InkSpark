import { defineConfig } from "vite";
import { TAURI_CSP } from "./src/csp";

// The preview server sends InkSpark's Tauri CSP, so the spike runs under the app's policy (M0 §5.2).
export default defineConfig({
  preview: {
    headers: { "Content-Security-Policy": TAURI_CSP },
  },
});
