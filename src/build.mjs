// Builds the site into a directory: index.html, projects.json (the feed), tiles/ (each project's
// branding image), brand/ (the org's own mark) and prs/ (the open pull requests page).

import fs from 'node:fs';
import path from 'node:path';
import { renderPage, renderPrsPage } from './render.mjs';

const BRAND = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'brand');

// prs is the PR read: pulls is null when it failed. Left out, or without a list, the page says it
// could not be read; without a read time, the build's time stands in.
export function writeSite({ out, org, projects, images, generatedAt, repoNames = [], prs }) {
  // A top-level entry named like any repo, listed or not, would hide its Pages site at /<repo>/.
  const reserved = new Set([...repoNames, ...projects.map((p) => p.repo)].map((n) => n.toLowerCase()));
  for (const entry of ['index.html', 'projects.json', 'tiles', 'brand', 'prs', '.nojekyll']) {
    if (reserved.has(entry.toLowerCase())) throw new Error(`a repo is named "${entry}", which the homepage needs as a path`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'tiles'), { recursive: true });
  fs.mkdirSync(path.join(out, 'prs'));
  fs.cpSync(BRAND, path.join(out, 'brand'), { recursive: true });
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  for (const [rel, buf] of images) fs.writeFileSync(path.join(out, rel), buf);
  fs.writeFileSync(path.join(out, 'index.html'), renderPage({ org, projects, generatedAt }));
  fs.writeFileSync(path.join(out, 'prs', 'index.html'), renderPrsPage({ org, projects, pulls: prs?.pulls ?? null, total: prs?.total ?? 0, readAt: prs?.readAt ?? generatedAt }));

  const feed = { org, generatedAt, projects };
  fs.writeFileSync(path.join(out, 'projects.json'), JSON.stringify(feed, null, 2) + '\n');
  return feed;
}

// A client over a fixture file, so the build runs with no network (tests, PR checks).
export function fixtureClient(fixture) {
  const notFound = () => null;
  return {
    async json(p, { allow404 = false } = {}) {
      let m;
      if ((m = /^\/orgs\/[^/]+\/repos\?.*page=(\d+)/.exec(p))) return m[1] === '1' ? fixture.repos : [];
      if ((m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(p))) {
        const f = fixture.files?.[`${m[1]}/${m[2]}`];
        if (f === undefined) return allow404 ? notFound() : Promise.reject(new Error(`GET ${p}: HTTP 404`));
        return { encoding: 'base64', content: Buffer.from(typeof f === 'string' ? f : JSON.stringify(f)).toString('base64') };
      }
      if ((m = /^\/repos\/[^/]+\/([^/]+)\/releases\?/.exec(p))) {
        const r = fixture.releases?.[m[1]];
        return r === undefined ? [] : Array.isArray(r) ? r : [r];
      }
      if ((m = /^\/repos\/[^/]+\/([^/]+)\/releases\/latest$/.exec(p))) {
        const r = fixture.latest?.[m[1]];
        return r ?? (allow404 ? notFound() : Promise.reject(new Error(`GET ${p}: HTTP 404`)));
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
