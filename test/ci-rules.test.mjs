// The ci-rules settings script, run the way the maintainer runs it:
//   GH_TOKEN=... node scripts/ci-rules.mjs [--org skathio] [--config .github/ci-rules.json] [--apply]
// against a fake GitHub REST API, with no network. The fake replaces the global fetch in the script's
// process (through --import) and answers the way GitHub does: a repo, its pull requests (open and in
// created order unless asked otherwise), the check runs on a commit, its rulesets listed as summaries
// and read by id. It logs every request, so a test can tell what the script read and what it wrote.
// Also here: the starting config in .github/ci-rules.json, and the hashira pin in ci.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts', 'ci-rules.mjs');
const TOKEN = 'ghp_fakeTokenThatMustNeverBePrinted0123';
const CHECK = 'ci / passed';
const ACTIONS_APP = 15368;
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
const NOT_RUN = (name) => `refused: check "${name}" has not run on a pull request yet`;

// ---- The fake API. These functions run inside the script's process, so they use nothing from this module.

function reply(status, body) {
  return { status, body };
}

function sortPulls(pulls, query) {
  const key = query.get('sort') === 'updated' ? 'updated_at' : 'created_at';
  const sign = query.get('direction') === 'asc' ? 1 : -1;
  return [...pulls].sort((a, b) => sign * a[key].localeCompare(b[key]));
}

function listPulls(repo, query) {
  const want = query.get('state') ?? 'open';
  const pulls = repo.pulls.filter((p) => want === 'all' || p.state === want);
  return reply(200, sortPulls(pulls, query).slice(0, Number(query.get('per_page') ?? 30)));
}

function keepCheckRun(run, query) {
  const name = query.get('check_name');
  const status = query.get('status');
  return (!name || run.name === name) && (!status || run.status === status);
}

function listCheckRuns(repo, query, sha) {
  const runs = (repo.checks[sha] ?? []).filter((r) => keepCheckRun(r, query));
  return reply(200, { total_count: runs.length, check_runs: runs });
}

function listRulesets(repo) {
  return reply(200, repo.rulesets.map(({ id, name, target, enforcement, source_type, source }) => ({ id, name, target, enforcement, source_type, source })));
}

function getRuleset(repo, query, id) {
  const found = repo.rulesets.find((r) => String(r.id) === id);
  return found ? reply(200, found) : reply(404, { message: 'Not Found' });
}

function writeRuleset(repo, query, id, body) {
  return getRuleset(repo, query, id).status === 200 ? reply(200, { ...body, id: Number(id) }) : reply(404, { message: 'Not Found' });
}

function routes() {
  return [
    ['GET', /^$/, (repo) => reply(200, repo.info)],
    ['GET', /^\/pulls$/, listPulls],
    ['GET', /^\/commits\/([^/]+)\/check-runs$/, listCheckRuns],
    ['GET', /^\/rulesets$/, listRulesets],
    ['GET', /^\/rulesets\/(\d+)$/, getRuleset],
    ['POST', /^\/rulesets$/, (repo, query, id, body) => reply(201, { ...body, id: 9999 })],
    [null, /^\/rulesets\/(\d+)$/, writeRuleset],
  ];
}

function findRepo(state, url) {
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const repo = m && m[1] === state.org ? state.repos[decodeURIComponent(m[2])] : undefined;
  return repo ? { repo, rest: m[3] ?? '' } : null;
}

function answer(state, req) {
  const found = findRepo(state, req.url);
  if (!found) return reply(404, { message: 'Not Found' });
  if (found.repo.fail) return reply(500, { message: 'Server Error' });
  for (const [method, pattern, handle] of routes()) {
    const hit = pattern.exec(found.rest);
    if (hit && (!method || method === req.method)) return handle(found.repo, req.url.searchParams, hit[1], req.body);
  }
  return reply(404, { message: 'Not Found' });
}

