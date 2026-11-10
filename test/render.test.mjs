import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, renderTile, esc, summarise } from '../src/render.mjs';

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
