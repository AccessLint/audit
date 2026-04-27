import { describe, it, expect } from "vitest";
import { buildSarif } from "../src/sarif.js";
import { aggregateRun, buildPerUrlReport } from "../src/report.js";
import type { SerializedViolation } from "../src/types.js";
import type { RawAuditResult } from "../src/audit.js";

const WORKSPACE = "/home/runner/work/repo/repo";

function v(overrides: Partial<SerializedViolation> = {}): SerializedViolation {
  return {
    ruleId: "text-alternatives/img-alt",
    selector: "img",
    html: "<img>",
    impact: "critical",
    message: "Missing alt.",
    ...overrides,
  };
}

const raw = (violations: SerializedViolation[]): RawAuditResult => ({
  url: "https://example.com",
  timestamp: Date.parse("2026-04-26T20:00:00Z"),
  ruleCount: 100,
  violations,
});

const runFor = (violations: SerializedViolation[]) =>
  aggregateRun([buildPerUrlReport(raw(violations), "https://example.com", "minor")]);

describe("buildSarif", () => {
  it("produces a valid v2.1.0 envelope", () => {
    const sarif = buildSarif(runFor([]), WORKSPACE);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0]!.tool.driver.name).toBe("AccessLint");
    expect(sarif.runs[0]!.results).toEqual([]);
  });

  it("maps impact to SARIF level", () => {
    const sarif = buildSarif(
      runFor([
        v({ impact: "critical" }),
        v({ impact: "serious", ruleId: "r/serious" }),
        v({ impact: "moderate", ruleId: "r/moderate" }),
        v({ impact: "minor", ruleId: "r/minor" }),
      ]),
      WORKSPACE,
    );
    const levels = sarif.runs[0]!.results.map((r) => r.level);
    expect(levels).toEqual(["error", "error", "warning", "note"]);
  });

  it("emits a physicalLocation for violations under the workspace", () => {
    const sarif = buildSarif(
      runFor([
        v({
          source: [
            {
              file: "file:///home/runner/work/repo/repo/src/Card.tsx",
              line: 42,
              column: 7,
              ownerDepth: 0,
            },
          ],
        }),
      ]),
      WORKSPACE,
    );
    const loc = sarif.runs[0]!.results[0]!.locations[0]!;
    expect(loc.physicalLocation).toEqual({
      artifactLocation: { uri: "src/Card.tsx", uriBaseId: "%SRCROOT%" },
      region: { startLine: 42, startColumn: 7 },
    });
  });

  it("falls back to a logical location when source is outside workspace", () => {
    const sarif = buildSarif(
      runFor([
        v({
          source: [{ file: "file:///opt/somewhere-else.js", line: 1, ownerDepth: 0 }],
        }),
      ]),
      WORKSPACE,
    );
    const loc = sarif.runs[0]!.results[0]!.locations[0]!;
    expect(loc.physicalLocation).toBeUndefined();
    expect(loc.logicalLocations?.[0]?.name).toBe("https://example.com");
  });

  it("deduplicates rules across multiple violations", () => {
    const sarif = buildSarif(
      runFor([v(), v(), v({ ruleId: "rule/other" })]),
      WORKSPACE,
    );
    const ids = sarif.runs[0]!.tool.driver.rules.map((r) => r.id);
    expect(ids.sort()).toEqual(["rule/other", "text-alternatives/img-alt"]);
  });

  it("preserves URL via result.properties", () => {
    const sarif = buildSarif(runFor([v()]), WORKSPACE);
    expect(sarif.runs[0]!.results[0]!.properties?.url).toBe("https://example.com");
    expect(sarif.runs[0]!.results[0]!.properties?.impact).toBe("critical");
  });

  it("declares %SRCROOT% in originalUriBaseIds", () => {
    const sarif = buildSarif(runFor([]), WORKSPACE);
    expect(sarif.runs[0]!.originalUriBaseIds?.["%SRCROOT%"]).toEqual({
      uri: "file:///home/runner/work/repo/repo/",
    });
  });

  it("strips startColumn when missing", () => {
    const sarif = buildSarif(
      runFor([
        v({
          source: [
            {
              file: "file:///home/runner/work/repo/repo/src/X.tsx",
              line: 5,
              ownerDepth: 0,
            },
          ],
        }),
      ]),
      WORKSPACE,
    );
    const region = sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation!.region!;
    expect(region.startLine).toBe(5);
    expect(region).not.toHaveProperty("startColumn");
  });
});
