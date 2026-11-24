// Builds the site into a directory: index.html, projects.json (the feed), tiles/ (each project's
// branding image), brand/ (the org's own mark), prs/ (the open pull requests page) and ci/ (the
// unresolved workflow failures).

import fs from 'node:fs';
import path from 'node:path';
import { renderPage, renderPrsPage } from './render.mjs';
import { renderCiPage } from './ci-page.mjs';

const BRAND = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'brand');

// prs is the PR read: pulls is null when it failed. Left out, or without a list, the page says it
// could not be read; without a read time, the build's time stands in. runs is collectRuns' read
// plus readAt, under the same rules.
export function writeSite({ out, org, projects, images, generatedAt, repoNames = [], prs, runs }) {
  // A top-level entry named like any repo, listed or not, would hide its Pages site at /<repo>/.
  const reserved = new Set([...repoNames, ...projects.map((p) => p.repo)].map((n) => n.toLowerCase()));
  for (const entry of ['index.html', 'projects.json', 'tiles', 'brand', 'prs', 'ci', '.nojekyll']) {
    if (reserved.has(entry.toLowerCase())) throw new Error(`a repo is named "${entry}", which the homepage needs as a path`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'tiles'), { recursive: true });
  fs.mkdirSync(path.join(out, 'prs'));
  fs.mkdirSync(path.join(out, 'ci'));
  fs.cpSync(BRAND, path.join(out, 'brand'), { recursive: true });
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  for (const [rel, buf] of images) fs.writeFileSync(path.join(out, rel), buf);
  fs.writeFileSync(path.join(out, 'index.html'), renderPage({ org, projects, generatedAt }));
  fs.writeFileSync(path.join(out, 'prs', 'index.html'), renderPrsPage({ org, projects, pulls: prs?.pulls ?? null, total: prs?.total ?? 0, readAt: prs?.readAt ?? generatedAt }));
  fs.writeFileSync(path.join(out, 'ci', 'index.html'), renderCiPage({ org, projects, runs, readAt: runs?.readAt ?? generatedAt }));

  const feed = { org, generatedAt, projects };
  fs.writeFileSync(path.join(out, 'projects.json'), JSON.stringify(feed, null, 2) + '\n');
  return feed;
}

// A client over a fixture file, so the build runs with no network (tests, PR checks).
export function fixtureClient(fixture) {
  const missing = (p, allow404) => (allow404 ? null : Promise.reject(new Error(`GET ${p}: HTTP 404`)));
  // Each REST path the build reads, answered from the fixture.
  const routes = [
    [/^\/orgs\/[^/]+\/repos\?.*page=(\d+)/, (m) => (m[1] === '1' ? fixture.repos : [])],
    [/^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/, (m, p, allow404) => {
      const f = fixture.files?.[`${m[1]}/${m[2]}`];
      if (f === undefined) return missing(p, allow404);
      return { encoding: 'base64', content: Buffer.from(typeof f === 'string' ? f : JSON.stringify(f)).toString('base64') };
    }],
    [/^\/repos\/[^/]+\/([^/]+)\/releases\?/, (m) => {
      const r = fixture.releases?.[m[1]];
      return r === undefined ? [] : Array.isArray(r) ? r : [r];
    }],
    [/^\/repos\/[^/]+\/([^/]+)\/actions\/runs\?/, (m) => {
      const r = fixture.runs?.[m[1]] ?? [];
      return { total_count: r.length, workflow_runs: r };
    }],
    [/^\/repos\/[^/]+\/([^/]+)\/releases\/latest$/, (m, p, allow404) => fixture.latest?.[m[1]] ?? missing(p, allow404)],
  ];
  return {
    async json(p, { allow404 = false } = {}) {
      for (const [re, answer] of routes) {
        const m = re.exec(p);
        if (m) return answer(m, p, allow404);
      }
      throw new Error(`fixture has no answer for ${p}`);
    },
    async bytes(p) {
      let m;
      if ((m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(p))) {
        const f = fixture.blobs?.[`${m[1]}/${m[2]}`];
        if (!f) throw new Error('HTTP 404');
        return { buf: Buffer.from(f.base64 ?? '', 'base64'), contentType: '' };
      }
      const u = fixture.urls?.[p];
      if (!u) throw new Error('HTTP 404');
      return { buf: Buffer.from(u.base64, 'base64'), contentType: u.contentType ?? '' };
    },
    // The only GraphQL query is the open-PR search; the fixture holds its result as GitHub shapes it.
    async graphql() {
      return { data: { search: fixture.pulls ?? { issueCount: 0, nodes: [] } } };
    },
  };
}
