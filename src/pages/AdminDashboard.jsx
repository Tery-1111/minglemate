import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg:        "#0a0a0f",
  surface:   "#111118",
  surfaceHi: "#1a1a24",
  border:    "#2a2a3a",
  accent:    "#7c6aff",
  accentSoft:"#7c6aff22",
  rose:      "#ff6b8a",
  roseSoft:  "#ff6b8a22",
  gold:      "#f5c842",
  goldSoft:  "#f5c84222",
  green:     "#4ade80",
  greenSoft: "#4ade8022",
  text:      "#f0f0f8",
  muted:     "#8888aa",
  warn:      "#f59e0b",
  warnSoft:  "#f59e0b22",
  danger:    "#ef4444",
  dangerSoft:"#ef444422",
};

const NAV_ITEMS = [
  { id: "dashboard",  label: "Dashboard",   icon: "⬡" },
  { id: "users",      label: "Users",        icon: "◎" },
  { id: "matches",    label: "Matches",      icon: "◈" },
  { id: "funnel",     label: "Funnel",       icon: "◭" },
  { id: "payments",   label: "Payments",     icon: "◇" },
  { id: "reports",    label: "Reports",      icon: "△" },
];

// ─── STYLES ──────────────────────────────────────────────────────────────────
const s = {
  shell: {
    display: "flex", minHeight: "100vh",
    backgroundColor: C.bg, color: C.text,
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    fontSize: "14px",
  },
  sidebar: {
    width: "220px", minHeight: "100vh",
    backgroundColor: C.surface,
    borderRight: `1px solid ${C.border}`,
    display: "flex", flexDirection: "column",
    padding: "0", flexShrink: 0,
  },
  sidebarLogo: {
    padding: "24px 20px 20px",
    borderBottom: `1px solid ${C.border}`,
  },
  logoMark: {
    fontSize: "20px", fontWeight: 700,
    background: `linear-gradient(135deg, ${C.accent}, ${C.rose})`,
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    letterSpacing: "-0.5px",
  },
  logoSub: { fontSize: "10px", color: C.muted, marginTop: "2px", letterSpacing: "2px", textTransform: "uppercase" },
  navSection: { padding: "16px 12px", flex: 1 },
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: "10px",
    padding: "9px 12px", borderRadius: "8px", cursor: "pointer",
    marginBottom: "2px", transition: "all 0.15s",
    backgroundColor: active ? C.accentSoft : "transparent",
    color: active ? C.accent : C.muted,
    fontWeight: active ? 600 : 400,
    border: active ? `1px solid ${C.accent}44` : "1px solid transparent",
  }),
  navIcon: { fontSize: "16px", width: "20px", textAlign: "center" },
  sidebarFooter: {
    padding: "16px", borderTop: `1px solid ${C.border}`,
  },
  statusDot: (ok) => ({
    display: "inline-block", width: "7px", height: "7px",
    borderRadius: "50%", backgroundColor: ok ? C.green : C.danger,
    marginRight: "6px",
  }),
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar: {
    padding: "16px 28px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.surface,
  },
  topbarTitle: { fontSize: "18px", fontWeight: 600 },
  topbarMeta: { fontSize: "12px", color: C.muted },
  refreshBtn: {
    padding: "7px 16px", borderRadius: "8px", cursor: "pointer",
    backgroundColor: C.accentSoft, color: C.accent,
    border: `1px solid ${C.accent}44`, fontSize: "13px", fontWeight: 500,
  },
  content: { flex: 1, overflowY: "auto", padding: "28px" },
  sectionTitle: {
    fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase",
    color: C.muted, marginBottom: "14px", fontWeight: 600,
  },
  grid: (cols) => ({
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: "16px", marginBottom: "28px",
  }),
  card: (accent) => ({
    backgroundColor: C.surface,
    border: `1px solid ${accent ? accent + "44" : C.border}`,
    borderRadius: "12px", padding: "20px",
    position: "relative", overflow: "hidden",
  }),
  kpiValue: { fontSize: "32px", fontWeight: 700, lineHeight: 1, marginBottom: "4px" },
  kpiLabel: { fontSize: "12px", color: C.muted, fontWeight: 500 },
  kpiDelta: (up) => ({
    fontSize: "11px", color: up ? C.green : C.danger,
    marginTop: "6px", fontWeight: 500,
  }),
  kpiAccentBar: (color) => ({
    position: "absolute", bottom: 0, left: 0, right: 0,
    height: "3px", backgroundColor: color,
    borderRadius: "0 0 12px 12px",
  }),
  alertBox: {
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "12px", overflow: "hidden", marginBottom: "28px",
  },
  alertHeader: {
    padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  alertRow: (type) => {
    const map = {
      warn:   { bg: C.warnSoft,   border: C.warn,   icon: "⚠" },
      danger: { bg: C.dangerSoft, border: C.danger,  icon: "✕" },
      info:   { bg: C.accentSoft, border: C.accent,  icon: "ℹ" },
      ok:     { bg: C.greenSoft,  border: C.green,   icon: "✓" },
    };
    const t = map[type] || map.info;
    return {
      padding: "12px 20px",
      borderLeft: `3px solid ${t.border}`,
      backgroundColor: t.bg,
      display: "flex", alignItems: "center", gap: "10px",
      borderBottom: `1px solid ${C.border}`,
    };
  },
  table: {
    width: "100%", borderCollapse: "collapse",
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: "12px", overflow: "hidden",
  },
  th: {
    padding: "12px 16px", textAlign: "left",
    fontSize: "11px", color: C.muted, fontWeight: 600,
    letterSpacing: "1px", textTransform: "uppercase",
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: C.surfaceHi,
  },
  td: {
    padding: "13px 16px", borderBottom: `1px solid ${C.border}`,
    fontSize: "13px",
  },
  badge: (color, bg) => ({
    display: "inline-block", padding: "3px 10px",
    borderRadius: "20px", fontSize: "11px", fontWeight: 600,
    color: color, backgroundColor: bg, letterSpacing: "0.5px",
  }),
  input: {
    width: "100%", padding: "10px 14px",
    backgroundColor: C.surfaceHi, border: `1px solid ${C.border}`,
    borderRadius: "8px", color: C.text, fontSize: "14px",
    outline: "none", boxSizing: "border-box",
  },
  actionBtn: (color, bg) => ({
    padding: "6px 14px", borderRadius: "6px", cursor: "pointer",
    backgroundColor: bg, color: color,
    border: `1px solid ${color}44`, fontSize: "12px", fontWeight: 500,
    marginRight: "6px",
  }),
  funnelBar: (pct, color) => ({
    height: "28px", width: `${pct}%`, backgroundColor: color,
    borderRadius: "4px", transition: "width 0.6s ease",
    display: "flex", alignItems: "center", paddingLeft: "10px",
    fontSize: "12px", fontWeight: 600, color: "#fff", minWidth: "40px",
  }),
  spinner: {
    display: "inline-block", width: "14px", height: "14px",
    border: `2px solid ${C.border}`, borderTopColor: C.accent,
    borderRadius: "50%", animation: "spin 0.8s linear infinite",
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = (n) => n == null ? "—" : Number(n).toLocaleString();
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "0%");
const ago = (ts) => {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

function StatusBadge({ status }) {
  const map = {
    active:    [C.green,  C.greenSoft],
    pending:   [C.warn,   C.warnSoft],
    suspended: [C.danger, C.dangerSoft],
    completed: [C.green,  C.greenSoft],
    failed:    [C.danger, C.dangerSoft],
    mutual:    [C.accent, C.accentSoft],
    unlocked:  [C.gold,   C.goldSoft],
    generated: [C.muted,  C.surfaceHi],
  };
  const [c, bg] = map[(status || "").toLowerCase()] || [C.muted, C.surfaceHi];
  return <span style={s.badge(c, bg)}>{status}</span>;
}

function KPICard({ label, value, delta, color, loading }) {
  return (
    <div style={s.card(color)}>
      {loading
        ? <div style={{ ...s.kpiValue, fontSize: "20px", color: C.muted }}>…</div>
        : <div style={{ ...s.kpiValue, color: color || C.text }}>{fmt(value)}</div>
      }
      <div style={s.kpiLabel}>{label}</div>
      {delta && <div style={s.kpiDelta(delta > 0)}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} today</div>}
      {color && <div style={s.kpiAccentBar(color)} />}
    </div>
  );
}

// ─── MODULE: EXECUTIVE DASHBOARD ─────────────────────────────────────────────
function ExecutiveDashboard({ stats, alerts, loading, onRefresh }) {
  return (
    <div>
      {/* KPI Row 1 — Users */}
      <p style={s.sectionTitle}>Platform Health</p>
      <div style={s.grid(4)}>
        <KPICard label="Total Users"        value={stats.totalUsers}       color={C.accent}  loading={loading} />
        <KPICard label="Active (7 days)"    value={stats.activeUsers}      color={C.green}   loading={loading} />
        <KPICard label="New Today"          value={stats.newToday}         color={C.rose}    delta={stats.newToday} loading={loading} />
        <KPICard label="Profiles Complete"  value={stats.profilesComplete} color={C.gold}    loading={loading} />
      </div>

      {/* KPI Row 2 — Onboarding */}
      <p style={s.sectionTitle}>Onboarding Funnel</p>
      <div style={s.grid(4)}>
        <KPICard label="Section 1 Complete" value={stats.section1Complete} color={C.accent}  loading={loading} />
        <KPICard label="Section 2 Complete" value={stats.section2Complete} color={C.accent}  loading={loading} />
        <KPICard label="S1 Completion Rate" value={stats.s1Rate + "%"}     color={C.green}   loading={loading} />
        <KPICard label="S2 Completion Rate" value={stats.s2Rate + "%"}     color={C.green}   loading={loading} />
      </div>

      {/* KPI Row 3 — Matches & Revenue */}
      <p style={s.sectionTitle}>Matches & Revenue</p>
      <div style={s.grid(4)}>
        <KPICard label="Total Matches"      value={stats.totalMatches}     color={C.rose}    loading={loading} />
        <KPICard label="Mutual Interest"    value={stats.mutualInterest}   color={C.rose}    loading={loading} />
        <KPICard label="Payments Today"     value={stats.paymentsToday}    color={C.gold}    delta={stats.paymentsToday} loading={loading} />
        <KPICard label="Revenue (Month)"    value={"KES " + fmt(stats.monthRevenue)} color={C.gold} loading={loading} />
      </div>

      {/* Alerts */}
      <p style={s.sectionTitle}>System Alerts</p>
      <div style={s.alertBox}>
        <div style={s.alertHeader}>
          <span style={{ fontWeight: 600 }}>Live Alerts</span>
          <span style={{ fontSize: "12px", color: C.muted }}>
            {alerts.length} active
          </span>
        </div>
        {alerts.length === 0 && (
          <div style={{ ...s.alertRow("ok"), borderBottom: "none" }}>
            <span>✓</span>
            <span style={{ color: C.green }}>All systems operating normally</span>
          </div>
        )}
        {alerts.map((a, i) => (
          <div key={i} style={{ ...s.alertRow(a.type), borderBottom: i < alerts.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <span>{a.type === "warn" ? "⚠" : a.type === "danger" ? "✕" : "ℹ"}</span>
            <div>
              <div style={{ fontWeight: 500 }}>{a.title}</div>
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>{a.body}</div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: "11px", color: C.muted }}>{ago(a.created_at)}</span>
          </div>
        ))}
      </div>

      {/* Reports pending */}
      <p style={s.sectionTitle}>Pending Reports</p>
      <div style={s.card()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, color: stats.pendingReports > 0 ? C.danger : C.green }}>
            {loading ? "…" : fmt(stats.pendingReports)}
          </span>
          <span style={{ color: C.muted, fontSize: "13px" }}>user reports awaiting review</span>
          {stats.pendingReports > 0 && (
            <span style={s.badge(C.danger, C.dangerSoft)}>Action Required</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MODULE: USER OPERATIONS ─────────────────────────────────────────────────
function UserOperations() {
  const [users, setUsers]     = useState([]);
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [actionMsg, setActionMsg] = useState("");

  const searchUsers = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("users")
      .select("id, email, full_name, campus, created_at, is_verified, account_status, section1_complete, section2_complete, phone")
      .order("created_at", { ascending: false })
      .limit(50);
    if (search.trim()) {
      q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,campus.ilike.%${search}%`);
    }
    const { data } = await q;
    setUsers(data || []);
    setLoading(false);
  }, [search]);

  useEffect(() => { searchUsers(); }, []);

  const doAction = async (userId, action) => {
    const updates = {
      suspend:  { account_status: "suspended" },
      restore:  { account_status: "active" },
      verify:   { is_verified: true },
      reset:    { section1_complete: false, section2_complete: false },
    };
    if (!updates[action]) return;
    const { error } = await supabase.from("users").update(updates[action]).eq("id", userId);
    if (!error) {
      setActionMsg(`✓ ${action} applied`);
      searchUsers();
      setTimeout(() => setActionMsg(""), 2500);
    }
  };

  return (
    <div>
      <p style={s.sectionTitle}>User Search & Management</p>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <input
          style={s.input}
          placeholder="Search by name, email, or campus…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && searchUsers()}
        />
        <button style={{ ...s.refreshBtn, whiteSpace: "nowrap" }} onClick={searchUsers}>
          Search
        </button>
      </div>

      {actionMsg && (
        <div style={{ ...s.alertRow("ok"), borderRadius: "8px", marginBottom: "16px" }}>
          {actionMsg}
        </div>
      )}

      <table style={s.table}>
        <thead>
          <tr>
            {["Name", "Email", "Campus", "S1", "S2", "Status", "Verified", "Joined", "Actions"].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={9} style={{ ...s.td, textAlign: "center", color: C.muted }}>Loading…</td></tr>
          )}
          {!loading && users.length === 0 && (
            <tr><td colSpan={9} style={{ ...s.td, textAlign: "center", color: C.muted }}>No users found</td></tr>
          )}
          {users.map(u => (
            <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => setSelected(selected?.id === u.id ? null : u)}>
              <td style={s.td}>{u.full_name || "—"}</td>
              <td style={{ ...s.td, color: C.muted, fontSize: "12px" }}>{u.email}</td>
              <td style={s.td}>{u.campus || "—"}</td>
              <td style={s.td}>{u.section1_complete ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.muted }}>✗</span>}</td>
              <td style={s.td}>{u.section2_complete ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.muted }}>✗</span>}</td>
              <td style={s.td}><StatusBadge status={u.account_status || "active"} /></td>
              <td style={s.td}>{u.is_verified ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.muted }}>✗</span>}</td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
              <td style={s.td} onClick={e => e.stopPropagation()}>
                <button style={s.actionBtn(C.green, C.greenSoft)}   onClick={() => doAction(u.id, "verify")}>Verify</button>
                <button style={s.actionBtn(C.warn, C.warnSoft)}     onClick={() => doAction(u.id, "reset")}>Reset</button>
                <button style={s.actionBtn(C.danger, C.dangerSoft)} onClick={() => doAction(u.id, "suspend")}>Suspend</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Expanded user detail */}
      {selected && (
        <div style={{ ...s.card(), marginTop: "20px" }}>
          <p style={s.sectionTitle}>User Detail — {selected.full_name}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            {[
              ["ID",      selected.id],
              ["Email",   selected.email],
              ["Phone",   selected.phone || "—"],
              ["Campus",  selected.campus || "—"],
              ["Status",  selected.account_status || "active"],
              ["Joined",  selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: "11px", color: C.muted, marginBottom: "4px" }}>{label}</div>
                <div style={{ fontWeight: 500 }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
            <button style={s.actionBtn(C.green,  C.greenSoft)}  onClick={() => doAction(selected.id, "restore")}>Restore</button>
            <button style={s.actionBtn(C.accent, C.accentSoft)} onClick={() => doAction(selected.id, "verify")}>Verify</button>
            <button style={s.actionBtn(C.warn,   C.warnSoft)}   onClick={() => doAction(selected.id, "reset")}>Reset Onboarding</button>
            <button style={s.actionBtn(C.danger, C.dangerSoft)} onClick={() => doAction(selected.id, "suspend")}>Suspend</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MODULE: MATCH INTELLIGENCE ──────────────────────────────────────────────
function MatchIntelligence() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("id, user_a_id, user_b_id, compatibility_score, status, created_at, is_mutual, is_unlocked")
        .order("created_at", { ascending: false })
        .limit(60);
      setMatches(data || []);
      setLoading(false);
    })();
  }, []);

  const statusColor = (st) => ({
    generated: C.muted,
    mutual:    C.accent,
    unlocked:  C.gold,
    expired:   C.danger,
    rejected:  C.danger,
  })[st] || C.muted;

  return (
    <div>
      <p style={s.sectionTitle}>Recent Matches</p>
      <table style={s.table}>
        <thead>
          <tr>
            {["User A", "User B", "Score", "Mutual", "Unlocked", "Status", "Created"].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} style={{ ...s.td, textAlign: "center", color: C.muted }}>Loading…</td></tr>}
          {matches.map(m => (
            <tr key={m.id}>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{m.user_a_id?.slice(0, 8)}…</td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{m.user_b_id?.slice(0, 8)}…</td>
              <td style={s.td}>
                <span style={{ color: m.compatibility_score >= 80 ? C.green : m.compatibility_score >= 60 ? C.gold : C.rose, fontWeight: 700 }}>
                  {m.compatibility_score ? m.compatibility_score + "%" : "—"}
                </span>
              </td>
              <td style={s.td}>{m.is_mutual ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.muted }}>✗</span>}</td>
              <td style={s.td}>{m.is_unlocked ? <span style={{ color: C.gold }}>✓</span> : <span style={{ color: C.muted }}>✗</span>}</td>
              <td style={s.td}><StatusBadge status={m.status || "generated"} /></td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MODULE: CONVERSION FUNNEL ────────────────────────────────────────────────
function ConversionFunnel({ stats }) {
  const steps = [
    { label: "Matches Generated", value: stats.totalMatches,   color: C.accent },
    { label: "Viewed",            value: stats.matchesViewed,   color: "#9b8fff" },
    { label: "Interest Shown",    value: stats.interestShown,   color: C.rose },
    { label: "Mutual Interest",   value: stats.mutualInterest,  color: "#ff9eb5" },
    { label: "Payment Initiated", value: stats.payInitiated,    color: C.gold },
    { label: "Payment Completed", value: stats.totalPaid,       color: C.green },
  ];
  const max = steps[0].value || 1;

  return (
    <div>
      <p style={s.sectionTitle}>Interest → Payment Funnel</p>
      <div style={{ ...s.card(), marginBottom: "28px" }}>
        {steps.map((step, i) => (
          <div key={step.label} style={{ marginBottom: i < steps.length - 1 ? "16px" : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", color: C.muted }}>{step.label}</span>
              <span style={{ fontWeight: 600 }}>
                {fmt(step.value)}
                {i > 0 && step.value > 0 && (
                  <span style={{ fontSize: "11px", color: C.muted, marginLeft: "8px" }}>
                    {pct(step.value, steps[0].value)} of total
                  </span>
                )}
              </span>
            </div>
            <div style={{ backgroundColor: C.surfaceHi, borderRadius: "4px", height: "28px", overflow: "hidden" }}>
              <div style={s.funnelBar((step.value / max) * 100, step.color)}>
                {step.value > 0 && fmt(step.value)}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ fontSize: "11px", color: C.muted, textAlign: "right", marginTop: "3px" }}>
                → {pct(steps[i + 1].value, step.value)} conversion
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MODULE: PAYMENT INTELLIGENCE ────────────────────────────────────────────
function PaymentIntelligence() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("all");

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("payments")
        .select("id, user_id, amount, status, provider, created_at, match_id, phone_number")
        .order("created_at", { ascending: false })
        .limit(80);
      if (filter !== "all") q = q.eq("status", filter);
      const { data } = await q;
      setPayments(data || []);
      setLoading(false);
    })();
  }, [filter]);

  const filters = ["all", "completed", "pending", "failed"];

  return (
    <div>
      <p style={s.sectionTitle}>Payment Records</p>
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {filters.map(f => (
          <button
            key={f}
            style={{
              ...s.actionBtn(filter === f ? C.accent : C.muted, filter === f ? C.accentSoft : "transparent"),
              textTransform: "capitalize",
            }}
            onClick={() => { setFilter(f); setLoading(true); }}
          >
            {f}
          </button>
        ))}
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            {["Payment ID", "User", "Phone", "Amount", "Provider", "Status", "Date"].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} style={{ ...s.td, textAlign: "center", color: C.muted }}>Loading…</td></tr>}
          {!loading && payments.length === 0 && (
            <tr><td colSpan={7} style={{ ...s.td, textAlign: "center", color: C.muted }}>No payments found</td></tr>
          )}
          {payments.map(p => (
            <tr key={p.id}>
              <td style={{ ...s.td, fontSize: "11px", color: C.muted }}>{p.id?.slice(0, 12)}…</td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{p.user_id?.slice(0, 8)}…</td>
              <td style={s.td}>{p.phone_number || "—"}</td>
              <td style={{ ...s.td, fontWeight: 600, color: C.gold }}>KES {fmt(p.amount)}</td>
              <td style={s.td}>{p.provider || "IntaSend"}</td>
              <td style={s.td}><StatusBadge status={p.status} /></td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>
                {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MODULE: REPORTS ──────────────────────────────────────────────────────────
function ReportsCenter() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("reports")
        .select("id, reporter_id, reported_id, reason, status, created_at, description")
        .order("created_at", { ascending: false })
        .limit(50);
      setReports(data || []);
      setLoading(false);
    })();
  }, []);

  const resolve = async (id) => {
    await supabase.from("reports").update({ status: "resolved" }).eq("id", id);
    setReports(r => r.map(x => x.id === id ? { ...x, status: "resolved" } : x));
  };

  return (
    <div>
      <p style={s.sectionTitle}>User Reports</p>
      <table style={s.table}>
        <thead>
          <tr>
            {["Reporter", "Reported", "Reason", "Description", "Status", "Date", "Action"].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} style={{ ...s.td, textAlign: "center", color: C.muted }}>Loading…</td></tr>}
          {!loading && reports.length === 0 && (
            <tr><td colSpan={7} style={{ ...s.td, textAlign: "center", color: C.green }}>No pending reports</td></tr>
          )}
          {reports.map(r => (
            <tr key={r.id}>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{r.reporter_id?.slice(0, 8)}…</td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>{r.reported_id?.slice(0, 8)}…</td>
              <td style={s.td}>{r.reason || "—"}</td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.description || "—"}
              </td>
              <td style={s.td}><StatusBadge status={r.status || "pending"} /></td>
              <td style={{ ...s.td, fontSize: "12px", color: C.muted }}>
                {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
              </td>
              <td style={s.td}>
                {r.status !== "resolved" && (
                  <button style={s.actionBtn(C.green, C.greenSoft)} onClick={() => resolve(r.id)}>
                    Resolve
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate  = useNavigate();
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats]   = useState({});
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { count: totalUsers },
        { count: activeUsers },
        { count: newToday },
        { count: section1Complete },
        { count: section2Complete },
        { count: totalMatches },
        { count: mutualInterest },
        { count: paymentsToday },
        { count: pendingReports },
        { count: totalPaid },
        { count: interestShown },
        { count: matchesViewed },
        { count: payInitiated },
      ] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("users").select("*", { count: "exact", head: true }).gte("last_active", new Date(Date.now() - 7*86400000).toISOString()),
        supabase.from("users").select("*", { count: "exact", head: true }).gte("created_at", new Date().toISOString().slice(0,10)),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("section1_complete", true),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("section2_complete", true),
        supabase.from("matches").select("*", { count: "exact", head: true }),
        supabase.from("matches").select("*", { count: "exact", head: true }).eq("is_mutual", true),
        supabase.from("payments").select("*", { count: "exact", head: true }).gte("created_at", new Date().toISOString().slice(0,10)).eq("status","completed"),
        supabase.from("reports").select("*", { count: "exact", head: true }).eq("status","pending"),
        supabase.from("payments").select("*", { count: "exact", head: true }).eq("status","completed"),
        supabase.from("likes").select("*", { count: "exact", head: true }),
        supabase.from("match_interactions").select("*", { count: "exact", head: true }).eq("action","viewed"),
        supabase.from("payments").select("*", { count: "exact", head: true }).in("status",["pending","completed"]),
      ]);

      // Revenue this month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: revData } = await supabase
        .from("payments")
        .select("amount")
        .eq("status", "completed")
        .gte("created_at", monthStart);
      const monthRevenue = (revData || []).reduce((sum, p) => sum + (p.amount || 0), 0);

      // Profiles complete (has at least 1 photo)
      const { count: profilesComplete } = await supabase
        .from("photos")
        .select("user_id", { count: "exact", head: true });

      const tu = totalUsers || 0;
      setStats({
        totalUsers:       tu,
        activeUsers:      activeUsers || 0,
        newToday:         newToday || 0,
        profilesComplete: profilesComplete || 0,
        section1Complete: section1Complete || 0,
        section2Complete: section2Complete || 0,
        s1Rate:           tu > 0 ? ((section1Complete / tu) * 100).toFixed(1) : 0,
        s2Rate:           tu > 0 ? ((section2Complete / tu) * 100).toFixed(1) : 0,
        totalMatches:     totalMatches || 0,
        mutualInterest:   mutualInterest || 0,
        paymentsToday:    paymentsToday || 0,
        monthRevenue:     monthRevenue,
        pendingReports:   pendingReports || 0,
        totalPaid:        totalPaid || 0,
        interestShown:    interestShown || 0,
        matchesViewed:    matchesViewed || 0,
        payInitiated:     payInitiated || 0,
      });

      // System alerts
      const { data: sysAlerts } = await supabase
        .from("system_alerts")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(10);
      setAlerts(sysAlerts || []);

      setLastRefresh(new Date());
    } catch (e) {
      console.error("Admin stats error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const MODULE_TITLES = {
    dashboard: "Executive Dashboard",
    users:     "User Operations Center",
    matches:   "Match Intelligence",
    funnel:    "Conversion Funnel",
    payments:  "Payment Intelligence",
    reports:   "Reports Center",
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        tr:hover td { background: ${C.surfaceHi}; }
      `}</style>

      <div style={s.shell}>
        {/* Sidebar */}
        <aside style={s.sidebar}>
          <div style={s.sidebarLogo}>
            <div style={s.logoMark}>MingleMate</div>
            <div style={s.logoSub}>Command Center</div>
          </div>
          <nav style={s.navSection}>
            {NAV_ITEMS.map(item => (
              <div
                key={item.id}
                style={s.navItem(tab === item.id)}
                onClick={() => setTab(item.id)}
              >
                <span style={s.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </nav>
          <div style={s.sidebarFooter}>
            <div style={{ fontSize: "12px", color: C.muted, marginBottom: "8px" }}>
              <span style={s.statusDot(true)} />
              Supabase Connected
            </div>
            <div
              style={{ fontSize: "12px", color: C.danger, cursor: "pointer" }}
              onClick={() => navigate("/admin")}
            >
              ← Sign Out
            </div>
          </div>
        </aside>

        {/* Main */}
        <main style={s.main}>
          {/* Topbar */}
          <div style={s.topbar}>
            <div>
              <div style={s.topbarTitle}>{MODULE_TITLES[tab]}</div>
              <div style={s.topbarMeta}>
                Last updated: {lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}
              </div>
            </div>
            <button style={s.refreshBtn} onClick={loadStats}>
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>

          {/* Module Content */}
          <div style={s.content}>
            {tab === "dashboard" && (
              <ExecutiveDashboard
                stats={stats}
                alerts={alerts}
                loading={loading}
                onRefresh={loadStats}
              />
            )}
            {tab === "users"    && <UserOperations />}
            {tab === "matches"  && <MatchIntelligence />}
            {tab === "funnel"   && <ConversionFunnel stats={stats} />}
            {tab === "payments" && <PaymentIntelligence />}
            {tab === "reports"  && <ReportsCenter />}
          </div>
        </main>
      </div>
    </>
  );
}
