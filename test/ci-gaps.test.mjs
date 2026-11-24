// Ends of the /ci/ rules the other tests leave open: a row always names its workflow, the page
// never reads as all clear when it was not told which repos could be read, and the settings
// script sees a ruleset as matching whatever order GitHub lists its checks in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectRuns } from '../src/collect.mjs';
import { renderCiPage } from '../src/ci-page.mjs';

const ORG = 'skathio';
const PATH = '.github/workflows/ci.yml';
const run = (name) => ({
  id: 1, name, path: PATH, event: 'push', conclusion: 'failure', created_at: '2026-11-20T10:00:00Z',
  html_url: `https://github.com/${ORG}/somi/actions/runs/1`, head_repository: { full_name: `${ORG}/somi` },
});

for (const [label, name] of [['is empty', ''], ['is only control and bidi characters', '‮\u0007‏']]) {
  test(`a failing workflow whose name ${label} shows its path`, async () => {
    const client = { json: async () => ({ workflow_runs: [run(name)] }) };
    const { failing } = await collectRuns({ client, org: ORG, projects: [{ repo: 'somi', private: false }], defaultBranches: { somi: 'main' } });
    assert.deepEqual(failing.map((r) => r.workflow), [PATH]);
  });
}

const page = (runs) => renderCiPage({ org: ORG, projects: [{ repo: 'somi', name: 'SoMi', private: false }], runs, readAt: '2026-11-24T09:05:00Z' });

for (const [label, runs] of [['left out', { failing: [] }], ['a string', { failing: [], unread: 'somi' }], ['null', { failing: [], unread: null }]]) {
  test(`with the unread list ${label} the page says the runs could not be read, not that nothing is failing`, () => {
    const html = page(runs);
    assert.ok(!html.includes('Nothing is failing'));
    assert.match(html, /Workflow runs could not be read at <time datetime="2026-11-24T09:05:00.000Z" data-local>/);
  });
}

test('with an empty unread list and no rows the page says nothing is failing', () => {
  assert.ok(page({ failing: [], unread: [] }).includes('Nothing is failing on the default branches.'));
});

// A fake GitHub for the settings script: one public repo whose newest PR ran the config's checks
// and whose ci-required lists the checks given, in that order. Any write is answered with a 500.
function fakeGithub() {
  const { ran, listed } = JSON.parse(process.env.FAKE_CHECKS);
  const app = { id: 15368 };
  const ruleset = {
    id: 77, name: 'ci-required', target: 'branch', enforcement: 'active', source_type: 'Repository',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: listed.map((context) => ({ context, integration_id: app.id })) } }],
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  };
  const answers = [
    [/\/rulesets\/77$/, ruleset],
    [/\/rulesets$/, [{ id: 77, name: 'ci-required', source_type: 'Repository' }]],
    [/\/check-runs$/, { check_runs: ran.map((name) => ({ name, status: 'completed', app })) }],
    [/\/pulls$/, [{ head: { sha: 'head1' } }]],
    [/\/repos\/skathio\/alpha$/, { private: false, archived: false, fork: false }],
  ];
  globalThis.fetch = async (input, init = {}) => {
    const hit = (init.method ?? 'GET') === 'GET' && answers.find(([at]) => at.test(new URL(input).pathname));
    return new Response(JSON.stringify(hit ? hit[1] : {}), { status: hit ? 200 : 500, headers: { 'content-type': 'application/json' } });
  };
}

function ciRules(config, listed) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const fake = 'data:text/javascript,' + encodeURIComponent(`${fakeGithub}\nfakeGithub();\n`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gaps-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ repos: { alpha: config } }));
  const env = { ...process.env, GH_TOKEN: 'ghp_fake', FAKE_CHECKS: JSON.stringify({ ran: config, listed }) };
  const res = spawnSync(process.execPath, ['--import', fake, `${root}scripts/ci-rules.mjs`, '--apply', '--config', file], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

test('a ci-required whose checks GitHub lists in another order is unchanged', () => {
  const res = ciRules(['ci / passed', 'ci / test'], ['ci / test', 'ci / passed']);
  assert.equal(res.stdout, 'alpha: unchanged\n', res.stderr);
  assert.equal(res.status, 0);
});

test('a ci-required with a different set of checks is still updated', () => {
  const res = ciRules(['ci / passed', 'ci / test'], ['ci / test', 'ci / other']);
  assert.equal(res.stdout, 'alpha: error: PUT /repos/skathio/alpha/rulesets/77: HTTP 500\n', res.stderr);
});
