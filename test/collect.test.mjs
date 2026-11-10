import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collect, githubClient } from '../src/collect.mjs';
import { fixtureClient } from '../src/build.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/org.json', import.meta.url), 'utf8'));
const run = async () => {
  const warnings = [];
  const out = await collect({ client: fixtureClient(fixture), org: 'skathio', warn: (r, m) => warnings.push(`${r}: ${m}`) });
  return { ...out, warnings, byRepo: Object.fromEntries(out.projects.map((p) => [p.repo, p])) };
};

test('public repos are listed, with or without a manifest', async () => {
  const { byRepo } = await run();
  assert.ok(byRepo.somi && byRepo.hinokami && byRepo.rogue);
  assert.equal(byRepo.rogue.tagline, 'Rogue CQS library', 'falls back to the repo description');
});

test('a private repo is listed only when it carries a manifest', async () => {
  const { byRepo } = await run();
  assert.equal(byRepo['secret-js'], undefined);
  assert.ok(byRepo['optin-js']);
});

test('a private tile links nowhere on GitHub', async () => {
  const p = (await run()).byRepo['optin-js'];
  assert.equal(p.repoUrl, null);
  assert.equal(p.site, null);
  assert.equal(p.release.url, null);
  assert.equal(p.release.tag, 'v0.3.0');
});

test('forks, archived repos, the homepage itself, .github and opted-out repos are skipped', async () => {
  const { byRepo } = await run();
  for (const r of ['forked', 'old', 'skathio.github.io', '.github', 'hidden']) assert.equal(byRepo[r], undefined, r);
});

test('a repo with Pages links its site; the release shows', async () => {
  const p = (await run()).byRepo.somi;
  assert.equal(p.site, 'https://skathio.github.io/somi/');
  assert.equal(p.release.tag, 'v5.0.2');
  assert.equal(p.image, 'tiles/somi.png');
});

test('raster images, from a repo path or a URL, are stored under tiles/', async () => {
  const { images, byRepo } = await run();
  assert.deepEqual([...images.keys()].sort(), ['tiles/remote.png', 'tiles/somi.png']);
  assert.equal(byRepo.remote.image, 'tiles/remote.png');
});

test('an SVG is never written as a file: it is inlined as a data URI', async () => {
  const { images, byRepo } = await run();
  assert.ok(![...images.keys()].some((k) => k.endsWith('.svg')));
  assert.match(byRepo.hinokami.image, /^data:image\/svg\+xml;base64,/);
});

test('a private repo with a broken or refused manifest is skipped, not listed', async () => {
  const { byRepo, warnings } = await run();
  assert.equal(byRepo['broken-js'], undefined, 'unparseable manifest');
  assert.equal(byRepo['stringly-js'], undefined, 'listed is a string');
  assert.ok(warnings.some((w) => w.startsWith('broken-js: private repo skipped')));
});

test('every repo name comes back, listed or not, for the path check', async () => {
  const { repoNames } = await run();
  for (const n of ['hidden', 'secret-js', 'forked', 'old']) assert.ok(repoNames.includes(n), n);
});

test('a bad image or manifest warns and falls back instead of failing the build', async () => {
  const { byRepo, warnings } = await run();
  assert.equal(byRepo.badsvg.image, null);
  assert.ok(warnings.some((w) => w.startsWith('badsvg: ') && /script/.test(w)));
  assert.equal(byRepo.badmanifest.colour, '#5b606b');
  assert.equal(byRepo.badmanifest.image, null);
  assert.deepEqual(byRepo.badmanifest.links, [{ label: 'Docs', url: 'https://example.com/docs' }]);
});

test('projects are ordered by most recent activity', async () => {
  const { projects } = await run();
  assert.deepEqual(projects.map((p) => p.repo).slice(0, 3), ['somi', 'hinokami', 'optin-js']);
});

test('the client sends the token to the GitHub API only, never to an image host', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    return new Response(Buffer.from('89504e47', 'hex'), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const c = githubClient({ token: 't0k', fetchImpl });
  await c.bytes('/repos/skathio/somi/contents/a.png', { raw: true });
  await c.bytes('https://images.example.com/a.png');
  assert.equal(seen[0].auth, 'Bearer t0k');
  assert.equal(seen[1].auth, undefined);
});

test('the client refuses an oversized download', async () => {
  const fetchImpl = async () => new Response(Buffer.alloc(3 * 1024 * 1024), { status: 200 });
  await assert.rejects(githubClient({ fetchImpl }).bytes('https://e.com/a.png'), /limit|over/);
});

test('the client stops reading an endless body at the cap, with no content-length', async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(64 * 1024)); } });
  const fetchImpl = async () => new Response(body, { status: 200 });
  await assert.rejects(githubClient({ fetchImpl }).bytes('https://e.com/a.png'), /over/);
  assert.ok(pulled < 64, `stopped after ${pulled} chunks`);
});

test('every request carries a timeout signal', async () => {
  const signals = [];
  const fetchImpl = async (url, init) => { signals.push(init.signal); return new Response('[]', { status: 200 }); };
  const c = githubClient({ fetchImpl });
  await c.json('/x');
  await c.bytes('https://e.com/a.png');
  assert.equal(signals.length, 2);
  for (const s of signals) assert.ok(s instanceof AbortSignal);
});

test('a missing manifest is a 404, not an error', async () => {
  const fetchImpl = async () => new Response('{}', { status: 404 });
  assert.equal(await githubClient({ fetchImpl }).json('/x', { allow404: true }), null);
  await assert.rejects(githubClient({ fetchImpl }).json('/x'), /404/);
});
