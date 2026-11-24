// Default-branch workflow runs read at build time for /ci/: who is read, which runs count, how
// they group, when a group is failing, what a failing row carries, the order, and how a failed
// read degrades. The contract under test:
//   collect({ client, org }) -> { ..., defaultBranches }: each repo's default branch, from the
//     repo list collect already reads;
//   collectRuns({ client, org, projects, defaultBranches, warn }) -> { failing, unread }
//     (from src/runs.mjs, re-exported by collect.mjs);
//   failing: the rows, newest failure first;
//   unread: the names of the repos whose runs could not be read;
//   a row: { repo, workflow, event, since, count, url }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as collector from '../src/collect.mjs';
import { fixtureClient } from '../src/build.mjs';

const ORG = 'skathio';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/org.json', import.meta.url), 'utf8'));
// Read through the module object, so one missing export fails its own tests and not the whole file.
const collectRuns = (args) => collector.collectRuns(args);

const runsPath = (repo, branch = 'main') => `/repos/${ORG}/${repo}/actions/runs?branch=${branch}&status=completed&per_page=100`;
const actionsUrl = (repo, id) => `https://github.com/${ORG}/${repo}/actions/runs/${id}`;

// A run as GitHub's REST API returns it. minute orders created_at; a later minute is newer.
let nextId = 1000;
const run = (f = {}) => {
  const repo = f.repo ?? 'somi';
  const id = f.id ?? nextId++;
  return {
    id,
    name: f.name ?? 'CI',
    path: f.path ?? '.github/workflows/ci.yml',
    event: f.event ?? 'push',
    status: 'completed',
    conclusion: 'conclusion' in f ? f.conclusion : 'failure',
    created_at: `2026-11-20T10:${String(f.minute ?? 0).padStart(2, '0')}:00Z`,
    html_url: f.url ?? actionsUrl(repo, id),
    head_repository: 'head' in f ? f.head : { full_name: `${ORG}/${repo}` },
  };
};
const at = (minute) => `2026-11-20T10:${String(minute).padStart(2, '0')}:00Z`;

