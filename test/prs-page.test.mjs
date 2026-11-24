// The /prs/ page: its rows, counts, as-of line, empty, failure and over-100 messages, the nav on
// both pages, the reserved `prs` path and the hourly rebuild. The page is checked through
// writeSite, which takes the PR read as prs: { pulls, total, readAt }, where pulls is null when
// the read failed. Rows are what collectPulls returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSite, fixtureClient } from '../src/build.mjs';
import { collectPulls } from '../src/collect.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const READ_AT = '2026-11-24T09:05:00Z';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-prs-'));
const project = (repo, name = repo, extra = {}) => ({ repo, name, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null, ...extra });
const PROJECTS = [project('somi', 'SoMi'), project('rogue', 'Rogue'), project('hinokami', 'Hinokami')];

const row = (fields = {}) => {
  const r = { repo: 'somi', number: 7, title: 'Bump x', author: 'dependabot[bot]', updatedAt: '2026-11-20T23:30:00Z', status: 'Ready for review', ci: 'passed', review: 'needs review', ...fields };
  return { url: `https://github.com/skathio/${r.repo}/pull/${r.number}`, ...r };
};

// Builds the site and returns both pages.
function build({ pulls = [], total = pulls?.length ?? 0, readAt = READ_AT, projects = PROJECTS } = {}) {
  const out = tmp();
  writeSite({ out, org: 'skathio', projects, images: new Map(), generatedAt: READ_AT, prs: { pulls, total, readAt } });
  const page = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
  return { out, home: page('index.html'), prs: page('prs/index.html') };
}

const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The text inside the first link to href, or null when there is none.
const linkText = (html, href) => {
  const m = new RegExp(`<a\\b[^>]*href="${escRe(href)}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
  return m ? text(m[1]) : null;
};
const bodyRows = (html) => (html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []).filter((r) => !/<th\b/.test(r));

test('the build writes prs/index.html next to the homepage', () => {
  const { out } = build({ pulls: [row()] });
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'prs', 'index.html')));
});

test('a row shows status, project, PR, author, CI result, review state and last update', () => {
  const { prs } = build({ pulls: [row({ status: 'Ready for review', ci: 'passed', review: 'needs review' })] });
  const rows = bodyRows(prs);
  assert.equal(rows.length, 1);
  const t = text(rows[0]);
  for (const part of ['Ready for review', 'SoMi', '#7 Bump x', 'dependabot[bot]', 'passed', 'needs review', '20 Nov 2026']) assert.ok(t.includes(part), `${part} in: ${t}`);
});

test('the project links to its tile on the homepage by display name', () => {
  const { prs } = build({ pulls: [row()] });
  assert.equal(linkText(prs, '../#somi'), 'SoMi');
});

test('the PR shows as #<number> <title> linked to the PR on GitHub', () => {
  const { prs } = build({ pulls: [row({ repo: 'rogue', number: 58, title: 'Add a timeout' })] });
  assert.equal(linkText(prs, 'https://github.com/skathio/rogue/pull/58'), '#58 Add a timeout');
});

test('the last update is a UTC date in the homepage\'s date style', () => {
  const { prs } = build({ pulls: [row({ updatedAt: '2026-11-20T23:30:00Z' })] });
  const t = text(bodyRows(prs)[0]);
  assert.ok(t.includes('20 Nov 2026'), t);
  assert.ok(!t.includes('21 Nov 2026'), t);
});

test('each CI result and review state label shows in its row', () => {
  const pulls = [
    row({ number: 1, ci: 'passed', review: 'approved', status: 'Ready to merge' }),
    row({ number: 2, ci: 'failed', review: 'changes requested', status: 'Needs attention' }),
    row({ number: 3, ci: 'running', review: 'needs review', status: 'Waiting' }),
    row({ number: 4, ci: 'none', review: 'unknown', status: 'No CI' }),
    row({ number: 5, ci: 'unknown', review: 'needs review', status: 'Ready for review' }),
  ];
  const { prs } = build({ pulls });
  const rows = bodyRows(prs).map(text);
  assert.equal(rows.length, 5);
  for (const p of pulls) {
    const t = rows.find((r) => r.includes(`#${p.number} `));
    assert.ok(t, `row #${p.number}`);
    for (const part of [p.ci, p.review, p.status]) assert.ok(t.includes(part), `${part} in: ${t}`);
  }
});

