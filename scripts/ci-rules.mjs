#!/usr/bin/env node
// Usage: GH_TOKEN=... node scripts/ci-rules.mjs [--org skathio] [--config .github/ci-rules.json] [--apply]
//
// Puts a ruleset named `ci-required` on each repo in the config, so a PR must pass the named checks
// and be up to date with the default branch before it can merge. Without --apply it is a dry run:
// it prints what it would do and writes nothing. The maintainer runs it by hand with an admin
// token; no workflow runs it, so no workflow holds that token.
//
// Exit codes: 0 every repo accepted; 1 a repo was refused or failed (the others still ran);
// 2 bad options or config, before anything is read or written.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { githubClient } from '../src/collect.mjs';

const RULESET = 'ci-required';
// GitHub Actions' app id. Pinning a check to it stops a commit status posted by anyone with write
// access from satisfying the requirement.
const ACTIONS_APP = 15368;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_CHECKS = 10;
const MAX_CHECK_NAME = 100;

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkChecks(repo, checks) {
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > MAX_CHECKS) return `${repo}: list 1 to ${MAX_CHECKS} check names`;
  if (checks.some((c) => typeof c !== 'string' || c.length < 1 || c.length > MAX_CHECK_NAME)) return `${repo}: each check name is a string of 1 to ${MAX_CHECK_NAME} characters`;
  if (new Set(checks).size !== checks.length) return `${repo}: a check name is repeated`;
  return null;
}

// Returns the config's repos as [name, checks] pairs, or an error message.
function parseConfig(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    return { error: `the config is not JSON: ${e.message}` };
  }
  if (!isObject(config) || Object.keys(config).join() !== 'repos' || !isObject(config.repos)) return { error: 'the config must be { "repos": { "<repo>": ["<check name>", ...] } }' };
  const repos = Object.entries(config.repos);
  for (const [repo, checks] of repos) {
    if (!REPO_NAME.test(repo)) return { error: `not a repo name: ${JSON.stringify(repo)}` };
    const error = checkChecks(repo, checks);
    if (error) return { error };
  }
  return { repos };
}

function desiredRuleset(checks) {
  return {
    name: RULESET,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [{
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: checks.map((context) => ({ context, integration_id: ACTIONS_APP })),
      },
    }],
    // Admins may merge a PR that is not green, through the PR only: never a direct push.
    bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'pull_request' }],
  };
}

function normaliseRule(rule) {
  if (rule?.type !== 'required_status_checks') return { type: rule?.type };
  const p = rule.parameters ?? {};
  return {
    type: rule.type,
    parameters: {
      strict_required_status_checks_policy: p.strict_required_status_checks_policy === true,
      do_not_enforce_on_create: p.do_not_enforce_on_create === true,
      // Sorted: the order of the checks means nothing, and GitHub may list them in another.
      required_status_checks: (p.required_status_checks ?? []).map((c) => ({ context: c.context, integration_id: c.integration_id })).sort((x, y) => String(x.context).localeCompare(String(y.context))),
    },
  };
}

// The ruleset as GitHub returns it, cut to the fields this script sets, so server fields
// (id, node_id, timestamps, source) never make a matching ruleset look different.
function normaliseRuleset(r) {
  const ref = r.conditions?.ref_name ?? {};
  return {
    name: r.name,
    target: r.target,
    enforcement: r.enforcement,
    conditions: { ref_name: { include: ref.include ?? [], exclude: ref.exclude ?? [] } },
    rules: (r.rules ?? []).map(normaliseRule),
    bypass_actors: (r.bypass_actors ?? []).map((a) => ({ actor_type: a.actor_type, actor_id: a.actor_id, bypass_mode: a.bypass_mode })),
  };
}

const enc = encodeURIComponent;

