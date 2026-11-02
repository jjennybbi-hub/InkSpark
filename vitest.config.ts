import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "app",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      // Each spike brings its own config; matching nothing is fine.
      "spikes/*/vitest.config.ts",
    ],
  },
});
