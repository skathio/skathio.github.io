// The /prs/ page checked against the request at its edges: the over-100 note when no row is left
// to show, the nav the two pages share, and a PR read handed over incomplete or of the wrong type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSite } from '../src/build.mjs';
import { collectPulls } from '../src/collect.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const READ_AT = '2026-11-24T09:05:00Z';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-prs-'));
const project = (repo, extra = {}) => ({ repo, name: repo, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null, ...extra });
const released = project('rogue', { release: { tag: 'v1.0.0', date: '2026-11-01T00:00:00Z', url: null } });

function prsPage(args) {
  const out = tmp();
  writeSite({ out, org: 'skathio', projects: [project('somi')], images: new Map(), generatedAt: READ_AT, ...args });
  return fs.readFileSync(path.join(out, 'prs', 'index.html'), 'utf8');
}
const navOf = (html) => /<site-nav\b[\s\S]*?<\/site-nav>/.exec(html)?.[0] ?? '';
const navItems = (html) => JSON.parse(/<script type="application\/json">([\s\S]*?)<\/script>/.exec(navOf(html))?.[1] ?? '{}').nav ?? [];

const node = (fields = {}) => ({
  repository: { name: 'somi', isPrivate: false }, number: 1, title: 'Bump x', url: 'https://github.com/skathio/somi/pull/1',
  isDraft: false, author: { login: 'dependabot' }, updatedAt: '2026-11-20T10:00:00Z', reviewDecision: null, mergeable: 'MERGEABLE',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...fields,
});
const clientWith = (search) => ({ graphql: async () => ({ data: { search } }) });

test('past 100 open PRs the note shows even when none of the first 100 is in a listed project', () => {
  const html = prsPage({ prs: { pulls: [], total: 150, readAt: READ_AT } });
  assert.ok(html.includes('Showing the first 100 of 150 open pull requests.'));
  assert.ok(!/<table\b/.test(html));
  assert.ok(!prsPage({ prs: { pulls: [], total: 100, readAt: READ_AT } }).includes('Showing the first'));
});

test('the pull requests page carries the homepage\'s Releases nav link when there are releases', () => {
  const html = prsPage({ projects: [project('somi'), released], prs: { pulls: [], total: 0, readAt: READ_AT } });
  assert.deepEqual(navItems(html), [{ label: 'Projects', href: '../#projects' }, { label: 'Releases', href: '../#releases' }]);
  const none = prsPage({ prs: { pulls: [], total: 0, readAt: READ_AT } });
  assert.deepEqual(navItems(none), [{ label: 'Projects', href: '../#projects' }]);
});

test('a PR read handed to writeSite as null or without a list is the could-not-be-read page', () => {
  for (const prs of [null, {}, { pulls: 'x' }, { pulls: undefined, total: 3 }]) {
    const html = prsPage({ prs });
    assert.match(html, /Pull request status could not be read at <time datetime="2026-11-24T09:05:00.000Z" data-local>24 Nov 2026, 09:05 UTC<\/time>\./, JSON.stringify(prs));
    assert.ok(!/<table\b/.test(html));
  }
});

test('a PR read with no read time falls back to the build time', () => {
  const html = prsPage({ prs: { pulls: [], total: 0 } });
  assert.match(html, /As of <time datetime="2026-11-24T09:05:00.000Z" data-local>24 Nov 2026, 09:05 UTC<\/time>, rebuilt hourly\./);
});

test('collectPulls with no projects, or projects of the wrong type, lists nothing and does not throw', async () => {
  for (const projects of [undefined, null, 'somi', [null, 'somi', { private: false }]]) {
    const out = await collectPulls({ client: clientWith({ issueCount: 1, nodes: [node()] }), org: 'skathio', projects });
    assert.deepEqual(out, { pulls: [], total: 1 }, JSON.stringify(projects));
  }
});

test('collectPulls with no client is a failed read with one warning', async () => {
  const warnings = [];
  const out = await collectPulls({ org: 'skathio', projects: [project('somi')], warn: (r, m) => warnings.push(m) });
  assert.equal(out.pulls, null);
  assert.equal(warnings.length, 1);
});

test('a negative count from GitHub is a malformed response', async () => {
  const warnings = [];
  const out = await collectPulls({ client: clientWith({ issueCount: -1, nodes: [node()] }), org: 'skathio', projects: [project('somi')], warn: (r, m) => warnings.push(m) });
  assert.equal(out.pulls, null);
  assert.equal(warnings.length, 1);
});

test('one listed PR, and null or empty nodes beside it, gives one row', async () => {
  const out = await collectPulls({ client: clientWith({ issueCount: 3, nodes: [null, {}, node()] }), org: 'skathio', projects: [project('somi')] });
  assert.deepEqual(out.pulls.map((p) => p.number), [1]);
});

test('the README names the hourly schedule', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(!/every 6 h/.test(readme));
});
