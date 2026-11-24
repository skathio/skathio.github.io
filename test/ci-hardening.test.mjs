// Defences around the /ci/ page and the ci-rules settings script that go beyond the request:
// a workflow that no longer exists keeps no row; the script never writes through a redirect,
// never puts a ruleset on a repo GitHub answers for under another name, never trusts a fork's
// PR as proof a check runs, and treats '.' and '..' as repos that are not there. Also the repo
// hygiene that keeps local tool state out of commits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectRuns } from '../src/collect.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORG = 'skathio';
const CHECK = 'ci / passed';
const TOKEN = 'ghp_fakeHardeningTokenNeverPrinted';

// ---- Workflow runs: a renamed or removed workflow's failure is not shown.

let nextId = 5000;
const run = (f = {}) => {
  const id = nextId++;
  return {
    id,
    name: f.name ?? 'CI',
    path: f.path ?? '.github/workflows/ci.yml',
    event: f.event ?? 'push',
    status: 'completed',
    conclusion: f.conclusion ?? 'failure',
    created_at: `2026-11-20T10:${String(f.minute ?? 0).padStart(2, '0')}:00Z`,
    html_url: `https://github.com/${ORG}/somi/actions/runs/${id}`,
    head_repository: { full_name: `${ORG}/somi` },
  };
};
const workflow = (p, state = 'active') => ({ id: nextId++, name: p, path: p, state });

// workflows is the list GitHub serves, an Error to throw, or any other answer.
async function read(runs, workflows) {
  const paths = [];
  const warnings = [];
  const client = {
    async json(p) {
      paths.push(p);
      if (p.includes('/actions/runs?')) return { total_count: runs.length, workflow_runs: runs };
      if (p.includes('/actions/workflows')) {
        if (workflows instanceof Error) throw workflows;
        return Array.isArray(workflows) ? { total_count: workflows.length, workflows } : workflows;
      }
      throw new Error(`no answer for ${p}`);
    },
  };
  const out = await collectRuns({ client, org: ORG, projects: [{ repo: 'somi', private: false }], defaultBranches: { somi: 'main' }, warn: (r, m) => warnings.push(m) });
  return { ...out, paths, warnings };
}
const shown = (out) => out.failing.map((r) => r.workflow).sort();

test('a failing workflow whose file is gone from the workflow list keeps no row', async () => {
  const out = await read([run({ name: 'Old', path: '.github/workflows/old.yml' }), run({ name: 'CI' })], [workflow('.github/workflows/ci.yml')]);
  assert.deepEqual(shown(out), ['CI']);
  assert.deepEqual(out.unread, []);
});

test('a failing workflow GitHub lists as deleted keeps no row', async () => {
  const out = await read([run({ name: 'Old', path: '.github/workflows/old.yml' }), run({ name: 'CI' })], [workflow('.github/workflows/old.yml', 'deleted'), workflow('.github/workflows/ci.yml')]);
  assert.deepEqual(shown(out), ['CI']);
});

test('a renamed workflow file drops the old path\'s row and keeps the new one', async () => {
  const runs = [run({ name: 'Build', path: '.github/workflows/build.yml', minute: 1 }), run({ name: 'Build', path: '.github/workflows/ci.yml', minute: 2 })];
  const out = await read(runs, [workflow('.github/workflows/build.yml', 'deleted'), workflow('.github/workflows/ci.yml')]);
  assert.equal(out.failing.length, 1);
  assert.match(out.failing[0].url, new RegExp(`/${runs[1].id}$`));
});

test('a Dependabot dynamic group shows though its path is not a workflow file', async () => {
  const out = await read([run({ name: 'npm in / - Update #12', path: 'dynamic/dependabot/dependabot-updates', event: 'dynamic' })], [workflow('.github/workflows/ci.yml')]);
  assert.deepEqual(shown(out), ['npm in / - Update #12']);
});

