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

/** A violation enriched with which URL produced it — needed when one
 *  audit run covers multiple pages. */
export type LocatedViolation = SerializedViolation & { url: string };

export interface ActionInputs {
  /** One or more URLs to audit. Always non-empty after parsing. */
  urls: string[];
  /** Baseline URL for regression mode. When set, only violations *new*
   *  in url(s) relative to this baseline are reported. */
  compareAgainst?: string;
  wcagLevel: WcagLevel;
  minImpact: Impact;
  failOn: FailLevel;
  rules: string[];
  rulesExclude: string[];
  waitFor: string;
  authHeaders: Record<string, string>;
}

/** One URL's audit, post-filter and ready for reporting. */
export interface PerUrlReport {
  url: string;
  generatedAt: string;
  ruleCount: number;
  totalViolations: number;
  filteredViolations: number;
  counts: Record<Impact, number>;
  violations: SerializedViolation[];
}

/** Aggregated run across one or more URLs. Counts and violations are
 *  totals; per-URL detail lives in `urls`. */
export interface AuditRun {
  /** True when this run filtered out violations present in a baseline
   *  (compare-against mode). */
  regressionMode: boolean;
  /** The baseline URL when regressionMode is true. */
  baseline?: string;
  generatedAt: string;
  totalViolations: number;
  filteredViolations: number;
  counts: Record<Impact, number>;
  /** Flat list of all violations across all URLs, tagged with their URL. */
  violations: LocatedViolation[];
  /** Per-URL breakdown. */
  urls: PerUrlReport[];
}

export type { Violation, Rule, AuditResult, SourceLocation };
