import type { SerializedViolation } from "./types.js";

/**
 * Identify violations *new* in `candidate` relative to `baseline`. Match key
 * is `ruleId + selector` — same key core's `diffAudit` uses. Selectors can
 * shift between renders (hashed CSS classes, generated IDs), so this isn't
 * perfectly stable, but it's the same trade-off any audit-diffing tool
 * makes.
 *
 * We don't import @accesslint/core's diffAudit directly because the action
 * works on serialized violations (no Element ref) and core's signature
 * expects a full AuditResult. Re-implementing the join is one line.
 */
export function newViolations(
  baseline: SerializedViolation[],
  candidate: SerializedViolation[],
): SerializedViolation[] {
  const baselineKeys = new Set(baseline.map((v) => `${v.ruleId}\0${v.selector}`));
  return candidate.filter((v) => !baselineKeys.has(`${v.ruleId}\0${v.selector}`));
}
