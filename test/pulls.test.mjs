// Open pull requests read at build time: who is shown, each PR's status, CI and review labels,
// the order, the caps, and how a failed read degrades. The contract under test:
//   collectPulls({ client, org, projects, warn }) -> { pulls, total }
//   pulls: the rows, or null when the data could not be read (never a partial list);
//   total: the open PR count GitHub reports;
//   a row: { repo, number, title, url, author, updatedAt, status, ci, review }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as collector from '../src/collect.mjs';
import { fixtureClient } from '../src/build.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/org.json', import.meta.url), 'utf8'));
const MB = 1024 * 1024;
// Read through the module object, so one missing export fails its own tests and not the whole file.
const { collect, githubClient } = collector;
const collectPulls = (args) => collector.collectPulls(args);

// What collect hands over: listed projects, one of them a private opted-in tile.
const projects = [
  { repo: 'somi', name: 'SoMi', private: false },
  { repo: 'rogue', name: 'Rogue', private: false },
  { repo: 'optin-js', name: 'Opt-in', private: true },
];

// One PR as GitHub's GraphQL search returns it. rollup null means no status-check rollup.
const DEFAULTS = { repo: 'somi', number: 1, title: 'Bump x', isDraft: false, login: 'dependabot', updatedAt: '2026-11-20T10:00:00Z', review: null, mergeable: 'MERGEABLE', rollup: 'SUCCESS', isPrivate: false };
const pr = (fields = {}) => {
  const f = { ...DEFAULTS, ...fields };
  return {
    repository: { name: f.repo, isPrivate: f.isPrivate },
    number: f.number,
    title: f.title,
    url: f.url ?? `https://github.com/skathio/${f.repo}/pull/${f.number}`,
    isDraft: f.isDraft,
    author: { login: f.login },
    updatedAt: f.updatedAt,
    reviewDecision: f.review,
    mergeable: f.mergeable,
    commits: { nodes: [{ commit: { statusCheckRollup: f.rollup === null ? null : { state: f.rollup } } }] },
  };
};

const body = (nodes, issueCount = nodes.length) => ({ data: { search: { issueCount, nodes } } });

// A real githubClient over a fake fetch, so every layer that reads the response is exercised.
// opts.token replaces the default token; { token: undefined } builds a client with none.
const clientFor = (respond, opts = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  return { client: githubClient({ token: 'token' in opts ? opts.token : 't0k', fetchImpl }), calls };
};
const json = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const read = async (respond, opts) => {
  const warnings = [];
  const { client, calls } = clientFor(respond, opts);
  const result = await collectPulls({ client, org: 'skathio', projects, warn: (r, m) => warnings.push(`${r}: ${m}`) });
  return { ...result, warnings, calls };
};
const readNodes = (nodes, issueCount) => read(() => json(body(nodes, issueCount)));
const only = async (fields) => {
  const { pulls } = await readNodes([pr(fields)]);
  assert.equal(pulls.length, 1);
  return pulls[0];
};

test('graphql POSTs the query and variables to the API with the token', async () => {
  const { client, calls } = clientFor(() => json({ data: {} }));
  await client.graphql('query Q { viewer { login } }', { org: 'skathio' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/graphql');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t0k');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'carries the same timeout as other requests');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.query, 'query Q { viewer { login } }');
  assert.deepEqual(sent.variables, { org: 'skathio' });
});

test('graphql reads a body up to the 1 MB cap and refuses one past it', async () => {
  const fits = JSON.stringify({ data: { x: 'a'.repeat(1000000 - 20) } });
  await assert.doesNotReject(clientFor(() => json(fits)).client.graphql('q', {}));
  const over = JSON.stringify({ data: { x: 'a'.repeat(MB) } });
  await assert.rejects(clientFor(() => json(over)).client.graphql('q', {}), /limit|over/);
});

test('graphql stops reading an endless body at the cap', async () => {
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); } });
  await assert.rejects(clientFor(() => new Response(stream, { status: 200 })).client.graphql('q', {}), /over/);
  assert.ok(pulled < 64, `stopped after ${pulled} chunks`);
});

test('graphql throws on a non-2xx response', async () => {
  for (const status of [401, 403, 500, 502]) {
    await assert.rejects(clientFor(() => json({ message: 'no' }, status)).client.graphql('q', {}), new RegExp(String(status)));
  }
});

