import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "spike-foliate-view",
    environment: "node",
    include: ["src/**/*.test.ts", "fixtures/**/*.test.ts"],
  },
});
