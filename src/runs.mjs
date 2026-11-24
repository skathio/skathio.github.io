// Unresolved workflow failures on the listed public projects' default branches, for the /ci/
// page. Who is listed is decided in collect.mjs: this reads only the projects collect returns,
// and re-exports through it.
//
// A failure is resolved when a later run of the same workflow on the default branch passes, so
// there is no age cutoff. Pull request runs and runs from other repositories never
// count: they say nothing about the default branch. Names are untrusted: they are cut here and
// escaped again in render.

import { cut, visible } from './pulls.mjs';

const RUN_LIMIT = 100;
const EVENTS = new Set(['push', 'schedule', 'workflow_dispatch', 'repository_dispatch', 'dynamic', 'workflow_run', 'release']);
// Unknown conclusions fall through: never a failure.
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// Only a run that passed resolves a failure. A cancelled, skipped, neutral or unknown run proved
// nothing about the branch, so it is passed over and the failure behind it still shows.
const PASSED = 'success';
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

const branchOf = (defaultBranches, repo) => (defaultBranches instanceof Map ? defaultBranches.get(repo) : defaultBranches?.[repo]);

// The runs list, or throws: without a list the repo's state is unknown, not green.
async function readRuns(client, org, repo, branch) {
  if (!REPO_NAME.test(repo)) throw new Error('the repo name is not a plain repo name');
  if (typeof branch !== 'string' || branch === '') throw new Error('its default branch is unknown');
  const res = await client.json(`/repos/${org}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=${RUN_LIMIT}`);
  if (!Array.isArray(res?.workflow_runs)) throw new Error('the response has no list of workflow runs');
  return res.workflow_runs.slice(0, RUN_LIMIT);
}

// The paths of the repo's live workflows, or null when they cannot be known. A null keeps every
// group: this list only removes rows, and a row shown too long is safer than a failure hidden.
// GitHub keeps a removed or renamed workflow's old file in the list, marked deleted.
async function liveWorkflows(client, org, repo) {
  let res;
  try {
    res = await client.json(`/repos/${org}/${repo}/actions/workflows?per_page=${RUN_LIMIT}`);
  } catch {
    return null;
  }
  const list = res?.workflows;
  if (!Array.isArray(list) || res.total_count !== list.length) return null;
  return new Set(list.filter((w) => w?.state !== 'deleted' && typeof w?.path === 'string').map((w) => w.path));
}

// A run that says something about the default branch, with its time, or null. A run whose time
// or workflow path is missing cannot be placed in a group's history, so it is left out.
function counted(run, org, repo) {
  if (!EVENTS.has(run?.event) || run.head_repository?.full_name !== `${org}/${repo}`) return null;
  const at = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
  if (Number.isNaN(at) || typeof run.path !== 'string') return null;
  return { run, at };
}

// Each Dependabot ecosystem runs on one dynamic path, told apart only by name: "<ecosystem> in
// <dir>", then " for <packages>" when the job updates named packages, then " - Update #<n>". The
// packages and the number change from run to run, so a later pass of the same ecosystem and
// directory must land in the same group to clear its failure.
const dependabotKey = (name) => name.replace(/ - Update #\d+$/, '').replace(/^(\S+ in \S+) for .*$/, '$1');
const groupKey = (run) => (run.event === 'dynamic'
  ? `${run.path}\n${typeof run.name === 'string' ? dependabotKey(run.name) : ''}`
  : run.path);

// A group's failures since its last pass (newest first), skipping runs with no verdict. Empty
// when its newest verdict is a pass, or when it has no failure at all.
function failuresSincePass(group) {
  const failed = [];
  for (const c of group) {
    if (c.run.conclusion === PASSED) break;
    if (FAILED.has(c.run.conclusion)) failed.push(c);
  }
  return failed;
}

// The row for a group (newest first), or null when it is not failing. The link is the newest
// failed run, and must be exactly that run's page, so a link can only ever point at a run on GitHub.
function failingRow(group, org, repo, warn) {
  const failed = failuresSincePass(group);
  if (!failed.length) return null;
  const { run, at } = failed[0];
  const url = `https://github.com/${org}/${repo}/actions/runs/${run.id}`;
  if (!Number.isSafeInteger(run.id) || run.id < 1 || run.html_url !== url) {
    warn(repo, `failing workflow run skipped: its URL is not ${url}`);
    return null;
  }
  return {
    repo,
    // A name with nothing left to show gives way to the path, so a row always says which workflow.
    workflow: cut((typeof run.name === 'string' && visible(run.name)) || visible(run.path), 100),
    event: run.event,
    since: new Date(failed[failed.length - 1].at).toISOString(),
    count: failed.length,
    url,
    at,
  };
}

// Each group's counted runs, newest first.
function groupRuns(runs, org, repo) {
  const groups = new Map();
  for (const c of runs.map((r) => counted(r, org, repo)).filter(Boolean)) {
    const key = groupKey(c.run);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => b.at - a.at));
}

// Dynamic runs have no workflow file, so the workflow list cannot speak for them.
const hasFile = (group) => group[0].run.event !== 'dynamic';

// The workflow list is read only when a file's workflow is failing, so a green repo costs no read.
async function failingRows({ client, org, repo, warn }, runs) {
  const groups = groupRuns(runs, org, repo);
  const live = groups.some((g) => hasFile(g) && failuresSincePass(g).length) ? await liveWorkflows(client, org, repo) : null;
  const shown = live ? groups.filter((g) => !hasFile(g) || live.has(g[0].run.path)) : groups;
  return shown.map((g) => failingRow(g, org, repo, warn)).filter(Boolean);
}

const newestFirst = (a, b) => b.at - a.at || a.repo.localeCompare(b.repo) || a.workflow.localeCompare(b.workflow);

// Returns { failing, unread }: failing is the rows, newest failure first; unread names each repo
// whose runs could not be read, so the page never claims all is green when it cannot know.
// defaultBranches is collect's, a Map or a plain object from repo name to branch.
export async function collectRuns({ client, org, projects, defaultBranches, warn = () => {} } = {}) {
  // Fail closed: only a project marked public, exactly, is read.
  const listed = Array.isArray(projects) ? projects : [];
  const repos = listed.filter((p) => p?.private === false && typeof p.repo === 'string').map((p) => p.repo);
  const rows = [];
  const unread = [];
  for (const repo of repos) {
    let runs;
    try {
      runs = await readRuns(client, org, repo, branchOf(defaultBranches, repo));
    } catch (e) {
      warn(repo, `workflow runs could not be read: ${e.message}`);
      unread.push(repo);
      continue;
    }
    rows.push(...(await failingRows({ client, org, repo, warn }, runs)));
  }
  return { failing: rows.sort(newestFirst).map(({ at, ...row }) => row), unread };
}
