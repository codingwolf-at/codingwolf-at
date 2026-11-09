// Generates the header banner, GitHub stats, top languages and activity graph SVGs for the profile README.
// Runs in the "Profile stats" workflow. Needs GITHUB_TOKEN; GITHUB_USER defaults to the repo owner.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OUT_DIR = "assets";

// Notion-style black and white: white pages, near-black ink, warm grays, hairline borders.
const THEME = {
  bg: "#ffffff",
  surface: "#ffffff",
  cover: "#f7f7f5",
  border: "#e9e9e7",
  grid: "#efefed",
  tag: "#f1f1ef",
  text: "#191919",
  muted: "#787774",
  subtle: "#9b9a97",
};
const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif";
const SERIF = "'Lyon-Text', 'Iowan Old Style', Georgia, ui-serif, 'Times New Roman', serif";
// Language bar and legend use one grayscale ramp instead of GitHub's rainbow of language colors.
// Stats and languages cards sit side by side and together match the 1000px-wide activity graph.
const CARD_W = 492;
const CARD_H = 270;
const CARD_GAP = 16;
const RAMP = ["#191919", "#4a4947", "#787774", "#a5a4a1", "#c9c8c5", "#e3e2df"];

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
const compact = (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const BASE_STYLE = `
    .label { font: 600 14px ${SANS}; fill: ${THEME.text}; }
    .num { font: 700 30px ${SANS}; fill: ${THEME.text}; letter-spacing: -0.8px; }
    .text { font: 400 13px ${SANS}; fill: ${THEME.muted}; }
    .meta { font: 400 12px ${SANS}; fill: ${THEME.subtle}; font-variant-numeric: tabular-nums; }
    .rise { opacity: 0; animation: rise 0.6s cubic-bezier(0.21, 0.47, 0.32, 0.98) forwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .rise { animation: none; opacity: 1; } }`;

function card(width, height, label, body, { extraStyle = "", defs = "" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
  <style>${BASE_STYLE}${extraStyle}
  </style>
  <defs>${defs}
  </defs>
  <rect x="0.5" y="0.5" rx="8" width="${width - 1}" height="${height - 1}" fill="${THEME.surface}" stroke="${THEME.border}"/>
  <text x="28" y="38" class="label">${esc(label)}</text>
${body}
</svg>
`;
}

// Roughly 13px sans glyph width, used to size the tag pills around their labels.
const tagWidth = (label) => Math.round(label.length * 6.6 + 16);

const ICONS = {
  role: `<rect x="0.7" y="3.2" width="12.6" height="9.6" rx="2"/><path d="M4.8 3.2V1.6h4.4v1.6M0.7 7.4h12.6"/>`,
  location: `<path d="M7 13.2s4.6-4.1 4.6-7.6a4.6 4.6 0 0 0-9.2 0c0 3.5 4.6 7.6 4.6 7.6z"/><circle cx="7" cy="5.6" r="1.6"/>`,
  focus: `<path d="M5 2.5h8M5 7h8M5 11.5h8"/><circle cx="1.6" cy="2.5" r="0.6"/><circle cx="1.6" cy="7" r="0.6"/><circle cx="1.6" cy="11.5" r="0.6"/>`,
};

// A Notion page: cover, page icon, title, then a few properties.
export function renderHeader() {
  const w = 1000;
  const h = 420;
  const coverH = 150;
  const props = [
    ["role", "Role", "Frontend Engineer at Plane"],
    ["location", "Location", "Hyderabad, India"],
    ["focus", "Focus", ["Design systems", "Accessibility", "AI-driven UX"]],
  ];
  const rows = props
    .map(([icon, label, value], i) => {
      const y = 336 + i * 32;
      let x = 196;
      const val = Array.isArray(value)
        ? value
            .map((tag) => {
              const tw = tagWidth(tag);
              const pill = `<rect x="${x}" y="${y - 16}" width="${tw}" height="22" rx="4" fill="${THEME.tag}"/><text x="${x + 8}" y="${y}" class="tagtext">${esc(tag)}</text>`;
              x += tw + 6;
              return pill;
            })
            .join("")
        : `<text x="${x}" y="${y}" class="value">${esc(value)}</text>`;
      return `  <g class="rise" style="animation-delay:${360 + i * 80}ms">
    <g transform="translate(60, ${y - 12})" fill="none" stroke="${THEME.muted}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>
    <text x="84" y="${y}" class="prop">${label}</text>
    ${val}
  </g>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Atul Tameshwari, Frontend Engineer at Plane. Building interfaces that feel inevitable.">
  <style>
    .icon { font: 700 30px ${SANS}; fill: ${THEME.text}; letter-spacing: -1px; }
    .name { font: 700 50px ${SANS}; fill: ${THEME.text}; letter-spacing: -1.5px; }
    .tag { font: 400 22px ${SANS}; fill: ${THEME.muted}; }
    .serif { font: italic 400 25px ${SERIF}; fill: ${THEME.text}; }
    .caret { font: 300 24px ${SANS}; fill: ${THEME.text}; animation: blink 1.1s steps(1) infinite; }
    .prop { font: 400 15px ${SANS}; fill: ${THEME.muted}; }
    .value { font: 400 15px ${SANS}; fill: ${THEME.text}; }
    .tagtext { font: 400 13px ${SANS}; fill: ${THEME.text}; }
    .rise { opacity: 0; animation: rise 0.8s cubic-bezier(0.21, 0.47, 0.32, 0.98) forwards; }
    .float { animation: float 6s ease-in-out infinite; }
    .float2 { animation: float 7s ease-in-out -2s infinite reverse; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes blink { 50% { fill-opacity: 0; } }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .rise, .caret, .float, .float2 { animation: none; opacity: 1; } }
  </style>
  <defs>
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="${THEME.text}" fill-opacity="0.13"/>
    </pattern>
    <linearGradient id="fadeX" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="fade"><rect width="${w}" height="${coverH}" fill="url(#fadeX)"/></mask>
    <clipPath id="frame"><rect x="0.5" y="0.5" rx="8" width="${w - 1}" height="${h - 1}"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="${w}" height="${h}" fill="${THEME.bg}"/>
    <rect width="${w}" height="${coverH}" fill="${THEME.cover}"/>
    <rect width="${w}" height="${coverH}" fill="url(#dots)" mask="url(#fade)"/>
    <line x1="0" x2="${w}" y1="${coverH}" y2="${coverH}" stroke="${THEME.border}"/>
    <g fill="${THEME.bg}" stroke="${THEME.text}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <g class="float"><circle cx="742" cy="82" r="30"/></g>
      <g class="float2"><rect x="806" y="40" width="58" height="58" rx="6" transform="rotate(12 835 69)"/></g>
      <g class="float"><path d="M890 112 l26 -46 l26 46 z"/></g>
      <path d="M660 122 q14 -16 28 0 t28 0 t28 0" fill="none"/>
    </g>
  </g>
  <rect x="0.5" y="0.5" rx="8" width="${w - 1}" height="${h - 1}" fill="none" stroke="${THEME.border}"/>

  <g class="rise" style="animation-delay:0ms">
    <rect x="60" y="108" width="76" height="76" rx="10" fill="${THEME.bg}" stroke="${THEME.border}"/>
    <text x="98" y="157" class="icon" text-anchor="middle">AT</text>
  </g>
  <text x="56" y="252" class="name rise" style="animation-delay:120ms">Atul Tameshwari</text>
  <text x="58" y="292" class="tag rise" style="animation-delay:240ms">Building interfaces that feel <tspan class="serif">inevitable.</tspan><tspan class="caret" dx="2">|</tspan></text>
${rows}
</svg>
`;
}

export function renderStats(d) {
  const tiles = [
    ["Commits", d.commits, "past year"],
    ["Pull requests", d.pullRequests, "all time"],
    ["Contributed to", d.contributedTo, "repositories"],
    ["Stars", d.stars, "earned"],
    ["Issues", d.issues, "opened"],
    ["Followers", d.followers, "on GitHub"],
  ];
  const body = tiles
    .map(([label, value, hint], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      return `  <g transform="translate(${28 + col * 150}, ${94 + row * 86})"><g class="rise" style="animation-delay:${100 + i * 80}ms">
    <text x="0" y="0" class="num">${value >= 10000 ? compact(value) : fmt(value)}</text>
    <text x="0" y="22" class="text">${label}</text>
    <text x="0" y="38" class="meta">${hint}</text>
  </g></g>`;
    })
    .join("\n");
  return card(CARD_W, CARD_H, "GitHub stats", body);
}

export function renderLanguages(d, count = 6) {
  const top = d.languages.slice(0, count);
  const total = top.reduce((sum, l) => sum + l.size, 0) || 1;
  const barWidth = CARD_W - 56;
  const gap = 3;
  let x = 0;
  const segments = top
    .map((l, i) => {
      const w = Math.max(2, (l.size / total) * barWidth - gap);
      const seg = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="10" rx="2" fill="${RAMP[i]}"/>`;
      x += w + gap;
      return seg;
    })
    .join("");
  const legend = top
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const pct = ((l.size / total) * 100).toFixed(1);
      const x0 = 28 + col * 226;
      return `  <g transform="translate(${x0}, ${128 + row * 40})"><g class="rise" style="animation-delay:${100 + i * 70}ms">
    <rect x="0" y="-9" width="10" height="10" rx="2" fill="${RAMP[i]}"/>
    <text x="20" y="0" class="text" style="fill:${THEME.text}">${esc(l.name)}</text>
    <text x="200" y="0" class="meta" text-anchor="end">${pct}%</text>
  </g></g>`;
    })
    .join("\n");
  const body = `  <g transform="translate(28, 72)">${segments}</g>
${legend}`;
  return card(CARD_W, CARD_H, "Top languages", body);
}

