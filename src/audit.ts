import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import type { ActionInputs, SerializedViolation } from "./types.js";

// The esbuild banner injects `require` (via createRequire) into the bundled
// ESM output so dynamic CJS requires used by transitive deps keep working.
// In source mode this declaration only exists for type-checking; the bundle
// is the only execution path.
declare const require: NodeJS.Require;

interface InPageOptions {
  includeAAA: boolean;
}

export interface RawAuditResult {
  url: string;
  timestamp: number;
  ruleCount: number;
  violations: SerializedViolation[];
}

function loadIifeBytes(): string {
  const iifePath = require.resolve("@accesslint/core/iife");
  return readFileSync(iifePath, "utf8");
}

/** 'load' / 'domcontentloaded' / 'networkidle' map to Playwright's loadState;
 *  anything else is treated as a CSS selector. */
async function applyWait(page: Page, waitFor: string): Promise<void> {
  if (waitFor === "load" || waitFor === "domcontentloaded" || waitFor === "networkidle") {
    await page.waitForLoadState(waitFor);
    return;
  }
  await page.waitForSelector(waitFor, { timeout: 30_000 });
}

export async function runAudit(inputs: ActionInputs): Promise<RawAuditResult> {
  const iife = loadIifeBytes();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      extraHTTPHeaders:
        Object.keys(inputs.authHeaders).length > 0 ? inputs.authHeaders : undefined,
    });
    const page = await context.newPage();

    try {
      await page.goto(inputs.url, { waitUntil: "load", timeout: 60_000 });
    } catch (err) {
      // Reframe the Playwright stack as a user-facing message that names the
      // most likely fixes — auth-headers for protected previews, wait-for
      // budget for slow loads, network reachability for dev servers.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to load ${inputs.url}: ${reason}\n` +
          `Common fixes:\n` +
          `  • Protected preview? Pass 'auth-headers' with the right Authorization or bypass token.\n` +
          `  • Slow startup? Increase 'wait-for' or wait on a specific selector.\n` +
          `  • Local dev server in CI? Make sure it's started in an earlier step and listening on the URL.`,
      );
    }

    try {
      await applyWait(page, inputs.waitFor);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `wait-for timed out: ${reason}\n` +
          `The page loaded but the wait condition (${inputs.waitFor}) wasn't met within the budget. ` +
          `If your app needs longer, switch 'wait-for' to a specific selector that signals readiness ` +
          `(e.g. '#app-ready', '[data-testid="shell-mounted"]').`,
      );
    }

    await page.addScriptTag({ content: iife });

    const opts: InPageOptions = { includeAAA: inputs.wcagLevel === "AAA" };

    // Element refs and other non-cloneable fields can't cross structured-clone,
    // so project violations to a JSON-safe shape inside the page.
    const result = (await page.evaluate(async (opts: InPageOptions) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AccessLint = (window as unknown as { AccessLint: any }).AccessLint;
      if (!AccessLint || typeof AccessLint.runAudit !== "function") {
        throw new Error("@accesslint/core IIFE did not load on the page.");
      }
      const raw = AccessLint.runAudit(document, opts);
      if (typeof AccessLint.attachReactFiberSource === "function") {
        try {
          await AccessLint.attachReactFiberSource(raw.violations);
        } catch {
          // Best-effort — never block the audit on source mapping.
        }
      }
      return {
        url: raw.url,
        timestamp: raw.timestamp,
        ruleCount: raw.ruleCount,
        violations: raw.violations.map((v: Record<string, unknown>) => ({
          ruleId: v.ruleId,
          selector: v.selector,
          html: v.html,
          impact: v.impact,
          message: v.message,
          context: v.context,
          source: v.source,
        })),
      };
    }, opts)) as RawAuditResult;

    return result;
  } finally {
    await browser?.close();
  }
}
