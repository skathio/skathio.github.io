// Collects the homepage's projects from the GitHub API.
//
// Who is listed:
//   - a public repo, unless its manifest says "listed": false;
//   - a private repo only when it carries a manifest (opt-in) that does not say "listed": false.
// Skipped always: forks, archived repos, this homepage repo, and the org's `.github` repo.
//
// The client is injected ({ json(path), bytes(url) }) so tests run against fixtures.
// A broken manifest or image in one repo never fails the build: it becomes a warning and
// that tile falls back to defaults.

import { MANIFEST_PATH, DEFAULT_COLOUR, validateManifest, checkImageBytes, imageExt } from './manifest.mjs';

const SKIP = (org) => new Set([`${org}.github.io`.toLowerCase(), '.github']);

async function listRepos(client, org) {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await client.json(`/orgs/${org}/repos?type=all&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`listing ${org}'s repos returned no list`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

// Returns null when the repo has no manifest, else { manifest, clean }. clean is false when the
// file did not parse or any field was refused; a private repo is then skipped (fail closed).
async function readManifest(client, org, repo, warn) {
  const file = await client.json(`/repos/${org}/${repo}/contents/${MANIFEST_PATH}`, { allow404: true });
  if (!file) return null;
  let raw;
  try {
    raw = JSON.parse(Buffer.from(file.content ?? '', file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8'));
  } catch {
    warn(repo, `${MANIFEST_PATH} is not valid JSON`);
    return { manifest: {}, clean: false };
  }
  const { manifest, errors } = validateManifest(raw);
  for (const e of errors) warn(repo, `${MANIFEST_PATH}: ${e}`);
  return { manifest: manifest ?? {}, clean: manifest !== null && errors.length === 0 };
}

// The latest release, as GitHub marks it (so "Set as latest" wins over a later backport),
// and how many published releases there are (drafts and pre-releases left out). The count
// stops at the first page of 100, which the page shows as "100+".
async function releases(client, org, repo) {
  const list = await client.json(`/repos/${org}/${repo}/releases?per_page=100`, { allow404: true });
  const done = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft && !r.prerelease && r.tag_name);
  const marked = done.length ? await client.json(`/repos/${org}/${repo}/releases/latest`, { allow404: true }) : null;
  const r = marked && marked.tag_name ? marked : done[0];
  return {
    latest: r ? { tag: String(r.tag_name), date: r.published_at ?? null, url: r.html_url ?? null } : null,
    count: done.length,
    capped: Array.isArray(list) && list.length === 100,
  };
}

async function fetchImage(client, org, repo, image, warn) {
  try {
    const { buf, contentType } = image.kind === 'path'
      ? await client.bytes(`/repos/${org}/${repo}/contents/${image.ref}`, { raw: true })
      : await client.bytes(image.ref);
    const ext = imageExt(image, contentType);
    if (!ext) { warn(repo, `image ${image.ref}: unknown image type`); return null; }
    const err = checkImageBytes(buf, ext);
    if (err) { warn(repo, `image ${image.ref}: ${err}`); return null; }
    return { buf, ext };
  } catch (e) {
    warn(repo, `image ${image.ref}: ${e.message}`);
    return null;
  }
}

export async function collect({ client, org, warn = () => {} }) {
  const skip = SKIP(org);
  const all = await listRepos(client, org);
  const repos = all.filter((r) => !r.fork && !r.archived && !skip.has(String(r.name).toLowerCase()));

  const projects = [];
  const images = new Map();
  for (const r of repos) {
    const isPrivate = r.private === true || r.visibility === 'private' || r.visibility === 'internal';
    const read = await readManifest(client, org, r.name, warn);
    if (isPrivate && read === null) continue; // private repos are opt-in
    if (isPrivate && !read.clean) { warn(r.name, 'private repo skipped: its manifest has errors'); continue; }
    const m = read?.manifest ?? {};
    if (m.listed === false) continue;

    const rel = await releases(client, org, r.name);
    const release = rel.latest;
    let image = null;
    if (m.image) {
      const got = await fetchImage(client, org, r.name, m.image, warn);
      if (got && got.ext === 'svg') {
        // Never served from this origin as a file: see screenSvg in manifest.mjs.
        image = `data:image/svg+xml;base64,${got.buf.toString('base64')}`;
      } else if (got) {
        image = `tiles/${r.name.toLowerCase()}.${got.ext}`;
        images.set(image, got.buf);
      }
    }

    projects.push({
      repo: r.name,
      name: m.name ?? r.name,
      tagline: m.tagline ?? (typeof r.description === 'string' && r.description.trim() ? r.description.trim().slice(0, 160) : ''),
      kind: m.kind ?? '',
      tags: m.tags ?? [],
      colour: m.colour ?? DEFAULT_COLOUR,
      image,
      links: m.links ?? [],
      private: isPrivate,
      // A private repo's own pages are not public, so its tile links nowhere on GitHub.
      repoUrl: isPrivate ? null : r.html_url,
      site: !isPrivate && r.has_pages ? `https://${org.toLowerCase()}.github.io/${r.name}/` : null,
      release: release && { ...release, url: isPrivate ? null : release.url },
      releaseCount: rel.count,
      releaseCountCapped: rel.capped,
      // GitHub's own repo metadata, shown in the hero: the main language and the licence.
      language: !isPrivate && typeof r.language === 'string' ? r.language.slice(0, 30) : null,
      license: !isPrivate && typeof r.license?.spdx_id === 'string' && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id.slice(0, 30) : null,
      updated: r.pushed_at ?? null,
    });
  }

  // Most recent activity first: a release date if newer than the last push, else the push.
  const when = (p) => Math.max(Date.parse(p.release?.date ?? '') || 0, Date.parse(p.updated ?? '') || 0);
  projects.sort((a, b) => when(b) - when(a) || a.repo.localeCompare(b.repo));
  // Every repo name, listed or not: the site must not publish a path any of them serves under.
  return { projects, images, repoNames: all.map((r) => String(r.name)) };
}

// The real client: GitHub's REST API with an optional token, and plain https for image URLs.
export function githubClient({ token, fetchImpl = fetch, apiBase = 'https://api.github.com', timeoutMs = 20000 }) {
  const headers = (extra = {}) => ({
    'User-Agent': 'skathio-homepage-build',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  // Reads the body in chunks and stops at the cap, so an endless or huge response cannot fill memory.
  const readCapped = async (res, limit) => {
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > limit) throw new Error(`response is ${declared} bytes; the limit is ${limit}`);
    if (!res.body) return Buffer.alloc(0);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > limit) {
        await res.body.cancel?.().catch(() => {});
        throw new Error(`response is over ${limit} bytes`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  return {
    async json(path, { allow404 = false } = {}) {
      const res = await fetchImpl(apiBase + path, { headers: headers({ Accept: 'application/vnd.github+json' }), signal: AbortSignal.timeout(timeoutMs) });
      if (allow404 && res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
      return res.json();
    },
    async bytes(pathOrUrl, { raw = false } = {}) {
      // The token goes only to the GitHub API, never to a third-party image host.
      const isApi = pathOrUrl.startsWith('/');
      const res = await fetchImpl(isApi ? apiBase + pathOrUrl : pathOrUrl, {
        headers: isApi ? headers(raw ? { Accept: 'application/vnd.github.raw' } : {}) : { 'User-Agent': 'skathio-homepage-build' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!isApi && new URL(res.url || pathOrUrl).protocol !== 'https:') throw new Error('redirected off https');
      // Twice the image limit, so checkImageBytes can report the real size.
      const buf = await readCapped(res, 2 * 1024 * 1024);
      return { buf, contentType: res.headers.get('content-type') ?? '' };
    },
  };
}