test('a title of 200 characters shows in full', () => {
  const title = 'a'.repeat(199) + 'z';
  const { prs } = build({ pulls: [row({ title })] });
  assert.ok(prs.includes(title));
});

test('a <script> title and an HTML login are escaped', () => {
  const { prs } = build({ pulls: [row({ title: '<script>alert(1)</script>', author: '<img src=x onerror=alert(1)>' })] });
  assert.ok(!prs.includes('<script>alert(1)'));
  assert.ok(!prs.includes('<img src=x'));
  assert.ok(prs.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('a row link is never anything but https', () => {
  const { prs } = build({ pulls: [row({ url: 'javascript:alert(1)' })] });
  assert.ok(!prs.includes('javascript:'));
});

test('rows show in status order, then newest update, then repo name and PR number', async () => {
  const node = (repo, number, f) => ({
    repository: { name: repo, isPrivate: false }, number, title: `T-${repo}-${number}`, url: `https://github.com/skathio/${repo}/pull/${number}`,
    isDraft: f.draft ?? false, author: { login: 'dependabot[bot]' }, updatedAt: f.at ?? '2026-11-20T10:00:00Z', reviewDecision: f.review ?? null,
    mergeable: 'UNKNOWN', commits: { nodes: [{ commit: { statusCheckRollup: f.ci === null ? null : { state: f.ci ?? 'SUCCESS' } } }] },
  });
  const nodes = [
    node('somi', 1, { ci: null }),
    node('somi', 2, { ci: 'PENDING' }),
    node('somi', 3, {}),
    node('somi', 4, { review: 'APPROVED' }),
    node('somi', 5, { ci: 'FAILURE', at: '2026-11-19T10:00:00Z' }),
    node('somi', 6, { ci: 'FAILURE', at: '2026-11-21T10:00:00Z' }),
    node('somi', 8, { ci: 'FAILURE', at: '2026-11-20T10:00:00Z' }),
    node('rogue', 9, { ci: 'FAILURE', at: '2026-11-20T10:00:00Z' }),
    node('somi', 7, { ci: 'FAILURE', at: '2026-11-20T10:00:00Z' }),
  ];
  const client = fixtureClient({ pulls: { issueCount: nodes.length, nodes } });
  const read = await collectPulls({ client, org: 'skathio', projects: PROJECTS });
  const { prs } = build({ pulls: read.pulls, total: read.total });
  const order = bodyRows(prs).map((r) => /T-([a-z]+-\d+)/.exec(text(r))?.[1]);
  assert.deepEqual(order, ['somi-6', 'rogue-9', 'somi-7', 'somi-8', 'somi-5', 'somi-4', 'somi-3', 'somi-2', 'somi-1']);
});

test('a count per status shows above the table', () => {
  const pulls = [
    ...[1, 2, 3].map((n) => row({ number: n, status: 'Needs attention', ci: 'failed' })),
    ...[4, 5].map((n) => row({ number: n, status: 'Ready to merge', review: 'approved' })),
    row({ number: 6, status: 'Ready for review' }),
    ...[7, 8, 9, 10].map((n) => row({ number: n, status: 'Waiting', ci: 'running' })),
    ...[11, 12, 13, 14, 15].map((n) => row({ number: n, status: 'No CI', ci: 'none' })),
  ];
  const { prs } = build({ pulls });
  const at = prs.search(/<table\b/);
  assert.ok(at > 0, 'a table');
  const above = text(prs.slice(0, at));
  for (const [label, n] of [['Needs attention', 3], ['Ready to merge', 2], ['Ready for review', 1], ['Waiting', 4], ['No CI', 5]]) {
    assert.match(above, new RegExp(`(\\b${n} ${label}\\b|\\b${label}:? ${n}\\b)`), `${label} ${n} in: ${above}`);
  }
});

test('the page says when the data was read: As of <date and time> UTC, rebuilt hourly', () => {
  const { prs } = build({ pulls: [row()], readAt: '2026-11-24T09:05:00Z' });
  const m = /As of (.+?) UTC\s*, rebuilt hourly/.exec(text(prs));
  assert.ok(m, 'as-of line');
  assert.match(m[1], /2026/);
  assert.match(m[1], /\b0?9[:.]05\b/);
});

test('with no open PRs the page says so in place of the table', () => {
  const { prs } = build({ pulls: [], total: 0 });
  assert.ok(text(prs).includes('No open pull requests.'));
  assert.ok(!/<table\b/.test(prs));
});

test('one open PR shows one row and no empty message', () => {
  const { prs } = build({ pulls: [row()], total: 1 });
  assert.equal(bodyRows(prs).length, 1);
  assert.ok(!text(prs).includes('No open pull requests.'));
});

test('a failed read shows the could-not-be-read message with no table, and the homepage still builds', () => {
  const { prs, home } = build({ pulls: null, total: 0, readAt: '2026-11-24T09:05:00Z' });
  const m = /Pull request status could not be read at (.+?)\./.exec(text(prs));
  assert.ok(m, 'failure message');
  assert.match(m[1], /\b0?9[:.]05\b/);
  assert.ok(!/<table\b/.test(prs));
  assert.ok(!text(prs).includes('No open pull requests.'));
  assert.ok(!/As of .+ rebuilt hourly/.test(text(prs)), 'no as-of line for data that was not read');
  assert.match(home, /<\/html>/);
});

test('past 100 open PRs the page says it shows the first 100 of n', () => {
  const pulls = Array.from({ length: 100 }, (_, i) => row({ number: i + 1 }));
  assert.ok(text(build({ pulls, total: 250 }).prs).includes('Showing the first 100 of 250 open pull requests.'));
  assert.ok(text(build({ pulls, total: 101 }).prs).includes('Showing the first 100 of 101 open pull requests.'));
  assert.ok(!text(build({ pulls, total: 100 }).prs).includes('Showing the first'), 'no note at exactly 100');
  assert.ok(!text(build({ pulls: [row()], total: 1 }).prs).includes('Showing the first'));
});

test('the homepage nav links to the pull requests page', () => {
  const { home } = build({ pulls: [] });
  const nav = /<nav\b[\s\S]*?<\/nav>/.exec(home)?.[0] ?? '';
  assert.equal(linkText(nav, 'prs/'), 'Pull requests');
});

test('the pull requests page has the nav back to the homepage and the theme toggle', () => {
  const { prs } = build({ pulls: [] });
  const nav = /<nav\b[\s\S]*?<\/nav>/.exec(prs)?.[0] ?? '';
  assert.ok(/<a\b[^>]*href="(\.\.\/|\.\.|\.\.\/index\.html|\/)"/.test(nav), `a link back home in: ${nav}`);
  assert.match(nav, /<button\b[^>]*id="theme"/);
  assert.match(prs, /<script src="\.\.\/brand\/theme\.js"><\/script>/);
});

test('the pull requests page has light and dark themes and a viewport for phones', () => {
  const { prs } = build({ pulls: [row()] });
  assert.match(prs, /name="viewport"/);
  assert.match(prs, /prefers-color-scheme:\s*dark/);
  assert.match(prs, /data-theme=dark/);
  assert.match(prs, /data-theme=light/);
});

test('the public feed keeps its shape: no PR data in projects.json', () => {
  const { out } = build({ pulls: [row()] });
  const feed = JSON.parse(fs.readFileSync(path.join(out, 'projects.json'), 'utf8'));
  assert.deepEqual(Object.keys(feed).sort(), ['generatedAt', 'org', 'projects']);
});

test('writeSite refuses a repo named prs, in any case, listed or not', () => {
  const args = { out: tmp(), org: 'skathio', images: new Map(), generatedAt: '', prs: { pulls: [], total: 0, readAt: READ_AT } };
  assert.throws(() => writeSite({ ...args, projects: [project('prs')] }), /prs/i);
  assert.throws(() => writeSite({ ...args, projects: [project('PRS')] }), /prs/i);
  assert.throws(() => writeSite({ ...args, projects: [], repoNames: ['PRS'] }), /prs/i);
});

test('the live build runs hourly, and the other triggers stay as they are', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const on = /^on:\n([\s\S]*?)^\S/m.exec(ci)?.[1] ?? '';
  assert.match(on, /^ {2}schedule:\n {4}- cron: '17 \* \* \* \*'\n/m);
  assert.ok(!ci.includes('17 */6 * * *'));
  assert.match(on, /^ {2}pull_request:\s*$/m);
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]\n/m);
  assert.match(on, /^ {2}repository_dispatch:\n {4}types: \[project-released, project-updated\]\n/m);
  assert.match(on, /^ {2}workflow_dispatch:\s*$/m);
});

