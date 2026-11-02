import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed dev-server port and leaves the terminal output alone.
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    ...(host === undefined ? {} : { host, hmr: { protocol: "ws", host, port: 1421 } }),
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri uses WebKit on macOS/Linux and WebView2 (Chromium) on Windows.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG === undefined ? "oxc" : false,
    sourcemap: process.env.TAURI_ENV_DEBUG !== undefined,
  },
});
