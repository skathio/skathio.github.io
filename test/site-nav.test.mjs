// The homepage on hashira's site-kit nav (request 27, and 28 for this site): every page emits a
// <site-nav> with the homepage's own items (Projects, Releases when there are releases, Pull
// requests, CI) and no Docs link, loads the kit from /_kit/, keeps this site's accent, and the
// deploy copies the kit into dist/ before the upload. Tile data and the schedule stay as they were.
// The items are read the way the kit reads them: the `nav` attribute or the inline JSON script,
// then any links passed in the element's own children (its extras slot), in that order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSite } from '../src/build.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'org.json');
const SITE = 'https://skathio.github.io/';
const PAGES = { home: ['index.html', SITE], prs: ['prs/index.html', `${SITE}prs/`], ci: ['ci/index.html', `${SITE}ci/`] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-site-nav-'));
const project = (repo, extra = {}) => ({ repo, name: repo, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null, ...extra });
const released = project('rogue', { release: { tag: 'v1.0.0', date: '2026-11-01T00:00:00Z', url: null } });

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrsOf = (raw) => Object.fromEntries([...raw.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [m[1].toLowerCase(), unescape(m[2] ?? m[3] ?? m[4] ?? '')]));
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// The one <site-nav> of a page, as the kit would configure it.
function siteNav(html) {
  const all = [...html.matchAll(/<site-nav\b([^>]*)>([\s\S]*?)<\/site-nav>/g)];
  if (all.length !== 1) return { count: all.length };
  const attrs = attrsOf(all[0][1]);
  const inner = all[0][2];
  const script = /<script\b[^>]*type=["']?application\/json["']?[^>]*>([\s\S]*?)<\/script>/.exec(inner);
  const config = { ...(script ? parse(script[1]) ?? {} : {}) };
  for (const [k, v] of Object.entries(attrs)) config[k] = k === 'nav' || k === 'home_link' ? parse(v) : v;
  // The .fb links are the no-script stand-ins the kit hides once defined, so they are not its extras.
  const extras = [...inner.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((m) => !/\bfb\b/.test(attrsOf(m[1]).class ?? ''))
    .map((m) => ({ label: unescape(m[2].replace(/<[^>]*>/g, '')).trim(), href: attrsOf(m[1]).href ?? null }));
  const nav = Array.isArray(config.nav) ? config.nav : [];
  return { count: 1, attrs, config, items: [...nav, ...extras] };
}
const where = (href, base) => { const u = new URL(href, base); return `${u.origin === new URL(SITE).origin ? '' : u.origin}${u.pathname}${u.hash}`; };

function build(projects) {
  const out = tmp();
  writeSite({ out, org: 'skathio', projects, images: new Map(), generatedAt: '2026-11-24T09:05:00Z', prs: { pulls: [], total: 0, readAt: '2026-11-24T09:05:00Z' }, runs: { repos: [], readAt: '2026-11-24T09:05:00Z' } });
  return Object.fromEntries(Object.entries(PAGES).map(([k, [rel, base]]) => [k, { html: fs.readFileSync(path.join(out, rel), 'utf8'), base }]));
}

function fixtureBuild() {
  const out = tmp();
  const { GITHUB_ACTIONS, ...env } = process.env;
  const res = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--fixture', FIXTURE], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return out;
}

const WITH = [['Projects', '/#projects'], ['Releases', '/#releases'], ['Pull requests', '/prs/'], ['CI', '/ci/']];
const WITHOUT = WITH.filter(([label]) => label !== 'Releases');

function assertItems(pages, expected) {
  for (const [name, { html, base }] of Object.entries(pages)) {
    const nav = siteNav(html);
    assert.equal(nav.count, 1, `${name}: one <site-nav>`);
    assert.deepEqual(nav.items.map((i) => [i.label, where(i.href, base)]), expected, name);
  }
}

// ---- The items, on every page.

test('with no release, every page emits one <site-nav> with Projects, Pull requests and CI, in that order', () => {
  assertItems(build([]), WITHOUT);
  assertItems(build([project('somi')]), WITHOUT);
});

test('with one release, every page emits one <site-nav> with Projects, Releases, Pull requests and CI, in that order', () => {
  assertItems(build([released]), WITH);
  assertItems(build([project('somi'), released]), WITH);
});

test('the fixture build\'s pages each emit the <site-nav> with all four items', () => {
  const out = fixtureBuild();
  const pages = Object.fromEntries(Object.entries(PAGES).map(([k, [rel, base]]) => [k, { html: fs.readFileSync(path.join(out, rel), 'utf8'), base }]));
  assertItems(pages, WITH);
});

test('no page has a Docs link: no docs field on the <site-nav> and no Docs item', () => {
  for (const projects of [[], [released]]) {
    for (const [name, { html }] of Object.entries(build(projects))) {
      const nav = siteNav(html);
      assert.equal(nav.count, 1, `${name}: one <site-nav>`);
      assert.ok(!('docs' in nav.config), `${name}: docs is set`);
      assert.ok(!nav.items.some((i) => /^docs$/i.test(i.label)), `${name}: a Docs item`);
      assert.ok(!/>\s*Docs\s*</.test(html), `${name}: a Docs link`);
    }
  }
});

test('the <site-nav> is the page\'s nav: no other <nav> element is left beside it', () => {
  for (const [name, { html }] of Object.entries(build([released]))) assert.ok(!/<nav\b/.test(html), name);
});

test('every page loads the kit\'s site-nav.js from the site\'s /_kit/', () => {
  for (const [name, { html, base }] of Object.entries(build([released]))) {
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']?([^"'\s>]+)/g)].map((m) => where(m[1], base));
    assert.ok(srcs.includes('/_kit/site-nav.js'), `${name}: ${srcs.join(', ')}`);
  }
});

