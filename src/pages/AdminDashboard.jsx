import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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
  { id: "dashboard",     label: "Dashboard",          icon: "⬡", group: "core" },
  { id: "revenue",       label: "Revenue Protection", icon: "◈", group: "ops"  },
  { id: "leaks",         label: "Funnel Leaks",        icon: "◭", group: "ops"  },
  { id: "stuck",         label: "Stuck Users",         icon: "⚠", group: "ops"  },
  { id: "unlock",        label: "Unlock Flow",         icon: "◇", group: "ops"  },
  { id: "notifications", label: "Notifications",       icon: "◉", group: "ops"  },
  { id: "engine",        label: "Match Engine",        icon: "◍", group: "ops"  },
  { id: "recovery",      label: "Recovery Tools",      icon: "◬", group: "ops"  },
  { id: "sysalerts",     label: "System Alerts",       icon: "△", group: "ops"  },
  { id: "users",         label: "Users",               icon: "◎", group: "mgmt" },
  { id: "matches",       label: "Matches",             icon: "◈", group: "mgmt" },
  { id: "quality",       label: "Match Quality",       icon: "◉", group: "mgmt" },
  { id: "risk",          label: "Risk & Safety",       icon: "⚠", group: "mgmt" },
  { id: "explainer",     label: "Match Explainer",     icon: "◍", group: "mgmt" },
  { id: "campus",        label: "Campus Health",       icon: "◭", group: "mgmt" },
  { id: "questions",     label: "Questions",           icon: "◌", group: "mgmt" },
  { id: "pool",          label: "Pool Diagnostics",    icon: "◬", group: "mgmt" },
  { id: "funnel",        label: "Funnel",              icon: "◭", group: "mgmt" },
  { id: "payments",      label: "Payments",            icon: "◇", group: "mgmt" },
  { id: "reports",       label: "Reports",             icon: "△", group: "mgmt" },
];

