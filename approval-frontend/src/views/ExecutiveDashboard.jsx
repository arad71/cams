import { useState, useMemo } from "react";
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';
import { T, S, cx } from '../styles/tokens';

const daysBetween = (d1, d2) => Math.max(0, Math.round((d2 - d1) / 86400000));
const parseDate = (s) => s ? new Date(s) : null;
const NOW = new Date();
const fmtNum = (n) => typeof n === "number" ? n.toLocaleString("en-AU") : n;
const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── SVG Charts ──────────────────────────────────────────
function Donut({ segments, size = 150, label }) {
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (!total) return <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: T.c.grey400, fontSize: 12 }}>No data</div>;
  let cum = 0;
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}>
        {segments.filter(s => s.value > 0).map((seg, i) => {
          const p = seg.value / total, dash = p * circ, offset = cum * circ;
          cum += p;
          return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color} strokeWidth={18} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} style={{ transition: "stroke-dasharray 0.5s ease" }} />;
        })}
      </g>
      <text x={size/2} y={size/2 - 6} textAnchor="middle" style={{ fontSize: 28, fontWeight: T.w.black, fill: "#1a3a4a" }}>{total}</text>
      {label && <text x={size/2} y={size/2 + 14} textAnchor="middle" style={{ fontSize: 12, fill: "#95a5a6", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: T.w.semi }}>{label}</text>}
    </svg>
  );
}

function GaugeArc({ value, max, target, size = 110, color, label }) {
  const angle = max > 0 ? Math.min((value / max) * 180, 180) : 0;
  const tAngle = max > 0 ? (target / max) * 180 : 0;
  const r = size / 2 - 10;
  const arc = (deg) => {
    const rad = (Math.PI * deg) / 180;
    return `${size/2 + r * Math.cos(Math.PI - rad)},${size/2 - r * Math.sin(Math.PI - rad)}`;
  };
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        <path d={`M ${size/2 - r},${size/2} A ${r},${r} 0 0,1 ${size/2 + r},${size/2}`} fill="none" stroke={T.c.borderLight} strokeWidth={12} strokeLinecap="round" />
        {angle > 0 && <path d={`M ${size/2 - r},${size/2} A ${r},${r} 0 ${angle > 90 ? 1 : 0},1 ${arc(angle)}`} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" style={{ transition: "d 0.5s ease" }} />}
        <text x={size/2} y={size/2 - 4} textAnchor="middle" style={{ fontSize: 20, fontWeight: T.w.black, fill: "#1a3a4a" }}>{value}{typeof max === "number" && max <= 100 ? "%" : ""}</text>
        <text x={size/2} y={size/2 + 12} textAnchor="middle" style={{ fontSize: 12, fill: "#95a5a6", fontWeight: T.w.semi, textTransform: "uppercase" }}>{label}</text>
      </svg>
    </div>
  );
}

function SparkBars({ data, color, height = 40 }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height }}>
      {data.map((d, i) => (
        <div key={i} title={`${d.l}: ${d.v}`} style={{ flex: 1, height: `${(d.v / max) * 100}%`, background: i === data.length - 1 ? color : `${color}55`, borderRadius: "2px 2px 0 0", minHeight: 2, transition: "height 0.3s" }} />
      ))}
    </div>
  );
}

