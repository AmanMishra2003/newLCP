import { useEffect, useMemo, useState } from "react";

const GQL = "/graphql";
const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID;
const SHEET_GID = import.meta.env.VITE_GOOGLE_SHEET_GID || "0";
const USERNAME_COLUMN_INDEX = Number(import.meta.env.VITE_USERNAME_COLUMN_INDEX || 0);
const USERNAME_CACHE_KEY = "lc-ranker-sheet-usernames";
const LEADERBOARD_SNAPSHOT_KEY = "lc-ranker-last-snapshot";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function extractUsernamesFromCsv(csv, columnIndex = USERNAME_COLUMN_INDEX) {
  const seen = new Set();

  return parseCsv(csv)
    .map((row) => (row[columnIndex] || "").trim())
    .filter((username, index) => {
      const normalized = username.toLowerCase();
      const isHeader = index === 0 && ["username", "usernames", "leetcode username", "leetcode handle", "handle"].includes(normalized);
      if (!username || isHeader || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function readCachedUsernames() {
  try {
    const cached = JSON.parse(localStorage.getItem(USERNAME_CACHE_KEY) || "[]");
    return Array.isArray(cached) ? cached.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cacheUsernames(usernames) {
  try {
    localStorage.setItem(USERNAME_CACHE_KEY, JSON.stringify(usernames));
  } catch {
    // Cache is a convenience fallback only.
  }
}

async function fetchSheetUsernames() {
  if (!SHEET_ID) {
    throw new Error("Missing VITE_GOOGLE_SHEET_ID in .env");
  }

  try {
    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet request failed with ${res.status}`);

    const csv = await res.text();
    const usernames = extractUsernamesFromCsv(csv);
    if (!usernames.length) throw new Error("No usernames found in column A");

    cacheUsernames(usernames);
    return { usernames, source: "sheet" };
  } catch (err) {
    const cached = readCachedUsernames();
    if (cached.length) {
      console.warn("Could not fetch usernames from Google Sheet. Using cached sheet usernames.", err);
      return { usernames: cached, source: "cache" };
    }
    throw err;
  }
}

async function fetchLeetCodeUser(username) {
  const query = `
    query getUserRankerStats($username: String!) {
      matchedUser(username: $username) {
        username
        profile { realName userAvatar ranking reputation }
        submitStats { acSubmissionNum { difficulty count } }
      }
      userContestRanking(username: $username) {
        rating globalRanking totalParticipants topPercentage badge { name }
      }
    }
  `;

  const res = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!res.ok) throw new Error(`LeetCode request failed with ${res.status}`);

  const json = await res.json();
  const user = json.data?.matchedUser;
  if (!user) throw new Error(json.errors?.[0]?.message || "User not found");

  const contest = json.data?.userContestRanking;
  const ac = user.submitStats?.acSubmissionNum ?? [];
  const get = (arr, diff) => arr?.find((x) => x.difficulty === diff)?.count ?? 0;

  return {
    username,
    profile: {
      realName: user.profile?.realName || username,
      avatar: user.profile?.userAvatar || "",
      ranking: user.profile?.ranking ?? 0,
      reputation: user.profile?.reputation ?? 0,
    },
    solved: {
      totalSolved: get(ac, "All"),
      easySolved: get(ac, "Easy"),
      mediumSolved: get(ac, "Medium"),
      hardSolved: get(ac, "Hard"),
    },
    contest: {
      rating: contest?.rating ?? 0,
      globalRanking: contest?.globalRanking ?? 0,
      topPercentage: contest?.topPercentage ?? 0,
      badge: contest?.badge?.name ?? null,
    },
  };
}

async function fetchLeetCodeUserFromServer(username) {
  const res = await fetch(`https://lcp-x95r.onrender.com/api/leetcode2/${username}`);
  // const res = await fetch(`http://localhost:3001/api/leetcode2/${username}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error || `Request failed with ${res.status}`
    );
  }

  const data = await res.json();

  return {
    username: data.username,

    profile: {
      realName:
        data.profile?.realName || username,

      avatar:
        data.profile?.avatar || "",

      ranking:
        data.profile?.ranking ?? 0,

      reputation:
        data.profile?.reputation ?? 0,
    },

    solved: {
      totalSolved:
        data.solved?.totalSolved ?? 0,

      easySolved:
        data.solved?.easySolved ?? 0,

      mediumSolved:
        data.solved?.mediumSolved ?? 0,

      hardSolved:
        data.solved?.hardSolved ?? 0,
    },

    contest: {
      rating:
        data.contest?.rating ?? 0,

      ratingDelta:
        data.contest?.ratingDelta ?? 0,

      globalRanking:
        data.contest?.globalRanking ?? 0,

      topPercentage:
        data.contest?.topPercentage ?? 0,

      badge:
        data.contest?.badge ?? null,
    },
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function runNext() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;

    results[index] = await worker(items[index], index);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

async function fetchAllUsers(usernames) {
  const users = await mapWithConcurrency(usernames, 6, async (username) => {
    try {
      return await fetchLeetCodeUserFromServer(username);
    } catch (err) {
      console.warn(`Skipping LeetCode username "${username}".`, err);
      return null;
    }
  });

  return users.filter(Boolean);
}

function rankForSnapshot(users) {
  return [...users].sort((a, b) => {
    const solvedDiff = (b.solved.totalSolved || 0) - (a.solved.totalSolved || 0);
    if (solvedDiff) return solvedDiff;
    const ratingDiff = (b.contest.rating || 0) - (a.contest.rating || 0);
    if (ratingDiff) return ratingDiff;
    return a.username.localeCompare(b.username);
  });
}

function readPreviousSnapshot() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEADERBOARD_SNAPSHOT_KEY) || "null");
    if (!parsed?.users || typeof parsed.users !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

// function shouldUpdateSnapshot(savedAt) {
//   if (!savedAt) return true;

//   const now = new Date();
//   const lastSaved = new Date(savedAt);

//   // Find most recent Thursday
//   const recentThursday = new Date(now);

//   const currentDay = now.getDay();

//   // Thursday = 4
//   const daysSinceThursday = (currentDay - 4 + 7) % 7;

//   recentThursday.setDate(now.getDate() - daysSinceThursday);
//   recentThursday.setHours(0, 0, 0, 0);

//   // Update only if snapshot is older than recent Thursday
//   return lastSaved < recentThursday;
// }

// function saveLeaderboardSnapshot(users) {
//    try {
//     const existing = localStorage.getItem(LEADERBOARD_SNAPSHOT_KEY);

//     if (existing) {
//       const parsed = JSON.parse(existing);

//       if (!shouldUpdateSnapshot(parsed.savedAt)) {
//         return;
//       }
//     }

//     const ranked = rankForSnapshot(users);

//     const snapshot = {
//       savedAt: new Date().toISOString(),
//       users: Object.fromEntries(
//         ranked.map((user, index) => [
//           user.username,
//           {
//             rank: index + 1,
//             rating: Math.round(user.contest.rating || 0),
//             totalSolved: user.solved.totalSolved || 0,
//           },
//         ])
//       ),
//     };

//     localStorage.setItem(
//       LEADERBOARD_SNAPSHOT_KEY,
//       JSON.stringify(snapshot)
//     );

//   } catch {
//     // ignore
//   }
// }

function attachMovement(users, previousSnapshot) {
  const currentRanks = new Map(rankForSnapshot(users).map((user, index) => [user.username, index + 1]));

  return users.map((user) => {
    const previous = previousSnapshot?.users?.[user.username];
    const currentRank = currentRanks.get(user.username);
    const currentRating = Math.round(user.contest.rating || 0);

    return {
      ...user,
      movement: {
        currentRank,
        previousRank: previous?.rank ?? null,
        rankDelta: previous?.rank ? previous.rank - currentRank : 0,
        ratingDelta: typeof previous?.rating === "number" ? currentRating - previous.rating : 0,
      },
    };
  });
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return number.toLocaleString();
}

function initialsFor(name) {
  return (
    (name || "")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "LC"
  );
}

function getSortValue(user, key) {
  if (key === "username") return (user.profile.realName || user.username).toLowerCase();
  if (key === "easy") return user.solved.easySolved ?? 0;
  if (key === "medium") return user.solved.mediumSolved ?? 0;
  if (key === "hard") return user.solved.hardSolved ?? 0;
  if (key === "rating") return user.contest.rating ?? 0;
  if (key === "ranking") return user.profile.ranking || Number.MAX_SAFE_INTEGER;
  return user.solved.totalSolved ?? 0;
}

function Avatar({ user, size = "small" }) {
  const name = user.profile.realName || user.username;
  return user.profile.avatar ? (
    <img className={`avatar avatar-${size}`} src={user.profile.avatar} alt="" />
  ) : (
    <span className={`avatar avatar-${size} avatar-fallback`}>{initialsFor(name)}</span>
  );
}

function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children || "Unrated"}</span>;
}

function RankNumber({ rank, delta }) {
  const hasDelta = typeof delta === "number" && delta !== 0;

  return (
    <span className="rank-number">
      #{rank}
      {/* {hasDelta ? (
        <span className={`rank-change ${delta > 0 ? "rank-up" : "rank-down"}`}>
          {delta > 0 ? "↑" : "↓"} {delta > 0 ? "+" : ""}
          {formatNumber(delta)}
        </span>
      ) : null} */}
    </span>
  );
}

function RatingDelta({ value }) {
  if (typeof value !== "number") return null;

  return (
    <span className={`rating-change ${value > 0 ? "rating-up" : value < 0 ? "rating-down" : "rating-flat"}`}>
      {value > 0 ? "↑" : value < 0 ? "↓" : ""} {value > 0 ? "+" : ""}
      {formatNumber(value)}
    </span>
  );
}

function SortButton({ active, dir }) {
  if (!active) return <span className="sort-glyph">&lt;&gt;</span>;
  return <span className="sort-glyph sort-active">{dir === "asc" ? "^" : "v"}</span>;
}

function TableSkeleton() {
  return (
    <div className="leaderboard-shell skeleton-shell" aria-label="Loading leaderboard">
      {Array.from({ length: 12 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="sk sk-rank" />
          <span className="sk sk-avatar" />
          <span className="sk sk-name" />
          <span className="sk sk-stat" />
          <span className="sk sk-stat" />
          <span className="sk sk-stat" />
          <span className="sk sk-stat" />
        </div>
      ))}
    </div>
  );
}

function TopCard({ user, rank }) {
  if (!user) return null;

  const podium = ["gold", "silver", "bronze"][rank - 1];

  return (
    <article className={`top-card top-card-${podium}`}>
      <div className="top-rank">
        <RankNumber rank={rank} delta={user.movement?.rankDelta} />
      </div>
      <Avatar user={user} size="large" />
      <div className="top-person">
        <h2>{user.profile.realName || user.username}</h2>
        <p>@{user.username}</p>
      </div>
      <div className="top-score">
        <strong>{formatNumber(user.solved.totalSolved)}</strong>
        <span>solved</span>
      </div>
      <div className="mini-breakdown" aria-label="Solved by difficulty">
        <span className="easy">{formatNumber(user.solved.easySolved)}</span>
        <span className="medium">{formatNumber(user.solved.mediumSolved)}</span>
        <span className="hard">{formatNumber(user.solved.hardSolved)}</span>
      </div>
    </article>
  );
}

function MetricCard({ label, value, detail, tone }) {
  return (
    <article className={`metric-card metric-${tone || "default"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function LeetCodeDashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sheetSource, setSheetSource] = useState(null);
  const [sheetUsernameCount, setSheetUsernameCount] = useState(0);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("totalSolved");
  const [sortDir, setSortDir] = useState("desc");
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("lc-ranker-theme") || "dark";
    } catch {
      return "dark";
    }
  });

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const previousSnapshot = readPreviousSnapshot();
      const { usernames, source } = await fetchSheetUsernames();
      setSheetSource(source);
      setSheetUsernameCount(usernames.length);
      const result = await fetchAllUsers(usernames);
      if (!result.length) throw new Error("No valid LeetCode users were found from the sheet");
      setUsers(attachMovement(result, previousSnapshot));
      setLastUpdated(new Date());
      // saveLeaderboardSnapshot(result);
    } catch (err) {
      setError(err.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("lc-ranker-theme", theme);
    } catch {
      // Local storage can be unavailable in private contexts.
    }
  }, [theme]);

  const rankedUsers = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
      const aVal = getSortValue(a, sortBy);
      const bVal = getSortValue(b, sortBy);
      if (typeof aVal === "string") return aVal.localeCompare(bVal) * dir;
      if (aVal === bVal) return a.username.localeCompare(b.username);
      return (aVal - bVal) * dir;
    });
  }, [users, sortBy, sortDir]);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rankedUsers;
    return rankedUsers.filter((user) => {
      const name = user.profile.realName || "";
      return `${name} ${user.username}`.toLowerCase().includes(term);
    });
  }, [query, rankedUsers]);

  const topThree = rankedUsers.slice(0, 3);

  const totals = useMemo(() => {
    const sum = users.reduce(
      (acc, user) => {
        acc.solved += user.solved.totalSolved || 0;
        acc.easy += user.solved.easySolved || 0;
        acc.medium += user.solved.mediumSolved || 0;
        acc.hard += user.solved.hardSolved || 0;
        if ((user.contest.rating || 0) > acc.bestRating) {
          acc.bestRating = Math.round(user.contest.rating);
          acc.bestRatedUser = user.username;
        }
        return acc;
      },
      { solved: 0, easy: 0, medium: 0, hard: 0, bestRating: 0, bestRatedUser: "" },
    );

    return sum;
  }, [users]);

  function updateSort(key) {
    if (sortBy === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(key === "username" || key === "ranking" ? "asc" : "desc");
  }

  const columns = [
    ["rank", "Rank"],
    ["username", "Coder"],
    ["totalSolved", "Solved"],
    ["easy", "Easy"],
    ["medium", "Medium"],
    ["hard", "Hard"],
    ["rating", "Contest"],
    ["ranking", "Global"],
  ];

  return (
    <main className="ranker-app" data-theme={theme}>
      <section className="hero-panel">
        <nav className="topbar" aria-label="Leaderboard controls">
          <a className="brand" href="https://leetcode.com" target="_blank" rel="noreferrer">
            <span className="brand-mark">LC</span>
            <span>
              <strong>LeetCodeRanker</strong>
              <small>MNNIT cohort leaderboard</small>
            </span>
          </a>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="primary-button" type="button" onClick={loadUsers} disabled={loading}>
              {loading ? "Syncing" : "Refresh"}
            </button>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Live LeetCode standings</p>
            <h1>Rank coders by solved count, contest rating, and consistency.</h1>
            <p className="hero-subtitle">
              Search the cohort, sort any metric, and spot the top performers without digging through profiles.
            </p>
          </div>
          <div className="hero-metrics" aria-label="Leaderboard summary">
            <MetricCard
              label="Sheet rows"
              value={formatNumber(sheetUsernameCount)}
              detail={sheetSource === "cache" ? "cached usernames" : "from column A"}
              tone="accent"
            />
            <MetricCard
              label="Profiles"
              value={formatNumber(users.length)}
              detail="valid LeetCode users"
              tone="blue"
            />
            <MetricCard label="Solved" value={formatNumber(totals.solved)} detail="total accepted" tone="accent" />
            <MetricCard
              label="Best contest"
              value={totals.bestRating ? formatNumber(totals.bestRating) : "--"}
              detail={totals.bestRatedUser ? `@${totals.bestRatedUser}` : "no rating yet"}
              tone="green"
            />
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Podium</p>
            <h2>Current top three</h2>
          </div>
          {lastUpdated ? <span className="timestamp">Updated {lastUpdated.toLocaleString()}</span> : null}
        </div>

        {loading ? (
          <div className="top-grid">
            {[1, 2, 3].map((item) => (
              <div className="top-card top-placeholder" key={item}>
                <span className="sk sk-avatar-large" />
                <span className="sk sk-title" />
                <span className="sk sk-stat-wide" />
              </div>
            ))}
          </div>
        ) : (
          <div className="top-grid">
            {topThree.map((user, index) => (
              <TopCard key={user.username} user={user} rank={index + 1} />
            ))}
          </div>
        )}

        <div className="board-toolbar">
          <div className="search-field">
            <span aria-hidden="true">/</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or handle"
              type="search"
            />
          </div>
          <div className="difficulty-strip" aria-label="Solved totals by difficulty">
            <Badge tone="easy">{formatNumber(totals.easy)} easy</Badge>
            <Badge tone="medium">{formatNumber(totals.medium)} medium</Badge>
            <Badge tone="hard">{formatNumber(totals.hard)} hard</Badge>
          </div>
        </div>

        {error ? (
          <div className="error-panel" role="alert">
            <strong>Leaderboard unavailable</strong>
            <span>{error}</span>
            <button type="button" onClick={loadUsers}>Try again</button>
          </div>
        ) : loading ? (
          <TableSkeleton />
        ) : (
          <div className="leaderboard-shell">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  {columns.map(([key, label]) => (
                    <th key={key}>
                      {key === "rank" ? (
                        label
                      ) : (
                        <button type="button" onClick={() => updateSort(key)}>
                          {label}
                          <SortButton active={sortBy === key} dir={sortDir} />
                        </button>
                      )}
                    </th>
                  ))}
                  <th>Badge</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.username}>
                    <td className="rank-cell">
                      <RankNumber
                        rank={rankedUsers.findIndex((item) => item.username === user.username) + 1}
                        delta={user.movement?.rankDelta}
                      />
                    </td>
                    <td className="coder-cell">
                      <Avatar user={user} />
                      <span>
                        <strong>{user.profile.realName || user.username}</strong>
                        <a href={`https://leetcode.com/${user.username}`} style={{ textDecoration: "none", fontSize: "0.875rem", textTransform: "lowercase",color:'white' }} target="_blank" rel="noopener noreferrer">
                          @{user.username}
                        </a>
                      </span>
                    </td>
                    <td className="strong-cell">{formatNumber(user.solved.totalSolved)}</td>
                    <td className="easy">{formatNumber(user.solved.easySolved)}</td>
                    <td className="medium">{formatNumber(user.solved.mediumSolved)}</td>
                    <td className="hard">{formatNumber(user.solved.hardSolved)}</td>
                    <td className="contest-cell">
                      <span>{user.contest.rating ? Math.round(user.contest.rating) : "--"}</span>
                      <RatingDelta value={user.contest?.ratingDelta} />
                    </td>
                    <td>{user.profile.ranking ? `#${formatNumber(user.profile.ranking)}` : "--"}</td>
                    <td>
                      <Badge>{user.contest.badge}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mobile-list" aria-label="Leaderboard cards">
              {filteredUsers.map((user) => {
                const rank = rankedUsers.findIndex((item) => item.username === user.username) + 1;
                return (
                  <article className="mobile-card" key={user.username}>
                    <div className="mobile-card-main">
                      <span className="rank-cell">
                        <RankNumber rank={rank} delta={user.movement?.rankDelta} />
                      </span>
                      <Avatar user={user} />
                      <span>
                        <strong>{user.profile.realName || user.username}</strong>
                        <small>@{user.username}</small>
                      </span>
                    </div>
                    <div className="mobile-card-stats">
                      <span>{formatNumber(user.solved.totalSolved)} solved</span>
                      <span className="easy">{formatNumber(user.solved.easySolved)} E</span>
                      <span className="medium">{formatNumber(user.solved.mediumSolved)} M</span>
                      <span className="hard">{formatNumber(user.solved.hardSolved)} H</span>
                      <span className="mobile-rating">
                        {user.contest.rating ? `${Math.round(user.contest.rating)} rating` : "unrated"}
                        <RatingDelta value={user.contest?.ratingDelta} />
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>

            {!filteredUsers.length ? (
              <div className="empty-state">
                <strong>No coders matched</strong>
                <span>Try a different name or handle.</span>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
