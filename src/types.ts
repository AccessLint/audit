import type { Violation, Rule, AuditResult, SourceLocation } from "@accesslint/core";

/** Impact severity, derived from Violation. */
export type Impact = Violation["impact"];

/** WCAG conformance level, derived from Rule. */
export type WcagLevel = Rule["level"];

/** Threshold at which the action exits non-zero. 'never' = always exit 0
 *  (composition decides); 'any' = any reported violation; otherwise the
 *  minimum impact tier that triggers failure. */
export type FailLevel = "never" | "any" | Impact;

/** Violation with the non-serializable Element ref stripped. */
export type SerializedViolation = Omit<Violation, "element">;

export interface ActionInputs {
  url: string;
  wcagLevel: WcagLevel;
  minImpact: Impact;
  failOn: FailLevel;
  rules: string[]; // allowlist; empty = all
  rulesExclude: string[]; // denylist
  waitFor: string;
  authHeaders: Record<string, string>;
}

export interface AuditReport {
  url: string;
  generatedAt: string;
  ruleCount: number;
  totalViolations: number;
  filteredViolations: number;
  counts: Record<Impact, number>;
  violations: SerializedViolation[];
}

export type { Violation, Rule, AuditResult, SourceLocation };