// ---- This site's own accent, and escaping.

test('every page keeps this site\'s own accent, #b80f0f in light and #ff4d4d in dark', () => {
  for (const [name, { html }] of Object.entries(build([released]))) {
    assert.ok(html.toLowerCase().includes('#b80f0f'), `${name}: light accent`);
    assert.ok(html.toLowerCase().includes('#ff4d4d'), `${name}: dark accent`);
    const accent = siteNav(html).config?.accent;
    if (accent !== undefined) assert.equal(String(accent).toLowerCase(), '#b80f0f', `${name}: the nav's accent`);
  }
});

test('an org name with markup in it is escaped in the <site-nav> on every page', () => {
  const evil = 'x"></site-nav></script><img src=x onerror=alert(1)>';
  const out = tmp();
  writeSite({ out, org: evil, projects: [released], images: new Map(), generatedAt: '2026-11-24T09:05:00Z' });
  for (const [name, [rel]] of Object.entries(PAGES)) {
    const html = fs.readFileSync(path.join(out, rel), 'utf8');
    assert.ok(!html.includes('<img src=x onerror'), name);
    assert.equal((html.match(/<site-nav\b/g) ?? []).length, 1, name);
    assert.equal((html.match(/<\/site-nav>/g) ?? []).length, 1, name);
  }
});

// ---- Tile data, unchanged.

test('the fixture build\'s tile data is unchanged', () => {
  const out = fixtureBuild();
  const feed = JSON.parse(fs.readFileSync(path.join(out, 'projects.json'), 'utf8'));
  const digest = crypto.createHash('sha256').update(JSON.stringify(feed.projects)).digest('hex');
  assert.equal(digest, '5042664f716abc2afbd0ce3f87ba3dbe8daccdd78dabbf21d32e0c206758930f');
  assert.deepEqual(fs.readdirSync(path.join(out, 'tiles')).sort(), ['remote.png', 'somi.png']);
});

// ---- The workflow.

const YML = () => fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const job = (yml, id) => new RegExp(`\\n {2}${id}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`).exec(yml)?.[1] ?? '';

test('the deploy build copies the kit into dist/ with site-kit@v3 after the build and before pages-upload', () => {
  const build = job(YML(), 'build');
  const kit = build.indexOf('skathio/hashira/.github/actions/site-kit@v3');
  assert.ok(kit >= 0, 'the build job runs site-kit@v3');
  assert.ok(build.indexOf('npm run build') < kit, 'site-kit runs after the live build');
  assert.ok(kit < build.indexOf('skathio/hashira/.github/actions/pages-upload@v3'), 'site-kit runs before pages-upload');
  const end = build.indexOf('\n      - ', kit);
  const step = build.slice(kit, end === -1 ? undefined : end);
  assert.match(step, /\n\s+dest: ['"]?dist['"]?\s*(\n|$)/);
});

test('site-kit runs in the deploy build only, not in the pull request job or the deploy job', () => {
  const yml = YML();
  assert.ok(!job(yml, 'ci').includes('site-kit'));
  assert.ok(!job(yml, 'deploy').includes('site-kit'));
  assert.equal((yml.match(/skathio\/hashira\/\.github\/actions\/site-kit@/g) ?? []).length, 1);
});

test('every hashira ref in ci.yml, site-kit included, is on @v3', () => {
  const refs = [...YML().matchAll(/skathio\/hashira\/(\S+)@(\S+)/g)];
  const paths = new Set(refs.map((m) => m[1]));
  for (const p of ['.github/actions/site-kit', '.github/actions/pages-upload', '.github/actions/pages-deploy', '.github/workflows/static-webapp-ci.yml']) assert.ok(paths.has(p), p);
  for (const m of refs) assert.equal(m[2], 'v3', `${m[1]} is on @${m[2]}`);
});

test('the triggers and the hourly schedule are unchanged, and the workflow keeps permissions: {} at the top', () => {
  const yml = YML();
  const on = /\non:\n([\s\S]*?)\n(?=\S)/.exec(yml)?.[1];
  assert.equal(on, [
    '  pull_request:',
    '  push:',
    '    branches: [main]',
    '  schedule:',
    "    - cron: '17 * * * *'",
    '  repository_dispatch:',
    '    types: [project-released, project-updated]',
    '  workflow_dispatch:',
    '',
  ].join('\n'));
  assert.match(yml, /\npermissions: \{\}\n/);
});

test('the repo stays dependency-free', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.ok(!pkg[k] || Object.keys(pkg[k]).length === 0, k);
});

test('without script every page still has the home link, Projects, Releases, Pull requests and CI in the nav', () => {
  for (const [projects, expected] of [[[released], WITH], [[], WITHOUT]]) {
    for (const [name, { html, base }] of Object.entries(build(projects))) {
      const inner = /<site-nav\b[^>]*>([\s\S]*?)<\/site-nav>/.exec(html)[1].replace(/<script\b[\s\S]*?<\/script>/g, '');
      const links = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => [m[2].replace(/<[^>]*>/g, '').trim(), where(attrsOf(m[1]).href, base)]);
      assert.deepEqual(links, [['skathio', '/'], ...expected], name);
    }
  }
});

test('the stand-in links hide once the kit defines <site-nav>, and the page\'s own nav links get the accent focus ring', () => {
  const { html } = build([released]).home;
  assert.ok(html.includes('site-nav:defined>a.fb{display:none}'));
  assert.ok(html.includes('site-nav>a:focus-visible{outline:2px solid var(--accent)'));
});