for (const [label, workflows] of [['cannot be read', new Error('HTTP 500')], ['has the wrong shape', { workflows: 'x' }], ['is null', null], ['is cut short of total_count', { total_count: 101, workflows: [] }]]) {
  test(`when the workflow list ${label}, every failure still shows, with no warning`, async () => {
    const out = await read([run({ name: 'Old', path: '.github/workflows/old.yml' })], workflows);
    assert.deepEqual(shown(out), ['Old']);
    assert.deepEqual(out.warnings, []);
    assert.deepEqual(out.unread, []);
  });
}

test('the workflow list is read only when a workflow file is failing', async () => {
  const green = await read([run({ conclusion: 'success' }), run({ event: 'dynamic', path: 'dynamic/pages/pages-build-deployment', name: 'pages' })], new Error('must not be read'));
  assert.ok(!green.paths.some((p) => p.includes('/actions/workflows')));
  const red = await read([run()], [workflow('.github/workflows/ci.yml')]);
  assert.deepEqual(red.paths.filter((p) => p.includes('/actions/workflows')), [`/repos/${ORG}/somi/actions/workflows?per_page=100`]);
});

// ---- The settings script, against a fake GitHub that can redirect and rename.
// These functions run inside the script's process, so they use nothing from this module.

function fakeAnswer(state, method, pathname) {
  const m = /^\/repos\/skathio\/([^/]+)(\/.*)?$/.exec(pathname);
  const repo = m && state.repos[decodeURIComponent(m[1])];
  if (!repo) return [404, { message: 'Not Found' }];
  const rest = m[2] ?? '';
  if (method !== 'GET') return repo.redirectWrites ? [307, null, `/repos/skathio/${repo.redirectWrites}${rest}`] : [201, { id: 9 }];
  const reads = [
    [/^$/, repo.info],
    [/^\/pulls$/, repo.pulls],
    [/^\/commits\/[^/]+\/check-runs$/, { check_runs: [{ name: 'ci / passed', status: 'completed', app: { id: 15368 } }] }],
    [/^\/rulesets$/, []],
  ];
  const hit = reads.find(([re]) => re.test(rest));
  return hit ? [200, hit[1]] : [404, { message: 'Not Found' }];
}

