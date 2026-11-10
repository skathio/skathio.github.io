import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, renderTile, esc } from '../src/render.mjs';

const base = { repo: 'x', name: 'X', tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null };

test('text is escaped', () => {
  const html = renderTile({ ...base, name: '<img src=x onerror=alert(1)>', tagline: '"><script>' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
});

test('a colour that is not hex never reaches the style attribute', () => {
  const html = renderTile({ ...base, colour: 'red;}body{display:none' });
  assert.match(html, /--tile:#5b606b/);
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
  assert.match(renderTile({ ...base, site: 'https://skathio.github.io/x/', repoUrl: 'https://github.com/skathio/x' }), /<h2><a href="https:\/\/skathio\.github\.io\/x\/">X<\/a>/);
  assert.match(renderTile({ ...base, repoUrl: 'https://github.com/skathio/x' }), /<h2><a href="https:\/\/github\.com\/skathio\/x">/);
});

test('the release tag and date show', () => {
  const html = renderTile({ ...base, release: { tag: 'v1.2.3', date: '2026-11-09T12:00:00Z', url: null } });
  assert.match(html, /v1\.2\.3/);
  assert.match(html, /9 Nov 2026/);
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
