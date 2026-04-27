import { getInput, getMultilineInput } from "@actions/core";
import type { ActionInputs, FailLevel, Impact, WcagLevel } from "./types.js";

const IMPACTS: readonly Impact[] = ["critical", "serious", "moderate", "minor"] as const;
const LEVELS: readonly WcagLevel[] = ["A", "AA", "AAA"] as const;
const FAIL_LEVELS: readonly FailLevel[] = ["never", "any", ...IMPACTS] as const;

function parseHeaders(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`auth-headers: invalid JSON — ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("auth-headers: must be a JSON object");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new Error(`auth-headers: value for "${k}" must be a string`);
    }
    out[k] = v;
  }
  return out;
}

function parseEnum<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}: expected one of ${allowed.join(", ")} — got "${value}"`);
  }
  return value as T;
}

/** Parse comma- or whitespace-separated rule IDs. Empty => []. */
function parseRuleList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function assertValidUrl(name: string, url: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(`${name}: not a valid URL — "${url}"`);
  }
}

/**
 * Resolve the audit target list. Users may set:
 * - `url:` (legacy, single URL), or
 * - `urls:` (one URL per line), or
 * - both — `urls:` wins, `url:` is ignored.
 * At least one must be provided and non-empty.
 */
function readUrls(): string[] {
  const single = getInput("url").trim();
  // getMultilineInput splits on \n and trims each entry.
  const multi = getMultilineInput("urls").map((u) => u.trim()).filter(Boolean);
  const list = multi.length > 0 ? multi : single ? [single] : [];
  if (list.length === 0) {
    throw new Error("Provide at least one URL via `url:` or `urls:`.");
  }
  for (const u of list) assertValidUrl("url", u);
  return list;
}

export function readInputs(): ActionInputs {
  const urls = readUrls();
  const compareAgainstRaw = getInput("compare-against").trim();
  const compareAgainst = compareAgainstRaw || undefined;
  if (compareAgainst) {
    assertValidUrl("compare-against", compareAgainst);
    if (urls.length > 1) {
      throw new Error(
        "compare-against currently only works with a single audited URL. " +
          "Either drop `compare-against` or reduce `urls` to one entry.",
      );
    }
  }

  return {
    urls,
    compareAgainst,
    wcagLevel: parseEnum("wcag-level", getInput("wcag-level") || "AA", LEVELS),
    minImpact: parseEnum("min-impact", getInput("min-impact") || "serious", IMPACTS),
    failOn: parseEnum("fail-on", getInput("fail-on") || "never", FAIL_LEVELS),
    rules: parseRuleList(getInput("rules")),
    rulesExclude: parseRuleList(getInput("rules-exclude")),
    waitFor: getInput("wait-for") || "networkidle",
    authHeaders: parseHeaders(getInput("auth-headers")),
  };
}
