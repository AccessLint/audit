import { describe, it, expect } from "vitest";
import {
  buildPerUrlReport,
  buildMarkdown,
  filterByImpact,
  countByImpact,
  shouldFail,
  lastSelectorSegment,
  aggregateRun,
  withFilteredViolations,
} from "../src/report.js";
import type { ActionInputs, AuditRun, SerializedViolation } from "../src/types.js";
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
  urls: ["https://example.com"],
  wcagLevel: "AA",
  minImpact: "serious",
  failOn: "never",
  rules: [],
  rulesExclude: [],
  waitFor: "networkidle",
  authHeaders: {},
};

const raw = (violations: SerializedViolation[]): RawAuditResult => ({
  url: "https://example.com",
  timestamp: Date.parse("2026-04-26T19:55:00Z"),
  ruleCount: 100,
  violations,
});

const reportFor = (violations: SerializedViolation[], minImpact = inputs.minImpact) =>
  buildPerUrlReport(raw(violations), inputs.urls[0]!, minImpact);

const runFor = (violations: SerializedViolation[], minImpact = inputs.minImpact) =>
  aggregateRun([reportFor(violations, minImpact)]);

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

describe("buildPerUrlReport", () => {
  it("filters, sorts by severity, and computes counts", () => {
    const r = reportFor([
      v({ impact: "minor", ruleId: "minor-rule" }),
      v({ impact: "critical", ruleId: "critical-rule" }),
      v({ impact: "serious", ruleId: "serious-rule" }),
    ]);
    expect(r.totalViolations).toBe(3);
    expect(r.filteredViolations).toBe(2);
    expect(r.violations.map((x) => x.ruleId)).toEqual(["critical-rule", "serious-rule"]);
    expect(r.counts).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 0 });
  });
});

describe("aggregateRun", () => {
  it("sums counts and tags violations with their URL", () => {
    const a = buildPerUrlReport(raw([v({ impact: "critical" })]), "https://a.com", "minor");
    const b = buildPerUrlReport(
      raw([v({ impact: "serious" }), v({ impact: "minor" })]),
      "https://b.com",
      "minor",
    );
    const run = aggregateRun([a, b]);
    expect(run.urls).toHaveLength(2);
    expect(run.filteredViolations).toBe(3);
    expect(run.counts).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 1 });
    expect(run.violations.map((x) => x.url)).toEqual([
      "https://a.com",
      "https://b.com",
      "https://b.com",
    ]);
  });

  it("propagates regression metadata", () => {
    const r = buildPerUrlReport(raw([]), "https://c.com", "serious");
    const run = aggregateRun([r], { regressionMode: true, baseline: "https://main.example" });
    expect(run.regressionMode).toBe(true);
    expect(run.baseline).toBe("https://main.example");
  });
});

describe("withFilteredViolations", () => {
  it("returns a fresh PerUrlReport reflecting the new subset", () => {
    const orig = reportFor([
      v({ impact: "critical", ruleId: "a" }),
      v({ impact: "serious", ruleId: "b" }),
      v({ impact: "moderate", ruleId: "c" }),
    ]);
    const subset = orig.violations.filter((x) => x.ruleId !== "b");
    const next = withFilteredViolations(orig, subset);
    expect(next.violations.map((x) => x.ruleId)).toEqual(["a"]);
    expect(next.counts).toEqual({ critical: 1, serious: 0, moderate: 0, minor: 0 });
    expect(next.totalViolations).toBe(orig.totalViolations); // unchanged
  });
});

describe("shouldFail", () => {
  const r = (counts: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>) =>
    runFor(
      (Object.entries(counts) as [SerializedViolation["impact"], number][]).flatMap(
        ([impact, n]) => Array.from({ length: n }, () => v({ impact })),
      ),
      "minor",
    );

  it("never fails when fail-on=never", () => {
    expect(shouldFail(r({ critical: 5 }), "never")).toBe(false);
  });

  it("fails on any when there's at least one violation", () => {
    expect(shouldFail(r({ minor: 1 }), "any")).toBe(true);
    expect(shouldFail(r({}), "any")).toBe(false);
  });

  it("fails on serious only when serious or critical present", () => {
    expect(shouldFail(r({ critical: 1 }), "serious")).toBe(true);
    expect(shouldFail(r({ serious: 1 }), "serious")).toBe(true);
    expect(shouldFail(r({ moderate: 5 }), "serious")).toBe(false);
  });

  it("fails on critical only when critical present", () => {
    expect(shouldFail(r({ critical: 1 }), "critical")).toBe(true);
    expect(shouldFail(r({ serious: 5 }), "critical")).toBe(false);
  });
});

describe("lastSelectorSegment", () => {
  it("returns the final segment", () => {
    expect(lastSelectorSegment("body > div > button.css-1k9j2m")).toBe("button.css-1k9j2m");
  });

  it("returns the input when there are no separators", () => {
    expect(lastSelectorSegment("img")).toBe("img");
  });
});

