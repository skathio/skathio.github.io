import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, renderTile, esc, summarise } from '../src/render.mjs';
import { renderCiPage } from '../src/ci-page.mjs';

const base = { repo: 'x', name: 'X', tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null };

test('text is escaped', () => {
  const html = renderTile({ ...base, name: '<img src=x onerror=alert(1)>', tagline: '"><script>' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
});

test('a colour that is not hex never reaches the style attribute', () => {
  const html = renderTile({ ...base, colour: 'red;}body{display:none' });
  assert.match(html, /--c:#5b606b/);
  assert.ok(!html.includes('display:none'));
});

test('only https links render', () => {
  const html = renderTile({ ...base, links: [{ label: 'bad', url: 'javascript:alert(1)' }, { label: 'ok', url: 'https://e.com/' }] });
  assert.ok(!html.includes('javascript:'));
  assert.match(html, /href="https:\/\/e\.com\/"/);
});

test('an image renders only from tiles/ or as an inlined SVG; otherwise the tile gets a monogram', () => {
  assert.match(renderTile({ ...base, image: 'tiles/x.png' }), /<img class="mark" src="tiles\/x\.png"/);
  assert.match(renderTile({ ...base, image: 'data:image/svg+xml;base64,PHN2Zz4=' }), /src="data:image\/svg\+xml;base64,PHN2Zz4="/);
  assert.ok(!renderTile({ ...base, image: 'tiles/x.svg' }).includes('tiles/x.svg'), 'an SVG file path is not used');
  assert.ok(!renderTile({ ...base, image: 'data:text/html;base64,PGI+' }).includes('data:text'));
  const html = renderTile({ ...base, image: 'https://evil.example/x.png' });
  assert.ok(!html.includes('evil.example'));
  assert.match(html, /<svg class="mark"/);
});

test('the tile title links to the site first, then the code', () => {
  assert.match(renderTile({ ...base, site: 'https://skathio.github.io/x/', repoUrl: 'https://github.com/skathio/x' }), /<h3><a href="https:\/\/skathio\.github\.io\/x\/">X<\/a>/);
  assert.match(renderTile({ ...base, repoUrl: 'https://github.com/skathio/x' }), /<h3><a href="https:\/\/github\.com\/skathio\/x">/);
});

test('the tile shows the release tag, kind and tags, escaped', () => {
  const html = renderTile({ ...base, kind: '<i>lib</i>', tags: ['.NET', '<b>x</b>'], release: { tag: 'v1.2.3', date: '2026-11-09T12:00:00Z', url: null } });
  assert.match(html, /<code class="ver">v1\.2\.3<\/code>/);
  assert.match(html, /&lt;i&gt;lib&lt;\/i&gt;/);
  assert.match(html, /<li>\.NET<\/li><li>&lt;b&gt;x&lt;\/b&gt;<\/li>/);
});

test('the releases timeline is newest first, with dates', () => {
  const html = renderPage({ org: 'skathio', generatedAt: '', projects: [
    { ...base, repo: 'a', name: 'Older', release: { tag: 'v1', date: '2026-01-01T00:00:00Z', url: null } },
    { ...base, repo: 'b', name: 'Newer', release: { tag: 'v2', date: '2026-11-09T12:00:00Z', url: null } },
    { ...base, repo: 'c', name: 'None' },
  ] });
  const tl = html.slice(html.indexOf('<ol class="tl">'));
  assert.ok(tl.indexOf('Newer') < tl.indexOf('Older'));
  assert.ok(!tl.includes('None'));
  assert.match(tl, /9 Nov 2026/);
});

test('no timeline, and no nav link to it, when nothing has been released', () => {
  const html = renderPage({ org: 'skathio', projects: [base], generatedAt: '' });
  assert.ok(!html.includes('id="releases"'));
  assert.ok(!html.includes('href="#releases"'));
});

test('a listed private project means the page stops claiming everything is open source', () => {
  const html = renderPage({ org: 'skathio', generatedAt: '', projects: [{ ...base, license: 'MIT' }, { ...base, repo: 'p', private: true }] });
  assert.ok(!/Open source ·/.test(html));
  assert.ok(!html.includes('Every project is open source'));
  assert.match(html, /<b>1<\/b><span>open source<\/span>/);
});

test('the hero numbers are counted from the data', () => {
  const s = summarise([
    { ...base, language: 'TypeScript', license: 'MIT', releaseCount: 26 },
    { ...base, language: 'C#', license: 'MIT', releaseCount: 9, releaseCountCapped: false },
    { ...base, language: 'TypeScript', license: 'MIT', releaseCount: 0 },
  ]);
  assert.deepEqual(s, { projects: 3, allOpen: true, releases: 35, releasesCapped: false, languages: ['C#', 'TypeScript'], licence: 'MIT' });
  assert.equal(summarise([{ ...base, license: 'MIT' }, { ...base, license: null }]).licence, null, 'one unlicensed project: no shared licence');
  assert.equal(summarise([]).licence, null);
});

test('the org name gets its accent and the theme script loads', () => {
  const html = renderPage({ org: 'skathio', projects: [], generatedAt: '' });
  assert.match(html, /skath<span class="io">io<\/span>/);
  assert.match(html, /<script src="brand\/theme\.js"><\/script>/);
});

test('the page has a dark mode, a viewport and the feed link', () => {
  const html = renderPage({ org: 'skathio', projects: [base], generatedAt: '2026-11-10T00:00:00Z' });
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /href="projects\.json"/);
});

test('an empty org renders a message, not an empty grid', () => {
  assert.match(renderPage({ org: 'skathio', projects: [], generatedAt: '' }), /No published projects yet/);
});

// The /ci/ page's own re-checks, past what collectRuns already checked.
const ciRow = (f = {}) => ({ repo: 'x', workflow: 'CI', event: 'push', since: '2026-11-20T10:00:00.000Z', count: 2, url: 'https://github.com/skathio/x/actions/runs/42', ...f });
const ci = (runs) => renderCiPage({ org: 'skathio', projects: [base, { ...base, repo: 'p', name: 'P', private: true }], runs, readAt: '2026-11-24T09:05:00Z' });

test('the CI page shows a listed public project\'s failing row with its run link', () => {
  const html = ci({ failing: [ciRow()], unread: [] });
  assert.match(html, /<a href="\.\.\/#x">X<\/a>/);
  assert.match(html, /href="https:\/\/github\.com\/skathio\/x\/actions\/runs\/42">Latest failed run<\/a>/);
  assert.match(html, /<td class="nw" data-label="Failed runs">2<\/td>/);
});

test('the CI page drops a row for an unlisted or private repo, or whose link is not that repo\'s run page', () => {
  for (const row of [
    ciRow({ repo: 'p', url: 'https://github.com/skathio/p/actions/runs/42' }),
    ciRow({ repo: 'nope', url: 'https://github.com/skathio/nope/actions/runs/42' }),
    ciRow({ url: 'https://github.com/other/x/actions/runs/42' }),
    ciRow({ url: 'https://github.com/skathio/y/actions/runs/42' }),
    ciRow({ url: 'https://github.com/skathio/x/actions/runs/42/attempts/2' }),
    ciRow({ url: 'https://github.com/skathio/x/actions/runs/0' }),
    ciRow({ url: 'https://github.com/skathio/x/actions/runs/99999999999999999' }),
    ciRow({ url: 'javascript:alert(1)' }),
    ciRow({ url: 42 }),
  ]) {
    const html = ci({ failing: [row], unread: [] });
    assert.ok(!/<table\b/.test(html), JSON.stringify(row));
    assert.ok(html.includes('Nothing is failing on the default branches.'));
  }
});

test('the CI page never reads as all clear when the runs or a repo could not be read', () => {
  for (const runs of [undefined, null, {}, { failing: 'x' }]) {
    const html = ci(runs);
    assert.ok(!html.includes('Nothing is failing'), JSON.stringify(runs));
    assert.match(html, /Workflow runs could not be read at <time datetime="2026-11-24T09:05:00.000Z" data-local>24 Nov 2026, 09:05 UTC<\/time>\./);
  }
  const html = ci({ failing: [], unread: ['x', 'p'] });
  assert.ok(!html.includes('Nothing is failing on the default branches.'));
  assert.match(html, /The workflow runs of <b>x<\/b> could not be read, so their failures are not shown\.<\/p>\n<p class="empty">Nothing is failing in the projects that could be read\.<\/p>/);
  assert.ok(!html.includes('<b>p</b>'), 'a private unread repo is not named');
});