// A check the ruleset requires has to have run on a PR already: requiring one that never runs
// would block every merge. A fork's PR proves nothing: its head commit, and so its check runs, belong to the fork. GitHub
// gives head.repo as null once the fork is deleted, which is refused too.
async function missingCheck(api, base, checks, fullName) {
  const [pr] = await api.json(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=1`);
  const head = pr?.head;
  const fromFork = head && 'repo' in head && String(head.repo?.full_name).toLowerCase() !== fullName.toLowerCase();
  for (const name of checks) {
    if (!head?.sha || fromFork) return name;
    const q = new URLSearchParams({ check_name: name, status: 'completed', per_page: '100' });
    const { check_runs: runs = [] } = await api.json(`${base}/commits/${enc(pr.head.sha)}/check-runs?${q}`);
    const ran = runs.some((r) => r.name === name && r.status === 'completed' && r.app?.id === ACTIONS_APP);
    if (!ran) return name;
  }
  return null;
}

async function refusal(api, base, checks, repo) {
  // '.' and '..' pass the config's name pattern, but GitHub allows neither, and either would
  // change the API path, so neither is read.
  if (/\/\.{1,2}$/.test(base)) return 'the repository was not found';
  const info = await api.json(base, { allow404: true });
  if (!info) return 'the repository was not found';
  // GitHub answers a renamed repo's old name with the new repo: the ruleset would land on a repo
  // the config does not name.
  const now = typeof info.full_name === 'string' ? info.full_name.split('/')[1] ?? '' : repo;
  if (now.toLowerCase() !== repo.toLowerCase()) return `the repository is now ${JSON.stringify(info.full_name)}`;
  // The free plan has no rulesets for private repos.
  if (info.private !== false) return 'the repository is private';
  if (info.archived) return 'the repository is archived';
  if (info.fork) return 'the repository is a fork';
  const missing = await missingCheck(api, base, checks, typeof info.full_name === 'string' ? info.full_name : base.slice('/repos/'.length));
  return missing === null ? null : `check "${missing}" has not run on a pull request yet`;
}

// Only ci-required is read in full. The list gives names only, which is how it is found; other
// rulesets, such as somi's `main`, are never read, changed or deleted.
async function findRuleset(api, base) {
  const list = await api.json(`${base}/rulesets?includes_parents=false&per_page=100`);
  const summary = list.find((r) => r.name === RULESET && (r.source_type ?? 'Repository') === 'Repository');
  return summary ? api.json(`${base}/rulesets/${enc(summary.id)}`) : null;
}

async function planRepo(api, base, checks, repo) {
  const reason = await refusal(api, base, checks, repo);
  if (reason) return { action: `refused: ${reason}` };
  const want = desiredRuleset(checks);
  const have = await findRuleset(api, base);
  if (!have) return { action: 'create', write: ['POST', `${base}/rulesets`, want] };
  if (JSON.stringify(normaliseRuleset(have)) === JSON.stringify(normaliseRuleset(want))) return { action: 'unchanged' };
  return { action: 'update', write: ['PUT', `${base}/rulesets/${enc(have.id)}`, want] };
}

function writer(token) {
  return async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { 'User-Agent': 'skathio-ci-rules', 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      // A redirected write would land somewhere the plan did not check.
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  };
}

function options() {
  try {
    return parseArgs({
      options: {
        org: { type: 'string', default: 'skathio' },
        config: { type: 'string', default: '.github/ci-rules.json' },
        apply: { type: 'boolean', default: false },
      },
    }).values;
  } catch (e) {
    return fail(e.message);
  }
}

function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read ${file}: ${e.code ?? 'error'}`);
  }
  const { repos, error } = parseConfig(text);
  if (error) fail(error);
  return repos;
}

// Prints one line for the repo and returns whether it was accepted.
async function runRepo({ api, write, apply, scrub }, base, repo, checks) {
  try {
    const plan = await planRepo(api, base, checks, repo);
    if (plan.write && apply) await write(...plan.write);
    console.log(`${repo}: ${plan.action}${plan.write && !apply ? ' (dry run)' : ''}`);
    return !plan.action.startsWith('refused');
  } catch (e) {
    console.log(`${repo}: error: ${scrub(e.message)}`);
    return false;
  }
}

async function main() {
  const values = options();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(values.org)) fail(`not an org name: ${values.org}`);
  const token = process.env.GH_TOKEN;
  if (!token) fail('GH_TOKEN is not set');
  const repos = readConfig(values.config);
  // Messages never carry the token, but a failure is scrubbed anyway before it is printed.
  const ctx = { api: githubClient({ token }), write: writer(token), apply: values.apply, scrub: (s) => String(s).split(token).join('***') };
  let failed = false;
  for (const [repo, checks] of repos) {
    // One repo at a time, so a refusal or an error never stops the others.
    if (!(await runRepo(ctx, `/repos/${values.org}/${enc(repo)}`, repo, checks))) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

await main();