describe("buildMarkdown — single URL", () => {
  it("emits a clean message when nothing fails", () => {
    const md = buildMarkdown(runFor([]));
    expect(md).toContain("**No accessibility violations found.**");
    expect(md).toContain("AccessLint audit — https://example.com");
  });

  it("notes filtered-out violations when threshold drops them all", () => {
    const md = buildMarkdown(runFor([v({ impact: "minor" }), v({ impact: "minor" })]));
    expect(md).toContain("**No violations at the configured threshold**");
    expect(md).toContain("(2 below threshold filtered)");
  });

  it("groups violations by source file using <details> sections", () => {
    const md = buildMarkdown(
      runFor(
        [
          v({
            impact: "critical",
            source: [{ file: "src/Card.tsx", line: 42, column: 7, ownerDepth: 0 }],
          }),
          v({
            impact: "serious",
            source: [{ file: "src/Card.tsx", line: 88, ownerDepth: 0 }],
          }),
          v({
            impact: "serious",
            source: [{ file: "src/Header.tsx", line: 5, ownerDepth: 0 }],
          }),
        ],
        "minor",
      ),
    );
    expect(md).toContain("<details");
    expect(md).toContain("<strong>src/Card.tsx</strong> — 2 violations");
    expect(md).toContain("<strong>src/Header.tsx</strong> — 1 violation");
  });

  it("buckets violations without a source into 'Unmapped'", () => {
    const md = buildMarkdown(runFor([v({ impact: "critical" })]));
    expect(md).toContain("Unmapped (no source location)");
  });

  it("uses last selector segment in the table", () => {
    const md = buildMarkdown(
      runFor(
        [
          v({
            impact: "critical",
            selector: "body > div > div > button.css-1k9j2m",
            source: [{ file: "src/X.tsx", line: 1, ownerDepth: 0 }],
          }),
        ],
        "critical",
      ),
    );
    expect(md).toContain("`button.css-1k9j2m`");
    expect(md).not.toContain("body > div > div");
  });

  it("strips the path prefix from group headings and source cells", () => {
    const md = buildMarkdown(
      runFor(
        [
          v({
            impact: "critical",
            source: [
              { file: "file:///home/runner/work/r/r/src/X.tsx", line: 1, ownerDepth: 0 },
            ],
          }),
        ],
        "critical",
      ),
      { pathPrefix: "file:///home/runner/work/r/r/" },
    );
    expect(md).toContain("<strong>src/X.tsx</strong>");
    expect(md).not.toContain("/home/runner/");
  });

  it("includes a run-log link when runUrl is provided", () => {
    const md = buildMarkdown(runFor([]), {
      runUrl: "https://github.com/owner/repo/actions/runs/12345",
    });
    expect(md).toContain("[run log](https://github.com/owner/repo/actions/runs/12345)");
  });

  it("escapes pipe characters in cell content", () => {
    const md = buildMarkdown(
      runFor(
        [
          v({
            impact: "critical",
            message: "Has | pipe in it",
            selector: "div",
            source: [{ file: "src/X.tsx", line: 1, ownerDepth: 0 }],
          }),
        ],
        "critical",
      ),
    );
    expect(md).toContain("Has \\| pipe in it");
  });
});

describe("buildMarkdown — multi-URL", () => {
  it("renders an H1 with the URL count and per-URL H2 sections", () => {
    const a = buildPerUrlReport(raw([v({ impact: "critical", ruleId: "a" })]), "https://a.com", "minor");
    const b = buildPerUrlReport(raw([v({ impact: "serious", ruleId: "b" })]), "https://b.com", "minor");
    const md = buildMarkdown(aggregateRun([a, b]));
    expect(md).toContain("# AccessLint audit — 2 URLs");
    expect(md).toContain("**2 violations across 2 URLs**");
    expect(md).toContain("## https://a.com");
    expect(md).toContain("## https://b.com");
  });

  it("emits a clean run summary when no URL has violations", () => {
    const a = buildPerUrlReport(raw([]), "https://a.com", "serious");
    const b = buildPerUrlReport(raw([]), "https://b.com", "serious");
    const md = buildMarkdown(aggregateRun([a, b]));
    expect(md).toContain("No accessibility violations found across any URL.");
  });
});

describe("buildMarkdown — regression mode", () => {
  it("renders a regression header with baseline and candidate URLs", () => {
    const candidate = buildPerUrlReport(
      raw([v({ impact: "critical" })]),
      "https://pr.example.com",
      "minor",
    );
    const md = buildMarkdown(
      aggregateRun([candidate], {
        regressionMode: true,
        baseline: "https://main.example.com",
      }),
    );
    expect(md).toContain("# AccessLint regression audit");
    expect(md).toContain("https://pr.example.com");
    expect(md).toContain("https://main.example.com");
    expect(md).toContain("Only violations *new* in the candidate are reported");
  });
});
