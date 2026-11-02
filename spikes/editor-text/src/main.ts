import type { Editor } from "@tiptap/core";
import {
  WRITING_MODES,
  createSpikeEditor,
  generateText,
  measureInputLatency,
  type SpikeEditorHandle,
  type WritingMode,
} from "./harness";

// Renders one editor per writing mode and exposes the handles to the Playwright tests
// (tests/helpers.ts declares the types of `window.__spike` and `window.__spikeApi`). The handles
// are published only once fonts are loaded, every editor has finished initialising and layout
// has settled, so tests never measure a page that is still reflowing.

/** TipTap emits "create" from a timeout after mounting. */
function whenCreated(editor: Editor): Promise<void> {
  if (editor.isInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    editor.on("create", () => {
      resolve();
    });
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function start(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (app === null) throw new Error("#app is missing");

  await document.fonts.ready;

  const spike: Partial<Record<WritingMode, SpikeEditorHandle>> = {};
  for (const mode of WRITING_MODES) {
    const host = document.createElement("section");
    host.dataset.testid = `editor-${mode}`;
    app.appendChild(host);
    spike[mode] = createSpikeEditor(host, mode);
  }
  await Promise.all(Object.values(spike).map((h) => whenCreated(h.editor)));
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();

  Object.assign(window, { __spike: spike, __spikeApi: { generateText, measureInputLatency } });
}

// Surface a failed start (it would otherwise be an unobserved rejection).
start().catch((error: unknown) => {
  reportError(error);
});
