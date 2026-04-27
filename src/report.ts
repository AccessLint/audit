import type {
  ActionInputs,
  AuditRun,
  FailLevel,
  Impact,
  LocatedViolation,
  PerUrlReport,
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

export function filterByImpact<V extends { impact: Impact }>(
  violations: V[],
  minImpact: Impact,
): V[] {
  const threshold = IMPACT_ORDER[minImpact];
  return violations.filter((v) => IMPACT_ORDER[v.impact] <= threshold);
}

export function countByImpact(
  violations: { impact: Impact }[],
): Record<Impact, number> {
  const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) counts[v.impact]++;
  return counts;
}

export function buildPerUrlReport(
  raw: RawAuditResult,
  url: string,
  minImpact: Impact,
): PerUrlReport {
  const filtered = filterByImpact(raw.violations, minImpact);
  filtered.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
  return {
    url,
    generatedAt: new Date(raw.timestamp).toISOString(),
    ruleCount: raw.ruleCount,
    totalViolations: raw.violations.length,
    filteredViolations: filtered.length,
    counts: countByImpact(filtered),
    violations: filtered,
  };
}

export interface AggregateOptions {
  regressionMode?: boolean;
  baseline?: string;
}

/** Combine N per-URL reports into a single AuditRun. */
export function aggregateRun(
  perUrl: PerUrlReport[],
  opts: AggregateOptions = {},
): AuditRun {
  const violations: LocatedViolation[] = [];
  for (const p of perUrl) {
    for (const v of p.violations) violations.push({ ...v, url: p.url });
  }
  return {
    regressionMode: !!opts.regressionMode,
    baseline: opts.baseline,
    generatedAt: new Date().toISOString(),
    totalViolations: perUrl.reduce((n, p) => n + p.totalViolations, 0),
    filteredViolations: violations.length,
    counts: countByImpact(violations),
    violations,
    urls: perUrl,
  };
}

/** Returns a fresh PerUrlReport with `violations` replaced by `subset`. */
export function withFilteredViolations(
  report: PerUrlReport,
  subset: SerializedViolation[],
): PerUrlReport {
  const sorted = [...subset].sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
  return {
    ...report,
    filteredViolations: sorted.length,
    counts: countByImpact(sorted),
    violations: sorted,
  };
}

export function shouldFail(run: AuditRun, failOn: FailLevel): boolean {
  if (failOn === "never") return false;
  if (failOn === "any") return run.filteredViolations > 0;
  const threshold = IMPACT_ORDER[failOn];
  return ALL_IMPACTS.some(
    (i) => IMPACT_ORDER[i] <= threshold && (run.counts[i] ?? 0) > 0,
  );
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

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

function formatPerUrl(report: PerUrlReport, pathPrefix: string): string[] {
  const { violations, totalViolations, filteredViolations, counts } = report;
  const out: string[] = [];

  if (filteredViolations === 0) {
    if (totalViolations === 0) {
      out.push("**No accessibility violations found.** ✅");
    } else {
      out.push(
        `**No violations at the configured threshold** (${totalViolations} below threshold filtered).`,
      );
    }
    return out;
  }

  const summary = ALL_IMPACTS.flatMap((i) =>
    counts[i] > 0 ? [`${IMPACT_EMOJI[i]} ${counts[i]} ${i}`] : [],
  ).join(", ");
  const filteredOut = totalViolations - filteredViolations;
  const noteSuffix = filteredOut > 0 ? ` _(+${filteredOut} below threshold)_` : "";
  out.push(
    `**${filteredViolations} violation${filteredViolations === 1 ? "" : "s"}**: ${summary}${noteSuffix}.`,
  );
  out.push("");
  for (const group of groupByFile(violations)) {
    out.push(...formatFileGroup(group, pathPrefix));
    out.push("");
  }
  return out;
}

export interface MarkdownContext {
  runUrl?: string;
  pathPrefix?: string;
}

export function buildMarkdown(run: AuditRun, ctx: MarkdownContext = {}): string {
  const lines: string[] = [];
  const isMulti = run.urls.length > 1;
  const pathPrefix = ctx.pathPrefix ?? "";

  if (run.regressionMode) {
    lines.push(`# AccessLint regression audit`);
    lines.push("");
    lines.push(
      `Comparing **${run.urls[0]?.url}** against baseline **${run.baseline}**. Only violations *new* in the candidate are reported below.`,
    );
    lines.push("");
  } else if (isMulti) {
    lines.push(`# AccessLint audit — ${run.urls.length} URLs`);
    lines.push("");
    const summary = ALL_IMPACTS.flatMap((i) =>
      run.counts[i] > 0 ? [`${IMPACT_EMOJI[i]} ${run.counts[i]} ${i}`] : [],
    ).join(", ");
    lines.push(
      run.filteredViolations === 0
        ? "**No accessibility violations found across any URL.** ✅"
        : `**${run.filteredViolations} violations across ${run.urls.length} URLs**: ${summary || "—"}.`,
    );
    lines.push("");
  } else {
    lines.push(`# AccessLint audit — ${run.urls[0]?.url}`);
    lines.push("");
  }

  for (const per of run.urls) {
    if (isMulti) {
      lines.push(`## ${per.url}`);
      lines.push("");
    }
    lines.push(...formatPerUrl(per, pathPrefix));
  }

  lines.push(
    `<sub>Generated ${run.generatedAt}` +
      (ctx.runUrl ? ` · [run log](${ctx.runUrl})` : "") +
      ` · [\`AccessLint/audit\`](https://github.com/AccessLint/audit)</sub>`,
  );

  return lines.join("\n") + "\n";
}
