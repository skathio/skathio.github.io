// Open pull requests in the listed public projects, for the /prs/ page. Who is listed is decided
// in collect.mjs: this reads only the projects collect returns, and re-exports through it.
//
// One GraphQL search reads them. `is:public` keeps private repos out of the search itself, so
// GitHub's reported count never includes their PRs; rows are still filtered by `isPrivate` and
// by membership in the listed public set (fail closed). Titles and logins are untrusted: they
// are cut here and escaped again in render.

export const PR_STATUSES = ['Needs attention', 'Ready to merge', 'Ready for review', 'Waiting', 'No CI'];
const PR_LIMIT = 100;
const PR_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: ${PR_LIMIT}) {
    issueCount
    nodes {
      ... on PullRequest {
        repository { name isPrivate }
        number title url isDraft updatedAt reviewDecision mergeable
        author { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;
const CI = new Map([['SUCCESS', 'passed'], ['FAILURE', 'failed'], ['ERROR', 'failed'], ['PENDING', 'running'], ['EXPECTED', 'running']]);
const REVIEW = new Map([['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes requested'], ['REVIEW_REQUIRED', 'needs review']]);

function ciLabel(node) {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  return rollup == null ? 'none' : CI.get(rollup.state) ?? 'unknown';
}

const reviewLabel = (decision) => REVIEW.get(decision ?? 'REVIEW_REQUIRED') ?? 'unknown';

// The first matching rule wins. Unknown values fall through: never a failure, conflict or approval.
function prStatus(isDraft, ci, review, mergeable) {
  if (isDraft === true) return 'Waiting';
  if (ci === 'failed' || mergeable === 'CONFLICTING' || review === 'changes requested') return 'Needs attention';
  if (ci === 'running') return 'Waiting';
  if (ci === 'none') return 'No CI';
  // Ready to merge claims CI passed, so an unrecognised CI state cannot earn it.
  return review === 'approved' && ci === 'passed' ? 'Ready to merge' : 'Ready for review';
}

// A cut never leaves half a surrogate pair at the end.
export const cut = (s, n) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '');

// Control and bidi-override characters could reorder or hide what a title or login says on the
// page, so they go before the cut and never count towards its length.
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export const visible = (s) => s.replace(HIDDEN, '');

// The login is cut to GitHub's 39 characters, keeping a `[bot]` suffix on top.
function authorLogin(author) {
  const login = typeof author?.login === 'string' ? visible(author.login) : 'ghost';
  const bot = login.endsWith('[bot]');
  return cut(bot ? login.slice(0, -5) : login, 39) + (bot ? '[bot]' : '');
}

// A row, or null when the node is not a PR of a listed public project. The url must be exactly
// the PR's own page, so a link on the page can only ever point at that PR on GitHub.
function pullRow(node, org, publicRepos, warn) {
  const repo = node?.repository?.name;
  if (typeof repo !== 'string' || node.repository.isPrivate !== false || !publicRepos.has(repo)) return null;
  const number = node.number;
  const url = `https://github.com/${org}/${repo}/pull/${number}`;
  if (!Number.isSafeInteger(number) || number < 1 || typeof node.url !== 'string' || node.url.toLowerCase() !== url.toLowerCase()) {
    warn(repo, `pull request skipped: its URL is not ${url}`);
    return null;
  }
  const ci = ciLabel(node);
  const review = reviewLabel(node.reviewDecision);
  return {
    repo,
    number,
    title: typeof node.title === 'string' ? cut(visible(node.title), 200) : '',
    url: node.url,
    author: authorLogin(node.author),
    updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : null,
    status: prStatus(node.isDraft, ci, review, node.mergeable),
    ci,
    review,
  };
}

const byStatusThenRecent = (a, b) =>
  PR_STATUSES.indexOf(a.status) - PR_STATUSES.indexOf(b.status)
  || (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)
  || a.repo.localeCompare(b.repo)
  || a.number - b.number;

// GitHub refuses a search string past 256 characters, so exclusions stop before that.
const SEARCH_MAX = 256;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

// Every repo collect saw that is not a listed public project is left out of the search, so
// GitHub's count and the 100 read cover only PRs that can show. A listed private project needs
// no exclusion: is:public keeps it out. A name that is not a plain repo name is never interpolated.
function searchString(org, repoNames, publicRepos, privateRepos) {
  let q = `org:${org} is:pr is:open archived:false is:public sort:updated-desc`;
  const names = Array.isArray(repoNames) ? repoNames : [];
  for (const name of names) {
    if (typeof name !== 'string' || !REPO_NAME.test(name) || publicRepos.has(name) || privateRepos.has(name)) continue;
    const next = `${q} -repo:${org}/${name}`;
    if (next.length > SEARCH_MAX) break;
    q = next;
  }
  return q;
}

// The search result, or throws: an errors array (even next to data) or a wrong shape means the
// list cannot be trusted as complete.
async function searchPulls(client, q) {
  const res = await client.graphql(PR_QUERY, { q });
  if (res?.errors !== undefined) throw new Error(`GitHub answered with errors: ${String(res.errors?.[0]?.message).slice(0, 200)}`);
  const search = res?.data?.search;
  if (!Array.isArray(search?.nodes) || !Number.isSafeInteger(search.issueCount) || search.issueCount < 0) throw new Error('the response has no list of pull requests');
  return search;
}

// Returns { pulls, total }: pulls is null when the read failed, never a partial list; total is
// the open PR count GitHub reports, which can be past the 100 read.
// repoNames is every repo collect saw, listed or not.
export async function collectPulls({ client, org, projects, repoNames, warn = () => {} } = {}) {
  // Fail closed: with no usable list of projects, no repo is known to be public and nothing shows.
  const listed = Array.isArray(projects) ? projects : [];
  const publicRepos = new Set(listed.filter((p) => p?.private === false && typeof p.repo === 'string').map((p) => p.repo));
  const privateRepos = new Set(listed.filter((p) => p?.private !== false && typeof p?.repo === 'string').map((p) => p.repo));
  let search;
  try {
    search = await searchPulls(client, searchString(org, repoNames, publicRepos, privateRepos));
  } catch (e) {
    warn(org, `pull requests could not be read: ${e.message}`);
    return { pulls: null, total: 0 };
  }
  const pulls = search.nodes.slice(0, PR_LIMIT).map((n) => pullRow(n, org, publicRepos, warn)).filter(Boolean);
  return { pulls: pulls.sort(byStatusThenRecent), total: search.issueCount };
}
