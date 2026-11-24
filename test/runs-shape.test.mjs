// What a wrong shape means for the default-branch runs read: a response without a list of runs
// makes the repo unread, and a single run that cannot be placed in its workflow's history is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRuns } from '../src/collect.mjs';

const ORG = 'skathio';
const run = (id, minute, conclusion, extra = {}) => ({
  id, name: 'CI', path: '.github/workflows/ci.yml', event: 'push', conclusion,
  created_at: `2026-11-20T10:${String(minute).padStart(2, '0')}:00Z`,
  html_url: `https://github.com/${ORG}/somi/actions/runs/${id}`,
  head_repository: { full_name: `${ORG}/somi` }, ...extra,
});

async function read(answer, branch = 'main') {
  const paths = [];
  const warnings = [];
  const client = { json: async (p) => { paths.push(p); return answer; } };
  const out = await collectRuns({ client, org: ORG, projects: [{ repo: 'somi', private: false }], defaultBranches: { somi: branch }, warn: (r, m) => warnings.push(`${r}: ${m}`) });
  return { ...out, paths, warnings };
}

for (const [label, answer] of [['null', null], ['a list', []], ['no workflow_runs', { total_count: 0 }], ['workflow_runs not a list', { workflow_runs: {} }]]) {
  test(`a runs response that is ${label} makes the repo unread`, async () => {
    const { failing, unread, warnings } = await read(answer);
    assert.deepEqual(failing, []);
    assert.deepEqual(unread, ['somi']);
    assert.equal(warnings.length, 1);
  });
}

test('a run that is not an object, or has no time or path, is left out and clears nothing', async () => {
  const { failing, unread } = await read({ workflow_runs: [null, 'x', run(2, 5, 'success', { created_at: 'soon' }), run(3, 6, 'success', { path: null }), run(1, 1, 'failure')] });
  assert.deepEqual(failing.map((r) => r.url), [`https://github.com/${ORG}/somi/actions/runs/1`]);
  assert.deepEqual(unread, []);
});

test('the branch name is encoded into the query', async () => {
  const { paths } = await read({ workflow_runs: [] }, 'a&b#c');
  assert.deepEqual(paths, [`/repos/${ORG}/somi/actions/runs?branch=a%26b%23c&status=completed&per_page=100`]);
});

test('a group whose newest run has no name shows its path', async () => {
  const { failing } = await read({ workflow_runs: [run(1, 1, 'failure', { name: 7 })] });
  assert.equal(failing[0].workflow, '.github/workflows/ci.yml');
});
