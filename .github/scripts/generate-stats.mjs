// Generates the GitHub stats, top languages and activity graph SVGs for the profile README.
// Runs in the "Profile stats" workflow. Needs GITHUB_TOKEN; GITHUB_USER defaults to the repo owner.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OUT_DIR = "assets";

const THEME = {
  bg: "#1a1b27",
  border: "#2a2e45",
  title: "#70a5fd",
  text: "#38bdae",
  muted: "#a9b1d6",
  icon: "#bf91f3",
  grid: "#2a2e45",
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";

const QUERY = `
query ($login: String!, $after: String) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, PULL_REQUEST_REVIEW]) { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function graphql(token, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GitHub API error: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data.user;
}

export async function fetchData(token, login) {
  let after = null;
  let user;
  const repos = [];
  do {
    const page = await graphql(token, { login, after });
    user ??= page;
    repos.push(...page.repositories.nodes);
    after = page.repositories.pageInfo.hasNextPage ? page.repositories.pageInfo.endCursor : null;
  } while (after);

  const languages = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      const entry = languages.get(node.name) ?? { name: node.name, color: node.color ?? "#858585", size: 0 };
      entry.size += size;
      languages.set(node.name, entry);
    }
  }

  const cc = user.contributionsCollection;
  return {
    name: user.name || user.login,
    stars: repos.reduce((sum, r) => sum + r.stargazerCount, 0),
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    followers: user.followers.totalCount,
    languages: [...languages.values()].sort((a, b) => b.size - a.size),
    days: cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays),
  };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => new Intl.NumberFormat("en-US").format(n);

function card(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <style>
    .title { font: 600 18px ${FONT}; fill: ${THEME.title}; }
    .label { font: 600 14px ${FONT}; fill: ${THEME.text}; }
    .value { font: 700 14px ${FONT}; fill: ${THEME.muted}; }
    .small { font: 400 12px ${FONT}; fill: ${THEME.muted}; }
    .fade { opacity: 0; animation: fadeIn 0.4s ease-in-out forwards; }
    @keyframes fadeIn { to { opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" rx="6" width="${width - 1}" height="${height - 1}" fill="${THEME.bg}" stroke="${THEME.border}"/>
  <text x="25" y="35" class="title">${esc(title)}</text>
${body}
</svg>
`;
}

const ICONS = {
  star: "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z",
  commit: "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
  pr: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z",
  issue: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z",
  repo: "M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z",
  people: "M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z",
};

export function renderStats(d) {
  const rows = [
    ["star", "Total stars", d.stars],
    ["commit", "Commits (past year)", d.commits],
    ["pr", "Pull requests", d.pullRequests],
    ["issue", "Issues", d.issues],
    ["repo", "Contributed to", d.contributedTo],
    ["people", "Followers", d.followers],
  ];
  const body = rows
    .map(
      ([icon, label, value], i) => `  <g class="fade" style="animation-delay:${150 + i * 120}ms" transform="translate(25, ${62 + i * 25})">
    <path d="${ICONS[icon]}" fill="${THEME.icon}" transform="translate(0,-12)"/>
    <text x="26" y="0" class="label">${label}:</text>
    <text x="205" y="0" class="value">${fmt(value)}</text>
  </g>`,
    )
    .join("\n");
  return card(400, 215, `${d.name}'s GitHub stats`, body);
}

export function renderLanguages(d, count = 8) {
  const top = d.languages.slice(0, count);
  const total = top.reduce((sum, l) => sum + l.size, 0) || 1;
  const barWidth = 300;
  let x = 0;
  const segments = top
    .map((l) => {
      const w = (l.size / total) * barWidth;
      const seg = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = top
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const pct = ((l.size / total) * 100).toFixed(1);
      return `  <g class="fade" style="animation-delay:${150 + i * 100}ms" transform="translate(${25 + col * 160}, ${85 + row * 25})">
    <circle cx="5" cy="-4" r="5" fill="${l.color}"/>
    <text x="16" y="0" class="small">${esc(l.name)} ${pct}%</text>
  </g>`;
    })
    .join("\n");
  const rows = Math.ceil(top.length / 2);
  const height = Math.max(215, 85 + rows * 25 + 10);
  const body = `  <clipPath id="bar"><rect x="0" y="0" width="${barWidth}" height="8" rx="4"/></clipPath>
  <g clip-path="url(#bar)" transform="translate(25, 55)">${segments}</g>
${legend}`;
  return card(350, height, "Most used languages", body);
}

export function renderActivity(d, days = 31) {
  const data = d.days.slice(-days);
  const width = 850;
  const height = 300;
  const pad = { top: 60, right: 30, bottom: 45, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(4, ...data.map((p) => p.contributionCount));
  const step = Math.ceil(max / 4);
  const yMax = step * 4;
  const xAt = (i) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * w : w / 2);
  const yAt = (v) => pad.top + h - (v / yMax) * h;

  const points = data.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.contributionCount).toFixed(1)}`);
  const line = points.join(" ");
  const area = `${pad.left},${pad.top + h} ${line} ${xAt(data.length - 1).toFixed(1)},${pad.top + h}`;

  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = k * step;
      const y = yAt(v).toFixed(1);
      return `  <line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="${THEME.grid}"/>
  <text x="${pad.left - 10}" y="${y}" class="small" text-anchor="end" dominant-baseline="middle">${v}</text>`;
    })
    .join("\n");

  const xLabels = data
    .map((p, i) =>
      i % 5 === 0 || i === data.length - 1
        ? `  <text x="${xAt(i).toFixed(1)}" y="${height - 20}" class="small" text-anchor="middle">${Number(p.date.slice(8, 10))}</text>`
        : "",
    )
    .filter(Boolean)
    .join("\n");

  const dots = data
    .map((p, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.contributionCount).toFixed(1)}" r="3" fill="${THEME.icon}"/>`)
    .join("");

  const body = `  <defs>
    <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${THEME.title}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${THEME.title}" stop-opacity="0"/>
    </linearGradient>
  </defs>
${grid}
  <g class="fade" style="animation-delay:150ms">
    <polygon points="${area}" fill="url(#fill)"/>
    <polyline points="${line}" fill="none" stroke="${THEME.title}" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
  </g>
${xLabels}
  <text x="${width / 2}" y="${height - 4}" class="small" text-anchor="middle">Days</text>`;
  return card(width, height, `${d.name}'s contribution graph (last ${days} days)`, body);
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER;
  if (!token || !login) throw new Error("GITHUB_TOKEN and GITHUB_USER (or GITHUB_REPOSITORY_OWNER) are required");

  const data = await fetchData(token, login);
  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(`${OUT_DIR}/github-stats.svg`, renderStats(data)),
    writeFile(`${OUT_DIR}/top-languages.svg`, renderLanguages(data)),
    writeFile(`${OUT_DIR}/activity-graph.svg`, renderActivity(data)),
  ]);
  console.log(`Wrote stats for ${login} to ${OUT_DIR}/`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
