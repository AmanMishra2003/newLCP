import { useState, useRef, useEffect } from "react";

const FontLink = () => (
  <link
    href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap"
    rel="stylesheet"
  />
);

// ── Fetch via Anthropic API (handles CORS) ────────────────────────────────────
async function fetchLeetCodeData(username) {
  const prompt = `
Fetch LeetCode data for the user "${username}" by calling the LeetCode GraphQL API at https://leetcode.com/graphql using these two queries:

Query 1 (POST to https://leetcode.com/graphql):
{"query": "query getUserStats($username: String!) { matchedUser(username: $username) { username profile { realName userAvatar ranking reputation } submitStats { acSubmissionNum { difficulty count submissions } totalSubmissionNum { difficulty count submissions } } } allQuestionsCount { difficulty count } }", "variables": {"username": "${username}"}}

Query 2 (POST to https://leetcode.com/graphql):
{"query": "query getUserContestRating($username: String!) { userContestRanking(username: $username) { rating globalRanking totalParticipants topPercentage badge { name } } }", "variables": {"username": "${username}"}}

Both requests need header: Content-Type: application/json

After fetching, return ONLY a raw JSON object (no markdown, no code fences, no explanation):
{
  "found": true,
  "profile": { "username": "${username}", "realName": "", "avatar": "", "ranking": 0, "reputation": 0 },
  "solved": { "totalSolved": 0, "easySolved": 0, "mediumSolved": 0, "hardSolved": 0, "totalEasy": 0, "totalMedium": 0, "totalHard": 0, "totalQuestions": 0 },
  "contest": { "rating": 0, "globalRanking": 0, "totalParticipants": 0, "topPercentage": 0, "badge": null }
}
If user is not found set "found": false. Fill all numbers from actual API data. If contest data unavailable, set contest values to 0 and badge to null.
`.trim();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error("API request failed");
  const json = await res.json();

  const text = (json.content || []).map(b => b.text || "").join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse response");
  const parsed = JSON.parse(match[0]);
  if (!parsed.found) throw new Error(`User "${username}" not found on LeetCode`);
  return parsed;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Sk({ w = "100%", h = 16, r = 6, mb = 0 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, marginBottom: mb,
      background: "linear-gradient(90deg,#1c2330 25%,#242d3b 50%,#1c2330 75%)",
      backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite",
    }} />
  );
}

function LoadingSkeleton() {
  const card = (children, extra = {}) => (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 14, padding: "1.5rem", ...extra }}>
      {children}
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "2rem" }}>
        <Sk w={50} h={50} r={25} />
        <div style={{ flex: 1 }}>
          <Sk w={160} h={18} r={5} mb={8} />
          <Sk w={100} h={11} r={4} />
        </div>
        <div><Sk w={90} h={10} r={4} mb={6} /><Sk w={70} h={22} r={5} /></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {card(
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <Sk w={90} h={90} r={45} />
            <div style={{ flex: 1 }}>
              <Sk w={90} h={10} r={4} mb={8} />
              <Sk w={80} h={30} r={5} mb={8} />
              <Sk w={60} h={11} r={4} mb={12} />
              <Sk h={4} r={99} mb={5} />
              <Sk w={70} h={10} r={4} />
            </div>
          </div>
        )}
        {card(
          <>
            <Sk w={100} h={10} r={4} mb={18} />
            {["E","M","H"].map(k => (
              <div key={k} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <Sk w={50} h={11} r={4} /><Sk w={60} h={11} r={4} />
                </div>
                <Sk h={5} r={99} />
              </div>
            ))}
          </>
        )}
      </div>

      {card(
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {[1,2,3,4].map(i => <div key={i}><Sk w={80} h={10} r={4} mb={8} /><Sk w={60} h={20} r={5} /></div>)}
        </div>,
        { marginBottom: 14 }
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {[1,2,3].map(i => card(<><Sk w={90} h={10} r={4} mb={8} /><Sk w={60} h={20} r={5} /></>, { key: i }))}
      </div>
    </div>
  );
}

