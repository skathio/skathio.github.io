// Defences on the PR read past what the request states: the search is narrowed to listed public
// projects and sorted so the 100 kept are the newest, and titles and logins lose the control and
// bidi characters that could disguise them on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPulls } from '../src/collect.mjs';

const PROJECTS = [
  { repo: 'somi', name: 'SoMi', private: false },
  { repo: 'optin-js', name: 'Opt-in', private: true },
];
const node = (fields = {}) => ({
  repository: { name: 'somi', isPrivate: false }, number: 1, title: 'Bump x', url: 'https://github.com/skathio/somi/pull/1',
  isDraft: false, author: { login: 'dependabot' }, updatedAt: '2026-11-20T10:00:00Z', reviewDecision: null, mergeable: 'MERGEABLE',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...fields,
});

async function read({ nodes = [], repoNames, projects = PROJECTS } = {}) {
  const sent = [];
  const warnings = [];
  const client = { graphql: async (query, variables) => { sent.push(variables); return { data: { search: { issueCount: nodes.length, nodes } } }; } };
  const out = await collectPulls({ client, org: 'skathio', projects, repoNames, warn: (r, m) => warnings.push(`${r}: ${m}`) });
  return { ...out, q: sent[0]?.q, warnings };
}
const terms = (q) => q.split(' ');
const BIDI_OR_CONTROL = /[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;

test('the search keeps the base qualifiers and sorts by last update, newest first', async () => {
  const { q } = await read();
  for (const s of ['org:skathio', 'is:pr', 'is:open', 'archived:false', 'is:public', 'sort:updated-desc']) assert.ok(terms(q).includes(s), s);
});

test('the search excludes every repo collect saw that is not a listed public project', async () => {
  const { q } = await read({ repoNames: ['somi', 'skathio.github.io', '.github', 'hidden'] });
  for (const n of ['skathio.github.io', '.github', 'hidden']) assert.ok(terms(q).includes(`-repo:skathio/${n}`), n);
  assert.ok(!q.includes('-repo:skathio/somi'));
});

test('a listed private project is not excluded by name: is:public already keeps it out', async () => {
  const { q } = await read({ repoNames: ['somi', 'optin-js'] });
  assert.ok(!q.includes('optin-js'));
});

test('a repo name outside the GitHub name pattern is never put in the search', async () => {
  const long = 'a'.repeat(101);
  const { q } = await read({ repoNames: ['bad name', 'x repo:other/y', 'a"b', '', long, 42, null, 'ok-1'] });
  for (const bad of ['bad', 'other/y', 'a"b', long, '42', 'null']) assert.ok(!q.includes(bad), bad);
  assert.ok(terms(q).includes('-repo:skathio/ok-1'));
  assert.ok(terms(q).every((t) => t !== '-repo:skathio/'));
  // Exactly 100 characters is still a name.
  assert.ok(terms((await read({ repoNames: ['b'.repeat(100)] })).q).includes(`-repo:skathio/${'b'.repeat(100)}`));
});

test('repoNames left out or of the wrong type adds no exclusion and still reads', async () => {
  for (const repoNames of [undefined, 'hidden', { 0: 'hidden' }]) {
    const out = await read({ nodes: [node()], repoNames });
    assert.ok(!out.q.includes('-repo:'), String(repoNames));
    assert.equal(out.pulls.length, 1);
  }
});

test('exclusions stop before the search passes GitHub\'s 256-character limit, keeping every base qualifier', async () => {
  const repoNames = Array.from({ length: 40 }, (_, i) => `unlisted-repository-${i}`);
  const { q, pulls } = await read({ nodes: [node()], repoNames });
  assert.ok(q.length <= 256, `${q.length} characters`);
  assert.ok(q.includes('-repo:skathio/unlisted-repository-0'));
  for (const s of ['org:skathio', 'is:pr', 'is:open', 'archived:false', 'is:public', 'sort:updated-desc']) assert.ok(terms(q).includes(s), s);
  assert.equal(pulls.length, 1);
});

test('control and bidi-override characters are stripped from a title before the cut', async () => {
  const { pulls } = await read({ nodes: [node({ title: '‮gnp.exe fix\u0007' }), node({ number: 2, url: 'https://github.com/skathio/somi/pull/2', title: '‮evil' })] });
  const byNumber = new Map(pulls.map((p) => [p.number, p.title]));
  assert.equal(byNumber.get(1), 'gnp.exe fix');
  assert.equal(byNumber.get(2), 'evil');
  const all = '\u0000\u001F\u007F\u009F؜‎‏‪‮⁦⁩';
  const { pulls: [row] } = await read({ nodes: [node({ title: `a${all}b` })] });
  assert.equal(row.title, 'ab');
  assert.doesNotMatch(row.title, BIDI_OR_CONTROL);
});

test('a title is cut to 200 characters after the strip, so stripped characters do not use up the length', async () => {
  const { pulls: [row] } = await read({ nodes: [node({ title: '‮'.repeat(50) + 'x'.repeat(250) })] });
  assert.equal(row.title, 'x'.repeat(200));
});

test('control and bidi-override characters are stripped from an author login, bot suffix kept', async () => {
  const { pulls } = await read({ nodes: [
    node({ author: { login: 'a‮b' } }),
    node({ number: 2, url: 'https://github.com/skathio/somi/pull/2', author: { login: '⁦' + 'r'.repeat(45) + '\u0007[bot]' } }),
  ] });
  const byNumber = new Map(pulls.map((p) => [p.number, p.author]));
  assert.equal(byNumber.get(1), 'ab');
  assert.equal(byNumber.get(2), `${'r'.repeat(39)}[bot]`);
});
