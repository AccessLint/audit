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
| `wait-for` | `networkidle` | What to wait for after navigation: `load`, `domcontentloaded`, `networkidle`, or a CSS selector like `#app-ready`. |
| `auth-headers` | `""` | JSON object of HTTP headers (e.g. `'{"Authorization":"Bearer ${{ secrets.PREVIEW_TOKEN }}"}'`). |
| `output-dir` | `$GITHUB_WORKSPACE` | Where to write `accesslint-report.json` / `accesslint-report.md`. |
| `install-browser` | `true` | Run `playwright install --only-shell chromium` before auditing. Set `false` if you've cached `~/.cache/ms-playwright` in an earlier step. |

## Outputs

| Name | Description |
| --- | --- |
| `violation-count` | Total violations after the `min-impact` filter. |
| `critical-count` | Critical-impact count. |
| `serious-count` | Serious-impact count. |
| `failed` | `true` when `violation-count > 0`, else `false`. |
| `report-json-path` | Absolute path to `accesslint-report.json`. |
| `report-markdown-path` | Absolute path to `accesslint-report.md`. |

## Composition examples

The action does not open PRs, post comments, or fail builds itself. Compose with whichever downstream actions you already use.

### Fail the build on critical violations

```yaml
- uses: AccessLint/audit@v1
  id: a11y
  with:
    url: ${{ steps.preview.outputs.url }}

- name: Fail on critical violations
  if: steps.a11y.outputs.critical-count != '0'
  run: |
    echo "::error::${{ steps.a11y.outputs.critical-count }} critical accessibility violations"
    exit 1
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