test('one search reads the org\'s open, unarchived PRs, at most 100', async () => {
  const { calls } = await readNodes([]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/graphql');
  const sent = calls[0].init.body;
  for (const s of ['org:skathio', 'is:pr', 'is:open', 'archived:false']) assert.ok(sent.includes(s), s);
  assert.match(sent, /first:\s*100\b|"first":\s*100\b/);
});

test('PRs from any author are listed, bots included', async () => {
  const { pulls } = await readNodes([pr({ number: 1, login: 'dependabot' }), pr({ number: 2, login: 'renovate[bot]' }), pr({ number: 3, login: 'octocat' })]);
  assert.deepEqual(pulls.map((p) => p.author).sort(), ['dependabot', 'octocat', 'renovate[bot]']);
});

test('a row carries the repo, number, title, url, author and last update', async () => {
  const p = await only({ repo: 'rogue', number: 7, title: 'Fix it', login: 'octocat', updatedAt: '2026-11-21T08:30:00Z' });
  assert.equal(p.repo, 'rogue');
  assert.equal(p.number, 7);
  assert.equal(p.title, 'Fix it');
  assert.equal(p.url, 'https://github.com/skathio/rogue/pull/7');
  assert.equal(p.author, 'octocat');
  assert.equal(p.updatedAt, '2026-11-21T08:30:00Z');
});

test('a PR whose repository is reported private is dropped, even in a listed public project', async () => {
  const { pulls } = await readNodes([pr({ repo: 'somi', number: 1, isPrivate: true }), pr({ repo: 'rogue', number: 2 })]);
  assert.deepEqual(pulls.map((p) => p.repo), ['rogue']);
});

test('a PR from a private opted-in tile is dropped, even when GitHub reports it public', async () => {
  const { pulls } = await readNodes([pr({ repo: 'optin-js', number: 1 }), pr({ repo: 'optin-js', number: 2, isPrivate: true })]);
  assert.deepEqual(pulls, []);
});

test('a PR from a repo that is not a listed project is dropped', async () => {
  const { pulls } = await readNodes([pr({ repo: 'hidden', number: 1 }), pr({ repo: 'somi', number: 2 })]);
  assert.deepEqual(pulls.map((p) => p.repo), ['somi']);
});

test('no open PRs gives an empty list, a zero total and no warning', async () => {
  const { pulls, total, warnings } = await readNodes([], 0);
  assert.deepEqual(pulls, []);
  assert.equal(total, 0);
  assert.deepEqual(warnings, []);
});

test('each status rule, and which rule wins', async () => {
  const cases = [
    [{ isDraft: true }, 'Waiting', 'a draft'],
    [{ isDraft: true, rollup: 'FAILURE' }, 'Waiting', 'a draft with failing CI'],
    [{ isDraft: true, mergeable: 'CONFLICTING', review: 'CHANGES_REQUESTED' }, 'Waiting', 'a draft with a conflict and changes requested'],
    [{ rollup: 'FAILURE' }, 'Needs attention', 'CI failed'],
    [{ rollup: 'ERROR' }, 'Needs attention', 'CI errored'],
    [{ mergeable: 'CONFLICTING' }, 'Needs attention', 'a merge conflict'],
    [{ review: 'CHANGES_REQUESTED' }, 'Needs attention', 'changes requested'],
    [{ review: 'APPROVED', rollup: 'FAILURE' }, 'Needs attention', 'approved with failing CI'],
    [{ rollup: 'PENDING', mergeable: 'CONFLICTING' }, 'Needs attention', 'a conflict while CI runs'],
    [{ rollup: null, review: 'CHANGES_REQUESTED' }, 'Needs attention', 'changes requested with no CI'],
    [{ rollup: 'PENDING' }, 'Waiting', 'CI pending'],
    [{ rollup: 'EXPECTED' }, 'Waiting', 'CI expected'],
    [{ rollup: 'PENDING', review: 'APPROVED' }, 'Waiting', 'approved while CI runs'],
    [{ rollup: null }, 'No CI', 'no status-check rollup'],
    [{ rollup: null, review: 'APPROVED' }, 'No CI', 'approved with no CI'],
    [{ review: 'APPROVED' }, 'Ready to merge', 'approved and passed'],
    [{ review: 'APPROVED', mergeable: 'UNKNOWN' }, 'Ready to merge', 'mergeable UNKNOWN is not a conflict'],
    [{ review: 'REVIEW_REQUIRED' }, 'Ready for review', 'passed, review required'],
    [{ review: null }, 'Ready for review', 'passed, no review decision'],
    [{ review: 'SOMETHING_NEW' }, 'Ready for review', 'an unknown review state is not an approval'],
    [{ mergeable: 'SOMETHING_NEW' }, 'Ready for review', 'an unknown mergeable state is not a conflict'],
    [{ rollup: 'SOMETHING_NEW', review: 'APPROVED' }, 'Ready for review', 'an unknown CI state is not a pass, even when approved'],
  ];
  for (const [fields, status, why] of cases) assert.equal((await only(fields)).status, status, why);
});

test('an unknown CI state shows as unknown and is not a failure', async () => {
  const p = await only({ rollup: 'SOMETHING_NEW' });
  assert.equal(p.ci, 'unknown');
  assert.notEqual(p.status, 'Needs attention');
});

test('CI result maps the rollup state', async () => {
  const cases = [['SUCCESS', 'passed'], ['FAILURE', 'failed'], ['ERROR', 'failed'], ['PENDING', 'running'], ['EXPECTED', 'running'], [null, 'none'], ['SOMETHING_NEW', 'unknown']];
  for (const [rollup, ci] of cases) assert.equal((await only({ rollup })).ci, ci, String(rollup));
});

test('review state maps the review decision', async () => {
  const cases = [['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes requested'], ['REVIEW_REQUIRED', 'needs review'], [null, 'needs review'], ['SOMETHING_NEW', 'unknown']];
  for (const [review, label] of cases) assert.equal((await only({ review })).review, label, String(review));
});

test('rows sort by status, then newest update, then repo name', async () => {
  const nodes = [
    pr({ repo: 'somi', number: 1, rollup: null }),
    pr({ repo: 'somi', number: 2, isDraft: true }),
    pr({ repo: 'somi', number: 3 }),
    pr({ repo: 'somi', number: 4, review: 'APPROVED' }),
    pr({ repo: 'somi', number: 5, rollup: 'FAILURE', updatedAt: '2026-11-01T00:00:00Z' }),
    pr({ repo: 'somi', number: 6, rollup: 'FAILURE', updatedAt: '2026-11-22T00:00:00Z' }),
    pr({ repo: 'somi', number: 7, rollup: 'FAILURE', updatedAt: '2026-11-10T00:00:00Z' }),
    pr({ repo: 'somi', number: 8, rollup: 'ERROR', updatedAt: '2026-11-15T00:00:00Z' }),
    pr({ repo: 'rogue', number: 9, rollup: 'ERROR', updatedAt: '2026-11-15T00:00:00Z' }),
  ];
  const { pulls } = await readNodes(nodes);
  assert.deepEqual(pulls.map((p) => p.status), ['Needs attention', 'Needs attention', 'Needs attention', 'Needs attention', 'Needs attention', 'Ready to merge', 'Ready for review', 'Waiting', 'No CI']);
  assert.deepEqual(pulls.slice(0, 5).map((p) => `${p.repo}#${p.number}`), ['somi#6', 'rogue#9', 'somi#8', 'somi#7', 'somi#5']);
});

test('the order does not depend on the order GitHub returns', async () => {
  const nodes = [1, 2, 3].flatMap((n) => [pr({ repo: 'somi', number: n }), pr({ repo: 'rogue', number: n })]);
  const a = (await readNodes(nodes)).pulls.map((p) => `${p.repo}#${p.number}`);
  const b = (await readNodes([...nodes].reverse())).pulls.map((p) => `${p.repo}#${p.number}`);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice(0, 3).map((k) => k.split('#')[0]), ['rogue', 'rogue', 'rogue']);
});

