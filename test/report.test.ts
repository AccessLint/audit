import { describe, it, expect } from "vitest";
import {
  buildReport,
  buildMarkdown,
  filterByImpact,
  countByImpact,
} from "../src/report.js";
import type { ActionInputs, SerializedViolation } from "../src/types.js";
import type { RawAuditResult } from "../src/audit.js";

function v(overrides: Partial<SerializedViolation> = {}): SerializedViolation {
  return {
    ruleId: "text-alternatives/img-alt",
    selector: "img",
    html: '<img src="x.png">',
    impact: "critical",
    message: "Image element missing alt attribute.",
    ...overrides,
  };
}

const inputs: ActionInputs = {
  url: "https://example.com",
  wcagLevel: "AA",
  minImpact: "serious",
  waitFor: "networkidle",
  authHeaders: {},
  outputDir: "/tmp",
  installBrowser: false,
};

const raw = (violations: SerializedViolation[]): RawAuditResult => ({
  url: "https://example.com",
  timestamp: Date.parse("2026-04-26T19:55:00Z"),
  ruleCount: 100,
  violations,
});

describe("filterByImpact", () => {
  it("keeps violations at or above the threshold", () => {
    const out = filterByImpact(
      [v({ impact: "minor" }), v({ impact: "critical" }), v({ impact: "serious" })],
      "serious",
    );
    expect(out.map((x) => x.impact)).toEqual(["critical", "serious"]);
  });

  it("returns empty when nothing meets the threshold", () => {
    expect(filterByImpact([v({ impact: "minor" })], "critical")).toEqual([]);
  });
});

describe("countByImpact", () => {
  it("returns 0s for empty input", () => {
    expect(countByImpact([])).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
  });

  it("counts each tier", () => {
    expect(
      countByImpact([
        v({ impact: "critical" }),
        v({ impact: "critical" }),
        v({ impact: "serious" }),
        v({ impact: "minor" }),
      ]),
    ).toEqual({ critical: 2, serious: 1, moderate: 0, minor: 1 });
  });
});

describe("buildReport", () => {
  it("filters, sorts by severity, and computes counts", () => {
    const r = buildReport(
      raw([
        v({ impact: "minor", ruleId: "minor-rule" }),
        v({ impact: "critical", ruleId: "critical-rule" }),
        v({ impact: "serious", ruleId: "serious-rule" }),
      ]),
      inputs,
    );
    expect(r.totalViolations).toBe(3);
    expect(r.filteredViolations).toBe(2);
    expect(r.violations.map((x) => x.ruleId)).toEqual(["critical-rule", "serious-rule"]);
    expect(r.counts).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 0 });
  });
});

describe("buildMarkdown", () => {
  it("emits a clean report when nothing fails", () => {
    const md = buildMarkdown(buildReport(raw([]), inputs));
    expect(md).toContain("**No accessibility violations found.**");
    expect(md).toContain("AccessLint audit — https://example.com");
  });

  it("notes filtered-out violations when threshold drops them all", () => {
    const md = buildMarkdown(
      buildReport(raw([v({ impact: "minor" }), v({ impact: "minor" })]), inputs),
    );
    expect(md).toContain("**No violations at the configured threshold**");
    expect(md).toContain("(2 below threshold filtered)");
  });

  it("renders a violation table with source locations", () => {
    const md = buildMarkdown(
      buildReport(
        raw([
          v({
            impact: "critical",
            source: [
              { file: "src/Card.tsx", line: 42, column: 7, symbol: "Card", ownerDepth: 0 },
            ],
          }),
        ]),
        inputs,
      ),
    );
    expect(md).toContain("| Impact | Rule | Source | Element | Message |");
    expect(md).toContain("`src/Card.tsx:42:7`");
    expect(md).toContain("(Card)");
  });

  it("uses an em-dash placeholder when source is absent", () => {
    const md = buildMarkdown(buildReport(raw([v({ impact: "critical" })]), inputs));
    expect(md).toContain("| critical | `text-alternatives/img-alt` | — |");
  });

  it("escapes pipe characters in cell content", () => {
    const md = buildMarkdown(
      buildReport(
        raw([v({ impact: "critical", message: "Has | pipe in it", selector: "div" })]),
        inputs,
      ),
    );
    expect(md).toContain("Has \\| pipe in it");
  });
});
