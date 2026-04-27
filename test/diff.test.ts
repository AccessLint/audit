import { describe, it, expect } from "vitest";
import { newViolations } from "../src/diff.js";
import type { SerializedViolation } from "../src/types.js";

function v(
  ruleId: string,
  selector: string,
  overrides: Partial<SerializedViolation> = {},
): SerializedViolation {
  return {
    ruleId,
    selector,
    html: "<el>",
    impact: "serious",
    message: "x",
    ...overrides,
  };
}

describe("newViolations", () => {
  it("returns candidate-only entries (matched by ruleId+selector)", () => {
    const baseline = [v("rule/a", "img"), v("rule/b", "button")];
    const candidate = [v("rule/a", "img"), v("rule/c", "a"), v("rule/b", "button.new")];
    const out = newViolations(baseline, candidate);
    expect(out.map((x) => `${x.ruleId}@${x.selector}`)).toEqual([
      "rule/c@a",
      "rule/b@button.new",
    ]);
  });

  it("returns all candidate violations when baseline is empty", () => {
    const candidate = [v("rule/a", "img")];
    expect(newViolations([], candidate)).toEqual(candidate);
  });

  it("returns nothing when candidate is empty", () => {
    expect(newViolations([v("rule/a", "img")], [])).toEqual([]);
  });

  it("treats different selectors as different violations even with same rule", () => {
    const out = newViolations([v("rule/a", "img")], [v("rule/a", "img.new")]);
    expect(out).toHaveLength(1);
  });
});
