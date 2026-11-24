// The /ci/ page, built on the head, nav and styles render.mjs shares with every page. Rows come
// from collectRuns and are re-checked here like the /prs/ rows: a row whose repo is not a listed
// public project is dropped, and so is one whose link is not exactly that repo's run page on
// GitHub. Text is escaped.

import { esc, formatTime, timeline, top } from './render.mjs';

const RUN_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/([1-9]\d*)$/;
const runUrl = (r, org) => {
  const m = typeof r.url === 'string' ? RUN_URL.exec(r.url) : null;
  return m && m[1] === org && m[2] === r.repo && Number.isSafeInteger(Number(m[3])) ? r.url : null;
};

// The /prs/ table's styles fit these rows too, phone stacking included.
function ciRow(r, names) {
  return `<tr><td class="proj"><a href="../#${esc(String(r.repo).toLowerCase())}">${esc(names.get(r.repo))}</a></td>`
    + `<td class="pr">${esc(r.workflow)}</td><td class="nw" data-label="Event">${esc(r.event)}</td>`
    + `<td data-label="Failing since">${formatTime(r.since)}</td><td class="nw" data-label="Failed runs">${esc(String(r.count))}</td>`
    + `<td class="nw run"><a href="${esc(r.url)}">Latest failed run</a></td></tr>`;
}

function ciBody(runs, readAt, names, org) {
  // Without the list of unread repos the page cannot know every read worked, so it claims nothing.
  if (!Array.isArray(runs?.failing) || !Array.isArray(runs.unread)) return `<p class="empty">Workflow runs could not be read at ${formatTime(readAt)}.</p>`;
  const rows = runs.failing.filter((r) => names.has(r?.repo) && runUrl(r, org));
  const unread = runs.unread.filter((repo) => names.has(repo));
  const asOf = `<p class="note">As of ${formatTime(readAt)}, rebuilt hourly.</p>`;
  // An unread repo may be failing, so the page names it first and never claims all is clear.
  const note = unread.length
    ? `<p class="note">The workflow runs of ${unread.map((repo) => `<b>${esc(repo)}</b>`).join(', ')} could not be read, so their failures are not shown.</p>\n`
    : '';
  if (!rows.length) {
    return `${note}<p class="empty">${unread.length ? 'Nothing is failing in the projects that could be read.' : 'Nothing is failing on the default branches.'}</p>\n${asOf}`;
  }
  return `${note}${asOf}
<div class="tablewrap"><table class="prs">
<thead><tr><th>Project</th><th>Workflow</th><th>Event</th><th>Failing since</th><th>Failed runs</th><th>Run</th></tr></thead>
<tbody>
${rows.map((r) => ciRow(r, names)).join('\n')}
</tbody></table></div>`;
}

export function renderCiPage({ org, projects, runs, readAt }) {
  const names = new Map(projects.filter((p) => p.private === false).map((p) => [p.repo, p.name || p.repo]));
  return `${top({ org, title: `CI · ${org}`, description: `Unresolved workflow failures on the default branches of the projects by ${org}.`, up: '../', hasReleases: Boolean(timeline(projects)), current: 'ci' })}
<div class="wrap">
<section id="ci" class="first"><p class="eyebrow">CI</p><h2>Failing on the default branch</h2>
<p class="sub">Workflows in the public projects on the <a href="../">homepage</a> that failed on the default branch and have not passed since, from the last 100 runs. Pull request runs are left out. A cancelled or skipped run does not clear a failure; only a passing run does.</p>
${ciBody(runs, readAt, names, org)}
</section>
<footer><p>${esc(org)} · Read from GitHub at build time · <a href="../">Back to the homepage</a></p></footer>
</div>
</body>
</html>
`;
}
