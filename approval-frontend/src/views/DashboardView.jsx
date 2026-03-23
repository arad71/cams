import { useState, useMemo } from 'react';
import { STATUS_CONFIG } from '../data/constants';
import MetricCard from '../components/ui/MetricCard';
import StatusBadge from '../components/ui/StatusBadge';
import LeafletMap from '../components/map/LeafletMap';

const daysBetween = (d1, d2) => Math.max(0, Math.round((d2 - d1) / 86400000));
const parseDate = (s) => s ? new Date(s) : null;
const NOW = new Date();
const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

function MiniBar({ value, max, color, height = 6 }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div style={{ width: "100%", height, background: "#eef2f4", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: 3 }} /></div>;
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD — role-aware
// ═══════════════════════════════════════════════════════════
export default function DashboardView({ apps, allApps, onSelectApp, globalLotsData, currentUser, users }) {
  const role = currentUser?.role || "engineer";
  const all = allApps || apps;
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("submitted");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const PAGE_SIZE = 12;

  const sc = {};
  Object.keys(STATUS_CONFIG).forEach(s => { sc[s] = all.filter(a => a.status === s).length; });

  // ─── Manager/Admin stats ──────────────────────────────
  const managerStats = useMemo(() => {
    if (role !== "admin" && role !== "manager") return null;
    const active = all.filter(a => !["approved", "rejected"].includes(a.status));
    const unassigned = all.filter(a => !a.assessment?.officer && !["approved", "rejected"].includes(a.status));
    const overdue = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) > 21; });
    const thisMonth = all.filter(a => { const s = parseDate(a.submittedDate); return s && s.getMonth() === NOW.getMonth() && s.getFullYear() === NOW.getFullYear(); });
    const completedThisMonth = all.filter(a => { const s = parseDate(a.submittedDate); return ["approved", "rejected"].includes(a.status) && s && s.getMonth() === NOW.getMonth() && s.getFullYear() === NOW.getFullYear(); });

    // Per-engineer performance
    const engineerPerf = {};
    all.forEach(a => {
      const off = a.assessment?.officer;
      if (!off) return;
      if (!engineerPerf[off]) engineerPerf[off] = { active: 0, completed: 0, overdue: 0, totalDays: 0, completedDays: 0, approved: 0, rejected: 0 };
      const ep = engineerPerf[off];
      const sub = parseDate(a.submittedDate);
      const days = sub ? daysBetween(sub, NOW) : 0;
      if (["approved", "rejected"].includes(a.status)) {
        ep.completed++;
        ep.completedDays += days;
        if (a.status === "approved") ep.approved++;
        else ep.rejected++;
      } else {
        ep.active++;
        ep.totalDays += days;
        if (days > 21) ep.overdue++;
      }
    });

    return { active: active.length, unassigned, overdue: overdue.length, thisMonth: thisMonth.length, completedThisMonth: completedThisMonth.length, engineerPerf };
  }, [all, role]);

  // ─── Engineer stats ───────────────────────────────────
  const engineerStats = useMemo(() => {
    if (role !== "engineer") return null;
    const mine = apps;
    const active = mine.filter(a => !["approved", "rejected"].includes(a.status));
    const pending = mine.filter(a => a.status === "pending_review");
    const underAssessment = mine.filter(a => a.status === "under_assessment");
    const completed = mine.filter(a => ["approved", "rejected"].includes(a.status));
    const overdue = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) > 21; });
    const avgDays = active.length > 0 ? Math.round(active.reduce((sum, a) => { const s = parseDate(a.submittedDate); return sum + (s ? daysBetween(s, NOW) : 0); }, 0) / active.length) : 0;
    return { total: mine.length, active: active.length, pending: pending.length, underAssessment: underAssessment.length, completed: completed.length, overdue: overdue.length, avgDays };
  }, [apps, role]);

  // ─── Application table (manager/admin) ────────────────
  const tableData = useMemo(() => {
    if (role !== "admin" && role !== "manager") return [];
    let data = all.map(a => { const s = parseDate(a.submittedDate); const d = s ? daysBetween(s, NOW) : 0; return { ...a, daysOpen: d, sla: d > 30 ? "overdue" : d > 21 ? "at_risk" : d > 14 ? "monitor" : "on_track" }; });
    if (search) { const q = search.toLowerCase(); data = data.filter(a => a.id?.toLowerCase().includes(q) || a.owner?.name?.toLowerCase().includes(q) || a.property?.address?.toLowerCase().includes(q) || a.assessment?.officer?.toLowerCase().includes(q) || a.status?.includes(q)); }
    data.sort((a, b) => { let va, vb; switch(sortCol) { case "id": va=a.id; vb=b.id; break; case "owner": va=a.owner?.name||""; vb=b.owner?.name||""; break; case "status": va=a.status; vb=b.status; break; case "officer": va=a.assessment?.officer||"zzz"; vb=b.assessment?.officer||"zzz"; break; case "days": va=a.daysOpen; vb=b.daysOpen; break; default: va=a.submittedDate||""; vb=b.submittedDate||""; } if (typeof va==="number") return sortDir==="asc"?va-vb:vb-va; return sortDir==="asc"?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va)); });
    return data;
  }, [all, role, search, sortCol, sortDir]);
  const pageCount = Math.ceil(tableData.length / PAGE_SIZE);
  const pageData = tableData.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);
  const toggleSort = (c) => { if (sortCol===c) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortCol(c); setSortDir("asc"); } };
  const sortArrow = (c) => sortCol===c?(sortDir==="asc"?" ▲":" ▼"):"";

  const SlaBadge = ({ sla }) => { const c = { on_track:{l:"On Track",c:"#27ae60",b:"#eafaf1"}, monitor:{l:"Monitor",c:"#3498db",b:"#ebf5fb"}, at_risk:{l:"At Risk",c:"#e67e22",b:"#fef5e7"}, overdue:{l:"Overdue",c:"#e74c3c",b:"#fdedec"} }[sla]||{l:sla,c:"#95a5a6",b:"#f0f3f5"}; return <span style={{padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,background:c.b,color:c.c}}>{c.l}</span>; };

  const exportCSV = () => {
    const h = ["ID","Applicant","Address","Status","Assigned To","Days Open","SLA","Submitted"];
    const rows = tableData.map(a => [a.id, a.owner?.name, a.property?.address, a.status, a.assessment?.officer||"", a.daysOpen, a.sla, a.submittedDate]);
    const csv = [h.join(","), ...rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(","))].join("\n");
    const b = new Blob([csv],{type:"text/csv"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=`applications_${new Date().toISOString().split("T")[0]}.csv`; a.click(); URL.revokeObjectURL(u);
  };

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>Dashboard</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 16px" }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>

      {/* ═══ MANAGER / ADMIN ═══ */}
      {(role === "admin" || role === "manager") && managerStats && (
        <>
          {/* KPIs */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <MetricCard label="Total Active" value={managerStats.active} color="#2980b9" />
            <MetricCard label="Unassigned" value={managerStats.unassigned.length} color={managerStats.unassigned.length > 3 ? "#e74c3c" : "#e67e22"} sub={managerStats.unassigned.length > 3 ? "⚠ Needs attention" : ""} />
            <MetricCard label="Overdue (>21d)" value={managerStats.overdue} color={managerStats.overdue > 0 ? "#e74c3c" : "#27ae60"} />
            <MetricCard label="New This Month" value={managerStats.thisMonth} color="#8e44ad" />
            <MetricCard label="Completed This Month" value={managerStats.completedThisMonth} color="#27ae60" />
          </div>

          {/* Status chips */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.entries(sc).filter(([, v]) => v > 0).map(([status, count]) => {
              const cfg = STATUS_CONFIG[status];
              return (
                <div key={status} style={{ padding: "6px 12px", borderRadius: 8, background: cfg?.bg || "#f0f3f5", border: `1px solid ${cfg?.color || "#ccc"}20`, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12 }}>{cfg?.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: cfg?.color }}>{count}</span>
                  <span style={{ fontSize: 10, color: "#7a8a94" }}>{cfg?.label}</span>
                </div>
              );
            })}
          </div>

          {/* Unassigned */}
          {managerStats.unassigned.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e74c3c30", overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 18px", borderBottom: "1px solid #fde8e8", background: "#fef5f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: "#e74c3c" }}>⚠ Unassigned Applications ({managerStats.unassigned.length})</span>
                <span style={{ fontSize: 10, color: "#c0392b" }}>Click to open and assign</span>
              </div>
              {managerStats.unassigned.slice(0, 8).map(app => {
                const sub = parseDate(app.submittedDate);
                const days = sub ? daysBetween(sub, NOW) : 0;
                return (
                  <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "9px 18px", borderBottom: "1px solid #fef0f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fef9f9"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div>
                      <div style={{ fontSize: 10, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: days > 14 ? "#e74c3c" : days > 7 ? "#e67e22" : "#7a8a94" }}>{days}d ago</span>
                      <StatusBadge status={app.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ Officer Workload + Performance ═══ */}
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #eef2f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>👤 Officer Workload & Performance</span>
              <span style={{ fontSize: 10, color: "#95a5a6" }}>{Object.keys(managerStats.engineerPerf).length} officers</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e4e9ec", background: "#f8fafb" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Officer</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Active</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Completed</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Overdue</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Avg Days</th>
                    <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase" }}>Approval %</th>
                    <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 800, color: "#5a6a74", fontSize: 9, textTransform: "uppercase", width: 140 }}>Workload</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(managerStats.engineerPerf).sort((a, b) => (b[1].active + b[1].completed) - (a[1].active + a[1].completed)).map(([name, ep]) => {
                    const maxActive = Math.max(...Object.values(managerStats.engineerPerf).map(e => e.active), 1);
                    const avgD = ep.completed > 0 ? Math.round(ep.completedDays / ep.completed) : (ep.active > 0 ? Math.round(ep.totalDays / ep.active) : 0);
                    const approvalPct = pct(ep.approved, ep.completed);
                    return (
                      <tr key={name} style={{ borderBottom: "1px solid #f5f7f8" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 700, color: "#1a3a4a" }}>{name}</div>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: ep.active > 5 ? "#e74c3c" : "#2980b9" }}>{ep.active}</span>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "#27ae60" }}>{ep.completed}</span>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: ep.overdue > 0 ? "#e74c3c" : "#27ae60" }}>{ep.overdue > 0 ? `⚠ ${ep.overdue}` : "✓ 0"}</span>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: avgD > 21 ? "#e74c3c" : avgD > 14 ? "#e67e22" : "#27ae60" }}>{avgD}d</span>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          {ep.completed > 0 ? (
                            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: approvalPct >= 80 ? "#eafaf1" : "#fef5e7", color: approvalPct >= 80 ? "#27ae60" : "#e67e22" }}>{approvalPct}%</span>
                          ) : <span style={{ fontSize: 10, color: "#95a5a6" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <MiniBar value={ep.active} max={maxActive} color={ep.active > 5 ? "#e74c3c" : "#2980b9"} height={8} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══ APPLICATION REGISTER (manager only) — collapsible ═══ */}
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden", marginBottom: 14 }}>
            <div onClick={() => setRegisterOpen(!registerOpen)} style={{ padding: "12px 18px", borderBottom: registerOpen ? "1px solid #eef2f4" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#95a5a6", transition: "transform 0.2s", transform: registerOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>📋 Application Register</span>
                <span style={{ fontSize: 10, color: "#95a5a6", fontWeight: 600 }}>{tableData.length} records</span>
              </div>
              {registerOpen && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                  <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search ID, applicant, officer..." style={{ padding: "5px 10px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 10, width: 200, fontFamily: "inherit", outline: "none" }} />
                  <button onClick={exportCSV} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#5a6a74" }}>📥 CSV</button>
                </div>
              )}
            </div>
            {registerOpen && (
              <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e4e9ec" }}>
                    {[{c:"id",l:"Ref"},{c:"owner",l:"Applicant"},{c:"status",l:"Status"},{c:"officer",l:"Assigned To"},{c:"submitted",l:"Submitted"},{c:"days",l:"Days"},{c:"sla",l:"SLA"}].map(h => (
                      <th key={h.c} onClick={() => toggleSort(h.c)} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 800, color: "#5a6a74", cursor: "pointer", userSelect: "none", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h.l}{sortArrow(h.c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.map(a => (
                    <tr key={a.id} onClick={() => onSelectApp(a)} style={{ borderBottom: "1px solid #f5f7f8", cursor: "pointer" }} onMouseEnter={e=>e.currentTarget.style.background="#f8fafb"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1a3a4a" }}>{a.id}</td>
                      <td style={{ padding: "8px 10px" }}><div style={{ fontWeight: 600, color: "#1a3a4a" }}>{a.owner?.name}</div><div style={{ fontSize: 9, color: "#95a5a6" }}>{a.property?.address?.split(",")[0]}</div></td>
                      <td style={{ padding: "8px 10px" }}><StatusBadge status={a.status} /></td>
                      <td style={{ padding: "8px 10px" }}>{a.assessment?.officer || <span style={{ color: "#e74c3c", fontSize: 10, fontWeight: 700 }}>⚠ Unassigned</span>}</td>
                      <td style={{ padding: "8px 10px", color: "#7a8a94", fontSize: 10 }}>{a.submittedDate}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: a.daysOpen > 21 ? "#e74c3c" : a.daysOpen > 14 ? "#e67e22" : "#1a3a4a" }}>{a.daysOpen}</td>
                      <td style={{ padding: "8px 10px" }}><SlaBadge sla={a.sla} /></td>
                    </tr>
                  ))}
                  {!pageData.length && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#95a5a6" }}>No matching records</td></tr>}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div style={{ padding: "10px 18px", borderTop: "1px solid #eef2f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#95a5a6" }}>Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE, tableData.length)} of {tableData.length}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={()=>setPage(Math.max(0,page-1))} disabled={page===0} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: page>0?"pointer":"default", color: page>0?"#1a3a4a":"#d5dde2" }}>‹ Prev</button>
                  <button onClick={()=>setPage(Math.min(pageCount-1,page+1))} disabled={page>=pageCount-1} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: page<pageCount-1?"pointer":"default", color: page<pageCount-1?"#1a3a4a":"#d5dde2" }}>Next ›</button>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </>
      )}

      {/* ═══ ENGINEER ═══ */}
      {role === "engineer" && engineerStats && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <MetricCard label="My Cases" value={engineerStats.total} color="#2980b9" />
            <MetricCard label="Under Assessment" value={engineerStats.underAssessment} color="#3498db" />
            <MetricCard label="Pending Review" value={engineerStats.pending} color="#e67e22" sub={engineerStats.pending > 3 ? "⚠ Backlog" : ""} />
            <MetricCard label="Overdue (>21d)" value={engineerStats.overdue} color={engineerStats.overdue > 0 ? "#e74c3c" : "#27ae60"} />
            <MetricCard label="Avg Days Open" value={`${engineerStats.avgDays}d`} color={engineerStats.avgDays > 14 ? "#e67e22" : "#27ae60"} />
            <MetricCard label="Completed" value={engineerStats.completed} color="#27ae60" />
          </div>
          {(() => {
            const urgent = apps.filter(a => { const s = parseDate(a.submittedDate); return !["approved","rejected"].includes(a.status) && s && daysBetween(s, NOW) > 14; }).sort((a, b) => (parseDate(a.submittedDate)||NOW) - (parseDate(b.submittedDate)||NOW));
            if (!urgent.length) return null;
            return (
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e67e2230", overflow: "hidden", marginBottom: 14 }}>
                <div style={{ padding: "10px 18px", borderBottom: "1px solid #fef5e7", background: "#fefbf5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: "#e67e22" }}>⏰ Needs Attention ({urgent.length})</span>
                  <span style={{ fontSize: 10, color: "#d35400" }}>Open &gt;14 days</span>
                </div>
                {urgent.slice(0, 5).map(app => {
                  const sub = parseDate(app.submittedDate); const days = sub ? daysBetween(sub, NOW) : 0;
                  return (
                    <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "9px 18px", borderBottom: "1px solid #fef8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#fefcf8"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div><div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div><div style={{ fontSize: 10, color: "#7a8a94" }}>{app.owner?.name}</div></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: days > 21 ? "#fdedec" : "#fef5e7", color: days > 21 ? "#e74c3c" : "#e67e22" }}>{days}d</span>
                        <StatusBadge status={app.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {/* ═══ MAP ═══ */}
      <div style={{ marginBottom: 16 }}>
        <LeafletMap apps={apps} onSelectApp={onSelectApp} height={380} allLotsData={globalLotsData} />
      </div>

      {/* ═══ RECENT APPLICATIONS — collapsible ═══ */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <div onClick={() => setRecentOpen(!recentOpen)} style={{ padding: "12px 18px", borderBottom: recentOpen ? "1px solid #eef2f4" : "none", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
          onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <span style={{ fontSize: 10, color: "#95a5a6", transition: "transform 0.2s", transform: recentOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1a3a4a" }}>{role === "engineer" ? "My Recent Cases" : "Recent Applications"}</span>
          <span style={{ fontSize: 10, color: "#95a5a6", fontWeight: 600 }}>{Math.min(apps.length, 8)} of {apps.length}</span>
        </div>
        {recentOpen && (
          <>
            {apps.slice(0, 8).map(app => {
              const sub = parseDate(app.submittedDate); const days = sub ? daysBetween(sub, NOW) : 0;
              return (
                <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "10px 18px", borderBottom: "1px solid #f5f7f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div><div style={{ fontSize: 11, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {app.assessment?.officer && role !== "engineer" && <span style={{ fontSize: 9, color: "#95a5a6" }}>{app.assessment.officer}</span>}
                    <span style={{ fontSize: 9, color: days > 21 ? "#e74c3c" : "#95a5a6", fontWeight: days > 21 ? 700 : 400 }}>{days}d</span>
                    <StatusBadge status={app.status} />
                  </div>
                </div>
              );
            })}
            {apps.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#95a5a6", fontSize: 12 }}>No applications</div>}
          </>
        )}
      </div>
    </div>
  );
}
