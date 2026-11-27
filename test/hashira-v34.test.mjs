// The homepage on hashira v3.4.0's site kit: the <site-nav> is a navigation landmark labelled
// "Site", its no-script links are slot="fallback" children (the kit holds their space and hides
// them once defined, so the page carries no fallback or focus CSS of its own), a slot="brand" span
// keeps the accented "io", the accent is set through the kit's --site-accent tokens and the
// palette the kit already defines is not declared again. The PR build copies the kit into its
// artifact, the PR job no longer holds the Pages grants, and the visual check fetches hashira's
// tags and waits for the nav to be ready instead of a fixed timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSite } from '../src/build.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const PAGES = { home: 'index.html', prs: 'prs/index.html', ci: 'ci/index.html' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-v34-'));
const project = (repo, extra = {}) => ({ repo, name: repo, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null, ...extra });
const released = project('rogue', { release: { tag: 'v1.0.0', date: '2026-11-01T00:00:00Z', url: null } });

const attrsOf = (raw) => Object.fromEntries([...raw.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']));
const text = (s) => s.replace(/<[^>]*>/g, '').trim();

function build(projects, org = 'skathio') {
  const out = tmp();
  writeSite({ out, org, projects, images: new Map(), generatedAt: '2026-11-24T09:05:00Z', prs: { pulls: [], total: 0, readAt: '2026-11-24T09:05:00Z' }, runs: { repos: [], readAt: '2026-11-24T09:05:00Z' } });
  return Object.fromEntries(Object.entries(PAGES).map(([k, rel]) => [k, fs.readFileSync(path.join(out, rel), 'utf8')]));
}

// The <site-nav>'s opening attributes and its direct children, script left out.
function siteNav(html) {
  const m = /<site-nav\b([^>]*)>([\s\S]*?)<\/site-nav>/.exec(html);
  assert.ok(m, 'a <site-nav>');
  const inner = m[2].replace(/<script\b[\s\S]*?<\/script>/g, '');
  const links = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((a) => ({ attrs: attrsOf(a[1]), body: a[2], label: text(a[2]) }));
  const rest = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '').trim();
  return { attrs: attrsOf(m[1]), links, rest };
}
const styleOf = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const declares = (css, name) => new RegExp(`(^|[;{\\s])${name}\\s*:`).test(css);

const BOTH = [[[released], ['skathio', 'Projects', 'Releases']], [[], ['skathio', 'Projects']]];

// ---- The <site-nav> markup.

test('every page\'s <site-nav> is the navigation landmark labelled "Site"', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const { attrs } = siteNav(html);
    assert.equal(attrs.role, 'navigation', name);
    assert.equal(attrs['aria-label'], 'Site', name);
  }
});

test('the no-script brand, Projects and Releases links are slot="fallback" children, in that order, with or without releases', () => {
  for (const [projects, expected] of BOTH) {
    for (const [name, html] of Object.entries(build(projects))) {
      const fallback = siteNav(html).links.filter((l) => l.attrs.slot === 'fallback').map((l) => l.label);
      assert.deepEqual(fallback, expected, name);
    }
  }
});

test('Pull requests and CI stay extras: links with no slot, after the fallback links', () => {
  for (const [projects] of BOTH) {
    for (const [name, html] of Object.entries(build(projects))) {
      const { links } = siteNav(html);
      const extras = links.filter((l) => !('slot' in l.attrs)).map((l) => l.label);
      assert.deepEqual(extras, ['Pull requests', 'CI'], name);
      const lastFallback = links.map((l) => l.attrs.slot).lastIndexOf('fallback');
      assert.ok(lastFallback < links.findIndex((l) => l.label === 'Pull requests'), name);
    }
  }
});

test('one <span slot="brand"> child restores the styled name, with the trailing "io" in its own element', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const { rest } = siteNav(html);
    const brands = [...rest.matchAll(/<(\w+)\b([^>]*)>/g)].filter((m) => attrsOf(m[2]).slot === 'brand');
    assert.equal(brands.length, 1, `${name}: one slot="brand" child`);
    assert.equal(brands[0][1].toLowerCase(), 'span', name);
    assert.ok(rest.startsWith('<span'), `${name}: the brand span is a direct child`);
    assert.equal(text(rest), 'skathio', name);
    assert.match(rest, /<\w+\b[^>]*>io<\/\w+>/, `${name}: "io" is wrapped for the accent`);
  }
});

test('an org name with markup in it is escaped in the brand slot and the fallback links', () => {
  const evil = 'x"><img src=x onerror=alert(1)><span slot="brand">io';
  for (const [name, html] of Object.entries(build([released], evil))) {
    assert.ok(!html.includes('<img src=x onerror'), name);
    const { rest } = siteNav(html);
    assert.equal([...rest.matchAll(/\bslot="brand"/g)].length, 1, `${name}: the org cannot add a second brand slot`);
  }
});

test('the fallback brand link shows the mark at the kit\'s 24px, not 26px', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const brand = siteNav(html).links.find((l) => l.attrs.slot === 'fallback' && l.label === 'skathio');
    assert.ok(brand, `${name}: a fallback brand link`);
    const img = /<img\b([^>]*)>/.exec(brand.body);
    assert.ok(img, `${name}: the fallback brand has the mark`);
    const a = attrsOf(img[1]);
    const css = styleOf(html).replace(/\s+/g, '');
    const byAttr = a.width === '24' && a.height === '24';
    const byCss = /site-nav[^{}]*img\{[^}]*width:24px[^}]*height:24px/.test(css) || /site-nav[^{}]*img\{[^}]*height:24px[^}]*width:24px/.test(css);
    assert.ok(byAttr || byCss, `${name}: the mark is 24px`);
    assert.ok(!/26px/.test(css), `${name}: no 26px left`);
  }
});