async function readRequest(input, init) {
  const request = new Request(input, init);
  const text = await request.text();
  return { method: request.method, url: new URL(request.url), auth: request.headers.get('authorization') ?? '', body: text ? JSON.parse(text) : null };
}

function install() {
  const state = JSON.parse(readFileSync(process.env.FAKE_GITHUB_STATE, 'utf8'));
  globalThis.fetch = async (input, init = {}) => {
    const req = await readRequest(input, init);
    appendFileSync(process.env.FAKE_GITHUB_LOG, JSON.stringify({ method: req.method, path: req.url.pathname, auth: req.auth, body: req.body }) + '\n');
    const { status, body } = answer(state, req);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

const FAKE = [reply, sortPulls, listPulls, keepCheckRun, listCheckRuns, listRulesets, getRuleset, writeRuleset, routes, findRepo, answer, readRequest, install];
const FAKE_URL = 'data:text/javascript,' + encodeURIComponent(`import { readFileSync, appendFileSync } from 'node:fs';\n${FAKE.join('\n')}\ninstall();\n`);

// ---- Fake repos.

let nextId = 100;
const checkRun = (name, status = 'completed', conclusion = 'success') => ({ id: nextId++, name, status, conclusion, app: { id: ACTIONS_APP, slug: 'github-actions' } });
const pull = (number, state, [created, updated], sha) => ({ number, state, created_at: `2026-11-0${created}T12:00:00Z`, updated_at: `2026-11-0${updated}T12:00:00Z`, head: { sha } });
const actor = { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' };

// Another ruleset on the repo, such as somi's `main`: the script must leave it alone.
const OTHER = { id: 1, name: 'main', target: 'branch', enforcement: 'active', source_type: 'Repository', source: 'skathio/x', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, rules: [{ type: 'deletion' }], bypass_actors: [] };

// ci-required as GitHub returns it when it already matches the config's checks.
const ciRequired = (checks, change = {}) => ({
  id: 77, name: 'ci-required', target: 'branch', enforcement: 'active', source_type: 'Repository', source: 'skathio/x',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: checks.map((context) => ({ context, integration_id: ACTIONS_APP })) } }],
  bypass_actors: [actor], current_user_can_bypass: 'pull_requests_only', node_id: 'RRS_x', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  ...change,
});

// A repo the script accepts unless told otherwise: public, and its only PR's head ran every check.
function fakeRepo(name, f = {}) {
  const checks = f.checks ?? [CHECK];
  return {
    info: { name, full_name: `skathio/${name}`, private: false, archived: false, fork: false, visibility: 'public', default_branch: 'main', ...f.info },
    pulls: f.pulls ?? [pull(1, 'open', [1, 2], 'head1')],
    checks: f.runs ?? { head1: checks.map((c) => checkRun(c)) },
    rulesets: [OTHER, ...(f.rulesets ?? [])],
    fail: f.fail,
  };
}

