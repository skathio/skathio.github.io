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

export function timeline(projects) {
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

const DARK = '--canvas:#101216;--surface:#171a20;--line:#2b3039;--ink:#e8e9ec;--muted:#a0a6b1;--accent:#ff4d4d;--code:#1f232b;--glow:rgba(255,40,40,.45);--ok:#5cc98a;--wait:#e2b04a;--info:#7fb0ff;color-scheme:dark';
const CSS = `
:root{--canvas:#f7f6f2;--surface:#fff;--line:#dedbd2;--ink:#1b1d22;--muted:#5b606b;--accent:#b80f0f;--code:#efece4;--glow:rgba(184,15,15,.22);--ok:#1d7a45;--wait:#8a5a00;--info:#1f5fbf;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:underline}
ul,ol{list-style:none;margin:0;padding:0}
/* The nav is hashira's site-nav element (from /_kit/). Until it is defined, or with no kit in a fixture
   build, its light-DOM links still lay out as a bar. The extras it slots in are page links. */
site-nav:not(:defined){display:flex;align-items:center;gap:16px;min-height:50px;padding:12px 18px;border-bottom:1px solid var(--line)}
site-nav>a{color:var(--muted);white-space:nowrap}
site-nav>a:hover{color:var(--accent);text-decoration:none}
/* The kit's focus ring lives in its shadow root and does not reach these light-DOM links. */
site-nav>a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* The .fb links stand in for the kit's brand, Projects and Releases while it is not defined
   (no script, the kit failed to load, or a fixture build): once it is, the kit draws them. */
site-nav>a.fb.brand{display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:800}
site-nav>a.fb.brand img{width:26px;height:26px}
site-nav:defined>a.fb{display:none}
.io{color:var(--accent)}
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
section.first{border-top:0;padding-top:48px}
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
.counts{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.counts li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:.9rem}
.counts b{margin-right:4px}
.note{color:var(--muted);font-size:.9rem;margin:0 0 14px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.prs{width:100%;border-collapse:collapse;font-size:.9rem}
.prs th,.prs td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
.prs th{color:var(--muted);font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.prs tr:last-child td{border-bottom:0}
.prs td.pr{min-width:240px}
.prs td.pr a,.prs td.proj a,.prs td.run a{text-decoration:underline}
.prs .nw{white-space:nowrap}
.st{display:inline-block;white-space:nowrap;border:1px solid currentColor;border-radius:999px;padding:0 10px;font-size:.78rem;font-weight:700}
.st-bad{color:var(--accent)}.st-ok{color:var(--ok)}.st-rev{color:var(--info)}.st-wait{color:var(--wait)}.st-none{color:var(--muted)}
footer{border-top:1px solid var(--line);padding:32px 0 48px;color:var(--muted);font-size:.85rem}
footer a{text-decoration:underline}
/* At phone width each pull request stacks into its own block, so nothing hides off to the side. */
@media (max-width:760px){.prs thead{display:none}.prs,.prs tbody,.prs tr,.prs td{display:block}.prs tr{padding:10px 0;border-bottom:1px solid var(--line)}.prs tr:last-child{border-bottom:0}.prs td{border:0;padding:3px 14px}.prs td.pr{min-width:0}.prs td[data-label]::before{content:attr(data-label) ": ";color:var(--muted);font-size:.85rem}}
@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}}
@media (max-width:760px){site-nav>a.fb.nl{display:none}.wrap{padding:0 16px}.hero{grid-template-columns:1fr;padding:48px 0 40px}.emblem{width:150px;height:150px;order:-1}h1{font-size:2.6rem}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}section{padding:56px 0}}
`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "skath<io>": the last two letters in the accent, as the SoMi site does with "So<Mi>".
const orgName = (org) => esc(org).replace(/io$/, '<span class="io">io</span>');

// The head and nav every page shares. `up` is the path back to the site root: '' on the homepage
// and '../' on /prs/ and /ci/. The nav is hashira's <site-nav>, loaded from /_kit/ (site-kit copies
// it there at deploy). Projects and Releases are its `nav` items, which the kit hides at phone
// width like every site's section links. Pull requests and CI are its extras, links in the page's
// own DOM: they stay visible at phone width and carry aria-current on their own page.
export const top = ({ org, title, description, up, hasReleases, current = null }) => {
  const nav = [{ label: 'Projects', href: `${up}#projects` }, ...(hasReleases ? [{ label: 'Releases', href: `${up}#releases` }] : [])];
  // The items in the kit's JSON form. `<` is escaped so no value can close the script.
  const navJson = JSON.stringify({ nav }).replace(/</g, '\\u003c');
  const here = ' aria-current="page"';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#101216" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<link rel="icon" href="${up}brand/mark.svg" type="image/svg+xml">
<link rel="alternate" type="application/json" href="${up}projects.json" title="Projects feed">
<link rel="stylesheet" href="${up}_kit/tokens.css">
<style>${CSS}</style>
<script src="${up}_kit/theme.js"></script>
<script src="${up}_kit/site-nav.js" defer></script>
<script src="${up}brand/local-time.js" defer></script>
</head>
<body>
<site-nav name="${esc(org)}" logo="${up}brand/mark.svg" root="${up || './'}"><script type="application/json">${navJson}</script><a class="fb brand" href="${up || './'}"><img src="${up}brand/mark.svg" alt=""><span>${orgName(org)}</span></a>${nav.map((i) => `<a class="fb nl" href="${i.href}">${i.label}</a>`).join('')}<a href="${up}prs/"${current === 'prs' ? here : ''}>Pull requests</a><a href="${up}ci/"${current === 'ci' ? here : ''}>CI</a></site-nav>`;
};

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
  const releases = timeline(projects);
  const name = orgName(org);
  return `${top({ org, title: org, description: `Open-source projects by ${org}: tools, libraries and the CI that ships them.`, up: '', hasReleases: Boolean(releases) })}
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

// The /prs/ page. Rows come from collectPulls, and every value is re-checked here: a row whose
// repo is not a listed public project is dropped, a link must still be https, text is escaped.
const PR_STATUS_CLASS = new Map([['Needs attention', 'bad'], ['Ready to merge', 'ok'], ['Ready for review', 'rev'], ['Waiting', 'wait'], ['No CI', 'none']]);
const PR_LIMIT = 100;

// "24 Nov 2026, 09:05 UTC", like formatDate. A static page cannot know the visitor's zone, so
// brand/local-time.js rewrites it in the browser; without script the UTC time is still correct.
export const formatTime = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t)
    ? 'an unknown time'
    : `<time datetime="${esc(new Date(t).toISOString())}" data-local>${esc(formatDate(iso))}, ${new Date(t).toISOString().slice(11, 16)} UTC</time>`;
};