function fixtureBuild(mutate) {
  const out = tmp();
  let fixture = path.join(ROOT, 'test', 'fixtures', 'org.json');
  if (mutate) {
    const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    mutate(data);
    fixture = path.join(tmp(), 'org.json');
    fs.writeFileSync(fixture, JSON.stringify(data));
  }
  const run = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--fixture', fixture], { cwd: ROOT, encoding: 'utf8' });
  return { run, out };
}

test('the fixture build writes a /prs/ page that shows every status and no private or unlisted PR', () => {
  const { run, out } = fixtureBuild();
  assert.equal(run.status, 0, run.stderr);
  const prs = fs.readFileSync(path.join(out, 'prs', 'index.html'), 'utf8');
  const rows = bodyRows(prs).map(text).join('\n');
  for (const status of ['Needs attention', 'Ready to merge', 'Ready for review', 'Waiting', 'No CI']) assert.ok(rows.includes(status), status);
  assert.ok(!prs.includes('must never show'));
  assert.ok(!prs.includes('optin-js'));
  assert.ok(!prs.includes('secret-js'));
  assert.ok(!prs.includes('evil.example'));
});

test('a malformed PR response still builds the homepage, with one warning and the could-not-be-read page', () => {
  const { run, out } = fixtureBuild((data) => { data.pulls = { issueCount: 3, nodes: 'not a list' }; });
  assert.equal(run.status, 0, run.stderr);
  assert.equal((run.stderr.match(/pull requests could not be read/g) ?? []).length, 1, run.stderr);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  const prs = fs.readFileSync(path.join(out, 'prs', 'index.html'), 'utf8');
  assert.match(text(prs), /Pull request status could not be read at .+\./);
  assert.ok(!/<table\b/.test(prs));
});

