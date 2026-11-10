import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSite } from '../src/build.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-'));
const p = (repo) => ({ repo, name: repo, tagline: '', colour: '#123456', image: null, links: [], private: false, repoUrl: null, site: null, release: null });

test('the site holds the page, the feed, the tiles and the brand', () => {
  const out = tmp();
  const feed = writeSite({ out, org: 'skathio', projects: [p('somi')], images: new Map([['tiles/somi.png', Buffer.from('x')]]), generatedAt: '2026-11-10T00:00:00Z' });
  for (const f of ['index.html', 'projects.json', 'tiles/somi.png', 'brand/mark.svg', '.nojekyll']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'projects.json'), 'utf8')), feed);
});

test('no top-level entry of the site shadows a project path', () => {
  const out = tmp();
  writeSite({ out, org: 'skathio', projects: [p('somi'), p('rogue')], images: new Map(), generatedAt: '' });
  const names = new Set(['somi', 'rogue', 'hinokami', 'maneki', 'hashira']);
  for (const entry of fs.readdirSync(out)) assert.ok(!names.has(entry.toLowerCase()), entry);
});

test('a repo named like a homepage path is refused, even when it is not listed', () => {
  assert.throws(() => writeSite({ out: tmp(), org: 'skathio', projects: [p('tiles')], images: new Map(), generatedAt: '' }), /tiles/);
  assert.throws(() => writeSite({ out: tmp(), org: 'skathio', projects: [], repoNames: ['Brand'], images: new Map(), generatedAt: '' }), /brand/i);
});

test('the source tree has no top-level folder named after a project repo', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const names = ['somi', 'rogue', 'hinokami', 'maneki', 'hashira', 'maneki-data', 'stonks', 'stonks-data', 'raven-js', 'ripper-js', 'jutsu-js', 'arise-js', 'arise-net', 'rogue-js'];
  for (const entry of fs.readdirSync(root)) assert.ok(!names.includes(entry.toLowerCase()), entry);
});
