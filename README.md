# AccessLint Audit Action

Run a WCAG 2.2 accessibility audit against a live URL on every PR or push, emit JSON and Markdown reports, and pipe the output to whatever downstream step you want — fail the build, comment on the PR, upload an artifact, open an issue.

> Backed by [`@accesslint/core`](https://www.npmjs.com/package/@accesslint/core). For audit + auto-fix workflows in your editor, see the [Claude Code plugin](https://github.com/AccessLint/claude-marketplace).

## Usage

```yaml
- uses: AccessLint/audit@v1
  id: a11y
  with:
    url: ${{ steps.preview.outputs.url }}
```

Then compose downstream:

```yaml
- uses: actions/upload-artifact@v6
  with:
    name: accesslint-report
    path: |
      accesslint-report.json
      accesslint-report.md

- name: Comment on PR
  if: github.event_name == 'pull_request'
  uses: marocchino/sticky-pull-request-comment@v2
  with:
    path: accesslint-report.md

- name: Fail on critical violations
  if: steps.a11y.outputs.critical-count != '0'
  run: exit 1
```

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `url` | _(required)_ | URL to audit (dev, preview, or prod). |
| `wcag-level` | `AA` | Conformance level: `A`, `AA`, or `AAA`. |
| `min-impact` | `serious` | Minimum impact in the report: `critical`, `serious`, `moderate`, `minor`. |
| `wait-for` | `networkidle` | What to wait for after navigation: `load`, `domcontentloaded`, `networkidle`, or a CSS selector. |
| `auth-headers` | `""` | JSON object of HTTP headers (e.g. `'{"Authorization":"Bearer …"}'`) for protected previews. |
| `output-dir` | `$GITHUB_WORKSPACE` | Where to write the report files. |
| `install-browser` | `true` | Run `playwright install --only-shell chromium` before auditing. Set `false` if your workflow already installed it. |

## Outputs

| Name | Description |
| --- | --- |
| `violation-count` | Total violations after the `min-impact` filter. |
| `critical-count` | Critical-impact count. |
| `serious-count` | Serious-impact count. |
| `failed` | `true` when `violation-count > 0`, else `false`. |
| `report-json-path` | Absolute path to `accesslint-report.json`. |
| `report-markdown-path` | Absolute path to `accesslint-report.md`. |

## What it does

1. Installs `chromium-headless-shell` via Playwright (skip with `install-browser: false`).
2. Launches headless Chromium and navigates to `url`.
3. Injects the [`@accesslint/core`](https://www.npmjs.com/package/@accesslint/core) IIFE and runs `runAudit(document)` plus `attachReactFiberSource` to map violations back to source files when the page is a React dev build.
4. Filters by `min-impact`, sorts by severity, writes JSON + Markdown reports, and sets step outputs.
5. Always exits 0 — composition decides whether the build fails.

## React source mapping

When auditing a React dev build that ships sourcemaps (CRA, Next dev, Vite + React), each violation's `Source:` column points at the actual `.tsx`/`.jsx` line that produced the element — read from React DevTools fibers in-page. On production builds, non-React pages, or pages without sourcemaps, the column is `—` and the agent falls back to the selector.

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
