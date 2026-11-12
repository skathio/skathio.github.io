# skathio.github.io

The skathio org homepage: one tile per published project, at https://skathio.github.io/.

Each project's own repository describes its tile in `.github/homepage.json`, with its name,
tagline, colour, branding image and links. This repo only collects those manifests and renders
them. To add or change a project, edit that project's manifest: see
[docs/manifest.md](docs/manifest.md).

## How content reaches the page

```
project repo                                this repo
.github/homepage.json  ──(read by build)──▶  scripts/build.mjs ──▶ dist/ ──▶ Pages
release or manifest change ──ping──▶ repository_dispatch: project-released / project-updated
                                     schedule: every 6 h
```

- **Pulled, not pushed.** The build reads every repo through the GitHub API: the manifest, the
  latest release, and whether Pages is on. A project never writes into this repo.
- **The ping only says "rebuild".** The `repository_dispatch` payload is ignored, so a ping
  cannot change what the page shows.
- **Loaded on demand.** The build also publishes the same data as
  [`projects.json`](https://skathio.github.io/projects.json) for anything that wants the tiles
  without the page.

## Paths

Project sites live at `https://skathio.github.io/<repo>/` and are served from their own repos.
This site therefore must never publish a top-level path named like a repo: the build refuses
to, and a test checks that no top-level folder here takes a project's name.

## Secrets

| Secret | Where | Token | Needed for |
|---|---|---|---|
| `HOMEPAGE_READ_TOKEN` | this repo | fine-grained, owner `skathio`, all repositories, **Contents: read**, **Metadata: read** | listing private repos that opted in. Without it only public repos are read. |
| `HOMEPAGE_DISPATCH_TOKEN` | the `homepage` environment of each project repo | fine-grained, owner `skathio`, only `skathio/skathio.github.io`, **Contents: read and write** | the ping. Without it the tile updates on the next scheduled build. |

GitHub's `repository_dispatch` endpoint requires Contents write on the target repo, so the
dispatch token can push to this repo. Two limits keep that narrow: the token covers this repo
only, and it is a secret of the project's `homepage` environment, which only `main` and `v*`
release tags can use, so a workflow pushed to any other branch cannot read it. Do not also keep it
as a repository or organisation secret: those are readable from any branch. Setting it up in a
project repo:

```sh
# The environment, limited to main and release tags (once per repo).
gh api -X PUT repos/skathio/<repo>/environments/homepage \
  --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/skathio/<repo>/environments/homepage/deployment-branch-policies -f name=main -f type=branch
gh api -X POST repos/skathio/<repo>/environments/homepage/deployment-branch-policies -f name='v*' -f type=tag
# The token, as an environment secret.
gh secret set HOMEPAGE_DISPATCH_TOKEN --env homepage -R skathio/<repo>
```

A failed ping (an expired or under-scoped token) leaves a warning on the project's run and does
not fail it; the tile then waits for the scheduled build.

## Develop

```sh
npm test                 # unit tests, with coverage
npm run build:fixture    # offline build into dist/ from test/fixtures/org.json
GH_TOKEN=$(gh auth token) npm run build   # live build from the org
```

Node 22 or later, no dependencies.