// Runs the script against the fake. config is written to a temp file and passed as --config,
// unless it is left out. Every run checks the token never reaches the output.
function runScript({ repos = [], config, args = [], org = 'skathio' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rules-'));
  const file = (n) => path.join(dir, n);
  fs.writeFileSync(file('state.json'), JSON.stringify({ org, repos: Object.fromEntries(repos.map((r) => [r.info.name, r])) }));
  fs.writeFileSync(file('log'), '');
  if (config !== undefined) fs.writeFileSync(file('config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  const configArgs = config === undefined ? [] : ['--config', file('config.json')];
  const env = { ...process.env, GH_TOKEN: TOKEN, FAKE_GITHUB_STATE: file('state.json'), FAKE_GITHUB_LOG: file('log') };
  const res = spawnSync(process.execPath, ['--import', FAKE_URL, SCRIPT, ...configArgs, ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  const requests = fs.readFileSync(file('log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.rmSync(dir, { recursive: true, force: true });
  const out = `${res.stdout}${res.stderr}`;
  assert.ok(!out.includes(TOKEN), 'the token was printed');
  const lines = out.split('\n');
  return { status: res.status, out, requests, writes: requests.filter((r) => WRITES.includes(r.method)), lineFor: (repo) => lines.find((l) => l.includes(repo)) ?? '' };
}

const writesTo = (run, repo) => run.writes.filter((w) => w.path.startsWith(`/repos/skathio/${repo}/`));

// ---- The starting config, the pin and the workflows.

test('.github/ci-rules.json starts with exactly the six repos, each requiring "ci / passed"', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'ci-rules.json'), 'utf8'));
  assert.deepEqual(Object.keys(config), ['repos']);
  assert.deepEqual(Object.keys(config.repos).sort(), ['bento', 'hinokami', 'maneki', 'rogue', 'skathio.github.io', 'somi']);
  for (const checks of Object.values(config.repos)) assert.deepEqual(checks, [CHECK]);
});

test('ci.yml pins all three hashira refs to v3.1.0 and keeps the ci job permissions', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const lines = yml.split('\n');
  const refs = lines.map((l, i) => [l, i]).filter(([l]) => /skathio\/hashira\/\S+@/.test(l));
  assert.equal(refs.length, 3);
  for (const [l, i] of refs) {
    assert.match(l, /@1bd415e21fb070c46f07e05bfaa70e42c0531342\s*$/);
    assert.ok(lines.slice(i - 2, i).some((c) => c.trim() === '# skathio/hashira v3.1.0'), `no v3.1.0 comment above line ${i + 1}`);
  }
  assert.ok(!yml.includes('v3.0.0') && !yml.includes('2c8d52526cbce593a445f7572b599813503160f5'));
  const ciJob = /\n {2}ci:\n([\s\S]*?)\n {2}\S/.exec(yml)[1];
  const perms = /permissions:\n((?: {6}.*\n)+)/.exec(`${ciJob}\n`)[1];
  const granted = Object.fromEntries([...perms.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(granted, { contents: 'read', 'id-token': 'write', pages: 'write', 'pull-requests': 'write', 'security-events': 'write' });
});

test('no workflow runs the ci-rules script', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('ci-rules'), f);
});

// ---- Dry run and --apply.

const threeRepos = () => [fakeRepo('alpha'), fakeRepo('beta', { rulesets: [ciRequired([CHECK], { enforcement: 'evaluate' })] }), fakeRepo('gamma', { rulesets: [ciRequired([CHECK])] })];
const threeConfig = { repos: { alpha: [CHECK], beta: [CHECK], gamma: [CHECK] } };

test('by default the script is a dry run: it prints create, update or unchanged per repo and writes nothing', () => {
  const run = runScript({ repos: threeRepos(), config: threeConfig });
  assert.equal(run.status, 0, run.out);
  assert.match(run.lineFor('alpha'), /\bcreate\b/);
  assert.match(run.lineFor('beta'), /\bupdate\b/);
  assert.match(run.lineFor('gamma'), /\bunchanged\b/);
  assert.deepEqual(run.writes, []);
  assert.ok(run.requests.length > 0 && run.requests.every((r) => r.auth.includes(TOKEN)), 'the API calls carry GH_TOKEN');
});

test('--apply creates or updates only ci-required, with the ruleset the request gives', () => {
  const run = runScript({ repos: threeRepos(), config: threeConfig, args: ['--apply'] });
  assert.equal(run.status, 0, run.out);
  const [created] = writesTo(run, 'alpha');
  assert.equal(writesTo(run, 'alpha').length, 1);
  assert.equal(created.method, 'POST');
  assert.equal(created.path, '/repos/skathio/alpha/rulesets');
  const updated = writesTo(run, 'beta');
  assert.deepEqual(updated.map((w) => [w.method, w.path]), [['PUT', '/repos/skathio/beta/rulesets/77']]);
  assert.deepEqual(writesTo(run, 'gamma'), [], 'a matching ci-required is left unchanged');
  for (const { body } of [created, updated[0]]) {
    assert.equal(body.name, 'ci-required');
    assert.equal(body.target, 'branch');
    assert.equal(body.enforcement, 'active');
    assert.deepEqual(body.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
    assert.deepEqual(body.bypass_actors, [actor]);
    const rule = body.rules.find((r) => r.type === 'required_status_checks');
    assert.equal(rule.parameters.strict_required_status_checks_policy, true);
    assert.deepEqual(rule.parameters.required_status_checks, [{ context: CHECK, integration_id: ACTIONS_APP }]);
  }
  assert.ok(!run.requests.some((r) => /\/rulesets\/1$/.test(r.path)), 'another ruleset was read or written');
});

test('a ci-required that differs in any part the request sets is reported as update', () => {
  const differs = {
    enforcement: { enforcement: 'disabled' },
    target: { target: 'tag' },
    include: { conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } },
    bypass: { bypass_actors: [] },
    'bypass mode': { bypass_actors: [{ ...actor, bypass_mode: 'always' }] },
    checks: ciRequired(['other check']),
    'not strict': { rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: CHECK, integration_id: ACTIONS_APP }] } }] },
    'no app pin': { rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: CHECK }] } }] },
  };
  for (const [what, change] of Object.entries(differs)) {
    const run = runScript({ repos: [fakeRepo('alpha', { rulesets: [ciRequired([CHECK], change)] })], config: { repos: { alpha: [CHECK] } } });
    assert.match(run.lineFor('alpha'), /\bupdate\b/, what);
    assert.deepEqual(run.writes, [], what);
  }
});