function prRow(r, names) {
  const pr = `#${esc(String(r.number))} ${esc(r.title)}`;
  const url = httpsUrl(r.url);
  const tile = `../#${esc(String(r.repo).toLowerCase())}`;
  return `<tr><td><span class="st st-${PR_STATUS_CLASS.get(r.status) ?? 'none'}">${esc(r.status)}</span></td><td class="proj"><a href="${tile}">${esc(names.get(r.repo))}</a></td>`
    + `<td class="pr">${url ? `<a href="${esc(url)}">${pr}</a>` : pr}</td><td data-label="Author">${esc(r.author)}</td>`
    + `<td class="nw" data-label="CI">${esc(r.ci)}</td><td class="nw" data-label="Review">${esc(r.review)}</td>`
    + `<td class="nw" data-label="Updated">${r.updatedAt ? `<time datetime="${esc(r.updatedAt)}">${esc(formatDate(r.updatedAt))}</time>` : ''}</td></tr>`;
}

function prBody(pulls, total, readAt, names) {
  if (!Array.isArray(pulls)) return `<p class="empty">Pull request status could not be read at ${formatTime(readAt)}.</p>`;
  const rows = pulls.filter((r) => names.has(r?.repo));
  const asOf = `<p class="note">As of ${formatTime(readAt)}, rebuilt hourly.</p>`;
  // Past the limit the note shows even with no row left, so an empty page never reads as complete.
  const more = Number.isSafeInteger(total) && total > PR_LIMIT ? `<p class="note">Showing the first ${PR_LIMIT} of ${total} open pull requests.</p>\n` : '';
  if (!rows.length) return `${asOf}\n${more}<p class="empty">No open pull requests.</p>`;
  // Every status is counted, zeros too: "0 Needs attention" is itself the answer to the question.
  const counts = [...PR_STATUS_CLASS.keys()].map((s) => `<li class="st-${PR_STATUS_CLASS.get(s)}"><b>${rows.filter((r) => r.status === s).length}</b> ${esc(s)}</li>`);
  return `${asOf}
<ul class="counts">${counts.join('')}</ul>
${more}<div class="tablewrap"><table class="prs">
<thead><tr><th>Status</th><th>Project</th><th>Pull request</th><th>Author</th><th>CI</th><th>Review</th><th>Updated</th></tr></thead>
<tbody>
${rows.map((r) => prRow(r, names)).join('\n')}
</tbody></table></div>`;
}

export function renderPrsPage({ org, projects, pulls, total, readAt }) {
  const names = new Map(projects.filter((p) => p.private === false).map((p) => [p.repo, p.name || p.repo]));
  return `${top({ org, title: `Pull requests · ${org}`, description: `Open pull requests in the projects by ${org}, with CI and review state.`, up: '../', hasReleases: Boolean(timeline(projects)), current: 'prs' })}
<div class="wrap">
<section id="pulls" class="first"><p class="eyebrow">Pull requests</p><h2>Open pull requests</h2>
<p class="sub">Every open pull request in the public projects on the <a href="../">homepage</a>, from any author, bots included. Each links to GitHub, where the checks are.</p>
${prBody(pulls, total, readAt, names)}
</section>
<footer><p>${esc(org)} · Read from GitHub at build time · <a href="../">Back to the homepage</a></p></footer>
</div>
</body>
</html>
`;
}
