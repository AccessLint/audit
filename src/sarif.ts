import type { AuditRun, Impact, LocatedViolation } from "./types.js";
import { toWorkspaceRelative } from "./annotations.js";

/**
 * Build a SARIF v2.1.0 document from the audit run. Suitable for upload via
 * github/codeql-action/upload-sarif so violations show up in the Security
 * tab and as inline annotations on the PR diff.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 *
 * Decisions:
 * - Each unique `ruleId` becomes a SARIF `rules[]` entry on the driver.
 * - Each violation becomes a `results[]` entry. SARIF requires `results` to
 *   reference rules by index *or* id; we use id (`ruleId`) for clarity.
 * - Impact maps to SARIF `level`:
 *     critical|serious -> "error"
 *     moderate         -> "warning"
 *     minor            -> "note"
 * - Locations include the source file (workspace-relative) when available,
 *   falling back to a logical location (the URL) otherwise.
 */

interface SarifLocation {
  physicalLocation?: {
    artifactLocation: { uri: string; uriBaseId?: string };
    region?: { startLine: number; startColumn?: number };
  };
  logicalLocations?: { name: string; kind: string }[];
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note" | "none";
  message: { text: string };
  locations: SarifLocation[];
  properties?: Record<string, unknown>;
}

interface SarifRule {
  id: string;
  shortDescription?: { text: string };
  helpUri?: string;
  properties?: { tags?: string[] };
}

interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: {
      driver: {
        name: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
    originalUriBaseIds?: Record<string, { uri: string }>;
  }[];
}

function impactToSarifLevel(impact: Impact): SarifResult["level"] {
  switch (impact) {
    case "critical":
    case "serious":
      return "error";
    case "moderate":
      return "warning";
    case "minor":
      return "note";
  }
}

function ruleHelpUri(ruleId: string): string {
  // Rule IDs look like 'category/rule-name'. Link to the rule's source.
  // Until we host hash-anchored docs, the engine's source tree is the next
  // best thing for "where is this rule defined".
  return `https://github.com/AccessLint/accesslint/tree/main/core/src/rules/${ruleId}`;
}

function locationFor(v: LocatedViolation, workspace: string): SarifLocation {
  const src = v.source?.[0];
  if (src) {
    const rel = toWorkspaceRelative(src.file, workspace);
    if (rel) {
      const physical: SarifLocation["physicalLocation"] = {
        artifactLocation: { uri: rel, uriBaseId: "%SRCROOT%" },
        region: { startLine: src.line, startColumn: src.column },
      };
      // SARIF rejects an undefined startColumn — strip when missing.
      if (physical.region && physical.region.startColumn === undefined) {
        delete physical.region.startColumn;
      }
      return { physicalLocation: physical };
    }
  }
  // Fallback: synthesize a repo-relative physicalLocation derived from the
  // URL. Code Scanning *requires* a physicalLocation on every result AND
  // rejects `https:` URIs (the URI must match the checkout's `file:`
  // scheme). We project the URL into a synthetic path under %SRCROOT%
  // (e.g. `audit/example.com/dashboard`) so violations from the same URL
  // group together in the Security tab. The path doesn't need to exist
  // in the repo — Code Scanning accepts non-existent paths and just
  // skips inline annotations for them.
  return {
    physicalLocation: {
      artifactLocation: { uri: urlToSyntheticPath(v.url), uriBaseId: "%SRCROOT%" },
      region: { startLine: 1 },
    },
    logicalLocations: [{ name: v.url, kind: "url" }],
  };
}

function urlToSyntheticPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `audit/${u.host}${path}`;
  } catch {
    return `audit/${url.replace(/[^a-zA-Z0-9._/-]/g, "_")}`;
  }
}

export function buildSarif(run: AuditRun, workspace: string): SarifLog {
  // Deduplicate rules across all violations.
  const seen = new Map<string, SarifRule>();
  for (const v of run.violations) {
    if (seen.has(v.ruleId)) continue;
    seen.set(v.ruleId, {
      id: v.ruleId,
      shortDescription: { text: v.message },
      helpUri: ruleHelpUri(v.ruleId),
      properties: { tags: ["accessibility", "wcag"] },
    });
  }

  const results: SarifResult[] = run.violations.map((v) => ({
    ruleId: v.ruleId,
    level: impactToSarifLevel(v.impact),
    message: { text: v.message },
    locations: [locationFor(v, workspace)],
    properties: {
      impact: v.impact,
      selector: v.selector,
      url: v.url,
    },
  }));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0-rtm.5.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "AccessLint",
            informationUri: "https://github.com/AccessLint/audit",
            rules: Array.from(seen.values()),
          },
        },
        originalUriBaseIds: {
          "%SRCROOT%": { uri: "file://" + (workspace.endsWith("/") ? workspace : workspace + "/") },
        },
        results,
      },
    ],
  };
}
