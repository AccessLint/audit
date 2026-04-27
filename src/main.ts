import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setOutput, setFailed, info, summary } from "@actions/core";
import { readInputs } from "./inputs.js";
import { runAll } from "./orchestrator.js";
import { buildMarkdown, shouldFail } from "./report.js";
import { emitAnnotations } from "./annotations.js";
import { buildSarif } from "./sarif.js";

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

  const targetSummary =
    inputs.urls.length === 1 ? inputs.urls[0]! : `${inputs.urls.length} URLs`;
  const modeSummary = inputs.compareAgainst
    ? ` (regression vs ${inputs.compareAgainst})`
    : "";
  info(
    `Auditing ${targetSummary}${modeSummary} — WCAG ${inputs.wcagLevel}, min impact ${inputs.minImpact}, fail-on ${inputs.failOn}`,
  );

  const auditRun = await runAll(inputs);

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const jsonPath = join(workspace, "accesslint-report.json");
  const mdPath = join(workspace, "accesslint-report.md");
  const sarifPath = join(workspace, "accesslint-report.sarif");

  const pathPrefix = workspaceFilePrefix(workspace);
  const runUrl = buildRunUrl();
  const markdown = buildMarkdown(auditRun, { pathPrefix, runUrl });
  const sarif = buildSarif(auditRun, workspace);

  writeFileSync(jsonPath, JSON.stringify(auditRun, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, markdown, "utf8");
  writeFileSync(sarifPath, JSON.stringify(sarif, null, 2) + "\n", "utf8");

  const annotated = emitAnnotations(auditRun.violations, workspace);

  setOutput("violation-count", auditRun.filteredViolations);
  setOutput("critical-count", auditRun.counts.critical);
  setOutput("serious-count", auditRun.counts.serious);
  setOutput("annotated-count", annotated);
  setOutput("failed", auditRun.filteredViolations > 0 ? "true" : "false");
  setOutput("report-json-path", jsonPath);
  setOutput("report-markdown-path", mdPath);
  setOutput("report-sarif-path", sarifPath);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await summary.addRaw(markdown).write();
    } catch {
      // best-effort
    }
  }

  info(
    `Audit complete: ${auditRun.filteredViolations}/${auditRun.totalViolations} violations after filter ` +
      `(${auditRun.counts.critical} critical, ${auditRun.counts.serious} serious). ` +
      `${annotated} inline annotation${annotated === 1 ? "" : "s"} emitted.`,
  );

  if (shouldFail(auditRun, inputs.failOn)) {
    setFailed(
      `accessibility threshold failed (fail-on=${inputs.failOn}, violations=${auditRun.filteredViolations})`,
    );
  }
}

function workspaceFilePrefix(workspace: string): string {
  const ws = workspace.endsWith("/") ? workspace : workspace + "/";
  return `file://${ws}`;
}

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