// ---- The page's own CSS: the kit owns the fallback box, the focus ring and the palette.

test('the page carries no fallback, stand-in hiding or focus-ring CSS of its own for the <site-nav>', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const css = styleOf(html).replace(/\s+/g, '');
    assert.ok(!css.includes('site-nav:not(:defined)'), `${name}: site-nav:not(:defined)`);
    assert.ok(!css.includes('site-nav:defined'), `${name}: site-nav:defined`);
    assert.ok(!/site-nav[^{}]*:focus-visible/.test(css), `${name}: a site-nav focus rule`);
  }
});

test('the accent is set through the kit\'s --site-accent (#b80f0f) and --site-accent-dark (#ff4d4d), and --accent is not declared', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const css = styleOf(html).replace(/\s+/g, '').toLowerCase();
    assert.match(css, /--site-accent:#b80f0f[;}]/, `${name}: light accent`);
    assert.match(css, /--site-accent-dark:#ff4d4d[;}]/, `${name}: dark accent`);
    assert.ok(!declares(css, '--accent'), `${name}: --accent is declared`);
  }
});

test('the palette the kit\'s tokens.css defines is not declared again, in either theme', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const css = styleOf(html).replace(/\s+/g, '');
    for (const t of ['--canvas', '--surface', '--line', '--ink', '--muted', '--code']) assert.ok(!declares(css, t), `${name}: ${t}`);
  }
});

test('the site\'s own status colours stay, in light and dark', () => {
  const css = styleOf(build([released]).home).replace(/\s+/g, '').toLowerCase();
  for (const [t, light, dark] of [['--ok', '#1d7a45', '#5cc98a'], ['--wait', '#8a5a00', '#e2b04a'], ['--info', '#1f5fbf', '#7fb0ff']]) {
    assert.ok(css.includes(`${t}:${light}`), `${t} light`);
    assert.ok(css.includes(`${t}:${dark}`), `${t} dark`);
  }
});

test('every page loads the kit\'s tokens.css before its own <style>, so the site\'s tokens override the kit\'s', () => {
  for (const [name, html] of Object.entries(build([released]))) {
    const link = html.search(/<link\b[^>]*href="[^"]*_kit\/tokens\.css"/);
    assert.ok(link >= 0, `${name}: tokens.css`);
    assert.ok(link < html.indexOf('<style'), name);
  }
});

// ---- The workflow.

const YML = () => fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const job = (yml, id) => new RegExp(`\\n {2}${id}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`).exec(yml)?.[1] ?? '';
const block = (body, key) => new RegExp(`\\n {4}${key}:\\n((?: {6}.*\\n?)*)`).exec(body)?.[1] ?? '';

test('the ci job keeps its id and calls static-webapp-ci with site_kit: true, so the PR artifact has _kit/', () => {
  const ci = job(YML(), 'ci');
  assert.match(ci, /uses: skathio\/hashira\/\.github\/workflows\/static-webapp-ci\.yml@v3/);
  assert.match(block(ci, 'with'), /^ {6}site_kit: true\s*$/m);
});

test('the ci job holds no id-token or pages grant; the deploy job keeps both', () => {
  const yml = YML();
  const ci = block(job(yml, 'ci'), 'permissions');
  assert.ok(ci.length > 0, 'the ci job lists its permissions');
  assert.ok(!/^\s*id-token:/m.test(ci), 'ci: id-token');
  assert.ok(!/^\s*pages:/m.test(ci), 'ci: pages');
  const deploy = block(job(yml, 'deploy'), 'permissions');
  assert.match(deploy, /^\s*id-token: write\b/m);
  assert.match(deploy, /^\s*pages: write\b/m);
});

test('the fixture build that site_kit runs after writes no _kit/ of its own', () => {
  const out = tmp();
  const { GITHUB_ACTIONS, ...env } = process.env;
  const res = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--fixture', path.join(ROOT, 'test', 'fixtures', 'org.json')], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!fs.existsSync(path.join(out, '_kit')));
});

// ---- The visual check.

const SKILL = path.join(ROOT, '.claude', 'skills', 'visual-check');
const SCRIPT = () => fs.readFileSync(path.join(SKILL, 'screenshots.sh'), 'utf8');
const skillCode = () => fs.readdirSync(SKILL).filter((f) => f !== 'SKILL.md').map((f) => fs.readFileSync(path.join(SKILL, f), 'utf8')).join('\n');

test('the visual check fetches hashira\'s tags before it reads the kit at v3', () => {
  const sh = SCRIPT();
  const fetch = sh.search(/git -C "?\$hashira"? fetch\b[^\n]*--tags/);
  assert.ok(fetch >= 0, 'git fetch --tags in the hashira clone');
  const show = sh.search(/git -C "?\$hashira"? show\b/);
  assert.ok(show < 0 || fetch < show, 'the fetch comes before the kit is read');
});

test('the visual check waits for the <site-nav> to be ready, not for a fixed timeout', () => {
  const code = skillCode();
  assert.match(code, /site-nav:ready|site-nav\[ready\]/);
  assert.ok(!/--wait-for-timeout|waitForTimeout/.test(code));
});

test('the visual check still takes the four shots: phone 390x844 and desktop 1280x800, light and dark', () => {
  const code = skillCode();
  assert.match(code, /390\D{1,3}844/);
  assert.match(code, /1280\D{1,3}800/);
  for (const f of ['phone', 'desktop']) assert.match(code, new RegExp(`${f}-`));
  for (const s of ['light', 'dark']) assert.match(code, new RegExp(s));
});
