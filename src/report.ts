import type {
  ActionInputs,
  AuditReport,
  Impact,
  SerializedViolation,
  SourceLocation,
} from "./types.js";
import type { RawAuditResult } from "./audit.js";

const IMPACT_ORDER: Record<Impact, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

const ALL_IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

/** Drop violations below the user's min-impact threshold. */
export function filterByImpact(
  violations: SerializedViolation[],
  minImpact: Impact,
): SerializedViolation[] {
  const threshold = IMPACT_ORDER[minImpact];
  return violations.filter((v) => IMPACT_ORDER[v.impact] <= threshold);
}

export function countByImpact(violations: SerializedViolation[]): Record<Impact, number> {
  const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) counts[v.impact]++;
  return counts;
}

export function buildReport(raw: RawAuditResult, inputs: ActionInputs): AuditReport {
  const filtered = filterByImpact(raw.violations, inputs.minImpact);
  filtered.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
  return {
    url: inputs.url,
    generatedAt: new Date(raw.timestamp).toISOString(),
    ruleCount: raw.ruleCount,
    totalViolations: raw.violations.length,
    filteredViolations: filtered.length,
    counts: countByImpact(filtered),
    violations: filtered,
  };
}

function escapeMd(text: string): string {
  // Cell-safe: pipes break tables, backticks/asterisks render as code/emphasis.
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatSourceCell(source?: SourceLocation[]): string {
  if (!source || source.length === 0) return "—";
  const first = source[0]!;
  const pos = first.column != null ? `${first.line}:${first.column}` : `${first.line}`;
  const symbol = first.symbol ? ` (${first.symbol})` : "";
  return `\`${escapeMd(first.file)}:${pos}\`${escapeMd(symbol)}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function buildMarkdown(report: AuditReport): string {
  const { url, counts, totalViolations, filteredViolations, violations, generatedAt } = report;
  const summaryParts = ALL_IMPACTS.flatMap((i) => (counts[i] > 0 ? [`${counts[i]} ${i}`] : []));
  const summary = summaryParts.length ? summaryParts.join(", ") : "no violations";

  const lines: string[] = [];
  lines.push(`# AccessLint audit — ${url}`);
  lines.push("");

  if (filteredViolations === 0) {
    if (totalViolations === 0) {
      lines.push("**No accessibility violations found.**");
    } else {
      lines.push(
        `**No violations at the configured threshold** (${totalViolations} below threshold filtered).`,
      );
    }
  } else {
    const filteredOut = totalViolations - filteredViolations;
    const noteSuffix = filteredOut > 0 ? ` (${filteredOut} below threshold filtered)` : "";
    lines.push(`**${filteredViolations} violation${filteredViolations === 1 ? "" : "s"}**: ${summary}${noteSuffix}.`);
    lines.push("");
    lines.push("| Impact | Rule | Source | Element | Message |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const v of violations) {
      lines.push(
        [
          v.impact,
          `\`${escapeMd(v.ruleId)}\``,
          formatSourceCell(v.source),
          `\`${escapeMd(truncate(v.selector, 60))}\``,
          escapeMd(v.message),
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
      );
    }
  }

  lines.push("");
  lines.push(`<sub>Generated ${generatedAt} by [\`AccessLint/audit\`](https://github.com/AccessLint/audit).</sub>`);

  return lines.join("\n") + "\n";
}