// ---- Options and defaults.

test('--org names the org the script reads', () => {
  const run = runScript({ org: 'other-org', repos: [fakeRepo('alpha')], config: { repos: { alpha: [CHECK] } }, args: ['--org', 'other-org'] });
  assert.match(run.lineFor('alpha'), /\bcreate\b/);
  assert.ok(run.requests.length > 0 && run.requests.every((r) => r.path.startsWith('/repos/other-org/')));
});

test('without options the script reads .github/ci-rules.json for the skathio org', () => {
  const run = runScript({});
  const read = new Set(run.requests.map((r) => /^\/repos\/skathio\/([^/]+)/.exec(r.path)?.[1]));
  assert.deepEqual([...read].sort(), ['bento', 'hinokami', 'maneki', 'rogue', 'skathio.github.io', 'somi']);
  assert.equal(run.status, 1, 'none of the repos exist in the fake, so each is refused');
});

// ---- The config: exit 2 and nothing written when it is wrong; its limits hold at their ends.

const long = (n) => 'x'.repeat(n);
const tenChecks = Array.from({ length: 10 }, (_, i) => `check ${i}`);

test('a bad config exits 2 and changes nothing, even with --apply', () => {
  const bad = {
    'not JSON': '{"repos": ',
    'not an object': 'null',
    'a list': '[]',
    'a key other than repos': { repos: { beta: [CHECK] }, extra: true },
    'repos left out': {},
    'repos is a list': { repos: ['beta'] },
    'an empty repo name': { repos: { beta: [CHECK], '': [CHECK] } },
    'a repo name of 101 characters': { repos: { beta: [CHECK], [long(101)]: [CHECK] } },
    'a repo name with a slash': { repos: { beta: [CHECK], 'skathio/alpha': [CHECK] } },
    'a repo name with a space': { repos: { beta: [CHECK], 'al pha': [CHECK] } },
    'checks not a list': { repos: { beta: [CHECK], alpha: CHECK } },
    'no checks': { repos: { beta: [CHECK], alpha: [] } },
    'eleven checks': { repos: { beta: [CHECK], alpha: [...tenChecks, 'check 10'] } },
    'a repeated check': { repos: { beta: [CHECK], alpha: [CHECK, CHECK] } },
    'a check that is not a string': { repos: { beta: [CHECK], alpha: [5] } },
    'an empty check name': { repos: { beta: [CHECK], alpha: [''] } },
    'a check name of 101 characters': { repos: { beta: [CHECK], alpha: [long(101)] } },
  };
  for (const [what, config] of Object.entries(bad)) {
    const run = runScript({ repos: [fakeRepo('alpha'), fakeRepo('beta')], config, args: ['--apply'] });
    assert.equal(run.status, 2, what);
    assert.deepEqual(run.writes, [], what);
  }
});