// Stats and languages side by side in one image, so the row is exactly as wide as the cards below it.
export function renderOverview(d) {
  const nest = (svg, prefix, x) =>
    svg
      .trim()
      .replace(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/, `<svg x="${x}" y="0"`)
      .replace(/id="([\w-]+)"/g, `id="${prefix}-$1"`)
      .replace(/url\(#([\w-]+)\)/g, `url(#${prefix}-$1)`);
  const width = CARD_W * 2 + CARD_GAP;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_H}" viewBox="0 0 ${width} ${CARD_H}" role="img" aria-label="GitHub stats and top languages">
${nest(renderStats(d), "stats", 0)}
${nest(renderLanguages(d), "langs", CARD_W + CARD_GAP)}
</svg>
`;
}

export function renderActivity(d, days = 31) {
  const data = d.days.slice(-days);
  const width = 1000;
  const height = 320;
  const pad = { top: 104, right: 32, bottom: 44, left: 56 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(4, ...data.map((p) => p.contributionCount));
  const step = Math.ceil(max / 4);
  const yMax = step * 4;
  const xAt = (i) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * w : w / 2);
  const yAt = (v) => pad.top + h - (v / yMax) * h;
  const total = data.reduce((sum, p) => sum + p.contributionCount, 0);

  // Smooth the line with a Catmull-Rom spline converted to cubic Béziers, clamped so it never dips below zero.
  const pts = data.map((p, i) => [xAt(i), yAt(p.contributionCount)]);
  const floor = pad.top + h;
  let path = pts.length ? `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}` : "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)];
    path += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const last = pts[pts.length - 1] ?? [pad.left, floor];
  const area = `${path} L${last[0].toFixed(1)},${floor} L${pad.left},${floor} Z`;

  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = k * step;
      const y = yAt(v).toFixed(1);
      return `  <line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="${THEME.grid}" ${k ? 'stroke-dasharray="3 5"' : ""}/>
  <text x="${pad.left - 14}" y="${y}" class="meta" text-anchor="end" dominant-baseline="middle">${v}</text>`;
    })
    .join("\n");

  const month = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const xLabels = data
    .map((p, i) =>
      i % 6 === 0 || i === data.length - 1
        ? `  <text x="${xAt(i).toFixed(1)}" y="${height - 16}" class="meta" text-anchor="${i === data.length - 1 ? "end" : i === 0 ? "start" : "middle"}">${month(p.date)}</text>`
        : "",
    )
    .filter(Boolean)
    .join("\n");

  const body = `  <text x="${width - 32}" y="50" class="num" text-anchor="end">${fmt(total)}</text>
  <text x="${width - 32}" y="72" class="meta" text-anchor="end">contributions · last ${days} days</text>
${grid}
  <g class="rise" style="animation-delay:150ms">
    <path d="${area}" fill="url(#area)"/>
    <path d="${path}" fill="none" stroke="${THEME.text}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="10" fill="${THEME.text}" fill-opacity="0.08"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" fill="${THEME.text}" stroke="${THEME.surface}" stroke-width="2"/>
  </g>
${xLabels}`;
  const defs = `
    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${THEME.text}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${THEME.text}" stop-opacity="0"/>
    </linearGradient>`;
  return card(width, height, "Contribution activity", body, { defs });
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER;
  if (!token || !login) throw new Error("GITHUB_TOKEN and GITHUB_USER (or GITHUB_REPOSITORY_OWNER) are required");

  const data = await fetchData(token, login);
  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(`${OUT_DIR}/header.svg`, renderHeader()),
    writeFile(`${OUT_DIR}/overview.svg`, renderOverview(data)),
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
