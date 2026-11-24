# skathio.github.io

The skathio org homepage at https://skathio.github.io/: one tile per project, built by reading
each repo's `.github/homepage.json` through the GitHub API. Plain Node ESM (Node 22+, CI uses
24), **no npm dependencies**, no framework, no bundler. The page is one generated `index.html`
with inline CSS.

## Commands (all verified)

```sh
npm test                 # node --test over test/**/*.test.mjs, coverage to stdout + coverage/lcov.info
npm run build:fixture    # offline build into dist/ from test/fixtures/org.json (no token, no network)
GH_TOKEN=$(gh auth token) npm run build   # live build from the org; reads the real repos
GH_TOKEN=$(gh auth token) node scripts/ci-rules.mjs [--apply]   # ci-required rulesets; dry run without --apply
```

- There is no lint or format command. Match the surrounding style: 2-space indent, single
  quotes, semicolons, long lines are fine.
- `build:fixture` prints `warning: ...` lines for `badsvg`, `badmanifest`, `broken-js`,
  `stringly-js` and `remote`. They are expected: the fixture deliberately carries bad manifests,
  a PR in `badsvg` whose URL is wrong ("pull request skipped"), and a failing run in `remote`
  whose URL is wrong ("failing workflow run skipped").
- Prefer `build:fixture` for any local check. The live build hits the GitHub API.

## Layout

