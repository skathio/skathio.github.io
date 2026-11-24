#!/usr/bin/env node
// Usage: node scripts/build.mjs [--out dist] [--org skathio] [--fixture test/fixtures/org.json]
//
// Live mode reads the org through the GitHub API. The token comes from GH_TOKEN: the workflow
// passes HOMEPAGE_READ_TOKEN when it is set (needed to see private opt-in repos), else the
// job's own token, which sees public repos only. Warnings go out as workflow annotations.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { collect, collectPulls, collectRuns, githubClient } from '../src/collect.mjs';
import { writeSite, fixtureClient } from '../src/build.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    org: { type: 'string', default: 'skathio' },
    fixture: { type: 'string' },
  },
});

if (!/^[A-Za-z0-9-]{1,39}$/.test(values.org)) {
  console.error(`not an org name: ${values.org}`);
  process.exit(2);
}

const client = values.fixture
  ? fixtureClient(JSON.parse(fs.readFileSync(values.fixture, 'utf8')))
  : githubClient({ token: process.env.GH_TOKEN || undefined });

const inActions = process.env.GITHUB_ACTIONS === 'true';
// Annotation text is escaped the way the runner expects, so a manifest value cannot forge a command.
const annot = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const warn = (repo, msg) => console.warn(inActions ? `::warning title=${annot(repo)}::${annot(msg)}` : `warning: ${repo}: ${msg}`);

const { projects, images, repoNames, defaultBranches } = await collect({ client, org: values.org, warn });
// PRs are filtered against what collect listed, so who is shown stays decided in one place.
// A failed read is a warning and pulls null, never a failed build.
const prs = { ...(await collectPulls({ client, org: values.org, projects, repoNames, warn })), readAt: new Date().toISOString() };
// Runs are read for the same listed public projects. An unread repo is a warning, named on /ci/.
const runs = { ...(await collectRuns({ client, org: values.org, projects, defaultBranches, warn })), readAt: new Date().toISOString() };
const feed = writeSite({ out: values.out, org: values.org, projects, images, repoNames, prs, runs, generatedAt: new Date().toISOString() });
const prLine = prs.pulls ? `${prs.pulls.length} shown of ${prs.total}` : 'not read';
console.log(`built ${values.out}: ${feed.projects.length} projects (${feed.projects.map((p) => p.repo).join(', ')}); open pull requests: ${prLine}`);
