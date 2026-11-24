// The /ci/ page: the build writes it, every page's nav links to it, a failing row shows what it
// must, a failed read is named above the table, the all-clear wording and its as-of line, the
// reserved `ci` path, and the fixture build. The page is checked through the fixture build
// (scripts/build.mjs --fixture), whose `runs` key holds each repo's runs as GitHub's REST API
// returns them, so the test does not depend on how writeSite takes the runs read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSite } from '../src/build.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'org.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-ci-'));

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const bodyRows = (html) => (html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []).filter((r) => !/<th\b/.test(r));
const navOf = (html) => /<nav\b[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: text(m[2]) }));
const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
const hrefs = (html) => anchors(html).map((a) => attr(a.attrs, 'href'));

// A run as GitHub's REST API returns it. day orders created_at; a later day is newer.
let nextId = 70000;
const run = (repo, f = {}) => {
  const id = f.id ?? nextId++;
  return {
    id,
    name: f.name ?? 'CI',
    path: f.path ?? '.github/workflows/ci.yml',
    event: f.event ?? 'push',
    status: 'completed',
    conclusion: f.conclusion ?? 'failure',
    created_at: `2026-11-${String(f.day ?? 10).padStart(2, '0')}T10:00:00Z`,
    html_url: f.url ?? `https://github.com/skathio/${repo}/actions/runs/${id}`,
    head_repository: { full_name: `skathio/${repo}` },
  };
};

// Runs the CLI over the fixture, with runs replaced when given, and returns its pages and output.
function fixtureBuild({ runs, mutate } = {}) {
  let fixture = FIXTURE;
  if (runs || mutate) {
    const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    if (runs) data.runs = runs;
    mutate?.(data);
    fixture = path.join(tmp(), 'org.json');
    fs.writeFileSync(fixture, JSON.stringify(data));
  }
  const out = tmp();
  const res = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--fixture', fixture], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const page = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
  return { out, stderr: res.stderr, home: page('index.html'), prs: page('prs/index.html'), ci: page('ci/index.html') };
}

let plain;
const plainBuild = () => (plain ??= fixtureBuild());
const allGreen = (repos = ['somi', 'hinokami', 'rogue']) => Object.fromEntries(repos.map((r) => [r, [run(r, { conclusion: 'success' })]]));

