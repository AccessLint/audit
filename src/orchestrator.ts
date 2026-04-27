import { info } from "@actions/core";
import { runAudit } from "./audit.js";
import {
  aggregateRun,
  buildPerUrlReport,
  withFilteredViolations,
} from "./report.js";
import { newViolations } from "./diff.js";
import type { ActionInputs, AuditRun, PerUrlReport } from "./types.js";

/**
 * Runs audits sequentially across `inputs.urls`. When `compareAgainst` is
 * set (single-URL only, enforced by readInputs), audits the baseline first
 * and reports only violations *new* in the candidate.
 *
 * Sequential rather than parallel for v0.3.0 — each audit launches a fresh
 * Chromium context, and CI runners typically have 2 cores. Going parallel
 * is an obvious win to revisit when audit counts grow.
 */
export async function runAll(inputs: ActionInputs): Promise<AuditRun> {
  if (inputs.compareAgainst) {
    return runRegression(inputs);
  }
  return runMulti(inputs);
}

async function runMulti(inputs: ActionInputs): Promise<AuditRun> {
  const reports: PerUrlReport[] = [];
  for (const url of inputs.urls) {
    info(`Auditing ${url}`);
    const raw = await runAudit(inputs, url);
    reports.push(buildPerUrlReport(raw, url, inputs.minImpact));
  }
  return aggregateRun(reports);
}

async function runRegression(inputs: ActionInputs): Promise<AuditRun> {
  const candidate = inputs.urls[0]!;
  const baseline = inputs.compareAgainst!;

  info(`Auditing baseline ${baseline}`);
  const baselineRaw = await runAudit(inputs, baseline);
  // Use the same min-impact filter on the baseline so we're comparing
  // apples to apples — a rule disabled by min-impact should not produce
  // "new" violations on the candidate.
  const baselineReport = buildPerUrlReport(baselineRaw, baseline, inputs.minImpact);

  info(`Auditing candidate ${candidate}`);
  const candidateRaw = await runAudit(inputs, candidate);
  const candidateReport = buildPerUrlReport(candidateRaw, candidate, inputs.minImpact);

  const newOnes = newViolations(baselineReport.violations, candidateReport.violations);
  const onlyNew = withFilteredViolations(candidateReport, newOnes);

  return aggregateRun([onlyNew], { regressionMode: true, baseline });
}