test('the total is the count GitHub reports, at and past 100', async () => {
  const hundred = Array.from({ length: 100 }, (_, i) => pr({ number: i + 1 }));
  const at = await readNodes(hundred, 100);
  assert.equal(at.total, 100);
  assert.equal(at.pulls.length, 100);
  const past = await readNodes(hundred, 150);
  assert.equal(past.total, 150);
  assert.equal(past.pulls.length, 100);
  const one = await readNodes([pr()], 1);
  assert.equal(one.total, 1);
});

test('no more than 100 PRs are kept, whatever the response holds', async () => {
  const { pulls } = await readNodes(Array.from({ length: 101 }, (_, i) => pr({ number: i + 1 })), 101);
  assert.ok(pulls.length <= 100, `${pulls.length} rows`);
});

test('a title is kept up to 200 characters and cut past it', async () => {
  assert.equal((await only({ title: 'a'.repeat(200) })).title, 'a'.repeat(200));
  const long = 'b'.repeat(150) + 'c'.repeat(51);
  const cut = (await only({ title: long })).title;
  assert.ok(cut.length <= 200, `${cut.length} characters`);
  assert.ok(long.startsWith(cut.slice(0, 199)), 'the cut keeps the start of the title');
});

test('a login of 39 characters is kept, and a [bot] suffix is allowed on top', async () => {
  const login = 'a'.repeat(39);
  assert.equal((await only({ login })).author, login);
  assert.equal((await only({ login: `${login}[bot]` })).author, `${login}[bot]`);
});

