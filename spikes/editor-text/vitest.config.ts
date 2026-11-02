import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "spike-editor-text",
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