function installFake() {
  const state = JSON.parse(process.env.FAKE_STATE);
  const log = (entry) => appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\n');
  // Answers the way fetch does: a 3xx is followed unless redirect is 'error', which rejects.
  globalThis.fetch = async (input, init = {}) => {
    const method = init.method ?? 'GET';
    const pathname = new URL(input).pathname;
    log({ method, path: pathname, redirect: init.redirect ?? 'follow' });
    let [status, body, location] = fakeAnswer(state, method, pathname);
    if (location) {
      if (init.redirect === 'error') throw new TypeError('fetch failed: redirect');
      log({ method, path: location, followed: true });
      [status, body] = [201, { id: 9 }];
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

const FAKE_URL = 'data:text/javascript,' + encodeURIComponent(`import { appendFileSync } from 'node:fs';\n${fakeAnswer}\n${installFake}\ninstallFake();\n`);

const ownPull = (repo, f = {}) => ({ number: 1, state: 'open', updated_at: '2026-11-02T00:00:00Z', head: { sha: 'head1', repo: { full_name: `skathio/${repo}` }, ...f } });
function fakeRepo(name, f = {}) {
  return { info: { name, full_name: `skathio/${name}`, private: false, archived: false, fork: false, ...f.info }, pulls: f.pulls ?? [ownPull(name)], redirectWrites: f.redirectWrites };
}

function runScript(repos, config, args = ['--apply']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-hardening-'));
  const log = path.join(dir, 'log');
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(log, '');
  fs.writeFileSync(configFile, JSON.stringify(config));
  const env = { ...process.env, GH_TOKEN: TOKEN, FAKE_STATE: JSON.stringify({ repos }), FAKE_LOG: log };
  const res = spawnSync(process.execPath, ['--import', FAKE_URL, path.join(ROOT, 'scripts', 'ci-rules.mjs'), '--config', configFile, ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  const requests = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.rmSync(dir, { recursive: true, force: true });
  const out = `${res.stdout}${res.stderr}`;
  assert.ok(!out.includes(TOKEN), 'the token was printed');
  const lines = out.split('\n');
  return { status: res.status, out, requests, writes: requests.filter((r) => r.method !== 'GET'), lineFor: (repo) => lines.find((l) => l.startsWith(`${repo}: `)) ?? '' };
}

test('a write GitHub redirects fails as that repo\'s error, lands nowhere, and the others still apply', () => {
  const run = runScript({ alpha: fakeRepo('alpha', { redirectWrites: 'victim' }), victim: fakeRepo('victim'), beta: fakeRepo('beta') }, { repos: { alpha: [CHECK], beta: [CHECK] } });
  assert.equal(run.status, 1, run.out);
  assert.match(run.lineFor('alpha'), /^alpha: error: /);
  assert.ok(!run.requests.some((r) => r.path.startsWith('/repos/skathio/victim/') && r.method !== 'GET'), 'the write reached the redirect target');
  assert.ok(run.writes.every((w) => w.followed || w.redirect === 'error'), 'every write is sent with redirect: error');
  assert.match(run.lineFor('beta'), /^beta: create$/);
});

test('a config name GitHub answers for with another repo is refused, and the others still apply', () => {
  const renamed = fakeRepo('old-name', { info: { name: 'new-name', full_name: 'skathio/new-name' } });
  const run = runScript({ 'old-name': renamed, beta: fakeRepo('beta') }, { repos: { 'old-name': [CHECK], beta: [CHECK] } });
  assert.equal(run.status, 1, run.out);
  assert.match(run.lineFor('old-name'), /^old-name: refused: the repository is now "skathio\/new-name"$/);
  assert.ok(!run.writes.some((w) => w.path.includes('old-name') || w.path.includes('new-name')));
  assert.match(run.lineFor('beta'), /^beta: create$/);
});

test('a config name that differs from GitHub\'s only in case is the same repo', () => {
  const run = runScript({ Alpha: fakeRepo('alpha') }, { repos: { Alpha: [CHECK] } });
  assert.equal(run.status, 0, run.out);
  assert.match(run.lineFor('Alpha'), /^Alpha: create$/);
});

for (const [label, head] of [['a fork', { repo: { full_name: 'someone/alpha' } }], ['a deleted fork', { repo: null }]]) {
  test(`a check that ran only on ${label}'s PR has not run on a pull request yet`, () => {
    const run = runScript({ alpha: fakeRepo('alpha', { pulls: [ownPull('alpha', head)] }), beta: fakeRepo('beta') }, { repos: { alpha: [CHECK], beta: [CHECK] } });
    assert.equal(run.status, 1, run.out);
    assert.equal(run.lineFor('alpha'), `alpha: refused: check "${CHECK}" has not run on a pull request yet`);
    assert.ok(!run.requests.some((r) => r.path.includes('/alpha/commits/')), 'the fork\'s check runs were read');
    assert.match(run.lineFor('beta'), /^beta: create$/);
  });
}

test('a PR from the repo itself counts, whatever the case of its name', () => {
  const run = runScript({ alpha: fakeRepo('alpha', { pulls: [ownPull('alpha', { repo: { full_name: 'Skathio/Alpha' } })] }) }, { repos: { alpha: [CHECK] } });
  assert.equal(run.status, 0, run.out);
  assert.match(run.lineFor('alpha'), /^alpha: create$/);
});

test('"." and ".." pass the config and are refused as not found, without a request, while the others apply', () => {
  const run = runScript({ beta: fakeRepo('beta') }, { repos: { '.': [CHECK], '..': [CHECK], beta: [CHECK] } });
  assert.equal(run.status, 1, run.out);
  assert.equal(run.lineFor('.'), '.: refused: the repository was not found');
  assert.equal(run.lineFor('..'), '..: refused: the repository was not found');
  assert.ok(run.requests.every((r) => r.path.startsWith('/repos/skathio/beta')), run.requests.map((r) => r.path).join('\n'));
  assert.match(run.lineFor('beta'), /^beta: create$/);
});

// ---- Repo hygiene.

test('src/render.mjs ends with one newline, not a blank line', () => {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'render.mjs'), 'utf8');
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});
