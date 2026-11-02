import axe from "axe-core";
import { expect } from "vitest";

function describeViolations(violations: readonly axe.Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? "unknown"}): ${v.help}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`,
    )
    .join("\n");
}

/** Runs axe-core on `container` and fails the test with a readable list of any violations. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, { resultTypes: ["violations"] });
  expect(results.violations, describeViolations(results.violations)).toEqual([]);
}
