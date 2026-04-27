import type {
  ActionInputs,
  AuditReport,
  FailLevel,
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

const IMPACT_EMOJI: Record<Impact, string> = {
  critical: "🟥",
  serious: "🟧",
  moderate: "🟨",
  minor: "🟦",
};

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

/** True when `count` of `impact` (or worse) meets the fail threshold. */
export function shouldFail(report: AuditReport, failOn: FailLevel): boolean {
  if (failOn === "never") return false;
  if (failOn === "any") return report.filteredViolations > 0;
  const threshold = IMPACT_ORDER[failOn];
  return ALL_IMPACTS.some(
    (i) => IMPACT_ORDER[i] <= threshold && (report.counts[i] ?? 0) > 0,
  );
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Reduce a deep selector to the last meaningful segment. Long selector
 * paths in the Markdown lose signal — `body > div > … > button.css-1k9j2m`
 * is just `button.css-1k9j2m` once you have a Source: line.
 */
export function lastSelectorSegment(selector: string): string {
  const segments = selector.split(/\s*>\s*/);
  return segments[segments.length - 1] ?? selector;
}

function trimPrefix(file: string, prefix: string): string {
  return prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function formatSourceCell(source: SourceLocation[] | undefined, pathPrefix: string): string {
  if (!source || source.length === 0) return "—";
  const first = source[0]!;
  const pos = first.column != null ? `${first.line}:${first.column}` : `${first.line}`;
  const symbol = first.symbol ? ` (${first.symbol})` : "";
  return `\`${escapeMd(trimPrefix(first.file, pathPrefix))}:${pos}\`${escapeMd(symbol)}`;
}

/** Group violations by their first source file path; violations without a
 *  source land in a synthetic "Unmapped" group at the end. */
function groupByFile(
  violations: SerializedViolation[],
): { file: string; violations: SerializedViolation[] }[] {
  const groups = new Map<string, SerializedViolation[]>();
  const UNMAPPED = "__unmapped__";
  for (const v of violations) {
    const file = v.source?.[0]?.file ?? UNMAPPED;
    let bucket = groups.get(file);
    if (!bucket) {
      bucket = [];
      groups.set(file, bucket);
    }
    bucket.push(v);
  }
  // Stable order: preserve insertion order, but float Unmapped to the end.
  const out: { file: string; violations: SerializedViolation[] }[] = [];
  let unmapped: SerializedViolation[] | undefined;
  for (const [file, vs] of groups) {
    if (file === UNMAPPED) unmapped = vs;
    else out.push({ file, violations: vs });
  }
  if (unmapped) out.push({ file: "Unmapped (no source location)", violations: unmapped });
  return out;
}

function formatFileGroup(
  group: { file: string; violations: SerializedViolation[] },
  pathPrefix: string,
): string[] {
  const lines: string[] = [];
  const counts = countByImpact(group.violations);
  const counted = ALL_IMPACTS.filter((i) => counts[i] > 0)
    .map((i) => `${counts[i]} ${i}`)
    .join(", ");

  // Trim the path prefix when present so the group header reads cleanly.
  const heading = trimPrefix(group.file, pathPrefix);
  lines.push(`<details${counts.critical > 0 || counts.serious > 0 ? " open" : ""}>`);
  lines.push(
    `<summary><strong>${escapeMd(heading)}</strong> — ${group.violations.length} violation${group.violations.length === 1 ? "" : "s"} (${counted})</summary>`,
  );
  lines.push("");
  lines.push("| Impact | Rule | Source | Element | Message |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const v of group.violations) {
    lines.push(
      [
        `${IMPACT_EMOJI[v.impact]} ${v.impact}`,
        `\`${escapeMd(v.ruleId)}\``,
        formatSourceCell(v.source, pathPrefix),
        `\`${escapeMd(lastSelectorSegment(v.selector))}\``,
        escapeMd(v.message),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("</details>");
  return lines;
}

export interface MarkdownContext {
  /** GitHub Actions run URL — included in the footer when provided. */
  runUrl?: string;
  /**
   * Common prefix to strip from source-file paths in group headings (e.g. a
   * workspace path like '/home/runner/work/repo/repo/'). Only affects display.
   */
  pathPrefix?: string;
}

export function buildMarkdown(report: AuditReport, ctx: MarkdownContext = {}): string {
  const { url, counts, totalViolations, filteredViolations, violations, generatedAt } = report;
  const summaryParts = ALL_IMPACTS.flatMap((i) =>
    counts[i] > 0 ? [`${IMPACT_EMOJI[i]} ${counts[i]} ${i}`] : [],
  );
  const summary = summaryParts.length ? summaryParts.join(", ") : "no violations";

  const lines: string[] = [];
  lines.push(`# AccessLint audit — ${url}`);
  lines.push("");

  if (filteredViolations === 0) {
    if (totalViolations === 0) {
      lines.push("**No accessibility violations found.** ✅");
    } else {
      lines.push(
        `**No violations at the configured threshold** (${totalViolations} below threshold filtered).`,
      );
    }
  } else {
    const filteredOut = totalViolations - filteredViolations;
    const noteSuffix = filteredOut > 0 ? ` _(+${filteredOut} below threshold)_` : "";
    lines.push(
      `**${filteredViolations} violation${filteredViolations === 1 ? "" : "s"}**: ${summary}${noteSuffix}.`,
    );
    lines.push("");
    for (const group of groupByFile(violations)) {
      lines.push(...formatFileGroup(group, ctx.pathPrefix ?? ""));
      lines.push("");
    }
  }

  lines.push(
    `<sub>Generated ${generatedAt}` +
      (ctx.runUrl ? ` · [run log](${ctx.runUrl})` : "") +
      ` · [\`AccessLint/audit\`](https://github.com/AccessLint/audit)</sub>`,
  );

  return lines.join("\n") + "\n";
}
