import {
  WRITING_MODES,
  createSpikeEditor,
  generateText,
  measureInputLatency,
  type SpikeEditorHandle,
  type WritingMode,
} from "./harness";

// Renders one editor per writing mode and exposes the handles to the Playwright tests
// (tests/helpers.ts declares the types of `window.__spike` and `window.__spikeApi`).
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("#app is missing");

const spike: Partial<Record<WritingMode, SpikeEditorHandle>> = {};
for (const mode of WRITING_MODES) {
  const host = document.createElement("section");
  host.dataset.testid = `editor-${mode}`;
  host.setAttribute("aria-label", `Editor (${mode})`);
  app.appendChild(host);
  spike[mode] = createSpikeEditor(host, mode);
}

Object.assign(window, { __spike: spike, __spikeApi: { generateText, measureInputLatency } });