test('no row carries a login past 39 characters plus [bot]', async () => {
  const { pulls } = await readNodes([pr({ number: 1, login: 'a'.repeat(40) }), pr({ number: 2, login: `${'b'.repeat(40)}[bot]` })]);
  for (const p of pulls) assert.ok(p.author.replace(/\[bot\]$/, '').length <= 39, p.author);
});

test('a PR whose url is not its own repo and number is dropped with a warning', async () => {
  const bad = [
    pr({ repo: 'somi', number: 2, url: 'https://github.com/skathio/rogue/pull/2' }),
    pr({ repo: 'somi', number: 3, url: 'https://github.com/skathio/somi/pull/4' }),
    pr({ repo: 'somi', number: 5, url: 'http://github.com/skathio/somi/pull/5' }),
    pr({ repo: 'somi', number: 6, url: 'https://github.com/other/somi/pull/6' }),
    pr({ repo: 'somi', number: 7, url: 'https://evil.example/skathio/somi/pull/7' }),
    pr({ repo: 'somi', number: 8, url: 'https://github.com/skathio/somi/pull/8/files' }),
    pr({ repo: 'somi', number: 9, url: 'javascript:alert(1)' }),
  ];
  const { pulls, warnings } = await readNodes([pr({ repo: 'somi', number: 1 }), ...bad]);
  assert.deepEqual(pulls.map((p) => p.number), [1]);
  assert.ok(warnings.length >= 1, 'warned');
});

const failures = {
  'an HTTP error': () => json({ message: 'boom' }, 500),
  'a GraphQL errors array': () => json({ errors: [{ message: 'rate limited' }], data: null }),
  'an errors array next to partial data': () => json({ errors: [{ message: 'partial' }], ...body([pr()]) }),
  'a body that is not JSON': () => new Response('<html>', { status: 200 }),
  'no data': () => json({ data: null }),
  'no search': () => json({ data: {} }),
  'nodes that are not a list': () => json({ data: { search: { issueCount: 1, nodes: 'x' } } }),
  'a body over the size cap': () => json({ data: { search: { issueCount: 0, nodes: [], pad: 'a'.repeat(2 * MB) } } }),
};

for (const [name, respond] of Object.entries(failures)) {
  test(`a read that fails with ${name} gives no list and one warning, and does not throw`, async () => {
    const { pulls, warnings } = await read(respond);
    assert.equal(pulls, null);
    assert.equal(warnings.length, 1, warnings.join('\n'));
  });
}

test('a read with no token gives no list and one warning, and does not throw', async () => {
  // GitHub's GraphQL API refuses an unauthenticated request.
  const respond = (url, init) => (init.headers.Authorization ? json(body([pr()])) : json({ message: 'Requires authentication' }, 401));
  const { pulls, warnings } = await read(respond, { token: undefined });
  assert.equal(pulls, null);
  assert.equal(warnings.length, 1, warnings.join('\n'));
});

test('the fixture covers every status and shows only public listed projects\' PRs', async () => {
  const warnings = [];
  const warn = (r, m) => warnings.push(`${r}: ${m}`);
  const client = fixtureClient(fixture);
  const listed = await collect({ client, org: 'skathio' });
  const { pulls } = await collectPulls({ client, org: 'skathio', projects: listed.projects, warn });
  const shown = new Set(listed.projects.filter((p) => !p.private).map((p) => p.repo));
  assert.ok(Array.isArray(pulls));
  for (const p of pulls) assert.ok(shown.has(p.repo), `${p.repo}#${p.number}`);
  const statuses = new Set(pulls.map((p) => p.status));
  for (const s of ['Needs attention', 'Ready to merge', 'Ready for review', 'Waiting', 'No CI']) assert.ok(statuses.has(s), s);
  assert.ok(warnings.length >= 1, 'the bad URL warns');
});

test('the fixture build still succeeds', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-prs-'));
  const run = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--fixture', 'test/fixtures/org.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
});