| Path | What |
|---|---|
| `scripts/build.mjs` | CLI entry: `--out`, `--org`, `--fixture`. Emits `::warning` annotations in Actions. |
| `scripts/ci-rules.mjs` | Run by hand with an admin token, never by a workflow: puts the `ci-required` ruleset (checks pinned to GitHub Actions, up to date with the default branch) on each repo in `.github/ci-rules.json`. Dry run unless `--apply`; refuses private, archived, forked or missing repos and checks that have not run on a PR yet. Touches no other ruleset. |
| `.github/ci-rules.json` | `{ "repos": { "<repo>": ["<check name>", ...] } }`: the checks each repo's PRs must pass. |
| `src/collect.mjs` | Lists org repos and reads manifests, releases and images. Decides who is listed. `githubClient` caps response sizes and sends the token to the API only. |
| `src/pulls.mjs` | Open PRs for `/prs/`: one GraphQL search (`githubClient.graphql`), filtered to `collect`'s listed public projects, with status, CI and review labels. Re-exported from `collect.mjs`. |
| `src/runs.mjs` | Unresolved workflow failures for `/ci/`: each listed public project's last 100 completed default-branch runs, grouped by workflow, PR and fork runs left out. Re-exported from `collect.mjs`. |
| `src/manifest.mjs` | Manifest schema, `LIMITS`, URL/path checks, image byte checks, `screenSvg`. |
| `src/render.mjs` | The whole page: HTML, inline `CSS`, light/dark tokens, tiles, hero stats, releases timeline, and the `/prs/` page (`renderPrsPage`). |
| `src/ci-page.mjs` | The `/ci/` page (`renderCiPage`), on `render.mjs`'s head, nav and CSS. Re-checks each row's repo and run URL. |
| `src/build.mjs` | `writeSite` (writes `dist/`, refuses reserved paths) and `fixtureClient`. |
| `brand/` | `mark.svg` (the org mark), `theme.js` (Auto/Light/Dark toggle, localStorage) and `local-time.js` (rewrites a `<time data-local>` UTC time into the visitor's zone; the UTC text stays without script). Copied into `dist/brand/`. |
| `test/` | `node:test` files, one per `src` module, plus `fixtures/org.json`. |
| `docs/manifest.md` | The manifest contract for project repos. Keep it in sync with `manifest.mjs`. |

Output in `dist/`: `index.html`, `projects.json` (the public feed), `tiles/<repo>.<ext>`,
`brand/`, `prs/index.html` (open pull requests), `ci/index.html` (unresolved CI failures),
`.nojekyll`.

## Security model (do not weaken)

Manifests come from other repos and are **untrusted**. There are two layers on purpose:
`manifest.mjs` validates against a closed shape, then `render.mjs` re-checks and escapes every
value (`esc`, `isHexColour`, `httpsUrl`, `tilePath`). Keep both layers.

- Links are https only. Colours are `#rrggbb` only. An image is a `tiles/` file or an inlined
  base64 SVG `data:` URI.
- An SVG is never served as a file from this origin. It is screened and refused, not sanitised.
- Private repos are opt-in and **fail closed**: any manifest error leaves them off the page.
- The `repository_dispatch` payload is never read. A ping only triggers a rebuild.
- Annotation text is escaped (`annot` in `scripts/build.mjs`), so a manifest cannot forge workflow commands.
- Workflows use `permissions: {}` at the top level and actions pinned by full SHA, with a version comment.

## Pitfalls

- **Reserved paths.** Project sites are served at `/<repo>/` from their own repos. This site
  must never publish a top-level path named like a repo. `writeSite` throws if a repo is named
  `index.html`, `projects.json`, `tiles`, `brand`, `prs`, `ci` or `.nojekyll`. When the org gets a new repo,
  add its name to the list in `test/build.test.mjs` ("the source tree has no top-level folder
  named after a project repo"). Never add a top-level folder here named after a repo.
- **CSS lives in a JS template string** (`CSS` in `render.mjs`). Dark tokens are the `DARK`
  string, applied under `prefers-color-scheme: dark` unless `data-theme=light`, and under
  `data-theme=dark`. Change both themes together.
- **Tests assert on HTML substrings** in `test/render.test.mjs`. Change copy or markup and those
  tests must change with it.
- **The fixture's images are tiny placeholders.** The SoMi and Remote marks render blank in a
  fixture build. That is expected, not a bug.
- **Hero copy is hard-coded** in `renderPage` ("Plugins for coding agents, .NET libraries...").
  The numbers are counted from data.
- `dist/` and `coverage/` are gitignored. Do not commit them.

## Visual testing (required)

This repo renders a website. **Every change that can affect what renders** (`src/render.mjs`,
`src/build.mjs`, `brand/`, anything in `collect.mjs` that changes tile data) needs a visual
check before the PR:

1. `npm run build:fixture`, then serve `dist/` and take screenshots at **phone (390×844)** and
   **desktop (1440×900)** widths, in **light and dark** mode: four full-page shots.
2. Look at each screenshot yourself: layout, overflow at phone width, contrast in both themes,
   the theme button, the tiles and the releases timeline.
3. Show the screenshots in the PR, or describe what each one shows and what you checked.

The exact steps are in the `visual-check` skill (`.claude/skills/visual-check/`). Changes that
cannot affect the page (CI, docs, tests only) do not need it. Say so in the PR.

## CI and deploy

- **`ci.yml`** is the one workflow, from hashira v3's static-webapp template. On a pull request
  only the `ci` job runs: hashira's reusable `static-webapp-ci.yml` at a pinned SHA, with jobs
  `ci / setup`, `ci / test` (`npm test` with coverage), `ci / scan-suite` (security scans),
  `ci / quality-gate` (SoMi's quality gate, at its default) and `ci / build-and-upload`
  (`npm run build:fixture`, offline). A PR never reaches the org.
- On push to `main`, hourly (`17 * * * *`), on `repository_dispatch` (`project-released`,
  `project-updated`) and by hand, `ci` is skipped and this repo's own `build` and `deploy` jobs
  run instead: `npm test`, a live build with `HOMEPAGE_READ_TOKEN` (or the job token), then a
  deploy to GitHub Pages through hashira's pages-upload and pages-deploy actions. hashira's CI
  cannot do this build: it takes no secrets and would upload the fixture build. **The merge is
  the approval**: there is no manual gate. Merging to `main` publishes.
- There is no release or versioning. A deploy is the release.
- When bumping the hashira pin, change all three `skathio/hashira` refs in `ci.yml` together.
  There is no `library_ref`: v3 checks its actions out at its own commit.
- `ci / passed` is hashira v3.1.0's aggregate job, and the check `.github/ci-rules.json` requires.
- Dependabot updates the GitHub Actions pins weekly, in one group.

## Conventions

- Conventional-commit subjects: `feat:`, `fix:`, `ci:`, `test:`, `chore:`, `docs:`. Lowercase,
  written as a statement ("ci: the merge is the approval for the site deploy").
- Commit bodies explain *why*.
- Work on a branch and open a PR against `main`. The maintainer merges. CODEOWNERS:
  `@skathio/homepage-developers`, `@skathio/homepage-owners`.
- Comments state the reason or the invariant, not the mechanics.
- No new dependencies without a stated reason. The repo is deliberately dependency-free.
- `.somi/` is local tool state. Never commit it or refer to it.
