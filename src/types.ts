import type { Violation, Rule, AuditResult, SourceLocation } from "@accesslint/core";

/** Impact severity, derived from Violation. */
export type Impact = Violation["impact"];

/** WCAG conformance level, derived from Rule. */
export type WcagLevel = Rule["level"];

/** Violation with the non-serializable Element ref stripped. */
export type SerializedViolation = Omit<Violation, "element">;

export interface ActionInputs {
  url: string;
  wcagLevel: WcagLevel;
  minImpact: Impact;
  waitFor: string;
  authHeaders: Record<string, string>;
  outputDir: string;
  installBrowser: boolean;
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