test('a repo is accepted at each limit and with a check that ran on the newest-updated PR', () => {
  const ok = {
    'one check': fakeRepo('alpha', { checks: [CHECK] }),
    'ten checks': fakeRepo('alpha', { checks: tenChecks }),
    'a check name of 100 characters': fakeRepo('alpha', { checks: [long(100)] }),
    'a repo name of 100 characters': fakeRepo(long(100)),
    'a closed PR updated most recently': fakeRepo('alpha', { pulls: [pull(1, 'closed', [1, 9], 'old'), pull(2, 'open', [5, 6], 'new')], runs: { old: [checkRun(CHECK)] } }),
    'a completed check that failed': fakeRepo('alpha', { runs: { head1: [checkRun(CHECK, 'completed', 'failure')] } }),
  };
  for (const [what, repo] of Object.entries(ok)) {
    const checks = what === 'ten checks' ? tenChecks : repo.checks.head1?.map((c) => c.name) ?? [CHECK];
    const run = runScript({ repos: [repo], config: { repos: { [repo.info.name]: checks } } });
    assert.equal(run.status, 0, `${what}: ${run.out}`);
    assert.match(run.lineFor(repo.info.name), /\bcreate\b/, what);
  }
});

// ---- Refused repos: the others carry on, and the script exits 1 at the end.

test('a refused repo is skipped, the others still apply, and the script exits 1', () => {
  const refused = {
    missing: [null, /refused: \S/],
    private: [fakeRepo('alpha', { info: { private: true, visibility: 'private' } }), /refused: \S/],
    archived: [fakeRepo('alpha', { info: { archived: true } }), /refused: \S/],
    'a fork': [fakeRepo('alpha', { info: { fork: true } }), /refused: \S/],
    'no pull request yet': [fakeRepo('alpha', { pulls: [] }), NOT_RUN(CHECK)],
    'the check never ran': [fakeRepo('alpha', { runs: { head1: [] } }), NOT_RUN(CHECK)],
    'the check is still running': [fakeRepo('alpha', { runs: { head1: [checkRun(CHECK, 'in_progress', null)] } }), NOT_RUN(CHECK)],
    'only an older PR ran it': [fakeRepo('alpha', { pulls: [pull(1, 'open', [1, 9], 'new'), pull(2, 'closed', [5, 6], 'old')], runs: { old: [checkRun(CHECK)] } }), NOT_RUN(CHECK)],
    'one of two checks never ran': [fakeRepo('alpha', { checks: [CHECK] }), NOT_RUN('lint')],
  };
  for (const [what, [repo, reason]] of Object.entries(refused)) {
    const checks = what === 'one of two checks never ran' ? [CHECK, 'lint'] : [CHECK];
    const run = runScript({ repos: [repo, fakeRepo('beta')].filter(Boolean), config: { repos: { alpha: checks, beta: [CHECK] } }, args: ['--apply'] });
    assert.equal(run.status, 1, what);
    assert.ok(typeof reason === 'string' ? run.lineFor('alpha').includes(reason) : reason.test(run.lineFor('alpha')), `${what}: ${run.lineFor('alpha')}`);
    assert.deepEqual(writesTo(run, 'alpha'), [], what);
    assert.equal(writesTo(run, 'beta').length, 1, `${what}: the other repo still gets its ruleset`);
  }
});

test('the token is not printed when the API fails', () => {
  const run = runScript({ repos: [fakeRepo('alpha', { fail: true })], config: { repos: { alpha: [CHECK] } }, args: ['--apply'] });
  assert.ok(run.requests.length > 0, 'the script called the API');
  assert.ok(!run.out.includes(TOKEN));
});
