# AccessLint Audit Action

Run a WCAG 2.2 accessibility audit against a live URL on every PR or push, emit JSON and Markdown reports, and pipe the output to whatever downstream step you want — fail the build, comment on the PR, upload an artifact, open an issue.

> Backed by [`@accesslint/core`](https://www.npmjs.com/package/@accesslint/core). For audit + auto-fix workflows in your editor, see the [Claude Code plugin](https://github.com/AccessLint/claude-marketplace).

## Quick start

```yaml
- uses: AccessLint/audit@v1
  id: a11y
  with:
    url: ${{ steps.preview.outputs.url }}
```

## Permissions

This action **requires no special permissions**. It only navigates the URL you point it at, runs the audit in a headless browser, and writes report files to `$GITHUB_WORKSPACE`. It does not read or write git refs, push to the repository, or call the GitHub API.

If you compose with downstream actions that *do* need permissions (`peter-evans/create-pull-request`, `actions/github-script`, sticky PR comments, etc.), set those permissions on the workflow or job, not on this action.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `url` | _(required)_ | URL to audit. Examples: `https://example.com`, `https://pr-123-myapp.preview.dev`, `http://localhost:3000`. |
| `wcag-level` | `AA` | Conformance level. One of `A`, `AA`, `AAA`. |
| `min-impact` | `serious` | Drops anything below this from the report. One of `critical`, `serious`, `moderate`, `minor`. |
| `fail-on` | `never` | Exit non-zero when violations at this level or worse exist. One of `never` (compose your own gate), `any`, `critical`, `serious`, `moderate`, `minor`. |
| `rules` | `""` | Comma- or whitespace-separated rule IDs to include (allowlist). Empty runs all rules. |
| `rules-exclude` | `""` | Comma- or whitespace-separated rule IDs to exclude. Example: `landmarks/region,navigable/bypass`. |
| `wait-for` | `networkidle` | What to wait for after navigation: `load`, `domcontentloaded`, `networkidle`, or a CSS selector like `#app-ready`. |
| `auth-headers` | `""` | JSON object of HTTP headers (e.g. `'{"Authorization":"Bearer ${{ secrets.PREVIEW_TOKEN }}"}'`). |

Reports always land at `$GITHUB_WORKSPACE/accesslint-report.json` and `accesslint-report.md`. The browser is installed automatically; cache `~/.cache/ms-playwright` between runs to skip the download (see [Cache the browser](#cache-the-browser-between-runs)).

## Outputs

| Name | Description |
| --- | --- |
| `violation-count` | Total violations after the `min-impact` filter. |
| `critical-count` | Critical-impact count. |
| `serious-count` | Serious-impact count. |
| `annotated-count` | Number of violations that landed as inline `::warning file=…::` PR-diff annotations (those with a workspace-relative source path). |
| `failed` | `true` when `violation-count > 0`. Independent of `fail-on` — `fail-on` controls the action's exit code; this output reports detection. |
| `report-json-path` | Absolute path to `accesslint-report.json`. |
| `report-markdown-path` | Absolute path to `accesslint-report.md`. |

## PR-diff annotations

When the audited URL is a React dev build (CRA, Next dev, Vite + React), each violation is mapped back to its source line via React DevTools fibers + sourcemaps. The action emits a `::warning file=src/Card.tsx,line=42,col=7::Insufficient color contrast 3.74:1` per violation, which GitHub renders **inline on the PR diff** at the matching line. No more "scroll up to find the sticky comment" — the squiggle is right where you're reading.

Production builds and non-React pages don't carry source metadata; those violations land in the report's "Unmapped" group and the `Source` column reads `—`.

## Composition examples

The action exits 0 by default — every common gating pattern is a downstream step. For the most common gate, use `fail-on:` directly.

### Fail the build on critical violations (one-liner)

```yaml
- uses: AccessLint/audit@v1
  with:
    url: ${{ steps.preview.outputs.url }}
    fail-on: critical
```

`fail-on` accepts `never` (default, composition-friendly), `any`, `critical`, `serious`, `moderate`, `minor`. Choose the threshold; the action does the rest.

### Custom gating via the step output

```yaml
- uses: AccessLint/audit@v1
  id: a11y
  with:
    url: ${{ steps.preview.outputs.url }}

- name: Custom gate
  if: steps.a11y.outputs.critical-count > 5
  run: exit 1
```

### Sticky comment on the PR with the report

```yaml
- uses: AccessLint/audit@v1
  with:
    url: ${{ steps.preview.outputs.url }}

- uses: marocchino/sticky-pull-request-comment@v2
  if: github.event_name == 'pull_request'
  with:
    header: a11y
    path: accesslint-report.md
```

### Upload as a build artifact

```yaml
- uses: AccessLint/audit@v1
  with: { url: ${{ steps.preview.outputs.url }} }

- uses: actions/upload-artifact@v6
  if: always()
  with:
    name: accesslint-report
    path: |
      accesslint-report.json
      accesslint-report.md
```

### Open an issue when a scheduled audit finds regressions

```yaml
on:
  schedule: [{ cron: "0 9 * * 1" }]   # every Monday 09:00 UTC

jobs:
  weekly-a11y:
    runs-on: ubuntu-latest
    permissions: { issues: write }
    steps:
      - uses: AccessLint/audit@v1
        id: a11y
        with:
          url: https://www.example.com
          min-impact: critical

      - if: steps.a11y.outputs.failed == 'true'
        uses: actions/github-script@v8
        with:
          script: |
            const md = require('fs').readFileSync('accesslint-report.md', 'utf8');
            github.rest.issues.create({
              ...context.repo,
              title: `a11y regressions on ${new Date().toISOString().slice(0, 10)}`,
              body: md,
              labels: ['accessibility'],
            });
```

### Auth headers for a protected preview

```yaml
- uses: AccessLint/audit@v1
  with:
    url: ${{ steps.vercel.outputs.preview-url }}
    auth-headers: |
      {"x-vercel-protection-bypass": "${{ secrets.VERCEL_BYPASS }}"}
```

### Cache the browser between runs

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}

- uses: AccessLint/audit@v1
  with:
    url: ${{ steps.preview.outputs.url }}
    install-browser: false   # cache hit ⇒ skip download
```

## What it does

1. Installs `chromium-headless-shell` via Playwright (skip with `install-browser: false`).
2. Launches headless Chromium and navigates to `url`.
3. Injects the [`@accesslint/core`](https://www.npmjs.com/package/@accesslint/core) IIFE and runs `runAudit(document)` plus `attachReactFiberSource` to map violations back to source files when the page is a React dev build.
4. Filters by `min-impact`, sorts by severity, writes JSON + Markdown reports, sets step outputs, and adds the markdown to the run summary.
5. Always exits 0 — composition decides whether the build fails.

### React source mapping

When auditing a React dev build that ships sourcemaps (CRA, Next dev, Vite + React), each violation's `Source:` column points at the actual `.tsx`/`.jsx` line that produced the element — read from React DevTools fibers in-page. On production builds, non-React pages, or pages without sourcemaps, the column is `—` and consumers fall back to the selector.

## Errors and how to fix them

The action surfaces actionable messages for the most common failures:

| Symptom | Likely fix |
| --- | --- |
| `Failed to load <url>: net::ERR_…` | Local dev server not started, wrong port, or a typo in the URL. |
| `Failed to load <url>: …401/403…` | Protected preview — set `auth-headers` with the right Authorization or bypass token. |
| `wait-for timed out: …` | The wait condition wasn't met inside the budget. Switch `wait-for` to a more specific selector, e.g. `#app-ready`. |

## Development

```sh
npm install
npm run typecheck
npm run build         # bundles dist/index.js via esbuild
npm test              # vitest
```

The bundled `dist/` is committed; CI verifies it's regenerated on every PR.

## License

MIT
