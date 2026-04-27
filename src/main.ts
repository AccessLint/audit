import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setOutput, setFailed, info, summary } from "@actions/core";
import { readInputs } from "./inputs.js";
import { runAudit } from "./audit.js";
import { buildReport, buildMarkdown, shouldFail } from "./report.js";
import { emitAnnotations } from "./annotations.js";

/** Bail out clearly if the runner shipped Node < 24 — esbuild target is
 *  node24 and Node 20 is removed from runners 2026-09-16. Friendlier than
 *  letting a syntax error crash the bundle. */
function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major < 20) {
    throw new Error(
      `AccessLint/audit requires Node 20+; got ${process.versions.node}. ` +
        `Set up the runner with actions/setup-node or use a newer image.`,
    );
  }
}

async function run(): Promise<void> {
  assertNodeVersion();
  const inputs = readInputs();

  info(
    `Auditing ${inputs.url} (WCAG ${inputs.wcagLevel}, min impact ${inputs.minImpact}, fail-on ${inputs.failOn})`,
  );

  const raw = await runAudit(inputs);
  const report = buildReport(raw, inputs);

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const jsonPath = join(workspace, "accesslint-report.json");
  const mdPath = join(workspace, "accesslint-report.md");

  // Workspace-relative source paths trim the long `/home/runner/work/...`
  // prefix from group headings in the Markdown.
  const pathPrefix = workspaceFilePrefix(workspace);
  const runUrl = buildRunUrl();
  const markdown = buildMarkdown(report, { pathPrefix, runUrl });

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, markdown, "utf8");

  // Inline PR-diff annotations: `::warning file=…,line=…::` lands the
  // violation right on the changed line in the PR review tab.
  const annotated = emitAnnotations(report.violations, workspace);

  setOutput("violation-count", report.filteredViolations);
  setOutput("critical-count", report.counts.critical);
  setOutput("serious-count", report.counts.serious);
  setOutput("annotated-count", annotated);
  setOutput("failed", report.filteredViolations > 0 ? "true" : "false");
  setOutput("report-json-path", jsonPath);
  setOutput("report-markdown-path", mdPath);

  // Surface the markdown in the run summary so it's visible without
  // downloading the artifact.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await summary.addRaw(markdown).write();
    } catch {
      // best-effort
    }
  }

  info(
    `Audit complete: ${report.filteredViolations}/${report.totalViolations} violations after filter ` +
      `(${report.counts.critical} critical, ${report.counts.serious} serious). ` +
      `${annotated} inline annotation${annotated === 1 ? "" : "s"} emitted.`,
  );

  if (shouldFail(report, inputs.failOn)) {
    setFailed(
      `accessibility threshold failed (fail-on=${inputs.failOn}, violations=${report.filteredViolations})`,
    );
  }
}

/** Build the file:// URL prefix that the fiber-source probe emits in CI,
 *  so we can strip it from group headings in the Markdown. */
function workspaceFilePrefix(workspace: string): string {
  const ws = workspace.endsWith("/") ? workspace : workspace + "/";
  return `file://${ws}`;
}

/** Construct the run-log URL when running inside GitHub Actions. */
function buildRunUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!server || !repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
}

run().catch((err) => {
  setFailed(err instanceof Error ? err.message : String(err));
});
