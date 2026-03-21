import { useState, useMemo } from "react";
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';

// ─── Helpers ─────────────────────────────────────────────
const daysBetween = (d1, d2) => Math.max(0, Math.round((d2 - d1) / 86400000));
const parseDate = (s) => s ? new Date(s) : null;
const NOW = new Date();
const fmtNum = (n) => n.toLocaleString("en-AU");

function MiniDonut({ segments, size = 120 }) {
  const total = segments.reduce((s, g) => s + g.value, 0);
  if (total === 0) return <svg width={size} height={size}><circle cx={size/2} cy={size/2} r={size/2-4} fill="none" stroke="#e4e9ec" strokeWidth={14}/></svg>;
  let cum = 0;
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      {segments.filter(s => s.value > 0).map((seg, i) => {
        const pct = seg.value / total;
        const dash = pct * circ;
        const offset = cum * circ;
        cum += pct;
        return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color} strokeWidth={14} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} strokeLinecap="round" />;
      })}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" style={{ transform: "rotate(90deg)", transformOrigin: "center", fontSize: 22, fontWeight: 800, fill: "#1a3a4a" }}>{total}</text>
    </svg>
  );
}

function HBar({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "#5a6a74", width: 80, textAlign: "right", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 22, background: "#f0f3f5", borderRadius: 6, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: 6, transition: "width 0.4s ease" }} />
        <span style={{ position: "absolute", right: 8, top: 3, fontSize: 10, fontWeight: 700, color: pct > 60 ? "#fff" : "#5a6a74" }}>{value}</span>
      </div>
    </div>
  );
}