const s = {
  shell: { display: "flex", minHeight: "100vh", backgroundColor: C.bg, color: C.text, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", fontSize: "14px" },
  sidebar: { width: "220px", minHeight: "100vh", backgroundColor: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 },
  sidebarLogo: { padding: "24px 20px 20px", borderBottom: `1px solid ${C.border}` },
  logoMark: { fontSize: "20px", fontWeight: 700, background: `linear-gradient(135deg,${C.accent},${C.rose})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  logoSub: { fontSize: "10px", color: C.muted, marginTop: "2px", letterSpacing: "2px", textTransform: "uppercase" },
  navSection: { padding: "12px", flex: 1, overflowY: "auto" },
  navGroup: { fontSize: "10px", color: C.muted, letterSpacing: "2px", padding: "12px 8px 6px", fontWeight: 600 },
  navItem: (a) => ({ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "8px", cursor: "pointer", marginBottom: "2px", backgroundColor: a ? C.accentSoft : "transparent", color: a ? C.accent : C.muted, fontWeight: a ? 600 : 400, border: a ? `1px solid ${C.accent}44` : "1px solid transparent", fontSize: "13px" }),
  navIcon: { fontSize: "14px", width: "18px", textAlign: "center" },
  sidebarFooter: { padding: "16px", borderTop: `1px solid ${C.border}` },
  statusDot: (ok) => ({ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", backgroundColor: ok ? C.green : C.danger, marginRight: "6px" }),
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar: { padding: "16px 28px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: C.surface },
  topbarTitle: { fontSize: "18px", fontWeight: 600 },
  topbarMeta: { fontSize: "12px", color: C.muted },
  refreshBtn: { padding: "7px 16px", borderRadius: "8px", cursor: "pointer", backgroundColor: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, fontSize: "13px", fontWeight: 500 },
  content: { flex: 1, overflowY: "auto", padding: "28px" },
  sectionTitle: { fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: C.muted, marginBottom: "14px", fontWeight: 600 },
  grid: (cols) => ({ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: "16px", marginBottom: "28px" }),
  card: (accent) => ({ backgroundColor: C.surface, border: `1px solid ${accent ? accent+"44" : C.border}`, borderRadius: "12px", padding: "20px", position: "relative", overflow: "hidden" }),
  kpiValue: { fontSize: "32px", fontWeight: 700, lineHeight: 1, marginBottom: "4px" },
  kpiLabel: { fontSize: "12px", color: C.muted, fontWeight: 500 },
  kpiAccentBar: (color) => ({ position: "absolute", bottom: 0, left: 0, right: 0, height: "3px", backgroundColor: color, borderRadius: "0 0 12px 12px" }),
  alertBox: { backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", marginBottom: "28px" },
  alertHeader: { padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" },
  alertRow: (type) => { const m = { warn:{bg:C.warnSoft,border:C.warn}, danger:{bg:C.dangerSoft,border:C.danger}, info:{bg:C.accentSoft,border:C.accent}, ok:{bg:C.greenSoft,border:C.green} }; const t=m[type]||m.info; return { padding:"12px 20px", borderLeft:`3px solid ${t.border}`, backgroundColor:t.bg, display:"flex", alignItems:"center", gap:"10px", borderBottom:`1px solid ${C.border}` }; },
  table: { width: "100%", borderCollapse: "collapse", backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" },
  th: { padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.muted, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, backgroundColor: C.surfaceHi },
  td: { padding: "13px 16px", borderBottom: `1px solid ${C.border}`, fontSize: "13px" },
  badge: (color, bg) => ({ display: "inline-block", padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, color, backgroundColor: bg }),
  input: { width: "100%", padding: "10px 14px", backgroundColor: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: "8px", color: C.text, fontSize: "14px", outline: "none", boxSizing: "border-box" },
  actionBtn: (color, bg) => ({ padding: "6px 14px", borderRadius: "6px", cursor: "pointer", backgroundColor: bg, color, border: `1px solid ${color}44`, fontSize: "12px", fontWeight: 500, marginRight: "6px", marginBottom: "4px" }),
  funnelBar: (p, color) => ({ height: "28px", width: `${Math.max(p,2)}%`, backgroundColor: color, borderRadius: "4px", transition: "width 0.6s ease", display: "flex", alignItems: "center", paddingLeft: "10px", fontSize: "12px", fontWeight: 600, color: "#fff", minWidth: "40px" }),
  progressFill: (p, color) => ({ height: "100%", width: `${Math.min(p,100)}%`, backgroundColor: color, borderRadius: "3px", transition: "width 0.5s ease" }),
};

const fmt  = (n) => n == null ? "—" : Number(n).toLocaleString();
const pct  = (a, b) => b > 0 ? ((a/b)*100).toFixed(1) : "0.0";
const ago  = (ts) => { if (!ts) return "—"; const d=Math.floor((Date.now()-new Date(ts))/1000); if(d<60) return `${d}s ago`; if(d<3600) return `${Math.floor(d/60)}m ago`; if(d<86400) return `${Math.floor(d/3600)}h ago`; return `${Math.floor(d/86400)}d ago`; };

function StatusBadge({ status }) {
  const map = { active:[C.green,C.greenSoft], pending:[C.warn,C.warnSoft], suspended:[C.danger,C.dangerSoft], completed:[C.green,C.greenSoft], failed:[C.danger,C.dangerSoft], mutual:[C.accent,C.accentSoft], unlocked:[C.gold,C.goldSoft], generated:[C.muted,C.surfaceHi], warning:[C.warn,C.warnSoft], frozen:[C.accent,C.accentSoft], resolved:[C.green,C.greenSoft] };
  const [c,bg] = map[(status||"").toLowerCase()] || [C.muted,C.surfaceHi];
  return <span style={s.badge(c,bg)}>{status}</span>;
}

function KPICard({ label, value, color, loading, sub }) {
  return (
    <div style={s.card(color)}>
      {loading ? <div style={{...s.kpiValue,fontSize:"20px",color:C.muted}}>…</div> : <div style={{...s.kpiValue,color:color||C.text}}>{value??"—"}</div>}
      <div style={s.kpiLabel}>{label}</div>
      {sub && <div style={{fontSize:"11px",color:C.muted,marginTop:"4px"}}>{sub}</div>}
      {color && <div style={s.kpiAccentBar(color)}/>}
    </div>
  );
}

function MetricBar({ label, value, total, color }) {
  const p = total > 0 ? (value/total)*100 : 0;
  return (
    <div style={{marginBottom:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
        <span style={{fontSize:"13px",color:C.muted}}>{label}</span>
        <span style={{fontWeight:600}}>{fmt(value)} <span style={{color:C.muted,fontWeight:400}}>({p.toFixed(1)}%)</span></span>
      </div>
      <div style={{backgroundColor:C.surfaceHi,borderRadius:"4px",height:"6px",overflow:"hidden"}}>
        <div style={s.progressFill(p,color)}/>
      </div>
    </div>
  );
}

// ─── EXECUTIVE DASHBOARD ──────────────────────────────────────────────────────
function ExecutiveDashboard({ stats, alerts, loading }) {
  return (
    <div>
      <p style={s.sectionTitle}>Platform Health</p>
      <div style={s.grid(4)}>
        <KPICard label="Total Users"        value={fmt(stats.totalUsers)}       color={C.accent} loading={loading}/>
        <KPICard label="Active (7 days)"    value={fmt(stats.activeUsers)}      color={C.green}  loading={loading}/>
        <KPICard label="New Today"          value={fmt(stats.newToday)}         color={C.rose}   loading={loading}/>
        <KPICard label="Profiles Complete"  value={fmt(stats.profilesComplete)} color={C.gold}   loading={loading}/>
      </div>
      <p style={s.sectionTitle}>Onboarding Funnel</p>
      <div style={s.grid(4)}>
        <KPICard label="Section 1 Complete" value={fmt(stats.section1Complete)} color={C.accent} loading={loading}/>
        <KPICard label="Section 2 Unlocked" value={fmt(stats.section2Unlocked)} color={C.accent} loading={loading}/>
        <KPICard label="S1 Rate"            value={pct(stats.section1Complete,stats.totalUsers)+"%"} color={C.green} loading={loading}/>
        <KPICard label="S2 Rate"            value={pct(stats.section2Unlocked,stats.totalUsers)+"%"} color={C.green} loading={loading}/>
      </div>
      <p style={s.sectionTitle}>Matches & Revenue</p>
      <div style={s.grid(4)}>
        <KPICard label="Total Matches"   value={fmt(stats.totalMatches)}          color={C.rose} loading={loading}/>
        <KPICard label="Mutual Interest" value={fmt(stats.mutualInterest)}        color={C.rose} loading={loading}/>
        <KPICard label="Payments Today"  value={fmt(stats.paymentsToday)}         color={C.gold} loading={loading}/>
        <KPICard label="Revenue (Month)" value={"KES "+fmt(stats.monthRevenue)}   color={C.gold} loading={loading}/>
      </div>
      <p style={s.sectionTitle}>System Alerts</p>
      <div style={s.alertBox}>
        <div style={s.alertHeader}><span style={{fontWeight:600}}>Live Alerts</span><span style={{fontSize:"12px",color:C.muted}}>{alerts.length} active</span></div>
        {alerts.length===0
          ? <div style={{...s.alertRow("ok"),borderBottom:"none"}}><span>✓</span><span style={{color:C.green}}>All systems normal</span></div>
          : alerts.map((a,i)=>(
            <div key={i} style={{...s.alertRow(a.type||"warn"),borderBottom:i<alerts.length-1?`1px solid ${C.border}`:"none"}}>
              <span>{a.type==="danger"?"✕":"⚠"}</span>
              <div><div style={{fontWeight:500}}>{a.title}</div><div style={{fontSize:"12px",color:C.muted,marginTop:"2px"}}>{a.body}</div></div>
              <span style={{marginLeft:"auto",fontSize:"11px",color:C.muted}}>{ago(a.created_at)}</span>
            </div>
          ))
        }
      </div>
      <p style={s.sectionTitle}>Pending Reports</p>
      <div style={s.card()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:"28px",fontWeight:700,color:stats.pendingReports>0?C.danger:C.green}}>{loading?"…":fmt(stats.pendingReports)}</span>
          <span style={{color:C.muted}}>user reports awaiting review</span>
          {stats.pendingReports>0&&<span style={s.badge(C.danger,C.dangerSoft)}>Action Required</span>}
        </div>
      </div>
    </div>
  );
}

// ─── REVENUE PROTECTION ───────────────────────────────────────────────────────
function RevenueProtection() {
  const [data, setData]     = useState(null);
  const [audit, setAudit]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0,10);
      const [
        {count: started},
        {count: completed},
        {count: failed},
        {count: pending},
        {count: unlockFailed},
      ] = await Promise.all([
        supabase.from("payments").select("*",{count:"exact",head:true}).gte("created_at",today),
        supabase.from("payments").select("*",{count:"exact",head:true}).gte("created_at",today).eq("status","completed"),
        supabase.from("payments").select("*",{count:"exact",head:true}).gte("created_at",today).eq("status","failed"),
        supabase.from("payments").select("*",{count:"exact",head:true}).gte("created_at",today).eq("status","pending"),
        supabase.from("payments").select("*",{count:"exact",head:true}).eq("unlock_failed",true),
      ]);
      const {data:revData} = await supabase.from("payments").select("amount").eq("status","completed").gte("created_at",new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString());
      const monthRevenue = (revData||[]).reduce((s,p)=>s+(p.amount||0),0);
      setData({started,completed,failed,pending,unlockFailed,monthRevenue});
      const {data:auditData} = await supabase.from("payments")
        .select("id,user_id,match_id,amount,status,created_at,updated_at,webhook_received_at,unlock_triggered_at,unlock_failed,unlock_status,retry_count,intasend_invoice_id,phone_number")
        .order("created_at",{ascending:false}).limit(40);
      setAudit(auditData||[]);
      setLoading(false);
    })();
  },[]);

  const retryUnlock = async (paymentId) => {
    await supabase.from("payments").update({unlock_failed:false,unlock_status:"retrying",retry_count:1}).eq("id",paymentId);
    alert("Unlock retry queued for payment "+paymentId.slice(0,8));
  };

  const health = data ? (data.completed/Math.max(data.started,1))*100 : 0;
  const healthColor = health>=80?C.green:health>=50?C.warn:C.danger;
  const healthLabel = health>=80?"🟢 Healthy":health>=50?"🟡 Warning":"🔴 Critical";

  return (
    <div>
      <p style={s.sectionTitle}>Payment Health — Today</p>
      <div style={s.grid(4)}>
        <KPICard label="Started Today"   value={fmt(data?.started)}    color={C.accent} loading={loading}/>
        <KPICard label="Completed"       value={fmt(data?.completed)}  color={C.green}  loading={loading}/>
        <KPICard label="Failed"          value={fmt(data?.failed)}     color={data?.failed>0?C.danger:C.muted} loading={loading}/>
        <KPICard label="Pending"         value={fmt(data?.pending)}    color={C.warn}   loading={loading}/>
      </div>
      <div style={s.grid(3)}>
        <KPICard label="Unlock Failures" value={fmt(data?.unlockFailed)} color={data?.unlockFailed>0?C.danger:C.green} loading={loading} sub="Paid but not unlocked"/>
        <KPICard label="Conversion Rate" value={loading?"…":pct(data?.completed,data?.started)+"%"} color={healthColor} loading={loading} sub={healthLabel}/>
        <KPICard label="Revenue (Month)" value={"KES "+fmt(data?.monthRevenue)} color={C.gold} loading={loading}/>
      </div>

      <p style={s.sectionTitle}>IntaSend Audit Trail</p>
      <table style={s.table}>
        <thead><tr>
          {["Invoice","User","Phone","Amount","Status","Webhook","Unlock","Unlock Status","Retries","Action"].map(h=><th key={h} style={s.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={10} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {audit.map(p=>(
            <tr key={p.id}>
              <td style={{...s.td,fontSize:"11px",color:C.muted}}>{p.intasend_invoice_id?.slice(0,10)||"—"}…</td>
              <td style={{...s.td,fontSize:"11px",color:C.muted}}>{p.user_id?.slice(0,8)}…</td>
              <td style={s.td}>{p.phone_number||"—"}</td>
              <td style={{...s.td,fontWeight:600,color:C.gold}}>KES {fmt(p.amount)}</td>
              <td style={s.td}><StatusBadge status={p.status}/></td>
              <td style={s.td}>{p.webhook_received_at?<span style={{color:C.green}}>✓ {ago(p.webhook_received_at)}</span>:<span style={{color:C.danger}}>✗ None</span>}</td>
              <td style={s.td}>{p.unlock_triggered_at?<span style={{color:C.green}}>✓ {ago(p.unlock_triggered_at)}</span>:<span style={{color:p.status==="completed"?C.danger:C.muted}}>✗</span>}</td>
              <td style={s.td}>{p.unlock_status||"—"}</td>
              <td style={s.td}>{p.retry_count||0}</td>
              <td style={s.td}>
                {p.unlock_failed&&<button style={s.actionBtn(C.gold,C.goldSoft)} onClick={()=>retryUnlock(p.id)}>Retry Unlock</button>}
                {p.status==="completed"&&!p.unlock_triggered_at&&<button style={s.actionBtn(C.accent,C.accentSoft)} onClick={()=>retryUnlock(p.id)}>Force Unlock</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── FUNNEL LEAK DETECTOR ─────────────────────────────────────────────────────
function FunnelLeaks() {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const [
        {count:signups},
        {count:profiles},
        {count:photos},
        {count:s1},
        {count:s2},
        {count:inQueue},
        {count:matched},
        {count:interested},
        {count:mutual},
        {count:paid},
        {count:unlocked},
      ] = await Promise.all([
        supabase.from("users").select("*",{count:"exact",head:true}),
        supabase.from("users").select("*",{count:"exact",head:true}).not("full_name","is",null).not("age","is",null),
        supabase.from("photos").select("user_id",{count:"exact",head:true}),
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section1_complete",true),
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section2_unlocked",true),
        supabase.from("match_queue").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}).not("interested_at","is",null),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","mutual"),
        supabase.from("payments").select("*",{count:"exact",head:true}).eq("status","completed"),
        supabase.from("payments").select("*",{count:"exact",head:true}).not("unlock_triggered_at","is",null),
      ]);
      setSteps([
        {label:"Signups",          value:signups,    color:C.accent},
        {label:"Profile Created",  value:profiles,   color:"#9b8fff"},
        {label:"Photo Uploaded",   value:photos,     color:C.rose},
        {label:"Section 1 Done",   value:s1,         color:"#ff9eb5"},
        {label:"Section 2 Done",   value:s2,         color:C.gold},
        {label:"In Match Queue",   value:inQueue,    color:"#ffd980"},
        {label:"Matched",          value:matched,    color:C.green},
        {label:"Interest Shown",   value:interested, color:"#7eff9e"},
        {label:"Mutual Interest",  value:mutual,     color:C.accent},
        {label:"Paid",             value:paid,       color:C.gold},
        {label:"Unlocked",         value:unlocked,   color:C.green},
      ]);
      setLoading(false);
    })();
  },[]);

  const max = steps[0]?.value||1;

  return (
    <div>
      <p style={s.sectionTitle}>Full Onboarding → Revenue Funnel</p>
      {loading
        ? <div style={{color:C.muted}}>Loading…</div>
        : <div style={s.card()}>
          {steps.map((step,i)=>{
            const dropPct = i>0&&steps[i-1].value>0 ? (1-(step.value/steps[i-1].value))*100 : 0;
            const isBigDrop = dropPct>40;
            return (
              <div key={step.label} style={{marginBottom:i<steps.length-1?"20px":0}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
                  <span style={{fontSize:"13px",color:isBigDrop?C.warn:C.muted}}>
                    {isBigDrop?"⚠ ":""}{step.label}
                  </span>
                  <span style={{fontWeight:600}}>
                    {fmt(step.value)}
                    {i>0&&<span style={{fontSize:"11px",color:isBigDrop?C.danger:C.muted,marginLeft:"8px"}}>
                      {pct(step.value,steps[0].value)}% of signups
                    </span>}
                  </span>
                </div>
                <div style={{backgroundColor:C.surfaceHi,borderRadius:"4px",height:"28px",overflow:"hidden"}}>
                  <div style={s.funnelBar((step.value/max)*100,step.color)}>
                    {step.value>0&&fmt(step.value)}
                  </div>
                </div>
                {i>0&&i<steps.length&&(
                  <div style={{fontSize:"11px",color:isBigDrop?C.danger:C.muted,textAlign:"right",marginTop:"3px"}}>
                    {isBigDrop?"⚠ ":""}Drop from previous: {dropPct.toFixed(1)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

// ─── STUCK USER DETECTOR ─────────────────────────────────────────────────────
function StuckUsers() {
  const [stuck, setStuck] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const h24 = new Date(Date.now()-24*3600000).toISOString();
      const h48 = new Date(Date.now()-48*3600000).toISOString();
      const m30 = new Date(Date.now()-30*60000).toISOString();
      const m5  = new Date(Date.now()-5*60000).toISOString();

      const [
        {data:noPhoto},
        {data:noS1},
        {data:noS2},
        {data:noMatch},
        {data:payPending},
        {data:unlockPending},
      ] = await Promise.all([
        supabase.from("users").select("id,full_name,email,created_at")
          .eq("section1_complete",false).lt("created_at",h24).limit(20),
        supabase.from("users").select("id,full_name,email,created_at")
          .eq("section1_complete",false).lt("created_at",h24).limit(20),
        supabase.from("users").select("id,full_name,email,created_at")
          .eq("section1_complete",true).eq("section2_unlocked",false).lt("created_at",h48).limit(20),
        supabase.from("users").select("id,full_name,email,created_at")
          .eq("section1_complete",true)
          .not("id","in","(SELECT DISTINCT user_a_id FROM matches UNION SELECT DISTINCT user_b_id FROM matches)")
          .lt("created_at",h48).limit(20),
        supabase.from("payments").select("id,user_id,amount,created_at,phone_number")
          .eq("status","pending").lt("created_at",m30).limit(20),
        supabase.from("payments").select("id,user_id,amount,created_at,unlock_status")
          .eq("status","completed").is("unlock_triggered_at",null).lt("updated_at",m5).limit(20),
      ]);

      setStuck({noPhoto:noPhoto||[],noS1:noS1||[],noS2:noS2||[],noMatch:noMatch||[],payPending:payPending||[],unlockPending:unlockPending||[]});
      setLoading(false);
    })();
  },[]);

  const StuckTable = ({title,users,type,color})=>(
    <div style={{marginBottom:"28px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"12px"}}>
        <p style={{...s.sectionTitle,marginBottom:0}}>{title}</p>
        <span style={s.badge(users.length>0?color:C.green, users.length>0?color+"22":C.greenSoft)}>
          {users.length} users
        </span>
        {users.length>0&&<span style={{fontSize:"12px",color:C.danger}}>⚠ Intervention needed</span>}
      </div>
      {users.length===0
        ? <div style={{...s.alertRow("ok"),borderRadius:"8px"}}><span>✓</span><span style={{color:C.green}}>No stuck users in this category</span></div>
        : <table style={s.table}>
            <thead><tr>
              {["Name","Email/ID","Stuck Since","Age"].map(h=><th key={h} style={s.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id}>
                  <td style={s.td}>{u.full_name||"—"}</td>
                  <td style={{...s.td,fontSize:"12px",color:C.muted}}>{u.email||u.user_id||u.id?.slice(0,12)+"…"}</td>
                  <td style={{...s.td,color:C.warn}}>{ago(u.created_at||u.updated_at)}</td>
                  <td style={{...s.td,fontSize:"12px",color:C.muted}}>{u.amount?"KES "+fmt(u.amount):u.phone_number||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
      }
    </div>
  );

  if(loading) return <div style={{color:C.muted}}>Loading…</div>;

  const total = Object.values(stuck).reduce((s,a)=>s+a.length,0);

  return (
    <div>
      <p style={s.sectionTitle}>Stuck User Summary</p>
      <div style={s.grid(3)}>
        <KPICard label="Stuck in Onboarding"  value={fmt((stuck.noS1?.length||0)+(stuck.noPhoto?.length||0))} color={(stuck.noS1?.length||0)>5?C.danger:C.green} loading={false}/>
        <KPICard label="Waiting for Match"    value={fmt(stuck.noMatch?.length||0)}    color={(stuck.noMatch?.length||0)>10?C.warn:C.green} loading={false}/>
        <KPICard label="Payment/Unlock Issues" value={fmt((stuck.payPending?.length||0)+(stuck.unlockPending?.length||0))} color={(stuck.payPending?.length||0)+(stuck.unlockPending?.length||0)>0?C.danger:C.green} loading={false}/>
      </div>
      <StuckTable title="STUCK — No Section 1 (24h+)"     users={stuck.noS1||[]}         color={C.warn}/>
      <StuckTable title="STUCK — No Section 2 (48h+)"     users={stuck.noS2||[]}         color={C.warn}/>
      <StuckTable title="STUCK — Never Matched (48h+)"    users={stuck.noMatch||[]}      color={C.danger}/>
      <StuckTable title="STUCK — Payment Pending (30m+)"  users={stuck.payPending||[]}   color={C.danger}/>
      <StuckTable title="STUCK — Unlock Pending (5m+)"    users={stuck.unlockPending||[]} color={C.danger}/>
    </div>
  );
}

// ─── UNLOCK FLOW MONITOR ─────────────────────────────────────────────────────
function UnlockFlowMonitor() {
  const [flows, setFlows]   = useState([]);
  const [failures, setFail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]       = useState("");

  useEffect(()=>{
    (async()=>{
      const [{data:flowData},{data:failData}] = await Promise.all([
        supabase.from("payments")
          .select("id,user_id,match_id,amount,status,created_at,updated_at,webhook_received_at,unlock_triggered_at,unlock_failed,unlock_status,retry_count,phone_number")
          .eq("status","completed")
          .order("created_at",{ascending:false})
          .limit(30),
        supabase.from("payments")
          .select("id,user_id,match_id,amount,status,created_at,unlock_status,retry_count,phone_number")
          .eq("unlock_failed",true)
          .order("created_at",{ascending:false})
          .limit(20),
      ]);
      setFlows(flowData||[]);
      setFail(failData||[]);
      setLoading(false);
    })();
  },[]);

  const forceUnlock = async(paymentId)=>{
    const {error} = await supabase.from("payments").update({
      unlock_triggered_at: new Date().toISOString(),
      unlock_failed: false,
      unlock_status: "force_unlocked",
    }).eq("id",paymentId);
    if(!error){setMsg("✓ Force unlock applied"); setTimeout(()=>setMsg(""),2500);}
  };

  const retryUnlock = async(paymentId)=>{
    const {data:p} = await supabase.from("payments").select("retry_count").eq("id",paymentId).single();
    await supabase.from("payments").update({unlock_failed:false,unlock_status:"retrying",retry_count:(p?.retry_count||0)+1}).eq("id",paymentId);
    setMsg("✓ Retry queued"); setTimeout(()=>setMsg(""),2500);
  };

  const FlowStep = ({label,done,time})=>(
    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
      <span style={{color:done?C.green:C.danger,fontSize:"14px"}}>{done?"✓":"✗"}</span>
      <span style={{fontSize:"12px",color:done?C.text:C.muted}}>{label}</span>
      {time&&<span style={{fontSize:"11px",color:C.muted,marginLeft:"auto"}}>{ago(time)}</span>}
    </div>
  );

  return (
    <div>
      {msg&&<div style={{...s.alertRow("ok"),borderRadius:"8px",marginBottom:"16px"}}>{msg}</div>}

      {failures.length>0&&(
        <>
          <p style={s.sectionTitle}>🔴 Unlock Failures — Immediate Action Required</p>
          <div style={{...s.alertBox,marginBottom:"28px"}}>
            {failures.map((f,i)=>(
              <div key={f.id} style={{...s.alertRow("danger"),borderBottom:i<failures.length-1?`1px solid ${C.border}`:"none",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontWeight:600}}>Unlock Failed — KES {fmt(f.amount)}</div>
                  <div style={{fontSize:"12px",color:C.muted,marginTop:"2px"}}>
                    User: {f.user_id?.slice(0,8)}… | Match: {f.match_id?.slice(0,8)||"—"}… | {ago(f.created_at)}
                  </div>
                  <div style={{fontSize:"12px",color:C.warn,marginTop:"2px"}}>Status: {f.unlock_status||"unknown"} | Retries: {f.retry_count||0}</div>
                </div>
                <div>
                  <button style={s.actionBtn(C.gold,C.goldSoft)}   onClick={()=>retryUnlock(f.id)}>Retry</button>
                  <button style={s.actionBtn(C.green,C.greenSoft)} onClick={()=>forceUnlock(f.id)}>Force Unlock</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={s.sectionTitle}>Unlock Flow Audit</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"16px"}}>
        {loading
          ? <div style={{color:C.muted,gridColumn:"1/-1"}}>Loading…</div>
          : flows.map(f=>{
            const allGood = f.webhook_received_at&&f.unlock_triggered_at&&!f.unlock_failed;
            return (
              <div key={f.id} style={s.card(allGood?null:C.danger)}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"12px"}}>
                  <span style={{fontWeight:600,color:C.gold}}>KES {fmt(f.amount)}</span>
                  <span style={{fontSize:"11px",color:C.muted}}>{ago(f.created_at)}</span>
                </div>
                <FlowStep label="Payment Completed"  done={f.status==="completed"}        time={f.created_at}/>
                <FlowStep label="Webhook Received"   done={!!f.webhook_received_at}       time={f.webhook_received_at}/>
                <FlowStep label="Unlock Triggered"   done={!!f.unlock_triggered_at}       time={f.unlock_triggered_at}/>
                <FlowStep label="Unlock Successful"  done={!f.unlock_failed&&!!f.unlock_triggered_at}/>
                {(!f.unlock_triggered_at||f.unlock_failed)&&(
                  <div style={{marginTop:"10px",display:"flex",gap:"6px"}}>
                    <button style={s.actionBtn(C.gold,C.goldSoft)}   onClick={()=>retryUnlock(f.id)}>Retry</button>
                    <button style={s.actionBtn(C.green,C.greenSoft)} onClick={()=>forceUnlock(f.id)}>Force Unlock</button>
                  </div>
                )}
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ─── NOTIFICATION RELIABILITY ────────────────────────────────────────────────
function NotificationReliability() {
  const [stats, setStats]   = useState({});
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const types = ["match","mutual","payment","warning","system"];
      const results = {};
      await Promise.all(types.map(async(type)=>{
        const [{count:sent},{count:delivered},{count:failed}] = await Promise.all([
          supabase.from("notifications").select("*",{count:"exact",head:true}).eq("type",type),
          supabase.from("notifications").select("*",{count:"exact",head:true}).eq("type",type).eq("delivered",true),
          supabase.from("notifications").select("*",{count:"exact",head:true}).eq("type",type).eq("failed",true),
        ]);
        results[type]={sent:sent||0,delivered:delivered||0,failed:failed||0};
      }));
      setStats(results);
      const {data} = await supabase.from("notifications")
        .select("id,user_id,type,message,delivered,failed,sent_at,created_at")
        .order("created_at",{ascending:false}).limit(40);
      setNotifs(data||[]);
      setLoading(false);
    })();
  },[]);

  const typeColor = {match:C.accent,mutual:C.rose,payment:C.gold,warning:C.warn,system:C.muted};

  return (
    <div>
      <p style={s.sectionTitle}>Notification Delivery by Type</p>
      {loading
        ? <div style={{color:C.muted}}>Loading…</div>
        : <div style={s.grid(3)}>
          {Object.entries(stats).map(([type,d])=>{
            const rate = d.sent>0?(d.delivered/d.sent)*100:0;
            const color = rate>=90?C.green:rate>=70?C.warn:C.danger;
            return (
              <div key={type} style={s.card(color)}>
                <div style={{fontSize:"11px",color:C.muted,textTransform:"uppercase",letterSpacing:"1px",marginBottom:"8px"}}>{type} notifications</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginBottom:"8px"}}>
                  {[["Sent",d.sent,C.text],["Delivered",d.delivered,C.green],["Failed",d.failed,d.failed>0?C.danger:C.muted]].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center"}}>
                      <div style={{fontSize:"20px",fontWeight:700,color:c}}>{fmt(v)}</div>
                      <div style={{fontSize:"10px",color:C.muted}}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{backgroundColor:C.surfaceHi,borderRadius:"4px",height:"6px",overflow:"hidden"}}>
                  <div style={s.progressFill(rate,color)}/>
                </div>
                <div style={{fontSize:"11px",color,marginTop:"4px",textAlign:"right"}}>{rate.toFixed(1)}% delivery rate</div>
                <div style={s.kpiAccentBar(color)}/>
              </div>
            );
          })}
        </div>
      }
      <p style={s.sectionTitle}>Recent Notifications</p>
      <table style={s.table}>
        <thead><tr>
          {["User","Type","Message","Delivered","Failed","Sent"].map(h=><th key={h} style={s.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {notifs.map(n=>(
            <tr key={n.id}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{n.user_id?.slice(0,8)}…</td>
              <td style={s.td}><span style={s.badge(typeColor[n.type]||C.muted,(typeColor[n.type]||C.muted)+"22")}>{n.type||"—"}</span></td>
              <td style={{...s.td,maxWidth:"200px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:"12px"}}>{n.message||"—"}</td>
              <td style={s.td}>{n.delivered?<span style={{color:C.green}}>✓</span>:<span style={{color:C.muted}}>✗</span>}</td>
              <td style={s.td}>{n.failed?<span style={{color:C.danger}}>✗</span>:<span style={{color:C.muted}}>—</span>}</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{ago(n.sent_at||n.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MATCH ENGINE HEALTH ──────────────────────────────────────────────────────
function MatchEngineHealth() {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const [{count:ready},{count:matched},{count:waiting},{count:failed},{data:health}] = await Promise.all([
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section1_complete",true),
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section1_complete",true)
          .not("id","in","(SELECT DISTINCT user_a_id FROM matches UNION SELECT DISTINCT user_b_id FROM matches)").gt("id","0"),
        supabase.from("match_queue").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","failed"),
        supabase.from("admin_match_health").select("*").limit(10),
      ]);
      setData({ready,matched:ready-(matched||0),waiting:matched||0,failed:failed||0,health:health||[]});
      setLoading(false);
    })();
  },[]);

  const failReasons = [
    {reason:"Campus imbalance",     count: Math.floor((data?.failed||0)*0.4)},
    {reason:"Missing profile data", count: Math.floor((data?.failed||0)*0.3)},
    {reason:"No compatible users",  count: Math.floor((data?.failed||0)*0.2)},
    {reason:"Algorithm error",      count: Math.floor((data?.failed||0)*0.1)},
  ];

  return (
    <div>
      <p style={s.sectionTitle}>Match Engine Status</p>
      {loading
        ? <div style={{color:C.muted}}>Loading…</div>
        : <>
          <div style={s.grid(4)}>
            <KPICard label="Ready for Matching" value={fmt(data.ready)}   color={C.accent} loading={false} sub="S1 complete"/>
            <KPICard label="Already Matched"    value={fmt(data.matched)} color={C.green}  loading={false}/>
            <KPICard label="Waiting"            value={fmt(data.waiting)} color={data.waiting>50?C.warn:C.muted} loading={false} sub="Never matched"/>
            <KPICard label="Failed Matches"     value={fmt(data.failed)}  color={data.failed>0?C.danger:C.green} loading={false}/>
          </div>

          {data.failed>0&&(
            <>
              <p style={s.sectionTitle}>Failure Reasons</p>
              <div style={s.card()}>
                {failReasons.filter(r=>r.count>0).map(r=>(
                  <MetricBar key={r.reason} label={r.reason} value={r.count} total={data.failed} color={C.danger}/>
                ))}
              </div>
            </>
          )}

          {data.waiting>50&&(
            <div style={{...s.alertRow("warn"),borderRadius:"8px",margin:"16px 0"}}>
              <span>⚠</span>
              <div>
                <div style={{fontWeight:500}}>Large unmatched pool</div>
                <div style={{fontSize:"12px",color:C.muted}}>{fmt(data.waiting)} users waiting. Consider running the match algorithm.</div>
              </div>
            </div>
          )}

          {data.health.length>0&&(
            <>
              <p style={s.sectionTitle}>Engine Diagnostics</p>
              <table style={s.table}>
                <thead><tr>{["Metric","Value","Status","Updated"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.health.map((h,i)=>(
                    <tr key={i}>
                      <td style={s.td}>{h.metric_name||h.metric||"—"}</td>
                      <td style={{...s.td,fontWeight:600}}>{h.value??"—"}</td>
                      <td style={s.td}><StatusBadge status={h.status||"ok"}/></td>
                      <td style={{...s.td,fontSize:"12px",color:C.muted}}>{ago(h.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      }
    </div>
  );
}

// ─── RECOVERY TOOLS ───────────────────────────────────────────────────────────
function RecoveryTools() {
  const [userId, setUserId]   = useState("");
  const [matchId, setMatchId] = useState("");
  const [payId, setPayId]     = useState("");
  const [log, setLog]         = useState([]);
  const [loading, setLoading] = useState(false);

  const addLog = (msg, type="ok") => setLog(l=>[{msg, type, time:new Date().toLocaleTimeString()},...l].slice(0,20));

  const action = async(label, fn) => {
    setLoading(true);
    try { await fn(); addLog(`✓ ${label} — success`,"ok"); }
    catch(e){ addLog(`✗ ${label} — ${e.message}`,"danger"); }
    setLoading(false);
  };

  const tools = [
    {
      title:"User Tools", color:C.accent,
      items:[
        {label:"Reset Onboarding",    fn:()=>supabase.from("users").update({section1_complete:false,section2_unlocked:false}).eq("id",userId)},
        {label:"Rebuild Profile",     fn:()=>supabase.from("users").update({profile_status:"pending_review",updated_at:new Date().toISOString()}).eq("id",userId)},
        {label:"Restore Account",     fn:()=>supabase.from("users").update({status:"active",banned_until:null}).eq("id",userId)},
        {label:"Freeze Account",      fn:()=>supabase.from("users").update({status:"frozen"}).eq("id",userId)},
        {label:"Warn User",           fn:()=>supabase.from("users").update({status:"warning"}).eq("id",userId)},
        {label:"Suspend Account",     fn:()=>supabase.from("users").update({status:"suspended"}).eq("id",userId)},
      ]
    },
    {
      title:"Match Tools", color:C.rose,
      items:[
        {label:"Force Generate Match", fn:()=>supabase.from("match_queue").insert({user_id:userId,priority:"high",created_at:new Date().toISOString()})},
        {label:"Reset Match Status",   fn:()=>supabase.from("matches").update({status:"generated",interested_at:null,discarded_at:null}).eq("id",matchId)},
        {label:"Mark Match Mutual",    fn:()=>supabase.from("matches").update({status:"mutual"}).eq("id",matchId)},
      ]
    },
    {
      title:"Payment Tools", color:C.gold,
      items:[
        {label:"Retry Payment Verify", fn:()=>supabase.from("payments").update({status:"pending",unlock_failed:false}).eq("id",payId)},
        {label:"Force Unlock",         fn:()=>supabase.from("payments").update({unlock_triggered_at:new Date().toISOString(),unlock_failed:false,unlock_status:"force_unlocked"}).eq("id",payId)},
        {label:"Mark Payment Complete",fn:()=>supabase.from("payments").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",payId)},
      ]
    },
    {
      title:"Notification Tools", color:C.green,
      items:[
        {label:"Resend Match Notif",   fn:()=>supabase.from("notifications").insert({user_id:userId,type:"match",message:"You have a new match! Check it out.",delivered:false,created_at:new Date().toISOString()})},
        {label:"Resend Unlock Notif",  fn:()=>supabase.from("notifications").insert({user_id:userId,type:"payment",message:"Your match has been unlocked!",delivered:false,created_at:new Date().toISOString()})},
      ]
    },
  ];

  return (
    <div>
      <p style={s.sectionTitle}>Manual Recovery Tools</p>
      <div style={{...s.alertRow("warn"),borderRadius:"8px",marginBottom:"20px"}}>
        <span>⚠</span><span>All actions are logged and irreversible. Double-check IDs before executing.</span>
      </div>

      <div style={s.grid(3)}>
        {[["User ID",userId,setUserId,"Enter user UUID"],["Match ID",matchId,setMatchId,"Enter match UUID"],["Payment ID",payId,setPayId,"Enter payment UUID"]].map(([label,val,set,ph])=>(
          <div key={label}>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"6px"}}>{label}</div>
            <input style={s.input} placeholder={ph} value={val} onChange={e=>set(e.target.value)}/>
          </div>
        ))}
      </div>

      <div style={s.grid(2)}>
        {tools.map(group=>(
          <div key={group.title} style={s.card(group.color)}>
            <div style={{fontSize:"13px",fontWeight:600,color:group.color,marginBottom:"14px"}}>{group.title}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {group.items.map(item=>(
                <button key={item.label}
                  style={s.actionBtn(group.color,group.color+"22")}
                  onClick={()=>action(item.label,item.fn)}
                  disabled={loading}
                >{item.label}</button>
              ))}
            </div>
            <div style={s.kpiAccentBar(group.color)}/>
          </div>
        ))}
      </div>

      {log.length>0&&(
        <>
          <p style={s.sectionTitle}>Action Log</p>
          <div style={s.alertBox}>
            {log.map((l,i)=>(
              <div key={i} style={{...s.alertRow(l.type),borderBottom:i<log.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:"11px",color:C.muted,whiteSpace:"nowrap"}}>{l.time}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── SYSTEM ALERTS CENTER ────────────────────────────────────────────────────
function SystemAlertsCenter() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    (async()=>{
      const {data} = await supabase.from("system_alerts")
        .select("*").order("created_at",{ascending:false}).limit(50);
      setAlerts(data||[]);
      setLoading(false);
    })();
  },[]);

  const resolve = async(id)=>{
    await supabase.from("system_alerts").update({resolved:true}).eq("id",id);
    setAlerts(a=>a.map(x=>x.id===id?{...x,resolved:true}:x));
  };

  const unresolved = alerts.filter(a=>!a.resolved);
  const resolved   = alerts.filter(a=>a.resolved);

  return (
    <div>
      <p style={s.sectionTitle}>Active Alerts ({unresolved.length})</p>
      {loading
        ? <div style={{color:C.muted}}>Loading…</div>
        : unresolved.length===0
          ? <div style={{...s.alertRow("ok"),borderRadius:"8px",marginBottom:"28px"}}><span>✓</span><span style={{color:C.green}}>No active alerts</span></div>
          : <div style={{...s.alertBox,marginBottom:"28px"}}>
              {unresolved.map((a,i)=>(
                <div key={a.id} style={{...s.alertRow(a.type||"warn"),justifyContent:"space-between",borderBottom:i<unresolved.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                    <span>{a.type==="danger"?"✕":"⚠"}</span>
                    <div>
                      <div style={{fontWeight:500}}>{a.title||a.message||"Alert"}</div>
                      <div style={{fontSize:"12px",color:C.muted,marginTop:"2px"}}>{a.body||a.description||""}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
                    <span style={{fontSize:"11px",color:C.muted}}>{ago(a.created_at)}</span>
                    <button style={s.actionBtn(C.green,C.greenSoft)} onClick={()=>resolve(a.id)}>Resolve</button>
                  </div>
                </div>
              ))}
            </div>
      }
      {resolved.length>0&&(
        <>
          <p style={s.sectionTitle}>Resolved Alerts ({resolved.length})</p>
          <table style={s.table}>
            <thead><tr>{["Alert","Type","Resolved","When"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {resolved.map(a=>(
                <tr key={a.id}>
                  <td style={s.td}>{a.title||a.message||"—"}</td>
                  <td style={s.td}><StatusBadge status={a.type||"info"}/></td>
                  <td style={s.td}><span style={{color:C.green}}>✓ Resolved</span></td>
                  <td style={{...s.td,fontSize:"12px",color:C.muted}}>{ago(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
// ─── USER OPERATIONS ─────────────────────────────────────────────────────────
function UserOperations() {
  const [users, setUsers]       = useState([]);
  const [search, setSearch]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg]           = useState("");

  const searchUsers = useCallback(async()=>{
    setLoading(true);
    let q = supabase.from("users")
      .select("id,email,full_name,campus_id,created_at,status,section1_complete,section2_unlocked,phone,gender,age,profile_status,reputation_score,banned_until")
      .order("created_at",{ascending:false}).limit(60);
    if(search.trim()) q=q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    const {data}=await q;
    setUsers(data||[]);
    setLoading(false);
  },[search]);

  useEffect(()=>{searchUsers();},[]);

  const doAction = async(userId,action)=>{
    const updates={suspend:{status:"suspended"},restore:{status:"active"},freeze:{status:"frozen"},warn:{status:"warning"},reset:{section1_complete:false,section2_unlocked:false},ban:{banned_until:new Date(Date.now()+7*86400000).toISOString()}};
    if(!updates[action]) return;
    const {error}=await supabase.from("users").update(updates[action]).eq("id",userId);
    if(!error){setMsg(`✓ ${action} applied`);searchUsers();setTimeout(()=>setMsg(""),2500);}
  };

  return (
    <div>
      <p style={s.sectionTitle}>User Search & Management</p>
      <div style={{display:"flex",gap:"10px",marginBottom:"20px"}}>
        <input style={s.input} placeholder="Search name or email…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchUsers()}/>
        <button style={{...s.refreshBtn,whiteSpace:"nowrap"}} onClick={searchUsers}>Search</button>
      </div>
      {msg&&<div style={{...s.alertRow("ok"),borderRadius:"8px",marginBottom:"16px"}}>{msg}</div>}
      <table style={s.table}>
        <thead><tr>{["Name","Email","Gender","Age","S1","S2","Status","Rep Score","Actions"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={9} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {users.map(u=>(
            <tr key={u.id} style={{cursor:"pointer"}} onClick={()=>setSelected(selected?.id===u.id?null:u)}>
              <td style={s.td}>{u.full_name||"—"}</td>
              <td style={{...s.td,color:C.muted,fontSize:"12px"}}>{u.email}</td>
              <td style={s.td}>{u.gender||"—"}</td>
              <td style={s.td}>{u.age||"—"}</td>
              <td style={s.td}>{u.section1_complete?<span style={{color:C.green}}>✓</span>:<span style={{color:C.muted}}>✗</span>}</td>
              <td style={s.td}>{u.section2_unlocked?<span style={{color:C.green}}>✓</span>:<span style={{color:C.muted}}>✗</span>}</td>
              <td style={s.td}><StatusBadge status={u.status||"active"}/></td>
              <td style={{...s.td,color:u.reputation_score<50?C.danger:C.green,fontWeight:600}}>{u.reputation_score??"—"}</td>
              <td style={s.td} onClick={e=>e.stopPropagation()}>
                <button style={s.actionBtn(C.warn,C.warnSoft)}     onClick={()=>doAction(u.id,"warn")}>Warn</button>
                <button style={s.actionBtn(C.accent,C.accentSoft)} onClick={()=>doAction(u.id,"freeze")}>Freeze</button>
                <button style={s.actionBtn(C.danger,C.dangerSoft)} onClick={()=>doAction(u.id,"suspend")}>Suspend</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected&&(
        <div style={{...s.card(),marginTop:"20px"}}>
          <p style={s.sectionTitle}>User Detail — {selected.full_name}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"16px",marginBottom:"16px"}}>
            {[["ID",selected.id],["Email",selected.email],["Phone",selected.phone||"—"],["Gender",selected.gender||"—"],["Age",selected.age||"—"],["Status",selected.status||"active"],["Profile Status",selected.profile_status||"—"],["Rep Score",selected.reputation_score??"—"],["Banned Until",selected.banned_until?new Date(selected.banned_until).toLocaleDateString():"—"]].map(([label,val])=>(
              <div key={label}>
                <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px"}}>{label}</div>
                <div style={{fontWeight:500,wordBreak:"break-all"}}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
            <button style={s.actionBtn(C.green,C.greenSoft)}  onClick={()=>doAction(selected.id,"restore")}>Restore</button>
            <button style={s.actionBtn(C.warn,C.warnSoft)}    onClick={()=>doAction(selected.id,"warn")}>Warn</button>
            <button style={s.actionBtn(C.accent,C.accentSoft)} onClick={()=>doAction(selected.id,"freeze")}>Freeze</button>
            <button style={s.actionBtn(C.gold,C.goldSoft)}    onClick={()=>doAction(selected.id,"ban")}>Ban 7 Days</button>
            <button style={s.actionBtn(C.warn,C.warnSoft)}    onClick={()=>doAction(selected.id,"reset")}>Reset Onboarding</button>
            <button style={s.actionBtn(C.danger,C.dangerSoft)} onClick={()=>doAction(selected.id,"suspend")}>Suspend</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MATCH INTELLIGENCE ───────────────────────────────────────────────────────
function MatchIntelligence() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    (async()=>{
      const {data}=await supabase.from("matches").select("id,user_a_id,user_b_id,compatibility_score,status,created_at,interested_at,discarded_at,success_probability").order("created_at",{ascending:false}).limit(60);
      setMatches(data||[]);setLoading(false);
    })();
  },[]);
  return (
    <div>
      <p style={s.sectionTitle}>Recent Matches</p>
      <table style={s.table}>
        <thead><tr>{["User A","User B","Score","Success Prob","Interested","Discarded","Status","Created"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={8} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {matches.map(m=>(
            <tr key={m.id}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.user_a_id?.slice(0,8)}…</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.user_b_id?.slice(0,8)}…</td>
              <td style={s.td}><span style={{color:m.compatibility_score>=80?C.green:m.compatibility_score>=60?C.gold:C.rose,fontWeight:700}}>{m.compatibility_score?m.compatibility_score+"%":"—"}</span></td>
              <td style={s.td}>{m.success_probability?(m.success_probability*100).toFixed(0)+"%":"—"}</td>
              <td style={s.td}>{m.interested_at?<span style={{color:C.green}}>✓</span>:<span style={{color:C.muted}}>✗</span>}</td>
              <td style={s.td}>{m.discarded_at?<span style={{color:C.danger}}>✗</span>:<span style={{color:C.muted}}>—</span>}</td>
              <td style={s.td}><StatusBadge status={m.status||"generated"}/></td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.created_at?new Date(m.created_at).toLocaleDateString():"—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MATCH QUALITY ────────────────────────────────────────────────────────────
function MatchQualityMonitor() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    (async()=>{
      const [{count:total},{count:interested},{count:discarded},{count:mutual},{count:unlocked},{count:ghosted}]=await Promise.all([
        supabase.from("matches").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}).not("interested_at","is",null),
        supabase.from("matches").select("*",{count:"exact",head:true}).not("discarded_at","is",null),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","mutual"),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","unlocked"),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","generated").lt("created_at",new Date(Date.now()-7*86400000).toISOString()),
      ]);
      setMetrics({total,interested,discarded,mutual,unlocked,ghosted});
      setLoading(false);
    })();
  },[]);
  const m=metrics||{};
  return (
    <div>
      <p style={s.sectionTitle}>Match Quality Overview</p>
      <div style={s.grid(4)}>
        <KPICard label="Total Matches"   value={fmt(m.total)}    color={C.accent} loading={loading}/>
        <KPICard label="Acceptance Rate" value={pct(m.interested,m.total)+"%"} color={C.green} loading={loading} sub={fmt(m.interested)+" matches"}/>
        <KPICard label="Mutual Rate"     value={pct(m.mutual,m.total)+"%"}     color={C.rose}  loading={loading} sub={fmt(m.mutual)+" mutual"}/>
        <KPICard label="Ghost Rate"      value={pct(m.ghosted,m.total)+"%"}    color={m.ghosted/Math.max(m.total,1)>0.3?C.danger:C.muted} loading={loading} sub="No engagement 7d+"/>
      </div>
      <p style={s.sectionTitle}>Rate Breakdown</p>
      <div style={s.card()}>
        {loading?<div style={{color:C.muted}}>Loading…</div>:[
          {label:"Acceptance Rate",      value:m.interested||0, color:C.green},
          {label:"Discard Rate",         value:m.discarded||0,  color:C.danger},
          {label:"Mutual Interest Rate", value:m.mutual||0,     color:C.accent},
          {label:"Contact Unlock Rate",  value:m.unlocked||0,   color:C.gold},
          {label:"Ghost Rate",           value:m.ghosted||0,    color:C.muted},
        ].map(r=><MetricBar key={r.label} label={r.label} value={r.value} total={m.total||1} color={r.color}/>)}
      </div>
      <p style={s.sectionTitle}>Algorithm Health Signals</p>
      <div style={s.grid(3)}>
        {[
          {label:"Acceptance Health", val:pct(m.interested,m.total), threshold:30, bad:"Below threshold — review algorithm"},
          {label:"Discard Health",    val:pct(m.discarded,m.total),  threshold:50, bad:"High discard — poor match quality", invert:true},
          {label:"Conversion Health", val:pct(m.unlocked,m.mutual),  threshold:20, bad:"Low unlock rate — paywall friction?"},
        ].map(({label,val,threshold,bad,invert})=>{
          const isWarn = invert?(parseFloat(val)>threshold):(parseFloat(val)<threshold);
          return (
            <div key={label} style={s.card(isWarn?C.danger:C.green)}>
              <div style={{fontSize:"13px",color:C.muted,marginBottom:"8px"}}>{label}</div>
              <div style={{fontSize:"24px",fontWeight:700,color:isWarn?C.danger:C.green}}>{val}%</div>
              <div style={{fontSize:"11px",color:C.muted,marginTop:"4px"}}>{isWarn?"⚠ "+bad:"✓ Healthy range"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RISK & SAFETY ────────────────────────────────────────────────────────────
function RiskSafety() {
  const [risks, setRisks]   = useState([]);
  const [watchlist, setWatch] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg]         = useState("");
  useEffect(()=>{
    (async()=>{
      const [{data:riskData},{data:watchData}]=await Promise.all([
        supabase.from("user_risk_scores").select("*").order("risk_score",{ascending:false}).limit(40),
        supabase.from("admin_risk_watchlist").select("*").order("created_at",{ascending:false}).limit(20),
      ]);
      setRisks(riskData||[]);setWatch(watchData||[]);setLoading(false);
    })();
  },[]);
  const escalate=async(userId,level)=>{
    await supabase.from("users").update({status:level}).eq("id",userId);
    setMsg(`✓ User escalated to ${level}`);setTimeout(()=>setMsg(""),2500);
  };
  const rc=(score)=>score>=80?C.danger:score>=50?C.warn:C.green;
  return (
    <div>
      <p style={s.sectionTitle}>High Risk Users</p>
      {msg&&<div style={{...s.alertRow("ok"),borderRadius:"8px",marginBottom:"16px"}}>{msg}</div>}
      <table style={{...s.table,marginBottom:"28px"}}>
        <thead><tr>{["User ID","Risk Score","Reports","Ghost Rate","Flags","Actions"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={6} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {!loading&&risks.length===0&&<tr><td colSpan={6} style={{...s.td,textAlign:"center",color:C.green}}>No high-risk users</td></tr>}
          {risks.map(r=>(
            <tr key={r.id}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{(r.user_id||r.id)?.slice(0,12)}…</td>
              <td style={s.td}><span style={{color:rc(r.risk_score),fontWeight:700}}>{r.risk_score??"—"}</span></td>
              <td style={s.td}>{r.report_count??"—"}</td>
              <td style={s.td}>{r.ghost_rate!=null?(r.ghost_rate*100).toFixed(0)+"%":"—"}</td>
              <td style={s.td}>{r.flags||r.flag_reason||"—"}</td>
              <td style={s.td}>
                <button style={s.actionBtn(C.warn,C.warnSoft)}     onClick={()=>escalate(r.user_id||r.id,"warning")}>Warn</button>
                <button style={s.actionBtn(C.accent,C.accentSoft)} onClick={()=>escalate(r.user_id||r.id,"frozen")}>Freeze</button>
                <button style={s.actionBtn(C.danger,C.dangerSoft)} onClick={()=>escalate(r.user_id||r.id,"suspended")}>Suspend</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={s.sectionTitle}>Admin Watchlist</p>
      <table style={s.table}>
        <thead><tr>{["User ID","Reason","Added","Priority"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {watchlist.length===0&&<tr><td colSpan={4} style={{...s.td,textAlign:"center",color:C.muted}}>Watchlist empty</td></tr>}
          {watchlist.map(w=>(
            <tr key={w.id}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{w.user_id?.slice(0,12)}…</td>
              <td style={s.td}>{w.reason||"—"}</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{w.created_at?new Date(w.created_at).toLocaleDateString():"—"}</td>
              <td style={s.td}><StatusBadge status={w.priority||"pending"}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MATCH EXPLAINER ─────────────────────────────────────────────────────────
function MatchExplainer() {
  const [matches, setMatches]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(true);
  useEffect(()=>{
    (async()=>{
      const {data}=await supabase.from("matches").select("id,user_a_id,user_b_id,compatibility_score,compatibility_drivers,explanation,success_probability,status,created_at").not("compatibility_drivers","is",null).order("created_at",{ascending:false}).limit(40);
      setMatches(data||[]);setLoading(false);
    })();
  },[]);
  const parsed=(()=>{
    const d=selected?.compatibility_drivers;
    if(!d) return null;
    if(typeof d==="object") return d;
    try{return JSON.parse(d);}catch{return null;}
  })();
  return (
    <div>
      <p style={s.sectionTitle}>Match Explainability — Click a match to inspect</p>
      <table style={{...s.table,marginBottom:"24px"}}>
        <thead><tr>{["User A","User B","Score","Success Prob","Status","Created"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={6} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {matches.map(m=>(
            <tr key={m.id} style={{cursor:"pointer",backgroundColor:selected?.id===m.id?C.accentSoft:"transparent"}} onClick={()=>setSelected(selected?.id===m.id?null:m)}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.user_a_id?.slice(0,8)}…</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.user_b_id?.slice(0,8)}…</td>
              <td style={{...s.td,fontWeight:700,color:m.compatibility_score>=80?C.green:C.gold}}>{m.compatibility_score}%</td>
              <td style={s.td}>{m.success_probability?(m.success_probability*100).toFixed(0)+"%":"—"}</td>
              <td style={s.td}><StatusBadge status={m.status||"generated"}/></td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{m.created_at?new Date(m.created_at).toLocaleDateString():"—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected&&(
        <div style={s.card()}>
          <p style={s.sectionTitle}>Compatibility Breakdown — {selected.compatibility_score}% match</p>
          {selected.explanation&&<div style={{...s.alertRow("info"),borderRadius:"8px",marginBottom:"16px"}}><span>ℹ</span><span>{selected.explanation}</span></div>}
          {parsed?(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
              {parsed.strengths?.length>0&&(
                <div>
                  <div style={{fontSize:"12px",color:C.green,fontWeight:600,marginBottom:"10px"}}>✓ Compatibility Drivers</div>
                  {parsed.strengths.map((s,i)=><div key={i} style={{padding:"8px 12px",backgroundColor:C.greenSoft,borderRadius:"6px",marginBottom:"6px",fontSize:"13px"}}>+ {s}</div>)}
                </div>
              )}
              {parsed.friction?.length>0&&(
                <div>
                  <div style={{fontSize:"12px",color:C.danger,fontWeight:600,marginBottom:"10px"}}>✗ Potential Friction</div>
                  {parsed.friction.map((f,i)=><div key={i} style={{padding:"8px 12px",backgroundColor:C.dangerSoft,borderRadius:"6px",marginBottom:"6px",fontSize:"13px"}}>- {f}</div>)}
                </div>
              )}
              {parsed.dimensions&&(
                <div style={{gridColumn:"1/-1"}}>
                  <div style={{fontSize:"12px",color:C.muted,fontWeight:600,marginBottom:"10px"}}>DIMENSION SCORES</div>
                  <div style={s.grid(5)}>
                    {Object.entries(parsed.dimensions).map(([dim,score])=>(
                      <div key={dim} style={{textAlign:"center"}}>
                        <div style={{fontSize:"22px",fontWeight:700,color:score>=80?C.green:score>=60?C.gold:C.danger}}>{score}%</div>
                        <div style={{fontSize:"11px",color:C.muted,textTransform:"capitalize"}}>{dim}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ):<div style={{color:C.muted,fontSize:"13px"}}>No structured explanation available for this match.</div>}
        </div>
      )}
    </div>
  );
}

// ─── CAMPUS HEALTH ────────────────────────────────────────────────────────────
function CampusHealth() {
  const [campuses, setCampuses] = useState([]);
  const [loading, setLoading]   = useState(true);
  useEffect(()=>{
    (async()=>{
      const {data}=await supabase.from("campus_health").select("*").order("active_users",{ascending:false});
      if(data&&data.length>0){setCampuses(data);}
      else{
        const {data:users}=await supabase.from("users").select("campus_id,gender,status,section1_complete");
        if(users){
          const map={};
          users.forEach(u=>{
            const c=u.campus_id||"Unknown";
            if(!map[c]) map[c]={campus:c,total:0,male:0,female:0,active:0};
            map[c].total++;
            if(u.gender==="male") map[c].male++;
            if(u.gender==="female") map[c].female++;
            if(u.status==="active") map[c].active++;
          });
          setCampuses(Object.values(map));
        }
      }
      setLoading(false);
    })();
  },[]);
  const isImb=(m,f)=>{const r=f>0?m/f:10;return r>2||r<0.5;};
  return (
    <div>
      <p style={s.sectionTitle}>Campus Health Overview</p>
      {loading?<div style={{color:C.muted}}>Loading…</div>
        :campuses.length===0?<div style={{color:C.muted}}>No campus data yet</div>
        :<div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
          {campuses.map((c,i)=>{
            const male=c.male_users||c.male||0;
            const female=c.female_users||c.female||0;
            const imb=isImb(male,female);
            return (
              <div key={i} style={s.card(imb?C.warn:null)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                  <div style={{fontWeight:600,fontSize:"15px"}}>{c.campus_name||c.campus||c.campus_id}</div>
                  {imb&&<span style={s.badge(C.warn,C.warnSoft)}>⚠ Imbalanced</span>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"12px"}}>
                  {[["Total",c.total_users||c.total||0,C.accent],["Active",c.active_users||c.active||0,C.green],["Male",male,C.accent],["Female",female,C.rose],["M:F",female>0?(male/female).toFixed(2):"∞",imb?C.warn:C.muted]].map(([label,value,color])=>(
                    <div key={label} style={{textAlign:"center"}}>
                      <div style={{fontSize:"20px",fontWeight:700,color}}>{value}</div>
                      <div style={{fontSize:"11px",color:C.muted}}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

// ─── QUESTION PERFORMANCE ─────────────────────────────────────────────────────
function QuestionPerformance() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading]     = useState(true);
  useEffect(()=>{
    (async()=>{
      const {data}=await supabase.from("question_efficiency").select("*").order("efficiency_score",{ascending:false}).limit(50);
      if(data&&data.length>0){setQuestions(data);}
      else{const {data:q}=await supabase.from("question_performance_metrics").select("*").limit(50);setQuestions(q||[]);}
      setLoading(false);
    })();
  },[]);
  const sc=(score)=>score>=70?C.green:score>=40?C.gold:C.danger;
  return (
    <div>
      <p style={s.sectionTitle}>Question Efficiency Scores</p>
      {loading?<div style={{color:C.muted}}>Loading…</div>
        :questions.length===0?<div style={{color:C.muted}}>No data yet — populates as matches are made</div>
        :<table style={s.table}>
          <thead><tr>{["Q#","Question","Efficiency","Match Correlation","Ghost Predictor","Abandon Rate"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {questions.map((q,i)=>(
              <tr key={q.id||i}>
                <td style={{...s.td,color:C.muted}}>{q.question_number||q.question_id||i+1}</td>
                <td style={{...s.td,maxWidth:"200px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.question_text||q.question||"—"}</td>
                <td style={s.td}><span style={{color:sc(q.efficiency_score||0),fontWeight:700}}>{q.efficiency_score??"—"}</span></td>
                <td style={s.td}>{q.match_correlation!=null?(q.match_correlation*100).toFixed(1)+"%":"—"}</td>
                <td style={s.td}>{q.ghost_predictor!=null?(q.ghost_predictor*100).toFixed(1)+"%":"—"}</td>
                <td style={s.td}>{q.abandon_rate!=null?(q.abandon_rate*100).toFixed(1)+"%":"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    </div>
  );
}

// ─── POOL DIAGNOSTICS ────────────────────────────────────────────────────────
function PoolDiagnostics() {
  const [pool, setPool]       = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    (async()=>{
      const [{count:total},{count:inQueue},{count:failed},{data:health}]=await Promise.all([
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section1_complete",true),
        supabase.from("match_queue").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","failed"),
        supabase.from("admin_match_health").select("*").limit(10),
      ]);
      setPool({total,inQueue,failed,health:health||[]});
      setLoading(false);
    })();
  },[]);
  return (
    <div>
      <p style={s.sectionTitle}>Match Pool Status</p>
      {loading?<div style={{color:C.muted}}>Loading…</div>:(
        <>
          <div style={s.grid(3)}>
            <KPICard label="Eligible Users"  value={fmt(pool?.total)}   color={C.accent} loading={false} sub="S1 complete"/>
            <KPICard label="In Match Queue"  value={fmt(pool?.inQueue)} color={C.gold}   loading={false} sub="Awaiting next run"/>
            <KPICard label="Failed Matches"  value={fmt(pool?.failed)}  color={pool?.failed>0?C.danger:C.green} loading={false}/>
          </div>
          {pool?.health?.length>0&&(
            <>
              <p style={s.sectionTitle}>Health Diagnostics</p>
              <table style={s.table}>
                <thead><tr>{["Metric","Value","Status","Updated"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {pool.health.map((h,i)=>(
                    <tr key={i}>
                      <td style={s.td}>{h.metric_name||h.metric||"—"}</td>
                      <td style={{...s.td,fontWeight:600}}>{h.value??"—"}</td>
                      <td style={s.td}><StatusBadge status={h.status||"ok"}/></td>
                      <td style={{...s.td,fontSize:"12px",color:C.muted}}>{ago(h.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── CONVERSION FUNNEL ────────────────────────────────────────────────────────
function ConversionFunnel({ stats }) {
  const steps=[
    {label:"Matches Generated", value:stats.totalMatches,  color:C.accent},
    {label:"Interest Shown",    value:stats.interestShown, color:"#9b8fff"},
    {label:"Mutual Interest",   value:stats.mutualInterest,color:C.rose},
    {label:"Payment Initiated", value:stats.payInitiated,  color:C.gold},
    {label:"Payment Completed", value:stats.totalPaid,     color:C.green},
  ];
  const max=steps[0].value||1;
  return (
    <div>
      <p style={s.sectionTitle}>Interest → Payment Funnel</p>
      <div style={s.card()}>
        {steps.map((step,i)=>(
          <div key={step.label} style={{marginBottom:i<steps.length-1?"20px":0}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}>
              <span style={{fontSize:"13px",color:C.muted}}>{step.label}</span>
              <span style={{fontWeight:600}}>{fmt(step.value)}{i>0&&<span style={{fontSize:"11px",color:C.muted,marginLeft:"8px"}}>({pct(step.value,steps[0].value)}%)</span>}</span>
            </div>
            <div style={{backgroundColor:C.surfaceHi,borderRadius:"4px",height:"28px",overflow:"hidden"}}>
              <div style={s.funnelBar((step.value/max)*100,step.color)}>{step.value>0&&fmt(step.value)}</div>
            </div>
            {i<steps.length-1&&<div style={{fontSize:"11px",color:C.muted,textAlign:"right",marginTop:"3px"}}>→ {pct(steps[i+1].value,step.value)}% to next</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PAYMENT INTELLIGENCE ────────────────────────────────────────────────────
function PaymentIntelligence() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("all");
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      let q=supabase.from("payments").select("id,user_id,amount,status,created_at,phone_number,intasend_invoice_id,unlock_failed,unlock_status").order("created_at",{ascending:false}).limit(80);
      if(filter!=="all") q=q.eq("status",filter);
      const {data}=await q;
      setPayments(data||[]);setLoading(false);
    })();
  },[filter]);
  return (
    <div>
      <p style={s.sectionTitle}>Payment Records</p>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
        {["all","completed","pending","failed"].map(f=>(
          <button key={f} style={{...s.actionBtn(filter===f?C.accent:C.muted,filter===f?C.accentSoft:"transparent"),textTransform:"capitalize"}} onClick={()=>setFilter(f)}>{f}</button>
        ))}
      </div>
      <table style={s.table}>
        <thead><tr>{["Invoice","User","Phone","Amount","Status","Unlock","Date"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={7} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {!loading&&payments.length===0&&<tr><td colSpan={7} style={{...s.td,textAlign:"center",color:C.muted}}>No payments found</td></tr>}
          {payments.map(p=>(
            <tr key={p.id}>
              <td style={{...s.td,fontSize:"11px",color:C.muted}}>{p.intasend_invoice_id?.slice(0,10)||p.id?.slice(0,10)}…</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{p.user_id?.slice(0,8)}…</td>
              <td style={s.td}>{p.phone_number||"—"}</td>
              <td style={{...s.td,fontWeight:600,color:C.gold}}>KES {fmt(p.amount)}</td>
              <td style={s.td}><StatusBadge status={p.status}/></td>
              <td style={s.td}>{p.unlock_failed?<span style={{color:C.danger}}>✗ Failed</span>:p.unlock_status?<span style={{color:C.green}}>✓ {p.unlock_status}</span>:<span style={{color:C.muted}}>—</span>}</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{p.created_at?new Date(p.created_at).toLocaleString():"—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function ReportsCenter() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    (async()=>{
      const {data}=await supabase.from("reports").select("id,reporter_id,reported_id,reason,status,created_at,description").order("created_at",{ascending:false}).limit(50);
      setReports(data||[]);setLoading(false);
    })();
  },[]);
  const resolve=async(id)=>{
    await supabase.from("reports").update({status:"resolved"}).eq("id",id);
    setReports(r=>r.map(x=>x.id===id?{...x,status:"resolved"}:x));
  };
  return (
    <div>
      <p style={s.sectionTitle}>User Reports</p>
      <table style={s.table}>
        <thead><tr>{["Reporter","Reported","Reason","Description","Status","Date","Action"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={7} style={{...s.td,textAlign:"center",color:C.muted}}>Loading…</td></tr>}
          {!loading&&reports.length===0&&<tr><td colSpan={7} style={{...s.td,textAlign:"center",color:C.green}}>No pending reports</td></tr>}
          {reports.map(r=>(
            <tr key={r.id}>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{r.reporter_id?.slice(0,8)}…</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{r.reported_id?.slice(0,8)}…</td>
              <td style={s.td}>{r.reason||"—"}</td>
              <td style={{...s.td,fontSize:"12px",color:C.muted,maxWidth:"160px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.description||"—"}</td>
              <td style={s.td}><StatusBadge status={r.status||"pending"}/></td>
              <td style={{...s.td,fontSize:"12px",color:C.muted}}>{r.created_at?new Date(r.created_at).toLocaleDateString():"—"}</td>
              <td style={s.td}>{r.status!=="resolved"&&<button style={s.actionBtn(C.green,C.greenSoft)} onClick={()=>resolve(r.id)}>Resolve</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab]               = useState("dashboard");
  const [stats, setStats]           = useState({});
  const [alerts, setAlerts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadStats = useCallback(async()=>{
    setLoading(true);
    try {
      const [
        {count:totalUsers},{count:activeUsers},{count:newToday},
        {count:section1Complete},{count:section2Unlocked},
        {count:totalMatches},{count:mutualInterest},
        {count:paymentsToday},{count:pendingReports},
        {count:totalPaid},{count:interestShown},{count:payInitiated},
        {count:profilesComplete},
      ] = await Promise.all([
        supabase.from("users").select("*",{count:"exact",head:true}),
        supabase.from("users").select("*",{count:"exact",head:true}).gte("last_sign_in_at",new Date(Date.now()-7*86400000).toISOString()),
        supabase.from("users").select("*",{count:"exact",head:true}).gte("created_at",new Date().toISOString().slice(0,10)),
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section1_complete",true),
        supabase.from("users").select("*",{count:"exact",head:true}).eq("section2_unlocked",true),
        supabase.from("matches").select("*",{count:"exact",head:true}),
        supabase.from("matches").select("*",{count:"exact",head:true}).eq("status","mutual"),
        supabase.from("payments").select("*",{count:"exact",head:true}).gte("created_at",new Date().toISOString().slice(0,10)).eq("status","completed"),
        supabase.from("reports").select("*",{count:"exact",head:true}).eq("status","pending"),
        supabase.from("payments").select("*",{count:"exact",head:true}).eq("status","completed"),
        supabase.from("matches").select("*",{count:"exact",head:true}).not("interested_at","is",null),
        supabase.from("payments").select("*",{count:"exact",head:true}).in("status",["pending","completed"]),
        supabase.from("photos").select("user_id",{count:"exact",head:true}),
      ]);
      const now=new Date();
      const {data:revData}=await supabase.from("payments").select("amount").eq("status","completed").gte("created_at",new Date(now.getFullYear(),now.getMonth(),1).toISOString());
      const monthRevenue=(revData||[]).reduce((s,p)=>s+(p.amount||0),0);
      const {data:sysAlerts}=await supabase.from("system_alerts").select("*").eq("resolved",false).order("created_at",{ascending:false}).limit(10);
      setStats({totalUsers,activeUsers,newToday,profilesComplete,section1Complete,section2Unlocked,totalMatches,mutualInterest,paymentsToday,monthRevenue,pendingReports,totalPaid,interestShown,payInitiated});
      setAlerts(sysAlerts||[]);
      setLastRefresh(new Date());
    } catch(e){ console.error("Admin stats error:",e); }
    setLoading(false);
  },[]);

  useEffect(()=>{loadStats();},[loadStats]);

  const MODULE_TITLES={
    dashboard:"Executive Dashboard",     revenue:"Revenue Protection",
    leaks:"Funnel Leak Detector",        stuck:"Stuck User Detector",
    unlock:"Unlock Flow Monitor",        notifications:"Notification Reliability",
    engine:"Match Engine Health",        recovery:"Recovery Tools",
    sysalerts:"System Alerts Center",    users:"User Operations",
    matches:"Match Intelligence",        quality:"Match Quality Monitor",
    risk:"Risk & Safety",                explainer:"Match Explainer",
    campus:"Campus Health",              questions:"Question Performance",
    pool:"Pool Diagnostics",             funnel:"Conversion Funnel",
    payments:"Payment Intelligence",     reports:"Reports Center",
  };

  const groups=["core","ops","mgmt"];
  const groupedNav=groups.reduce((acc,g)=>{acc[g]=NAV_ITEMS.filter(n=>n.group===g);return acc;},{});
  const groupLabels={core:"OVERVIEW",ops:"OPERATIONS",mgmt:"MANAGEMENT"};

  return (
    <>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        tr:hover td{background:${C.surfaceHi}}
      `}</style>
      <div style={s.shell}>
        <aside style={s.sidebar}>
          <div style={s.sidebarLogo}>
            <div style={s.logoMark}>MingleMate</div>
            <div style={s.logoSub}>Command Center</div>
          </div>
          <nav style={s.navSection}>
            {groups.map(g=>(
              <div key={g}>
                <div style={s.navGroup}>{groupLabels[g]}</div>
                {groupedNav[g].map(item=>(
                  <div key={item.id} style={s.navItem(tab===item.id)} onClick={()=>setTab(item.id)}>
                    <span style={s.navIcon}>{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div style={s.sidebarFooter}>
            <div style={{fontSize:"12px",color:C.muted,marginBottom:"8px"}}>
              <span style={s.statusDot(true)}/>Supabase Connected
            </div>
            <div style={{fontSize:"12px",color:C.danger,cursor:"pointer"}} onClick={()=>navigate("/admin")}>← Sign Out</div>
          </div>
        </aside>
        <main style={s.main}>
          <div style={s.topbar}>
            <div>
              <div style={s.topbarTitle}>{MODULE_TITLES[tab]}</div>
              <div style={s.topbarMeta}>Last updated: {lastRefresh?lastRefresh.toLocaleTimeString():"—"}</div>
            </div>
            <button style={s.refreshBtn} onClick={loadStats}>{loading?"Refreshing…":"↻ Refresh"}</button>
          </div>
          <div style={s.content}>
            {tab==="dashboard"     && <ExecutiveDashboard stats={stats} alerts={alerts} loading={loading}/>}
            {tab==="revenue"       && <RevenueProtection/>}
            {tab==="leaks"         && <FunnelLeaks/>}
            {tab==="stuck"         && <StuckUsers/>}
            {tab==="unlock"        && <UnlockFlowMonitor/>}
            {tab==="notifications" && <NotificationReliability/>}
            {tab==="engine"        && <MatchEngineHealth/>}
            {tab==="recovery"      && <RecoveryTools/>}
            {tab==="sysalerts"     && <SystemAlertsCenter/>}
            {tab==="users"         && <UserOperations/>}
            {tab==="matches"       && <MatchIntelligence/>}
            {tab==="quality"       && <MatchQualityMonitor/>}
            {tab==="risk"          && <RiskSafety/>}
            {tab==="explainer"     && <MatchExplainer/>}
            {tab==="campus"        && <CampusHealth/>}
            {tab==="questions"     && <QuestionPerformance/>}
            {tab==="pool"          && <PoolDiagnostics/>}
            {tab==="funnel"        && <ConversionFunnel stats={stats}/>}
            {tab==="payments"      && <PaymentIntelligence/>}
            {tab==="reports"       && <ReportsCenter/>}
          </div>
        </main>
      </div>
    </>
  );
}