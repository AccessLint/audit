import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setOutput, setFailed, info, summary } from "@actions/core";
import { readInputs } from "./inputs.js";
import { runAudit } from "./audit.js";
import { buildReport, buildMarkdown } from "./report.js";

async function run(): Promise<void> {
  const inputs = readInputs();
  // Browser install happens in the composite action's pre-step, not here.

  info(`Auditing ${inputs.url} (WCAG ${inputs.wcagLevel}, min impact ${inputs.minImpact})`);
  const raw = await runAudit(inputs);
  const report = buildReport(raw, inputs);

  const jsonPath = join(inputs.outputDir, "accesslint-report.json");
  const mdPath = join(inputs.outputDir, "accesslint-report.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const markdown = buildMarkdown(report);
  writeFileSync(mdPath, markdown, "utf8");

  setOutput("violation-count", report.filteredViolations);
  setOutput("critical-count", report.counts.critical);
  setOutput("serious-count", report.counts.serious);
  setOutput("failed", report.filteredViolations > 0 ? "true" : "false");
  setOutput("report-json-path", jsonPath);
  setOutput("report-markdown-path", mdPath);

  // Surface the markdown in the run summary so it's visible without
  // downloading the artifact. Skip silently when GITHUB_STEP_SUMMARY isn't
  // set (local invocation, custom runners).
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await summary.addRaw(markdown).write();
    } catch {
      // best-effort
    }
  }

  info(
    `Audit complete: ${report.filteredViolations}/${report.totalViolations} violations after filter ` +
      `(${report.counts.critical} critical, ${report.counts.serious} serious).`,
  );
}

run().catch((err) => {
  setFailed(err instanceof Error ? err.message : String(err));
});
