import { getInput, getBooleanInput } from "@actions/core";
import type { ActionInputs, Impact, WcagLevel } from "./types.js";

const IMPACTS: readonly Impact[] = ["critical", "serious", "moderate", "minor"] as const;
const LEVELS: readonly WcagLevel[] = ["A", "AA", "AAA"] as const;

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

export function readInputs(): ActionInputs {
  const url = getInput("url", { required: true });
  // Sanity check the URL early so we fail fast with a clear message rather
  // than a Playwright timeout on a typo.
  try {
    new URL(url);
  } catch {
    throw new Error(`url: not a valid URL — "${url}"`);
  }

  return {
    url,
    wcagLevel: parseEnum("wcag-level", getInput("wcag-level") || "AA", LEVELS),
    minImpact: parseEnum("min-impact", getInput("min-impact") || "serious", IMPACTS),
    waitFor: getInput("wait-for") || "networkidle",
    authHeaders: parseHeaders(getInput("auth-headers")),
    outputDir: getInput("output-dir") || process.env.GITHUB_WORKSPACE || process.cwd(),
    installBrowser: getBooleanInput("install-browser"),
  };
}
