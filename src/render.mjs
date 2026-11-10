// Renders the homepage. Every value from a project is escaped here, whatever collect.mjs
// already checked: a colour must still be a hex colour, a link must still be https and an
// image must still be a tiles/ file or an inlined SVG, or it is dropped.

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
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#0b0c0f"/><circle cx="32" cy="32" r="27" fill="none" stroke="${colourOf(p)}" stroke-width="2"/>`
    + `<text x="32" y="42" text-anchor="middle" font-size="28" font-weight="800" fill="${colourOf(p)}" font-family="system-ui, sans-serif">${letter}</text></svg>`;
}

function links(p) {
  const out = [];
  const add = (label, url) => {
    const u = httpsUrl(url);
    if (u && !out.some((l) => l.url === u)) out.push({ label, url: u });
  };
  if (p.site) add('Site', p.site);
  if (p.repoUrl) add('Code', p.repoUrl);
  if (p.release?.url) add('Release', p.release.url);
  for (const l of p.links ?? []) add(l.label, l.url);
  return out;
}

const pills = (list) => (Array.isArray(list) && list.length
  ? `<ul class="pills">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
  : '');

export function renderTile(p) {
  const img = tilePath(p);
  const mark = img ? `<img class="mark" src="${esc(img)}" alt="" width="52" height="52" loading="lazy" decoding="async">` : monogram(p);
  const ls = links(p);
  const primary = ls[0];
  const title = primary ? `<a href="${esc(primary.url)}">${esc(p.name)}</a>` : esc(p.name);
  return `<li class="card" style="--c:${colourOf(p)}" id="${esc(String(p.repo).toLowerCase())}">
  <div class="cardtop">${mark}<div class="who"><h3>${title}</h3>${p.kind ? `<p class="kind">${esc(p.kind)}</p>` : ''}</div>${p.release?.tag ? `<code class="ver">${esc(p.release.tag)}</code>` : ''}</div>
  <p class="desc">${esc(p.tagline ?? '')}</p>
  ${pills(p.tags)}
  ${ls.length ? `<ul class="links">${ls.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join('')}</ul>` : ''}
</li>`;
}

// The hero's numbers, all counted from the collected data.
export function summarise(projects) {
  const languages = [...new Set(projects.map((p) => p.language).filter(Boolean))].sort();
  const licences = [...new Set(projects.map((p) => p.license).filter(Boolean))];
  const releases = projects.reduce((n, p) => n + (Number.isInteger(p.releaseCount) ? p.releaseCount : 0), 0);
  return {
    projects: projects.length,
    allOpen: projects.every((p) => !p.private),
    releases,
    releasesCapped: projects.some((p) => p.releaseCountCapped),
    languages,
    licence: projects.length > 0 && licences.length === 1 && projects.every((p) => p.license === licences[0]) ? licences[0] : null,
  };
}

function timeline(projects) {
  const rows = projects
    .filter((p) => p.release?.tag)
    .sort((a, b) => (Date.parse(b.release.date ?? '') || 0) - (Date.parse(a.release.date ?? '') || 0))
    .slice(0, 8);
  if (!rows.length) return '';
  const item = (p) => {
    const tag = `<code>${esc(p.release.tag)}</code>`;
    const url = httpsUrl(p.release.url);
    return `<li><span class="dot"></span>${url ? `<a href="${esc(url)}">${tag}</a>` : tag}`
      + `${p.release.date ? ` <time datetime="${esc(p.release.date)}">${esc(formatDate(p.release.date))}</time>` : ''} <b>${esc(p.name)}</b>`
      + `${p.kind ? `<p>${esc(p.kind)}</p>` : ''}</li>`;
  };
  return `<section id="releases"><p class="eyebrow">Releases</p><h2>Latest releases</h2>
<p class="sub">The newest release of each project, read from GitHub Releases on every build.</p>
<ol class="tl">${rows.map(item).join('')}</ol></section>`;
}

const DARK = '--canvas:#101216;--surface:#171a20;--line:#2b3039;--ink:#e8e9ec;--muted:#a0a6b1;--accent:#ff4d4d;--code:#1f232b;--glow:rgba(255,40,40,.45);color-scheme:dark';
const CSS = `
:root{--canvas:#f7f6f2;--surface:#fff;--line:#dedbd2;--ink:#1b1d22;--muted:#5b606b;--accent:#b80f0f;--code:#efece4;--glow:rgba(184,15,15,.22);
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:underline}
ul,ol{list-style:none;margin:0;padding:0}
nav{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:24px;padding:10px 18px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--canvas) 88%,transparent);backdrop-filter:blur(8px);font-size:.93rem}
nav .brand{display:flex;gap:8px;align-items:center;font-weight:800}
nav .brand img{width:26px;height:26px}
.io{color:var(--accent)}
nav .nl{color:var(--muted)}
nav .sp{flex:1}
nav button{font:inherit;color:var(--ink);background:none;border:1px solid var(--line);border-radius:8px;padding:4px 12px;cursor:pointer}
.wrap{max-width:1140px;margin:0 auto;padding:0 40px}
.hero{display:grid;grid-template-columns:1fr 260px;gap:40px;align-items:center;padding:88px 0 64px}
.eyebrow{margin:0;color:var(--accent);font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:4.2rem;line-height:1.05;letter-spacing:-.035em;margin:12px 0 20px}
.lede{color:var(--muted);font-size:1.15rem;max-width:640px;margin:0}
.emblem{width:240px;height:240px;filter:drop-shadow(0 0 40px var(--glow))}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0 18px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-size:1.6rem;line-height:1.3}
.stat span{color:var(--muted);font-size:.85rem}
.pills{display:flex;flex-wrap:wrap;gap:8px}
.pills li{border:1px solid var(--line);border-radius:999px;padding:2px 12px;font-size:.82rem}
.hero .pills li:nth-child(-n+2){border-color:var(--accent);color:var(--accent)}
section{border-top:1px solid var(--line);padding:72px 0}
h2{font-size:2.1rem;letter-spacing:-.02em;margin:6px 0 10px}
.sub{color:var(--muted);max-width:640px;margin:0 0 36px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{--cc:color-mix(in srgb,var(--c) 72%,#000);position:relative;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .card{--cc:var(--c)}}
:root[data-theme=dark] .card{--cc:var(--c)}
.card::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(400px 140px at 0% 0%,color-mix(in srgb,var(--c) 18%,transparent),transparent 70%)}
.cardtop{display:flex;gap:14px;align-items:center}
.mark{flex:none;width:52px;height:52px;border-radius:12px;object-fit:contain}
.who{min-width:0}
.card h3{margin:0;font-size:1.2rem}
.kind{margin:0;color:var(--cc);font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.ver{margin-left:auto;font:600 .85rem var(--mono);background:var(--code);padding:2px 8px;border-radius:6px}
.desc{margin:0;color:var(--muted);font-size:.95rem;flex:1}
.card .pills li{font-size:.75rem;color:var(--muted)}
.links{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:6px 18px;font-weight:700;font-size:.9rem}
.links a{color:var(--cc)}
.card h3 a{position:relative;z-index:1}
.tl{padding-left:26px;border-left:1px solid var(--line)}
.tl li{position:relative;padding:0 0 26px}
.dot{position:absolute;left:-32px;top:7px;width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.tl code{font:700 .95rem var(--mono)}
.tl time{color:var(--muted);font-size:.85rem;margin:0 8px}
.tl p{margin:2px 0 0;color:var(--muted)}
.empty{color:var(--muted)}
footer{border-top:1px solid var(--line);padding:32px 0 48px;color:var(--muted);font-size:.85rem}
footer a{text-decoration:underline}
@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.wrap{padding:0 16px}.hero{grid-template-columns:1fr;padding:48px 0 40px}.emblem{width:150px;height:150px;order:-1}h1{font-size:2.6rem}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}nav .nl{display:none}section{padding:56px 0}}
`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function renderPage({ org, projects, generatedAt }) {
  const s = summarise(projects);
  const eyebrow = [s.allOpen ? 'Open source' : null, plural(s.projects, 'project', 'projects'), s.languages.length ? plural(s.languages.length, 'language', 'languages') : null]
    .filter(Boolean).join(' · ');
  const stats = [
    [String(s.projects), s.projects === 1 ? 'project' : 'projects'],
    [`${s.releases}${s.releasesCapped ? '+' : ''}`, s.releases === 1 ? 'release' : 'releases'],
    [String(s.languages.length), s.languages.length === 1 ? 'language' : 'languages'],
    s.licence && s.allOpen ? [s.licence, 'every project'] : [String(projects.filter((p) => !p.private).length), 'open source'],
  ];
  const cards = projects.length
    ? `<ul class="grid">\n${projects.map(renderTile).join('\n')}\n</ul>`
    : '<p class="empty">No published projects yet.</p>';
  // "skath<io>": the last two letters in the accent, as the SoMi site does with "So<Mi>".
  const releases = timeline(projects);
  const name = esc(org).replace(/io$/, '<span class="io">io</span>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(org)}</title>
<meta name="description" content="Open-source projects by ${esc(org)}: tools, libraries and the CI that ships them.">
<meta name="theme-color" content="#101216" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<link rel="icon" href="brand/mark.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="projects.json" title="Projects feed">
<style>${CSS}</style>
<script src="brand/theme.js"></script>
</head>
<body>
<nav><a class="brand" href="./"><img src="brand/mark.svg" alt=""><span>${name}</span></a><a class="nl" href="#projects">Projects</a>${releases ? '<a class="nl" href="#releases">Releases</a>' : ''}<span class="sp"></span><button type="button" id="theme" hidden>Theme</button></nav>
<div class="wrap">
<header class="hero"><div>
  <p class="eyebrow">${esc(eyebrow)}</p>
  <h1>${name}: small tools, built carefully, shipped often.</h1>
  <p class="lede">Plugins for coding agents, .NET libraries and the CI that releases them. ${s.allOpen ? 'Every project is open source, and every' : 'Every'} release goes through the same pinned, reviewed pipeline.</p>
  <div class="stats">${stats.map(([b, t]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join('')}</div>
  ${pills(s.languages)}
</div><img class="emblem" src="brand/mark.svg" alt=""></header>
<section id="projects"><p class="eyebrow">Projects</p><h2>What I'm building</h2>
<p class="sub">Each card comes from the project's own repository, so it stays current.</p>
${cards}
</section>
${releases}
<footer><p>${esc(org)} · Updated <time datetime="${esc(generatedAt)}">${esc(formatDate(generatedAt))}</time> · Data: <a href="projects.json">projects.json</a></p></footer>
</div>
</body>
</html>
`;
}
