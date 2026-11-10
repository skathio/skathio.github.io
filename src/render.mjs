// Renders the homepage. Every value from a project is escaped here, whatever collect.mjs
// already checked: a colour must still be a hex colour and a link must still be https,
// or it is dropped.

import { isHexColour, httpsUrl, DEFAULT_COLOUR } from './manifest.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const colourOf = (p) => (isHexColour(p.colour) ? p.colour : DEFAULT_COLOUR);
const tilePath = (p) => (typeof p.image === 'string'
  && (/^tiles\/[a-z0-9._-]+\.(png|jpg|webp)$/.test(p.image) || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.image))
  ? p.image : null);

const formatDate = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t)
    ? ''
    : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// A lettered mark for a project that sent no image, in its own colour.
function monogram(p) {
  const letter = esc((p.name || p.repo || '?').trim().charAt(0).toUpperCase());
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="${colourOf(p)}"/>`
    + `<text x="32" y="43" text-anchor="middle" font-size="30" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${letter}</text></svg>`;
}

function links(p) {
  const out = [];
  const add = (label, url) => {
    const u = httpsUrl(url);
    if (u && !out.some((l) => l.url === u)) out.push({ label, url: u });
  };
  if (p.site) add('Site', p.site);
  if (p.release?.url) add('Release', p.release.url);
  if (p.repoUrl) add('Code', p.repoUrl);
  for (const l of p.links ?? []) add(l.label, l.url);
  return out;
}

export function renderTile(p) {
  const img = tilePath(p);
  const mark = img ? `<img class="mark" src="${esc(img)}" alt="" width="64" height="64" loading="lazy" decoding="async">` : monogram(p);
  const release = p.release?.tag
    ? `<p class="release"><span class="tag">${esc(p.release.tag)}</span>${p.release.date ? ` <time datetime="${esc(p.release.date)}">${esc(formatDate(p.release.date))}</time>` : ''}</p>`
    : '';
  const ls = links(p);
  const primary = ls[0];
  const title = primary ? `<a href="${esc(primary.url)}">${esc(p.name)}</a>` : esc(p.name);
  return `<li class="tile" style="--tile:${colourOf(p)}" id="${esc(String(p.repo).toLowerCase())}">
  ${mark}
  <div class="body">
    <h2>${title}</h2>
    ${p.tagline ? `<p class="tagline">${esc(p.tagline)}</p>` : ''}
    ${release}
    ${ls.length ? `<ul class="links">${ls.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
  </div>
</li>`;
}

const CSS = `
:root{--canvas:#f7f6f2;--surface:#fff;--ink:#1b1d22;--muted:#5b606b;--line:#dedbd2;--accent:#b80f0f;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--canvas:#101216;--surface:#171a20;--ink:#e8e9ec;--muted:#a0a6b1;--line:#2b3039;--accent:#ff4d4d}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.55 var(--sans)}
a{color:inherit}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header{padding:56px 0 32px;display:flex;gap:16px;align-items:center}
header img{width:56px;height:56px;border-radius:14px;box-shadow:0 0 0 1px var(--line)}
header h1{margin:0;font-size:2rem;letter-spacing:-.02em}
header p{margin:2px 0 0;color:var(--muted)}
.grid{list-style:none;margin:0;padding:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.tile{position:relative;display:flex;gap:16px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.tile::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--tile)}
.mark{flex:none;width:64px;height:64px;border-radius:14px;object-fit:contain}
.body{min-width:0}
.tile h2{margin:0;font-size:1.15rem}
.tile h2 a{text-decoration:none}
.tile h2 a:hover{text-decoration:underline}
.tagline{margin:4px 0 0;color:var(--muted);font-size:.95rem}
.release{margin:8px 0 0;font-size:.85rem;color:var(--muted)}
.tag{font-family:var(--mono);color:var(--ink);background:color-mix(in srgb,var(--tile) 14%,transparent);padding:1px 6px;border-radius:6px}
.links{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.9rem}
.links a{color:var(--tile);font-weight:600;text-decoration:none}
@media (prefers-color-scheme:dark){.links a{color:color-mix(in srgb,var(--tile) 55%,#fff)}}
.links a:hover{text-decoration:underline}
footer{padding:40px 0 56px;color:var(--muted);font-size:.85rem}
footer a{color:var(--muted)}
.empty{color:var(--muted)}
`;

export function renderPage({ org, projects, generatedAt }) {
  const tiles = projects.length
    ? `<ul class="grid">\n${projects.map(renderTile).join('\n')}\n</ul>`
    : '<p class="empty">No published projects yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(org)} — projects</title>
<meta name="description" content="Projects published by ${esc(org)}.">
<link rel="icon" href="brand/mark.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="projects.json" title="Projects feed">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <img src="brand/mark.svg" alt="">
  <div><h1>${esc(org)}</h1><p>Projects, libraries and tools.</p></div>
</header>
<main>
${tiles}
</main>
<footer>
  <p>Updated <time datetime="${esc(generatedAt)}">${esc(formatDate(generatedAt))}</time>. Each tile comes from its repository's <code>.github/homepage.json</code>. Data: <a href="projects.json">projects.json</a>.</p>
</footer>
</div>
</body>
</html>
`;
}
