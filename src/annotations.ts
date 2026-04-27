import { warning } from "@actions/core";
import type { SerializedViolation, SourceLocation } from "./types.js";

/**
 * GitHub Actions uses relative paths in `::warning file=…::` annotations to
 * place them on the right line in a PR diff. The fiber probe gives us
 * absolute file URLs (e.g. `file:///home/runner/work/<repo>/<repo>/src/X.tsx`)
 * — strip the `file://` scheme and the workspace prefix so what's left is
 * relative to the checkout root.
 */
export function toWorkspaceRelative(file: string, workspace: string): string | null {
  let path = file;
  if (path.startsWith("file://")) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch {
      return null;
    }
  }
  // Strip workspace prefix (with or without trailing slash).
  const ws = workspace.endsWith("/") ? workspace : workspace + "/";
  if (path.startsWith(ws)) return path.slice(ws.length);
  // Some sources point at node_modules under the workspace; same logic
  // applies. If the file is outside the workspace (e.g. a CDN URL or an
  // absolute path on the runner that isn't under $GITHUB_WORKSPACE), we
  // can't annotate it — return null and the caller will skip.
  if (path.startsWith("/")) return null; // absolute path outside workspace
  return path;
}

/**
 * Pick the highest-confidence source candidate that maps to a file under
 * the workspace. Top of the array is the JSX literal (ownerDepth 0); fall
 * back through owners until we find one that lives in the user's source.
 */
export function pickAnnotatableSource(
  source: SourceLocation[] | undefined,
  workspace: string,
): { file: string; line: number; column?: number; symbol?: string } | null {
  if (!source) return null;
  for (const s of source) {
    const rel = toWorkspaceRelative(s.file, workspace);
    if (rel === null) continue;
    return { file: rel, line: s.line, column: s.column, symbol: s.symbol };
  }
  return null;
}

/**
 * Emit a `::warning file=…,line=…,col=…,title=…::message` for each violation
 * we can pin to a source line. GitHub places these inline on the PR diff for
 * the matching file/line, which is the difference between "look at this
 * sticky comment" and "fix the squiggle on line 42".
 *
 * Returns the count actually annotated (some may have no usable source).
 */
export function emitAnnotations(
  violations: SerializedViolation[],
  workspace: string,
): number {
  let count = 0;
  for (const v of violations) {
    const loc = pickAnnotatableSource(v.source, workspace);
    if (!loc) continue;
    warning(v.message, {
      title: v.ruleId,
      file: loc.file,
      startLine: loc.line,
      startColumn: loc.column,
    });
    count++;
  }
  return count;
}
