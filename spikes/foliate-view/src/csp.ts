/**
 * InkSpark's Tauri CSP. Must equal `app.security.csp` in `src-tauri/tauri.conf.json`
 * (checked by `src/csp.test.ts`). The preview server sends it as a header (vite.config.ts).
 */
export const TAURI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: blob: data:; font-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost";
