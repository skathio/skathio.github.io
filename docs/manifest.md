# Adding a project to the homepage

A tile on https://skathio.github.io/ comes from the project's own repository. Nothing about a
project is written into this repo.

## 1. The manifest: `.github/homepage.json`

```json
{
  "name": "SoMi",
  "kind": "Agent plugin",
  "tagline": "Routes each request to the right workflow and model tier, and asks for a reviewer only when the diff calls for one.",
  "tags": ["Claude Code", "Copilot CLI", "Node"],
  "colour": "#ff4d4d",
  "image": "site/brand/somi-icon-800.png",
  "links": { "npm": "https://www.npmjs.com/package/@skathio/somi" }
}
```

| Field | Rule | Without it |
|---|---|---|
| `name` | text, at most 40 characters | the repo name |
| `kind` | text, at most 24 characters: what it is ("Agent plugin", ".NET library") | none |
| `tagline` | text, at most 160 characters: the card's description | the repo description |
| `tags` | up to 5 pills of at most 20 characters each | none |
| `colour` | hex colour, `#rrggbb`: the card's accent. Pick the bright shade used on dark; the light theme darkens it. | grey |
| `image` | the branding image (see below) | a lettered mark in `colour` |
| `links` | up to 4 `"label": "https://…"` pairs | none |
| `listed` | `false` hides a public repo | `true` |

The build adds **Site** (when the repo has Pages), **Release** (the latest GitHub Release) and
**Code** links on its own, and shows the latest release tag and date.

**Who is listed.** Every public repo, unless its manifest says `"listed": false`. A private
repo appears only if it has a manifest: that is the opt-in. A private tile shows its name,
tagline, image and release tag, and links nowhere on GitHub, since those pages are not public.
Forks and archived repos are never listed.

A bad field never breaks the homepage: the build drops that field, uses the default, and
reports it as a warning on the deploy run.

## 2. The branding image

`image` is either:

- **a path in the repo**, such as `public/mark.svg`: relative, no `..`; or
- **an https URL**, such as `https://example.com/logo.png`.

Either way, the build downloads the image at build time, so the homepage never hotlinks. A
PNG, JPEG or WebP is served from `tiles/`. An SVG is embedded in the page itself and never
served as a file, so it cannot run on the skathio.github.io origin.

Rules: `.png`, `.jpg`, `.webp` (at most 512 KB) or `.svg` (at most 64 KB); square, shown at 64×64 CSS pixels
(256×256 or larger looks sharp). The bytes must match the extension. An SVG must be a plain
drawing: one with `<script>`, event handlers, animation (`<set>`, `<animate>`), `<foreignObject>`,
namespace-prefixed elements, a DTD or entities, character references (`&#…;`) or any reference
outside the file (`href`, `src` or `url()` not starting with `#`) is refused.

**Private repos fail closed.** A private repo whose manifest does not parse, or has any field
the build refuses, is left off the homepage until the manifest is fixed.

## 3. The ping: update the tile right away

The homepage rebuilds every six hours on its own. To update a tile right after a release or a
manifest change, the project sends a `repository_dispatch`:

```yaml
# .github/workflows/homepage.yml
name: homepage
on:
  push:
    branches: [main]
    paths: ['.github/homepage.json', '<your image path>']
  release:
    types: [published]
  workflow_dispatch:

permissions: {}

jobs:
  ping:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Ask the homepage to rebuild
        # A ping is a courtesy: an expired token or an API error must not fail the run.
        continue-on-error: true
        env:
          GH_TOKEN: ${{ secrets.HOMEPAGE_DISPATCH_TOKEN }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          if [ -z "${GH_TOKEN}" ]; then
            echo "::notice::HOMEPAGE_DISPATCH_TOKEN is not set; the homepage picks this up on its next scheduled build."
            exit 0
          fi
          gh api repos/skathio/skathio.github.io/dispatches \
            -f event_type=project-released -f "client_payload[repo]=${REPO}"
```

A release that a workflow creates with `GITHUB_TOKEN` does not fire the `release` event (GitHub
does not chain workflows that way). A repo that releases from a workflow therefore also runs the
same step as a last job of its publish workflow.

The ping carries no content: the homepage ignores the payload and re-reads every repo itself.