// Runs brand/local-time.js against a stand-in DOM, in a child process because Date formatting
// follows TZ, which is fixed per process. Returns each time element's text afterwards.
function runLocalTime(times, tz) {
  const src = fs.readFileSync(path.join(ROOT, 'brand', 'local-time.js'), 'utf8');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const nodes = ${JSON.stringify(times)}.map((dt) => ({ textContent: 'UTC text', getAttribute: (n) => (n === 'datetime' ? dt : null) }));
    let ready;
    globalThis.document = { addEventListener: (_, fn) => { ready = fn; }, querySelectorAll: (q) => (q === 'time[data-local]' ? nodes : []) };
    new Function(${JSON.stringify(src)})();
    ready();
    console.log(JSON.stringify(nodes.map((n) => n.textContent)));
  `], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('both PR page times carry their instant for the browser to show in local time, and the page loads the script', () => {
  const { prs } = build({ pulls: [row()], readAt: '2026-11-24T09:05:00Z' });
  assert.match(prs, /As of <time datetime="2026-11-24T09:05:00\.000Z" data-local>/);
  assert.match(prs, /<script src="\.\.\/brand\/local-time\.js" defer><\/script>/);
  const failed = build({ pulls: null, readAt: '2026-11-24T09:05:00Z' }).prs;
  assert.match(failed, /could not be read at <time datetime="2026-11-24T09:05:00\.000Z" data-local>/);
});

test('local-time.js shows the read time in the visitor zone, and leaves a bad datetime alone', () => {
  const [berlin, bad] = runLocalTime(['2026-11-24T09:05:00.000Z', 'not a date'], 'Europe/Berlin');
  assert.match(berlin, /^24 Nov 2026, 10:05 /);
  assert.ok(!berlin.includes('UTC'), berlin);
  assert.equal(bad, 'UTC text');
  const [tokyo] = runLocalTime(['2026-11-24T20:05:00.000Z'], 'Asia/Tokyo');
  assert.match(tokyo, /^25 Nov 2026, 05:05 /, 'the date moves with the zone');
});