function BarChart({ data, height = 160 }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.min(36, Math.max(16, Math.floor(300 / data.length)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", marginBottom: 2 }}>{d.value}</span>
          <div style={{ width: barW, height: `${(d.value / max) * (height - 30)}px`, background: `linear-gradient(180deg, ${d.color || "#2980b9"}, ${d.color || "#2980b9"}99)`, borderRadius: "4px 4px 0 0", transition: "height 0.3s ease", minHeight: 2 }} />
          <span style={{ fontSize: 8, color: "#95a5a6", marginTop: 3, whiteSpace: "nowrap" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Card Components ─────────────────────────────────────
const Card = ({ children, title, icon, span = 1, style = {} }) => (
  <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden", gridColumn: `span ${span}`, ...style }}>
    {title && <div style={{ padding: "12px 18px", borderBottom: "1px solid #eef2f4", display: "flex", alignItems: "center", gap: 8 }}>
      {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      <span style={{ fontWeight: 800, fontSize: 13, color: "#1a3a4a" }}>{title}</span>
    </div>}
    <div style={{ padding: 18 }}>{children}</div>
  </div>
);

const KPI = ({ label, value, sub, color, icon }) => (
  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 140 }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</div>
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#7a8a94", fontWeight: 600, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color }}>{sub}</div>}
    </div>
  </div>
);


// ═══════════════════════════════════════════════════════════
//  EXECUTIVE DASHBOARD
// ═══════════════════════════════════════════════════════════
export default function ExecutiveDashboard({ apps, branding = {} }) {
  const [period, setPeriod] = useState("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("submitted");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const orgName = branding.orgName || "Council";
  const systemName = branding.systemShort || "CAMS";

  // ─── Derived Data ────────────────────────────────────────
  const stats = useMemo(() => {
    const all = apps || [];
    const now = new Date();
    const active = all.filter(a => !["approved", "rejected"].includes(a.status));
    const approved = all.filter(a => a.status === "approved");
    const rejected = all.filter(a => a.status === "rejected");
    const pending = all.filter(a => a.status === "pending_review");
    const completed = [...approved, ...rejected];

    // Days open for each app
    const daysOpen = all.map(a => {
      const sub = parseDate(a.submittedDate);
      return sub ? daysBetween(sub, now) : 0;
    });

    // Average processing time for completed
    const completedDays = completed.map(a => {
      const sub = parseDate(a.submittedDate);
      return sub ? daysBetween(sub, now) : 0;
    });
    const avgDays = completedDays.length > 0 ? Math.round(completedDays.reduce((a, b) => a + b, 0) / completedDays.length) : 0;

    // Status breakdown
    const statusCounts = {};
    Object.keys(STATUS_CONFIG).forEach(s => { statusCounts[s] = all.filter(a => a.status === s).length; });

    // Monthly submissions
    const months = {};
    const completedMonths = {};
    all.forEach(a => {
      const d = parseDate(a.submittedDate);
      if (d) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        months[key] = (months[key] || 0) + 1;
      }
    });
    completed.forEach(a => {
      const d = parseDate(a.submittedDate);
      if (d) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        completedMonths[key] = (completedMonths[key] || 0) + 1;
      }
    });

    // Aging buckets
    const aging = { "0–7 days": 0, "8–14 days": 0, "15–30 days": 0, "30+ days": 0 };
    active.forEach(a => {
      const sub = parseDate(a.submittedDate);
      if (!sub) return;
      const d = daysBetween(sub, now);
      if (d <= 7) aging["0–7 days"]++;
      else if (d <= 14) aging["8–14 days"]++;
      else if (d <= 30) aging["15–30 days"]++;
      else aging["30+ days"]++;
    });

    // Officer workload
    const officers = {};
    active.forEach(a => {
      const off = a.assessment?.officer || "Unassigned";
      officers[off] = (officers[off] || 0) + 1;
    });

    return {
      total: all.length, active: active.length, approved: approved.length,
      rejected: rejected.length, pending: pending.length, completed: completed.length,
      avgDays, statusCounts, months, completedMonths, aging, officers, daysOpen,
    };
  }, [apps]);

  // ─── Filtered + Sorted Table ─────────────────────────────
  const tableData = useMemo(() => {
    let data = (apps || []).map(a => {
      const sub = parseDate(a.submittedDate);
      const d = sub ? daysBetween(sub, NOW) : 0;
      const sla = d > 30 ? "overdue" : d > 14 ? "at_risk" : "on_track";
      return { ...a, daysOpen: d, sla };
    });
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(a =>
        a.id?.toLowerCase().includes(s) ||
        a.owner?.name?.toLowerCase().includes(s) ||
        a.property?.address?.toLowerCase().includes(s) ||
        a.assessment?.officer?.toLowerCase().includes(s)
      );
    }
    data.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case "id": va = a.id; vb = b.id; break;
        case "owner": va = a.owner?.name || ""; vb = b.owner?.name || ""; break;
        case "status": va = a.status; vb = b.status; break;
        case "officer": va = a.assessment?.officer || ""; vb = b.assessment?.officer || ""; break;
        case "days": va = a.daysOpen; vb = b.daysOpen; break;
        default: va = a.submittedDate || ""; vb = b.submittedDate || "";
      }
      if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return data;
  }, [apps, search, sortCol, sortDir]);

  const pageCount = Math.ceil(tableData.length / PAGE_SIZE);
  const pageData = tableData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };
  const sortArrow = (col) => sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // Month labels for charts
  const monthKeys = Object.keys({ ...stats.months, ...stats.completedMonths }).sort();
  const monthLabels = monthKeys.map(k => { const [y, m] = k.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y.slice(2)}`; });

  // SLA badge
  const SlaBadge = ({ sla }) => {
    const cfg = { on_track: { label: "On Track", color: "#27ae60", bg: "#eafaf1" }, at_risk: { label: "At Risk", color: "#e67e22", bg: "#fef5e7" }, overdue: { label: "Overdue", color: "#e74c3c", bg: "#fdedec" } };
    const c = cfg[sla] || cfg.on_track;
    return <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: c.bg, color: c.color }}>{c.label}</span>;
  };

  // Export CSV
  const exportCSV = () => {
    const headers = ["ID", "Applicant", "Address", "Status", "Assigned To", "Days Open", "SLA", "Submitted"];
    const rows = tableData.map(a => [a.id, a.owner?.name, a.property?.address, a.status, a.assessment?.officer || "", a.daysOpen, a.sla, a.submittedDate]);
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${systemName}_applications_${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Status donut segments
  const donutSegs = Object.entries(stats.statusCounts).filter(([, v]) => v > 0).map(([k, v]) => ({ value: v, color: STATUS_CONFIG[k]?.color || "#bdc3c7", label: STATUS_CONFIG[k]?.label || k }));

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#1abc9c", textTransform: "uppercase", letterSpacing: "0.08em" }}>{orgName}</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3a4a", margin: "2px 0 4px" }}>Crossover Management Dashboard</h1>
        <p style={{ color: "#7a8a94", fontSize: 12, margin: 0 }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      {/* KPI Row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <KPI icon="📋" label="Total Applications" value={fmtNum(stats.total)} color="#2980b9" />
        <KPI icon="🆕" label="New / Pending" value={fmtNum(stats.pending)} color="#e67e22" sub={stats.pending > 5 ? "⚠ High backlog" : ""} />
        <KPI icon="✅" label="Completed" value={fmtNum(stats.completed)} color="#27ae60" />
        <KPI icon="⏱" label="Avg Processing" value={`${stats.avgDays}d`} color="#8e44ad" sub={stats.avgDays > 21 ? "Above 21-day target" : "Within target"} />
        <KPI icon="⚡" label="Active / In Progress" value={fmtNum(stats.active)} color="#2c3e50" />
      </div>

      {/* Charts Row 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card title="Application Status" icon="🍩">
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <MiniDonut segments={donutSegs} size={130} />
            <div style={{ flex: 1 }}>
              {donutSegs.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#5a6a74", flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3a4a" }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="New Submissions by Month" icon="📈">
          <BarChart data={monthKeys.map((k, i) => ({
            label: monthLabels[i], value: stats.months[k] || 0, color: "#2980b9",
          }))} />
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card title="Completed by Month" icon="✅">
          <BarChart data={monthKeys.map((k, i) => ({
            label: monthLabels[i], value: stats.completedMonths[k] || 0, color: "#27ae60",
          }))} />
        </Card>

        <Card title="Aging Report — Pending Workload" icon="⏳">
          {(() => {
            const maxAging = Math.max(...Object.values(stats.aging), 1);
            const agingColors = ["#27ae60", "#e67e22", "#e74c3c", "#c0392b"];
            return Object.entries(stats.aging).map(([label, value], i) => (
              <HBar key={label} label={label} value={value} max={maxAging} color={agingColors[i]} />
            ));
          })()}
        </Card>
      </div>

      {/* Monthly Trend Comparison */}
      <Card title="Monthly Trend — Submissions vs Completions" icon="📊" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 140, padding: "0 4px" }}>
          {monthKeys.map((k, i) => {
            const sub = stats.months[k] || 0;
            const comp = stats.completedMonths[k] || 0;
            const max = Math.max(...monthKeys.map(mk => Math.max(stats.months[mk] || 0, stats.completedMonths[mk] || 0)), 1);
            return (
              <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 1 }}>
                <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 110 }}>
                  <div style={{ width: 14, height: `${(sub / max) * 100}px`, background: "#2980b9", borderRadius: "3px 3px 0 0", minHeight: 2 }} title={`Submitted: ${sub}`} />
                  <div style={{ width: 14, height: `${(comp / max) * 100}px`, background: "#27ae60", borderRadius: "3px 3px 0 0", minHeight: 2 }} title={`Completed: ${comp}`} />
                </div>
                <span style={{ fontSize: 7, color: "#95a5a6" }}>{monthLabels[i]}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
          <span style={{ fontSize: 10, color: "#2980b9", fontWeight: 700 }}>■ Submitted</span>
          <span style={{ fontSize: 10, color: "#27ae60", fontWeight: 700 }}>■ Completed</span>
        </div>
      </Card>

      {/* Officer Workload */}
      {Object.keys(stats.officers).length > 0 && (
        <Card title="Officer Workload" icon="👤" style={{ marginBottom: 14 }}>
          {(() => {
            const maxOff = Math.max(...Object.values(stats.officers), 1);
            return Object.entries(stats.officers).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <HBar key={name} label={name} value={count} max={maxOff} color="#2980b9" />
            ));
          })()}
        </Card>
      )}

      {/* Data Table */}
      <Card title="Application Register" icon="📋" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by ID, applicant, address, officer..."
            style={{ padding: "7px 12px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 11, width: 280, fontFamily: "inherit", outline: "none" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={exportCSV} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#5a6a74" }}>📥 Export CSV</button>
            <span style={{ fontSize: 10, color: "#95a5a6", lineHeight: "28px" }}>{tableData.length} records</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e4e9ec" }}>
                {[
                  { col: "id", label: "Ref" }, { col: "owner", label: "Applicant" },
                  { col: "status", label: "Status" }, { col: "officer", label: "Assigned To" },
                  { col: "submitted", label: "Submitted" }, { col: "days", label: "Days Open" },
                  { col: "sla", label: "SLA" },
                ].map(h => (
                  <th key={h.col} onClick={() => toggleSort(h.col)}
                    style={{ padding: "8px 10px", textAlign: "left", fontWeight: 800, color: "#5a6a74", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {h.label}{sortArrow(h.col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map(a => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f5f7f8" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1a3a4a" }}>{a.id}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 600, color: "#1a3a4a" }}>{a.owner?.name}</div>
                    <div style={{ fontSize: 9, color: "#95a5a6" }}>{a.property?.address?.split(",")[0]}</div>
                  </td>
                  <td style={{ padding: "8px 10px" }}><StatusBadge status={a.status} /></td>
                  <td style={{ padding: "8px 10px", color: "#5a6a74" }}>{a.assessment?.officer || "—"}</td>
                  <td style={{ padding: "8px 10px", color: "#7a8a94", fontSize: 10 }}>{a.submittedDate}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: a.daysOpen > 30 ? "#e74c3c" : a.daysOpen > 14 ? "#e67e22" : "#1a3a4a" }}>{a.daysOpen}</td>
                  <td style={{ padding: "8px 10px" }}><SlaBadge sla={a.sla} /></td>
                </tr>
              ))}
              {pageData.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#95a5a6", fontSize: 12 }}>No matching applications</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 12 }}>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: page > 0 ? "pointer" : "default", color: page > 0 ? "#1a3a4a" : "#d5dde2" }}>‹ Prev</button>
            {Array.from({ length: Math.min(pageCount, 7) }, (_, i) => {
              const p = pageCount <= 7 ? i : (page < 3 ? i : page > pageCount - 4 ? pageCount - 7 + i : page - 3 + i);
              return (
                <button key={p} onClick={() => setPage(p)}
                  style={{ padding: "4px 10px", borderRadius: 4, border: p === page ? "1.5px solid #1abc9c" : "1px solid #d5dde2", background: p === page ? "#1abc9c12" : "#fff", fontSize: 10, fontWeight: p === page ? 800 : 400, cursor: "pointer", color: p === page ? "#1abc9c" : "#5a6a74" }}>{p + 1}</button>
              );
            })}
            <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
              style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: page < pageCount - 1 ? "pointer" : "default", color: page < pageCount - 1 ? "#1a3a4a" : "#d5dde2" }}>Next ›</button>
          </div>
        )}
      </Card>
    </div>
  );
}