// ── Ring ──────────────────────────────────────────────────────────────────────
function Ring({ value, max, color, size = 90, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1c2330" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${pct*c} ${c}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)" }} />
    </svg>
  );
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to }) {
  const [n, setN] = useState(0);
  const t = useRef(null);
  useEffect(() => {
    const end = Number(to) || 0;
    let cur = 0; const step = Math.max(end / 50, 1);
    clearInterval(t.current);
    t.current = setInterval(() => {
      cur = Math.min(cur + step, end);
      setN(Math.floor(cur));
      if (cur >= end) clearInterval(t.current);
    }, 18);
    return () => clearInterval(t.current);
  }, [to]);
  return <>{n.toLocaleString()}</>;
}

// ── Diff bar ──────────────────────────────────────────────────────────────────
const DC = { Easy: "#00b8a3", Medium: "#ffc01e", Hard: "#ff375f" };
function DiffBar({ label, count, total }) {
  const color = DC[label];
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
        <span style={{ color, fontWeight: 500 }}>{label}</span>
        <span style={{ color: "#7d8590" }}>
          <span style={{ color: "#e6edf3", fontWeight: 500 }}>{count}</span> / {total}
        </span>
      </div>
      <div style={{ height: 5, background: "#1c2330", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 99, background: color,
          width: `${pct}%`, transition: "width 1.2s cubic-bezier(.4,0,.2,1)",
          boxShadow: `0 0 8px ${color}44`,
        }} />
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 14, padding: "1.5rem", ...style }}>
      {children}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function MainApp() {
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [data, setData]     = useState(null);
  const [username, setUsername] = useState("");

  const handleFetch = async (e) => {
    e.preventDefault();
    const u = input.trim();
    if (!u || loading) return;
    setUsername(u);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await fetchLeetCodeData(u);
      setData(result);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const S = data?.solved;
  const C = data?.contest;
  const P = data?.profile;
  const totalPct = S?.totalQuestions ? Math.round(S.totalSolved / S.totalQuestions * 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'DM Mono','Fira Code',monospace", padding: "2rem" }}>
      <FontLink />
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .lci:focus{border-color:#ffa116!important;outline:none;box-shadow:0 0 0 3px #ffa11620!important}
        .lci::placeholder{color:#484f58}
        .lcb:hover:not(:disabled){background:#e08e10!important}
        .lcb:active:not(:disabled){transform:scale(.97)}
      `}</style>

      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "2.5rem", flexWrap: "wrap", rowGap: 12 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "#ffa116" }}>LC</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: "#3d444d" }}>stats</span>
          <div style={{ flex: 1 }} />
          <form onSubmit={handleFetch} style={{ display: "flex", gap: 8 }}>
            <input
              className="lci"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="leetcode username"
              disabled={loading}
              style={{
                background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
                padding: "9px 14px", color: "#e6edf3", fontFamily: "inherit",
                fontSize: 13, width: 200, opacity: loading ? 0.6 : 1,
                transition: "border-color .2s,box-shadow .2s",
              }}
            />
            <button
              type="submit"
              className="lcb"
              disabled={loading || !input.trim()}
              style={{
                background: "#ffa116", color: "#0d1117", border: "none", borderRadius: 8,
                padding: "9px 20px", fontFamily: "'Syne',sans-serif", fontWeight: 800,
                fontSize: 12, cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: ".06em", opacity: loading ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 7,
                transition: "background .15s,transform .1s",
              }}
            >
              {loading
                ? <><span style={{ width: 13, height: 13, border: "2px solid #0d1117", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />LOADING</>
                : "FETCH"
              }
            </button>
          </form>
        </div>

        {/* Empty state */}
        {!username && !loading && !error && (
          <div style={{ textAlign: "center", padding: "6rem 0", color: "#3d444d" }}>
            <div style={{ fontSize: 50, marginBottom: 14, opacity: .5 }}>{"{ }"}</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Enter a LeetCode username</div>
            <div style={{ fontSize: 12 }}>type any handle above and hit FETCH</div>
          </div>
        )}

        {/* Skeleton */}
        {loading && <LoadingSkeleton />}

        {/* Error */}
        {error && !loading && (
          <div style={{ background: "#190e0e", border: "1px solid #5c1e1e", borderRadius: 12, padding: "1.25rem 1.5rem", color: "#ff6b6b", fontSize: 13, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 18 }}>⚠</span> {error}
          </div>
        )}

        {/* Dashboard */}
        {data && !loading && (
          <div style={{ animation: "fadeUp .45s ease forwards" }}>

            {/* Profile */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "2rem" }}>
              {P?.avatar
                ? <img src={P.avatar} alt="" style={{ width: 50, height: 50, borderRadius: "50%", border: "2px solid #30363d" }} />
                : <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#1c2330", border: "2px solid #30363d", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: "#ffa116" }}>{(username[0] || "?").toUpperCase()}</div>
              }
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800 }}>{P?.realName || username}</div>
                <div style={{ fontSize: 11, color: "#7d8590", marginTop: 3 }}>@{username}</div>
              </div>
              {P?.ranking > 0 && (
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#7d8590", letterSpacing: ".1em", marginBottom: 4 }}>GLOBAL RANK</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#ffa116" }}>#{P.ranking.toLocaleString()}</div>
                </div>
              )}
            </div>

            {/* Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Card style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Ring value={S?.totalSolved ?? 0} max={S?.totalQuestions ?? 1} color="#5b8dee" />
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, lineHeight: 1 }}><Counter to={S?.totalSolved ?? 0} /></span>
                    <span style={{ fontSize: 9, color: "#7d8590", marginTop: 2 }}>solved</span>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#7d8590", letterSpacing: ".1em", marginBottom: 6 }}>TOTAL SOLVED</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 30, fontWeight: 800, lineHeight: 1 }}><Counter to={S?.totalSolved ?? 0} /></div>
                  <div style={{ fontSize: 11, color: "#7d8590", marginTop: 4 }}>/ {(S?.totalQuestions ?? 0).toLocaleString()} questions</div>
                  <div style={{ height: 4, background: "#1c2330", borderRadius: 99, overflow: "hidden", marginTop: 10 }}>
                    <div style={{ height: "100%", borderRadius: 99, background: "#5b8dee", width: `${totalPct}%`, transition: "width 1.2s cubic-bezier(.4,0,.2,1)" }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#7d8590", marginTop: 5 }}>{totalPct}% completion</div>
                </div>
              </Card>

              <Card>
                <div style={{ fontSize: 10, color: "#7d8590", letterSpacing: ".1em", marginBottom: 16 }}>BY DIFFICULTY</div>
                <DiffBar label="Easy"   count={S?.easySolved   ?? 0} total={S?.totalEasy   ?? 0} />
                <DiffBar label="Medium" count={S?.mediumSolved ?? 0} total={S?.totalMedium ?? 0} />
                <DiffBar label="Hard"   count={S?.hardSolved   ?? 0} total={S?.totalHard   ?? 0} />
              </Card>
            </div>

            {/* Contest */}
            {C?.rating > 0
              ? (
                <Card style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 14 }}>
                  {[
                    { label: "RATING",       val: Math.round(C.rating),                          color: "#ffa116" },
                    { label: "CONTEST RANK", val: `#${(C.globalRanking ?? 0).toLocaleString()}`, color: "#e6edf3" },
                    { label: "TOP %",        val: `${parseFloat(C.topPercentage ?? 0).toFixed(2)}%`, color: "#5b8dee" },
                    { label: "BADGE",        val: C.badge?.name ?? "—",                           color: "#c9d1d9" },
                  ].map(({ label, val, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: "#7d8590", letterSpacing: ".1em", marginBottom: 7 }}>{label}</div>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color }}>{val}</div>
                    </div>
                  ))}
                </Card>
              ) : (
                <Card style={{ fontSize: 12, color: "#484f58", marginBottom: 14 }}>No contest history for this user.</Card>
              )
            }

            {/* Bottom */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
              {[
                { label: "EASY SOLVED",   val: (S?.easySolved   ?? 0).toLocaleString() },
                { label: "MEDIUM SOLVED", val: (S?.mediumSolved ?? 0).toLocaleString() },
                { label: "HARD SOLVED",   val: (S?.hardSolved   ?? 0).toLocaleString() },
              ].map(({ label, val }) => (
                <Card key={label} style={{ padding: "1.1rem 1.25rem" }}>
                  <div style={{ fontSize: 10, color: "#7d8590", letterSpacing: ".1em", marginBottom: 7 }}>{label}</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800 }}>{val}</div>
                </Card>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}