// A fake client that serves the repo list, an opt-in manifest for private repos, no releases,
// and each repo's runs. runs[repo] is a list of runs, an Error to throw, or any other answer.
function fakeClient({ repos, runs = {} }) {
  const paths = [];
  const runsOf = (name) => {
    const r = runs[name] ?? [];
    if (r instanceof Error) throw r;
    return Array.isArray(r) ? { total_count: r.length, workflow_runs: r } : r;
  };
  const routes = [
    [/^\/orgs\/[^/]+\/repos\?.*page=(\d+)/, (m) => (m[1] === '1' ? repos : [])],
    [/\/contents\//, () => ({ encoding: 'base64', content: Buffer.from('{}').toString('base64') })],
    [/\/releases\/latest$/, () => null],
    [/\/releases\?/, () => []],
    [/^\/repos\/[^/]+\/([^/]+)\/actions\/runs\?/, (m) => runsOf(m[1])],
  ];
  const json = async (p) => {
    paths.push(p);
    for (const [re, answer] of routes) {
      const m = re.exec(p);
      if (m) return answer(m);
    }
    throw new Error(`no answer for ${p}`);
  };
  return { client: { json, bytes: async () => { throw new Error('HTTP 404'); }, graphql: async () => ({}) }, paths };
}

const repo = (name, extra = {}) => ({ name, private: false, default_branch: 'main', html_url: `https://github.com/${ORG}/${name}`, ...extra });

// Runs collect and then collectRuns over one fake client, as the build does.
async function read(runs, repos = Object.keys(runs).map((n) => repo(n)), projects) {
  const { client, paths } = fakeClient({ repos, runs });
  const warnings = [];
  const warn = (r, m) => warnings.push({ repo: r, msg: m });
  const got = await collector.collect({ client, org: ORG });
  const out = await collectRuns({ client, org: ORG, projects: projects ?? got.projects, defaultBranches: got.defaultBranches, warn });
  return { ...out, warnings, paths, defaultBranches: got.defaultBranches };
}
const one = async (runs) => (await read({ somi: runs })).failing;

test('collect returns each repo\'s default branch from the repo list', async () => {
  const { defaultBranches } = await read({ somi: [], rogue: [] }, [repo('somi', { default_branch: 'trunk' }), repo('rogue')]);
  const get = (n) => (defaultBranches instanceof Map ? defaultBranches.get(n) : defaultBranches?.[n]);
  assert.equal(get('somi'), 'trunk');
  assert.equal(get('rogue'), 'main');
});

test('the runs read is the 100 most recent completed runs on the default branch', async () => {
  const { paths } = await read({ somi: [], rogue: [] }, [repo('somi', { default_branch: 'trunk' }), repo('rogue')]);
  const runReads = paths.filter((p) => p.includes('/actions/runs'));
  assert.deepEqual(runReads.sort(), [runsPath('rogue'), runsPath('somi', 'trunk')]);
});

test('only listed public projects are read; a private one never shows, not even as unread', async () => {
  const failing = [run({ repo: 'secret' })];
  const { failing: rows, unread, paths } = await read({ secret: failing, somi: [run()] }, [repo('secret', { private: true, visibility: 'private' }), repo('somi')]);
  assert.ok(!paths.some((p) => p.includes('/secret/actions')), 'a private repo\'s runs are never requested');
  assert.deepEqual(rows.map((r) => r.repo), ['somi']);
  assert.ok(!unread.includes('secret'));
});

test('a project counts only when private is exactly false', async () => {
  const projects = [{ repo: 'somi', name: 'SoMi' }, { repo: 'rogue', name: 'Rogue', private: 'false' }, { repo: 'bento', name: 'Bento', private: false }];
  const { failing } = await read({ somi: [run({ repo: 'somi' })], rogue: [run({ repo: 'rogue' })], bento: [run({ repo: 'bento' })] }, undefined, projects);
  assert.deepEqual(failing.map((r) => r.repo), ['bento']);
});

test('no projects, no rows and nothing unread', async () => {
  const { failing, unread } = await read({}, [], []);
  assert.deepEqual(failing, []);
  assert.deepEqual(unread, []);
});

test('a repo with no runs has no rows and is not unread', async () => {
  const { failing, unread } = await read({ somi: [] });
  assert.deepEqual(failing, []);
  assert.deepEqual(unread, []);
});

for (const event of ['push', 'schedule', 'workflow_dispatch', 'repository_dispatch', 'dynamic', 'workflow_run', 'release']) {
  test(`a failing ${event} run counts`, async () => {
    const rows = await one([run({ event })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, event);
  });
}

for (const event of ['pull_request', 'pull_request_target', 'merge_group', 'something_new']) {
  test(`a failing ${event} run is left out`, async () => {
    assert.deepEqual(await one([run({ event })]), []);
  });
}

test('a run from another repository, or with no head repository, is left out', async () => {
  assert.deepEqual(await one([run({ head: { full_name: 'someone/somi' } })]), []);
  assert.deepEqual(await one([run({ head: null })]), []);
  assert.deepEqual(await one([run({ head: { full_name: `${ORG}/rogue` } })]), []);
});

test('a newer run that does not count does not clear a failure', async () => {
  const rows = await one([
    run({ minute: 1, conclusion: 'failure' }),
    run({ minute: 2, event: 'pull_request', conclusion: 'success' }),
    run({ minute: 3, head: { full_name: 'fork/somi' }, conclusion: 'success' }),
  ]);
  assert.equal(rows.length, 1);
});

for (const conclusion of ['failure', 'timed_out', 'startup_failure']) {
  test(`a newest run with conclusion ${conclusion} is failing`, async () => {
    assert.equal((await one([run({ minute: 1, conclusion: 'success' }), run({ minute: 2, conclusion })])).length, 1);
  });
}

test('a newer run that passed clears the failure', async () => {
  assert.deepEqual(await one([run({ minute: 1 }), run({ minute: 2, conclusion: 'success' })]), []);
});

for (const conclusion of ['cancelled', 'skipped', 'neutral', 'action_required', 'stale', 'mystery', null]) {
  test(`a newer run with conclusion ${conclusion} does not clear the failure`, async () => {
    const failed = run({ minute: 1 });
    const rows = await one([run({ minute: 0, conclusion: 'success' }), failed, run({ minute: 2, conclusion })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, actionsUrl('somi', failed.id));
    assert.equal(rows[0].count, 1);
  });
}

test('runs with no verdict are passed over, and the streak counts only failures since the last pass', async () => {
  const first = run({ minute: 2 });
  const last = run({ minute: 5, conclusion: 'timed_out' });
  const rows = await one([
    run({ minute: 0 }),
    run({ minute: 1, conclusion: 'success' }),
    first,
    run({ minute: 3, conclusion: 'cancelled' }),
    run({ minute: 4, conclusion: 'skipped' }),
    last,
    run({ minute: 6, conclusion: 'cancelled' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].url, actionsUrl('somi', last.id));
  assert.equal(Date.parse(rows[0].since), Date.parse(first.created_at));
});

test('a group with no failure and no pass is not failing', async () => {
  assert.deepEqual(await one([run({ minute: 1, conclusion: 'cancelled' }), run({ minute: 2, conclusion: 'skipped' })]), []);
});

test('newest is decided by created_at, not by the order of the list', async () => {
  assert.deepEqual(await one([run({ minute: 1 }), run({ minute: 2, conclusion: 'success' })].reverse()), []);
  assert.equal((await one([run({ minute: 2 }), run({ minute: 1, conclusion: 'success' })])).length, 1);
});

test('runs are grouped by workflow path', async () => {
  const rows = await one([
    run({ minute: 1, path: '.github/workflows/ci.yml', name: 'CI' }),
    run({ minute: 2, path: '.github/workflows/ci.yml', name: 'CI renamed', conclusion: 'success' }),
    run({ minute: 3, path: '.github/workflows/nightly.yml', name: 'Nightly' }),
  ]);
  assert.deepEqual(rows.map((r) => r.workflow), ['Nightly']);
});

test('each Dependabot ecosystem is its own group, whatever its update number', async () => {
  const path = 'dynamic/dependabot/dependabot-updates';
  const rows = await one([
    run({ minute: 1, event: 'dynamic', path, name: 'npm_and_yarn in /. - Update #11' }),
    run({ minute: 2, event: 'dynamic', path, name: 'npm_and_yarn in /. - Update #12', conclusion: 'success' }),
    run({ minute: 3, event: 'dynamic', path, name: 'github_actions in /. - Update #5' }),
  ]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].workflow, /^github_actions in \/\./);
});

test('a Dependabot job named for packages is in its ecosystem and directory group, so a later pass clears it', async () => {
  const path = 'dynamic/dependabot/dependabot-updates';
  assert.deepEqual(await one([
    run({ minute: 1, event: 'dynamic', path, name: 'npm_and_yarn in /site for @vitejs/plugin-react, vite - Update #1726687800' }),
    run({ minute: 2, event: 'dynamic', path, name: 'npm_and_yarn in /site - Update #1726687706', conclusion: 'success' }),
  ]), []);
  const rows = await one([
    run({ minute: 1, event: 'dynamic', path, name: 'npm_and_yarn in /site - Update #1' }),
    run({ minute: 2, event: 'dynamic', path, name: 'npm_and_yarn in /site for vite - Update #2', conclusion: 'success' }),
    run({ minute: 3, event: 'dynamic', path, name: 'npm_and_yarn in / for vite - Update #3' }),
  ]);
  assert.equal(rows.length, 1, 'another directory is another group');
  assert.match(rows[0].workflow, /^npm_and_yarn in \/ for vite/);
});

test('a dynamic run on another path is another group', async () => {
  const rows = await one([
    run({ minute: 1, event: 'dynamic', path: 'dynamic/pages/pages-build-deployment', name: 'pages build and deployment' }),
    run({ minute: 2, event: 'dynamic', path: 'dynamic/dependabot/dependabot-updates', name: 'pages build and deployment', conclusion: 'success' }),
  ]);
  assert.equal(rows.length, 1);
});

test('a single failed run: since is its time, the streak is one, the link is the run', async () => {
  const [row] = await one([run({ id: 42, minute: 7, name: 'CI' })]);
  assert.equal(row.repo, 'somi');
  assert.equal(row.workflow, 'CI');
  assert.equal(row.event, 'push');
  assert.equal(Date.parse(row.since), Date.parse(at(7)));
  assert.equal(row.count, 1);
  assert.equal(row.url, actionsUrl('somi', 42));
});

test('the streak is the unbroken failures ending at the newest run; the link is the newest', async () => {
  const [row] = await one([
    run({ minute: 1, conclusion: 'failure' }),
    run({ minute: 2, conclusion: 'success' }),
    run({ minute: 3, conclusion: 'timed_out' }),
    run({ minute: 4, event: 'pull_request', conclusion: 'success' }),
    run({ minute: 5, conclusion: 'startup_failure' }),
    run({ id: 77, minute: 6, conclusion: 'failure' }),
  ]);
  assert.equal(Date.parse(row.since), Date.parse(at(3)));
  assert.equal(row.count, 3);
  assert.equal(row.url, actionsUrl('somi', 77));
});

test('a streak of 100 failures counts 100, from the oldest of them', async () => {
  const runs = Array.from({ length: 100 }, (_, i) => run({ minute: i % 60, conclusion: 'failure' }));
  runs.forEach((r, i) => { r.created_at = new Date(Date.UTC(2026, 10, 20) + (100 - i) * 60000).toISOString(); });
  const [row] = await one(runs);
  assert.equal(row.count, 100);
  assert.equal(Date.parse(row.since), Date.UTC(2026, 10, 20) + 60000);
});

test('only 100 runs are read, even if more come back', async () => {
  const runs = Array.from({ length: 101 }, () => run({ conclusion: 'failure' }));
  runs.forEach((r, i) => { r.created_at = new Date(Date.UTC(2026, 10, 20) + (101 - i) * 60000).toISOString(); });
  const [row] = await one(runs);
  assert.equal(row.count, 100);
});

test('the workflow name loses control and bidi characters', async () => {
  const [row] = await one([run({ name: 'C‮I\u0007 ⁦build⁩‏' })]);
  assert.equal(row.workflow, 'CI build');
});

test('the workflow name is cut to 100 characters, hidden ones not counted', async () => {
  const name = (n) => 'x'.repeat(n);
  assert.equal((await one([run({ name: name(100) })]))[0].workflow, name(100));
  assert.equal((await one([run({ name: name(101) })]))[0].workflow, name(100));
  assert.equal((await one([run({ name: `‮${name(100)}\u0000` })]))[0].workflow, name(100));
});

test('a cut never leaves half a surrogate pair', async () => {
  const [row] = await one([run({ name: `${'x'.repeat(99)}\u{1F600}` })]);
  assert.ok(!/[\uD800-\uDBFF]$/.test(row.workflow));
  assert.ok(row.workflow.length <= 100);
});

const badLinks = [
  ['another host', { id: 5, url: 'https://evil.example/skathio/somi/actions/runs/5' }],
  ['another repo', { id: 5, url: actionsUrl('rogue', 5) }],
  ['another id', { id: 5, url: actionsUrl('somi', 6) }],
  ['http', { id: 5, url: 'http://github.com/skathio/somi/actions/runs/5' }],
  ['a trailing path', { id: 5, url: `${actionsUrl('somi', 5)}/attempts/1` }],
  ['id 0', { id: 0 }],
  ['a negative id', { id: -3 }],
  ['a fractional id', { id: 1.5 }],
  ['an id past the safe integers', { id: 2 ** 53 }],
  ['a string id', { id: '12' }],
];
for (const [label, f] of badLinks) {
  test(`a failing run with ${label} drops its row with a warning`, async () => {
    const { failing, warnings } = await read({ somi: [run(f)], rogue: [run({ repo: 'rogue' })] });
    assert.deepEqual(failing.map((r) => r.repo), ['rogue']);
    assert.ok(warnings.some((w) => w.repo === 'somi'), 'warned for the repo');
  });
}

test('the largest safe-integer id is accepted', async () => {
  const [row] = await one([run({ id: Number.MAX_SAFE_INTEGER })]);
  assert.equal(row.url, actionsUrl('somi', Number.MAX_SAFE_INTEGER));
});

test('rows are sorted newest failure first, then by repo, then by workflow', async () => {
  const { failing } = await read({
    somi: [run({ repo: 'somi', minute: 5, path: 'a.yml', name: 'Beta' }), run({ repo: 'somi', minute: 5, path: 'b.yml', name: 'Alpha' }), run({ repo: 'somi', minute: 1, path: 'c.yml', name: 'Aaa' })],
    bento: [run({ repo: 'bento', minute: 5, path: 'z.yml', name: 'Zeta' }), run({ repo: 'bento', minute: 9, path: 'y.yml', name: 'Yota' })],
  });
  assert.deepEqual(failing.map((r) => `${r.repo}/${r.workflow}`), ['bento/Yota', 'bento/Zeta', 'somi/Alpha', 'somi/Beta', 'somi/Aaa']);
});

test('a repo whose runs cannot be read warns, is named unread, and the others still show', async () => {
  const { failing, unread, warnings } = await read({ somi: new Error('GET runs: HTTP 403'), rogue: [run({ repo: 'rogue' })] });
  assert.deepEqual(failing.map((r) => r.repo), ['rogue']);
  assert.deepEqual(unread, ['somi']);
  assert.ok(warnings.some((w) => w.repo === 'somi'));
});

test('a repo with no default branch is named unread with a warning', async () => {
  const { failing, unread, warnings } = await read({ somi: [run()], rogue: [run({ repo: 'rogue' })] }, [repo('somi', { default_branch: undefined }), repo('rogue')]);
  assert.deepEqual(failing.map((r) => r.repo), ['rogue']);
  assert.deepEqual(unread, ['somi']);
  assert.ok(warnings.some((w) => w.repo === 'somi'));
});

test('every unread repo is named', async () => {
  const { unread } = await read({ somi: new Error('HTTP 500'), rogue: new Error('HTTP 502'), bento: [] });
  assert.deepEqual([...unread].sort(), ['rogue', 'somi']);
});

// The fixture build: the runs the fixture serves, and what comes of them.
async function readFixture() {
  const base = fixtureClient(fixture);
  const served = [];
  const client = { ...base, async json(p, o) { const r = await base.json(p, o); if (p.includes('/actions/runs')) served.push(...(r?.workflow_runs ?? [])); return r; } };
  const got = await collector.collect({ client, org: ORG });
  const warnings = [];
  const out = await collectRuns({ client, org: ORG, projects: got.projects, defaultBranches: got.defaultBranches, warn: (r, m) => warnings.push(`${r}: ${m}`) });
  return { ...out, warnings, served };
}

test('the fixture shows the failing push and Dependabot rows only', async () => {
  const { failing, unread } = await readFixture();
  assert.deepEqual(failing.map((r) => r.event).sort(), ['dynamic', 'push']);
  assert.deepEqual(unread, []);
});

test('the fixture\'s bad run URL is the one runs warning', async () => {
  const { warnings, served } = await readFixture();
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.ok(served.some((r) => typeof r.html_url === 'string' && !/^https:\/\/github\.com\/skathio\/[^/]+\/actions\/runs\/\d+$/.test(r.html_url)), 'a run with a bad URL is served');
});

test('the fixture serves the runs that must not show', async () => {
  const { served } = await readFixture();
  const failed = (r) => r.conclusion === 'failure';
  assert.ok(served.some((r) => r.event === 'pull_request' && failed(r)), 'a pull_request failure');
  assert.ok(served.some((r) => typeof r.head_repository?.full_name === 'string' && !r.head_repository.full_name.startsWith(`${ORG}/`)), 'a run from a fork');
  const passedLater = (f) => served.some((r) => r.path === f.path && r.event === 'push' && r.conclusion === 'success' && Date.parse(r.created_at) > Date.parse(f.created_at));
  assert.ok(served.some((r) => r.event === 'push' && failed(r) && passedLater(r)), 'a workflow that failed and then passed');
});
