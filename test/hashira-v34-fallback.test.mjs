// The no-script fallback links take the kit's own gap token, as the earlier audit asked ("match the
// kit's padding/gap tokens"), so they sit where the kit's links will once it is ready and do not
// move sideways when it takes over.
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { top } from '../src/render.mjs';

const css = (up) => /<style>([\s\S]*?)<\/style>/.exec(top({ org: 'skathio', title: 't', description: 'd', up, hasReleases: true }))[1].replace(/\s+/g, '');
const fallbackRule = (sheet) => /site-nav:not\(\[ready\]\)>a\{([^}]*)\}/.exec(sheet)?.[1] ?? null;

test('until the kit is ready the nav links are spaced by the kit\'s --nav-gap, not a length of the page\'s own', () => {
  for (const up of ['', '../']) {
    const rule = fallbackRule(css(up));
    assert.ok(rule, 'a rule for the links of a <site-nav> that is not ready');
    const spacing = rule.split(';').filter((d) => /^(margin|gap|padding)/.test(d));
    assert.deepEqual(spacing, ['margin-right:var(--nav-gap,28px)']);
  }
});

test('the page sets no --nav-gap of its own, so the gap is the kit\'s at every width', () => {
  assert.ok(!/(^|[;{])--nav-(gap|pad|h):/.test(css('')));
});

// hashira v3.4.0's pages-upload needs neither grant (upload-pages-artifact hands the tar to
// upload-artifact on the runner's own token), and its own-build template gives the build job
// contents: read alone. That job runs npm and holds the org read token, so it must not be able to
// mint an OIDC token or publish Pages.
test('the build job holds contents: read alone; only deploy can mint an OIDC token or publish Pages', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const perms = (id) => {
    const body = new RegExp(`\\n {2}${id}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`).exec(yml)?.[1] ?? '';
    const lines = /\n {4}permissions:\n((?: {6}.*\n?)*)/.exec(body)?.[1] ?? '';
    return lines.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).sort();
  };
  assert.deepEqual(perms('build'), ['contents: read']);
  assert.deepEqual(perms('deploy'), ['id-token: write', 'pages: write']);
});