function HBar({ label, value, max, color, sub }) {
  const p = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: T.c.grey800, width: 90, textAlign: "right", fontWeight: T.w.semi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <div style={{ flex: 1, height: 20, background: T.c.borderLight, borderRadius: 5, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${p}%`, height: "100%", background: `linear-gradient(90deg, ${color}, ${color}bb)`, borderRadius: 5, transition: "width 0.4s" }} />
        <span style={{ position: "absolute", right: 8, top: 2, fontSize: 12, fontWeight: T.w.bold, color: p > 50 ? "#fff" : "#5a6a74" }}>{value}{sub ? ` ${sub}` : ""}</span>
      </div>
    </div>
  );
}

// ─── Layout Primitives ───────────────────────────────────
const Card = ({ children, title, icon, sub, span = 1, style = {}, headerRight }) => (
  <div style={{ background: T.c.card, borderRadius: 16, border: `1px solid ${T.c.border}`, overflow: "hidden", gridColumn: `span ${span}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", ...style }}>
    {title && (
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.c.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
          <div>
            <span style={{ fontWeight: T.w.black, fontSize: 14, color: T.c.text, letterSpacing: "-0.01em" }}>{title}</span>
            {sub && <div style={{ fontSize: 12, color: T.c.textMuted, marginTop: 1 }}>{sub}</div>}
          </div>
        </div>
        {headerRight}
      </div>
    )}
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

const BigKPI = ({ label, value, sub, color, icon, trend }) => (
  <div style={{ background: T.c.card, borderRadius: 16, border: `1px solid ${T.c.border}`, padding: "20px 22px", flex: 1, minWidth: 155, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: -8, right: -8, width: 60, height: 60, borderRadius: "50%", background: `${color}08` }} />
    <div style={{ fontSize: 12, color: T.c.textSecondary, fontWeight: T.w.bold, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontSize: 32, fontWeight: T.w.black, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</span>
      {trend && <span style={{ fontSize: 12, fontWeight: T.w.bold, color: trend.startsWith("+") || trend.startsWith("↑") ? "#27ae60" : trend.startsWith("-") || trend.startsWith("↓") ? "#e74c3c" : "#95a5a6" }}>{trend}</span>}
    </div>
    {sub && <div style={{ fontSize: 12, color: T.c.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);


// ═══════════════════════════════════════════════════════════
//  EXECUTIVE DASHBOARD
// ═══════════════════════════════════════════════════════════
export default function ExecutiveDashboard({ apps, branding = {} }) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("submitted");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const orgName = branding.orgName || "Council";
  const systemName = branding.systemShort || "CAMS";

  const stats = useMemo(() => {
    const all = apps || [];
    const now = NOW;
    const active = all.filter(a => !["approved", "rejected"].includes(a.status));
    const approved = all.filter(a => a.status === "approved");
    const rejected = all.filter(a => a.status === "rejected");
    const pending = all.filter(a => a.status === "pending_review");
    const completed = [...approved, ...rejected];

    // SLA: % completed within 21 days
    const completedDays = completed.map(a => { const s = parseDate(a.submittedDate); return s ? daysBetween(s, now) : 0; });
    const avgDays = completedDays.length ? Math.round(completedDays.reduce((a, b) => a + b, 0) / completedDays.length) : 0;
    const within21 = completedDays.filter(d => d <= 21).length;
    const slaRate = pct(within21, completed.length);
    const approvalRate = pct(approved.length, completed.length);

    // Status counts
    const statusCounts = {};
    Object.keys(STATUS_CONFIG).forEach(s => { statusCounts[s] = all.filter(a => a.status === s).length; });

    // Monthly data (last 12 months)
    const months = {}, compMonths = {};
    all.forEach(a => { const d = parseDate(a.submittedDate); if (d) { const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; months[k] = (months[k]||0)+1; } });
    completed.forEach(a => { const d = parseDate(a.submittedDate); if (d) { const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; compMonths[k] = (compMonths[k]||0)+1; } });

    // Aging
    const aging = [0, 0, 0, 0, 0]; // 0-7, 8-14, 15-21, 22-30, 30+
    active.forEach(a => { const s = parseDate(a.submittedDate); if (!s) return; const d = daysBetween(s, now); if (d<=7) aging[0]++; else if (d<=14) aging[1]++; else if (d<=21) aging[2]++; else if (d<=30) aging[3]++; else aging[4]++; });

    // Officer workload
    const officers = {};
    active.forEach(a => { const o = a.assessment?.officer || "Unassigned"; officers[o] = (officers[o]||0)+1; });

    // This month vs last month
    const thisMo = all.filter(a => { const d = parseDate(a.submittedDate); return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
    const lastMo = all.filter(a => { const d = parseDate(a.submittedDate); if (!d) return false; const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); }).length;

    // Unassigned
    const unassigned = active.filter(a => !a.assessment?.officer).length;

    return { total: all.length, active: active.length, approved: approved.length, rejected: rejected.length, pending: pending.length, completed: completed.length, avgDays, slaRate, approvalRate, statusCounts, months, compMonths, aging, officers, thisMo, lastMo, unassigned, within21 };
  }, [apps]);

  // Month keys for charts
  const allMonthKeys = Object.keys({ ...stats.months, ...stats.compMonths }).sort().slice(-12);
  const monthLabels = allMonthKeys.map(k => { const [y, m] = k.split("-"); return `${MONTHS[+m-1]} '${y.slice(2)}`; });

  // Donut segments
  const donutSegs = Object.entries(stats.statusCounts).filter(([,v]) => v > 0).map(([k,v]) => ({ value: v, color: STATUS_CONFIG[k]?.color || "#bdc3c7", label: STATUS_CONFIG[k]?.label || k }));

  // Table
  const tableData = useMemo(() => {
    let data = (apps||[]).map(a => { const s = parseDate(a.submittedDate); const d = s ? daysBetween(s, NOW) : 0; return { ...a, daysOpen: d, sla: d > 30 ? "overdue" : d > 21 ? "at_risk" : d > 14 ? "monitor" : "on_track" }; });
    if (search) { const q = search.toLowerCase(); data = data.filter(a => a.id?.toLowerCase().includes(q) || a.owner?.name?.toLowerCase().includes(q) || a.property?.address?.toLowerCase().includes(q) || a.assessment?.officer?.toLowerCase().includes(q)); }
    data.sort((a, b) => { let va, vb; switch(sortCol) { case "id": va=a.id; vb=b.id; break; case "owner": va=a.owner?.name||""; vb=b.owner?.name||""; break; case "status": va=a.status; vb=b.status; break; case "officer": va=a.assessment?.officer||""; vb=b.assessment?.officer||""; break; case "days": va=a.daysOpen; vb=b.daysOpen; break; default: va=a.submittedDate||""; vb=b.submittedDate||""; } if (typeof va==="number") return sortDir==="asc"?va-vb:vb-va; return sortDir==="asc"?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va)); });
    return data;
  }, [apps, search, sortCol, sortDir]);
  const pageCount = Math.ceil(tableData.length / PAGE_SIZE);
  const pageData = tableData.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);
  const toggleSort = (c) => { if (sortCol===c) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortCol(c); setSortDir("asc"); } };
  const sortArrow = (c) => sortCol===c ? (sortDir==="asc"?" ▲":" ▼") : "";
  const SlaBadge = ({ sla }) => { const c = { on_track:{l:"On Track",c:"#27ae60",b:"#eafaf1"}, monitor:{l:"Monitor",c:"#3498db",b:"#ebf5fb"}, at_risk:{l:"At Risk",c:"#e67e22",b:"#fef5e7"}, overdue:{l:"Overdue",c:"#e74c3c",b:"#fdedec"} }[sla]||{l:sla,c:"#95a5a6",b:T.c.borderLight}; return <span style={{padding:"2px 8px",borderRadius:4,fontSize:12,fontWeight:700,background:c.b,color:c.c}}>{c.l}</span>; };

  const exportCSV = () => {
    const h = ["ID","Applicant","Address","Status","Assigned To","Days Open","SLA","Submitted"];
    const rows = tableData.map(a => [a.id, a.owner?.name, a.property?.address, a.status, a.assessment?.officer||"", a.daysOpen, a.sla, a.submittedDate]);
    const csv = [h.join(","), ...rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(","))].join("\n");
    const b = new Blob([csv],{type:"text/csv"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=`${systemName}_report_${new Date().toISOString().split("T")[0]}.csv`; a.click(); URL.revokeObjectURL(u);
  };

  const moTrend = stats.lastMo > 0 ? (stats.thisMo > stats.lastMo ? `↑ ${stats.thisMo - stats.lastMo} vs last mo` : stats.thisMo < stats.lastMo ? `↓ ${stats.lastMo - stats.thisMo} vs last mo` : "Same as last mo") : "";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ marginBottom: 24, borderBottom: "2px solid #e4e9ec", paddingBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: T.w.black, color: "#1abc9c", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>{orgName}</div>
            <h1 style={{ fontSize: 26, fontWeight: T.w.black, color: T.c.text, margin: 0, letterSpacing: "-0.02em" }}>Crossover Management</h1>
            <h2 style={{ fontSize: 16, fontWeight: 400, color: T.c.textSecondary, margin: "2px 0 0" }}>Executive Performance Dashboard</h2>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: T.w.bold, color: T.c.text }}>{new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</div>
            <div style={{ fontSize: 12, color: T.c.textMuted }}>Data as of today · Auto-refreshed</div>
          </div>
        </div>
      </div>

      {/* ═══ KPI ROW ═══ */}
      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <BigKPI icon="📋" label="Total Applications" value={fmtNum(stats.total)} color="#1a3a4a" sub={`${stats.completed} completed · ${stats.active} active`} />
        <BigKPI icon="⏱" label="Avg Processing Time" value={`${stats.avgDays}d`} color={stats.avgDays > 21 ? "#e74c3c" : stats.avgDays > 14 ? "#e67e22" : "#27ae60"} sub="Target: 21 days" trend={stats.avgDays <= 21 ? "✓ On target" : "⚠ Above target"} />
        <BigKPI icon="📊" label="SLA Compliance" value={`${stats.slaRate}%`} color={stats.slaRate >= 80 ? "#27ae60" : stats.slaRate >= 60 ? "#e67e22" : "#e74c3c"} sub={`${stats.within21} of ${stats.completed} within 21 days`} />
        <BigKPI icon="✅" label="Approval Rate" value={`${stats.approvalRate}%`} color="#2980b9" sub={`${stats.approved} approved · ${stats.rejected} rejected`} />
        <BigKPI icon="🆕" label="This Month" value={fmtNum(stats.thisMo)} color="#8e44ad" trend={moTrend} />
      </div>

      {/* ═══ ROW: Status + Gauges + Capacity ═══ */}
      <div className="cams-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card title="Application Status" icon="🍩" sub="Current distribution">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Donut segments={donutSegs} size={140} label="Applications" />
            <div style={{ flex: 1 }}>
              {donutSegs.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: T.c.grey800, flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: T.w.black, color: T.c.text }}>{s.value}</span>
                  <span style={{ fontSize: 12, color: T.c.textMuted }}>{pct(s.value, stats.total)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Performance Gauges" icon="🎯" sub="Key targets">
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            <GaugeArc value={stats.slaRate} max={100} target={80} size={100} color={stats.slaRate >= 80 ? "#27ae60" : "#e67e22"} label="SLA %" />
            <GaugeArc value={stats.approvalRate} max={100} target={90} size={100} color="#2980b9" label="Approval %" />
          </div>
          <div style={{ textAlign: "center", fontSize: 12, color: T.c.textMuted, marginTop: 8 }}>SLA target: 80% within 21 days · Approval benchmark: 90%</div>
        </Card>

        <Card title="Capacity & Backlog" icon="⚡" sub="Resource utilisation">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: stats.unassigned > 3 ? "#fdedec" : "#f8fafb", borderRadius: T.r.md, border: `1px solid ${stats.unassigned > 3 ? "#e74c3c20" : T.c.borderLight}` }}>
              <span style={{ fontSize: 12, color: T.c.grey800, fontWeight: T.w.semi }}>Unassigned</span>
              <span style={{ fontSize: 14, fontWeight: T.w.black, color: stats.unassigned > 3 ? "#e74c3c" : "#1a3a4a" }}>{stats.unassigned}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.c.bgAlt, borderRadius: T.r.md, border: "1px solid #eef2f4" }}>
              <span style={{ fontSize: 12, color: T.c.grey800, fontWeight: T.w.semi }}>Pending Review</span>
              <span style={{ fontSize: 14, fontWeight: T.w.black, color: stats.pending > 5 ? "#e67e22" : "#1a3a4a" }}>{stats.pending}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.c.bgAlt, borderRadius: T.r.md, border: "1px solid #eef2f4" }}>
              <span style={{ fontSize: 12, color: T.c.grey800, fontWeight: T.w.semi }}>Active Officers</span>
              <span style={{ fontSize: 14, fontWeight: T.w.black, color: T.c.text }}>{Object.keys(stats.officers).filter(k => k !== "Unassigned").length}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: T.c.bgAlt, borderRadius: T.r.md, border: "1px solid #eef2f4" }}>
              <span style={{ fontSize: 12, color: T.c.grey800, fontWeight: T.w.semi }}>Avg per Officer</span>
              <span style={{ fontSize: 14, fontWeight: T.w.black, color: T.c.text }}>{(() => { const offs = Object.entries(stats.officers).filter(([k]) => k!=="Unassigned"); return offs.length ? Math.round(offs.reduce((s,[,v])=>s+v,0)/offs.length) : 0; })()}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ═══ ROW: Monthly Trends + Aging ═══ */}
      <div className="cams-stack" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card title="Monthly Trend" icon="📈" sub="Submissions vs completions (last 12 months)">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160, padding: "0 4px" }}>
            {allMonthKeys.map((k, i) => {
              const sub = stats.months[k] || 0;
              const comp = stats.compMonths[k] || 0;
              const max = Math.max(...allMonthKeys.map(mk => Math.max(stats.months[mk]||0, stats.compMonths[mk]||0)), 1);
              return (
                <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 1 }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 130 }}>
                    <div title={`Submitted: ${sub}`} style={{ width: 12, height: `${(sub/max)*120}px`, background: "linear-gradient(180deg,#2980b9,#3498db)", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                    <div title={`Completed: ${comp}`} style={{ width: 12, height: `${(comp/max)*120}px`, background: "linear-gradient(180deg,#27ae60,#2ecc71)", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                  </div>
                  <span style={{ fontSize: 7, color: T.c.textMuted, whiteSpace: "nowrap" }}>{monthLabels[i]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 10, fontSize: 12 }}>
            <span style={{ color: T.c.info, fontWeight: T.w.bold }}>■ Submitted</span>
            <span style={{ color: T.c.success, fontWeight: T.w.bold }}>■ Completed</span>
          </div>
        </Card>

        <Card title="Aging Report" icon="⏳" sub="Active applications by age">
          {[
            { l: "0–7 days", v: stats.aging[0], c: "#27ae60" },
            { l: "8–14 days", v: stats.aging[1], c: "#f1c40f" },
            { l: "15–21 days", v: stats.aging[2], c: "#e67e22" },
            { l: "22–30 days", v: stats.aging[3], c: "#e74c3c" },
            { l: "30+ days", v: stats.aging[4], c: "#c0392b" },
          ].map(({ l, v, c }) => (
            <HBar key={l} label={l} value={v} max={Math.max(...stats.aging, 1)} color={c} />
          ))}
          <div style={{ marginTop: 8, padding: "6px 10px", background: T.c.bgAlt, borderRadius: T.r.md, fontSize: 12, color: T.c.textSecondary, textAlign: "center" }}>
            {stats.aging[3] + stats.aging[4] > 0 ? `⚠ ${stats.aging[3] + stats.aging[4]} application${stats.aging[3]+stats.aging[4]>1?"s":""} beyond 21-day SLA target` : "✓ All within SLA target"}
          </div>
        </Card>
      </div>
    </div>
  );
}
