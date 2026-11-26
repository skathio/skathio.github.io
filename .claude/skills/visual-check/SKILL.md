---
name: visual-check
description: Build the skathio homepage from the fixture, serve it locally and screenshot it at phone and desktop widths in light and dark mode, then inspect the shots. Use for any change that can affect what renders (src/render.mjs, src/build.mjs, brand/, tile data in src/collect.mjs) before opening or updating a PR.
---

# Visual check for the homepage

CLAUDE.md requires this for every change that affects the rendered page.

## 1. Take the screenshots

```sh
.claude/skills/visual-check/screenshots.sh <output-dir>
```

Use your scratchpad or another temp directory for `<output-dir>`, never a path inside the repo.
The script:

- runs `npm run build:fixture` (offline, from `test/fixtures/org.json`) into `dist/`;
- copies hashira's site kit (`tokens.css`, `theme.js`, `site-nav.js`) at its `v3` tag into
  `dist/_kit/`, as the deploy's `site-kit@v3` step does, from the clone at `$HASHIRA_DIR`
  (default `../hashira`). It stops if there is none: without the kit the nav does not render;
- serves `dist/` with `python3 -m http.server` on a **free** port bound to 127.0.0.1. It picks a
  free port because a common port like 4173 may already serve something else on this machine. It
  then checks that the page's `<title>` is `skathio` before taking any screenshot;
- takes four full-page PNGs with `npx -y playwright@1.61.1 screenshot`:
  `phone-light.png`, `phone-dark.png` (390×844) and `desktop-light.png`, `desktop-dark.png`
  (1280×800). Dark mode comes from `--color-scheme dark`, which drives the page's
  `prefers-color-scheme` tokens;
- stops the server on exit.

Requirements: Node 22+, python3, curl and network access for npx. Playwright is **not** a repo
dependency: npx fetches the pinned version on demand. The first run may need
`npx -y playwright@1.61.1 install chromium`.

If the Playwright MCP tools are available, they work too. Navigate to the served URL,
`browser_resize` to 390×844 and 1280×800, `browser_emulate_media` with `colorScheme` set to
light or dark, and `browser_take_screenshot` with `fullPage: true`. Use them to check the theme
button (Auto → Light → Dark) in the nav, which the CLI shots cannot click.

## 2. Inspect every shot

Open each PNG with the Read tool and check:

- **Nav:** hashira's `<site-nav>`: the mark and name, Projects and Releases (desktop only),
  Pull requests and CI (kept at phone width), the theme toggle on the right, in this site's red
  accent on hover and focus, the same bar as the hashira, rogue and SoMi sites.
- **Phone:** one-column grid, no horizontal overflow, the emblem above the title, Projects and
  Releases hidden from the nav, the 2×2 stats, nothing clipped in the tiles or the timeline.
- **Desktop:** three-column grid, the hero emblem beside the title, a 4-up stats row.
- **Light and dark:** text contrast on cards and pills, the accent (`#b80f0f` light,
  `#ff4d4d` dark), tile link colours (`--cc`, darkened on light), and the glow on the emblem.
- **Data:** escaped HTML shows literally (the `<b>Bad</b>` tile), monograms for tiles without an
  image, release tags, and the timeline newest first.

Expected in a fixture build: the SoMi and Remote marks are blank (the fixture images are tiny
placeholders), "0 languages", and the `warning:` lines from the deliberately bad manifests.

## 3. Report in the PR

Attach the screenshots to the PR, or describe each of the four: what changed and what you
checked. If a change cannot affect rendering, say so in the PR instead.