// Whether a nav link stays on screen at phone width (390px): no display:none rule in a
// max-width media query that covers 390px picks it out of the nav by tag and classes.
const phoneMedia = (css) => [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
  .filter((m) => Number(m[1]) >= 390).map((m) => m[2]);
const hidingSelectors = (block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((rule) => /display:\s*none/.test(rule[2]))
  .flatMap((rule) => rule[1].split(',').map((s) => s.trim().split(/\s+/)));
// Whether the last compound of a selector (tag, .class and :not(.class) only) picks the link.
function compoundMatches(compound, classes) {
  if (/^[a-z]/i.test(compound) && !/^a(?![a-z])/i.test(compound)) return false;
  const not = [...compound.matchAll(/:not\(\.([\w-]+)\)/g)].map((m) => m[1]);
  const has = [...compound.replace(/:not\([^)]*\)/g, '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  return has.every((c) => classes.has(c)) && !not.some((c) => classes.has(c));
}
function visibleOnPhone(html, link) {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const classes = new Set((attr(link.attrs, 'class') ?? '').split(/\s+/).filter(Boolean));
  const hides = (parts) => parts[0] === 'nav' && parts.length > 1 && compoundMatches(parts[parts.length - 1], classes);
  return !phoneMedia(css).flatMap(hidingSelectors).some(hides);
}

test('the build writes ci/index.html next to the homepage and prs/', () => {
  const { out } = plainBuild();
  for (const f of ['index.html', 'prs/index.html', 'ci/index.html']) assert.ok(fs.existsSync(path.join(out, f)), f);
});

test('every page\'s nav has a CI link right next to Pull requests', () => {
  const pages = plainBuild();
  for (const name of ['home', 'prs', 'ci']) {
    const links = anchors(navOf(pages[name]));
    const ci = links.findIndex((a) => a.text === 'CI');
    const pr = links.findIndex((a) => a.text === 'Pull requests');
    assert.ok(ci >= 0, `a CI link on ${name}`);
    assert.ok(pr >= 0, `a Pull requests link on ${name}`);
    assert.equal(Math.abs(ci - pr), 1, `CI next to Pull requests on ${name}`);
  }
});

test('the CI link goes to /ci/ from the homepage and from /prs/', () => {
  const { home, prs } = plainBuild();
  const ciHref = (html) => attr(anchors(navOf(html)).find((a) => a.text === 'CI')?.attrs ?? '', 'href');
  assert.match(ciHref(home) ?? '', /^(\.\/)?ci\/(index\.html)?$/);
  assert.match(ciHref(prs) ?? '', /^\.\.\/ci\/(index\.html)?$/);
});

test('the CI and Pull requests links stay visible at phone width on every page', () => {
  const pages = plainBuild();
  for (const name of ['home', 'prs', 'ci']) {
    for (const label of ['CI', 'Pull requests']) {
      const link = anchors(navOf(pages[name])).find((a) => a.text === label);
      assert.ok(link, `${label} on ${name}`);
      assert.ok(visibleOnPhone(pages[name], link), `${label} is hidden at phone width on ${name}`);
    }
  }
});

test('aria-current="page" marks the page you are on, and only that link', () => {
  const pages = plainBuild();
  const current = (html) => anchors(navOf(html)).filter((a) => /\baria-current="page"/.test(a.attrs)).map((a) => a.text);
  assert.deepEqual(current(pages.ci), ['CI']);
  assert.deepEqual(current(pages.prs), ['Pull requests']);
  assert.deepEqual(current(pages.home), []);
});

test('the CI page has the nav back home, the theme toggle, both themes and the local-time script', () => {
  const { ci } = plainBuild();
  assert.ok(hrefs(navOf(ci)).some((h) => ['../', '..', '../index.html'].includes(h)), navOf(ci));
  assert.match(navOf(ci), /<button\b[^>]*id="theme"/);
  assert.match(ci, /<script src="\.\.\/brand\/theme\.js"><\/script>/);
  assert.match(ci, /<script src="\.\.\/brand\/local-time\.js" defer><\/script>/);
  assert.match(ci, /name="viewport"/);
  assert.match(ci, /prefers-color-scheme:\s*dark/);
  assert.match(ci, /data-theme=dark/);
});

test('the fixture build shows the failing push and Dependabot rows only', () => {
  const { ci } = plainBuild();
  const rows = bodyRows(ci);
  assert.equal(rows.length, 2, rows.join('\n'));
  const urls = rows.flatMap(hrefs);
  assert.ok(urls.includes('https://github.com/skathio/somi/actions/runs/9003'), urls.join(' '));
  assert.ok(urls.includes('https://github.com/skathio/rogue/actions/runs/9201'), urls.join(' '));
  for (const id of ['9001', '9002', '9004', '9005', '9101', '9102', '9202', '9301']) assert.ok(!ci.includes(`/actions/runs/${id}`), `run ${id} not shown`);
  assert.ok(!text(ci).includes('Nothing is failing'));
});

test('the fixture build warns about the bad run URL once and reads every repo', () => {
  const { stderr } = plainBuild();
  const runWarnings = stderr.split('\n').filter((l) => /^warning: /.test(l) && /actions\/runs|workflow run/.test(l));
  assert.equal(runWarnings.length, 1, stderr);
  assert.match(runWarnings[0], /^warning: remote: /);
  assert.ok(!/could not be read/.test(stderr), stderr);
});

test('a failing row shows the project linked to its tile, workflow, event, since, streak and run link', () => {
  const somi = [9, 8, 7, 6, 5, 4, 3].map((day, i) => run('somi', { id: 500 + i, name: 'Release build', event: 'workflow_dispatch', day }));
  somi.push(run('somi', { id: 499, name: 'Release build', event: 'workflow_dispatch', day: 2, conclusion: 'success' }));
  const { ci } = fixtureBuild({ runs: { somi } });
  const rows = bodyRows(ci);
  assert.equal(rows.length, 1, rows.join('\n'));
  const t = text(rows[0]);
  const project = anchors(rows[0]).find((a) => attr(a.attrs, 'href') === '../#somi');
  assert.equal(project?.text, 'SoMi');
  for (const part of ['Release build', 'workflow_dispatch']) assert.ok(t.includes(part), `${part} in: ${t}`);
  assert.ok(t.includes('3 Nov 2026') || /datetime="2026-11-03T10:00/.test(rows[0]), `failing since the oldest failure in: ${rows[0]}`);
  assert.match(t, /\b7\b/, `the streak of 7 in: ${t}`);
  assert.ok(hrefs(rows[0]).includes('https://github.com/skathio/somi/actions/runs/500'), rows[0]);
  assert.ok(!hrefs(rows[0]).some((h) => /\/actions\/runs\/50[1-6]$/.test(h)), 'only the newest failed run is linked');
});

test('one failing run is a row with a streak of 1 since that run', () => {
  const { ci } = fixtureBuild({ runs: { hinokami: [run('hinokami', { id: 610, day: 12 })] } });
  const rows = bodyRows(ci);
  assert.equal(rows.length, 1, rows.join('\n'));
  assert.match(text(rows[0]), /\b1\b/);
  assert.ok(text(rows[0]).includes('12 Nov 2026') || /datetime="2026-11-12T10:00/.test(rows[0]), rows[0]);
  assert.ok(hrefs(rows[0]).includes('https://github.com/skathio/hinokami/actions/runs/610'));
});

test('rows show newest failure first, then repo name, then workflow name', () => {
  const runs = {
    somi: [run('somi', { id: 701, name: 'Beta', path: '.github/workflows/b.yml', day: 14 }), run('somi', { id: 702, name: 'Alpha', path: '.github/workflows/a.yml', day: 14 })],
    hinokami: [run('hinokami', { id: 703, day: 14 })],
    rogue: [run('rogue', { id: 704, day: 15 })],
  };
  const ids = bodyRows(fixtureBuild({ runs }).ci).map((r) => hrefs(r).map((h) => /\/actions\/runs\/(\d+)$/.exec(h ?? '')?.[1]).find(Boolean));
  assert.deepEqual(ids, ['704', '703', '702', '701']);
});

test('a workflow name and a project name with markup are escaped', () => {
  const runs = { badmanifest: [run('badmanifest', { id: 801, name: '<img src=x onerror=alert(1)>' })] };
  const { ci } = fixtureBuild({ runs });
  assert.equal(bodyRows(ci).length, 1);
  assert.ok(!ci.includes('<img src=x'), 'workflow name escaped');
  assert.ok(ci.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!ci.includes('<b>Bad</b>'), 'project name escaped');
});

test('a private project never shows on /ci/, not as a row, a name or an unread repo', () => {
  const runs = { 'optin-js': [run('optin-js', { id: 901 })], somi: [run('somi', { id: 902 })] };
  const { ci } = fixtureBuild({ runs, mutate: (d) => { d.runs['secret-js'] = 'not a list'; } });
  assert.equal(bodyRows(ci).length, 1);
  for (const s of ['optin', 'Optin', 'secret-js', '/actions/runs/901']) assert.ok(!ci.includes(s), s);
});

test('with nothing failing and every read working the page says so above the as-of line', () => {
  const { ci } = fixtureBuild({ runs: allGreen() });
  const t = text(ci);
  const nothing = t.indexOf('Nothing is failing on the default branches.');
  const asOf = t.search(/As of .+?, rebuilt hourly\./);
  assert.ok(nothing >= 0, t);
  assert.ok(asOf > nothing, 'the as-of line comes after the all-clear');
  assert.match(ci, /As of <time datetime="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z" data-local>[^<]+<\/time>, rebuilt hourly\./);
  assert.equal(bodyRows(ci).length, 0);
  assert.ok(!/<table\b/.test(ci));
});

test('with no runs at all and every read working the page still says nothing is failing', () => {
  const { ci } = fixtureBuild({ runs: {} });
  assert.ok(text(ci).includes('Nothing is failing on the default branches.'));
});

test('a repo whose runs cannot be read is named above the table, and the other rows still show', () => {
  const runs = { somi: [run('somi', { id: 1001 })], hinokami: 'not a list' };
  const { ci, stderr } = fixtureBuild({ runs });
  assert.match(stderr, /^warning: hinokami: /m);
  const table = ci.search(/<table\b/);
  assert.ok(table > 0, 'a table');
  assert.match(text(ci.slice(0, table)).toLowerCase(), /hinokami/);
  assert.equal(bodyRows(ci).length, 1);
  assert.ok(hrefs(bodyRows(ci)[0]).includes('https://github.com/skathio/somi/actions/runs/1001'));
});

test('every unread repo is named, and an unread page never reads as all clear without the note', () => {
  const runs = { ...allGreen(['somi']), hinokami: 'not a list' };
  const { ci } = fixtureBuild({ runs, mutate: (d) => { delete d.repos.find((r) => r.name === 'rogue').default_branch; } });
  const t = text(ci).toLowerCase();
  assert.match(t, /hinokami/);
  assert.match(t, /rogue/);
  assert.equal(bodyRows(ci).length, 0);
  if (t.includes('nothing is failing')) {
    const note = Math.min(t.indexOf('hinokami'), t.indexOf('rogue'));
    assert.ok(note < t.indexOf('nothing is failing'), 'the unread note comes before any all-clear');
  }
});

test('writeSite refuses a repo named ci, in any case, listed or not', () => {
  const project = (repo) => ({ repo, name: repo, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null });
  const args = { out: tmp(), org: 'skathio', images: new Map(), generatedAt: '' };
  assert.throws(() => writeSite({ ...args, projects: [project('ci')] }), /"ci"/i);
  assert.throws(() => writeSite({ ...args, projects: [project('CI')] }), /"ci"/i);
  assert.throws(() => writeSite({ ...args, projects: [], repoNames: ['Ci'] }), /"ci"/i);
});

test('the public feed keeps its shape: no run data in projects.json', () => {
  const { out } = plainBuild();
  const feed = JSON.parse(fs.readFileSync(path.join(out, 'projects.json'), 'utf8'));
  assert.deepEqual(Object.keys(feed).sort(), ['generatedAt', 'org', 'projects']);
  assert.ok(!JSON.stringify(feed).includes('actions/runs'));
});
