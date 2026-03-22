import { useMemo } from 'react';
import { STATUS_CONFIG } from '../data/constants';
import MetricCard from '../components/ui/MetricCard';
import StatusBadge from '../components/ui/StatusBadge';
import LeafletMap from '../components/map/LeafletMap';

const daysBetween = (d1, d2) => Math.max(0, Math.round((d2 - d1) / 86400000));
const parseDate = (s) => s ? new Date(s) : null;
const NOW = new Date();

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ width: 60, height: 6, background: "#f0f3f5", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD — role-aware
//  Manager/Admin: KPIs + status chips + officer workload + unassigned list
//  Engineer: personal KPIs + urgent cases
//  All: map + recent applications
// ═══════════════════════════════════════════════════════════
export default function DashboardView({ apps, allApps, onSelectApp, globalLotsData, currentUser, users }) {
  const role = currentUser?.role || "engineer";
  const all = allApps || apps;
  const sc = {};
  Object.keys(STATUS_CONFIG).forEach(s => { sc[s] = all.filter(a => a.status === s).length; });

  // ─── Manager/Admin stats ──────────────────────────────
  const managerStats = useMemo(() => {
    if (role !== "admin" && role !== "manager") return null;
    const active = all.filter(a => !["approved", "rejected"].includes(a.status));
    const unassigned = all.filter(a => !a.assessment?.officer && !["approved", "rejected"].includes(a.status));
    const overdue = active.filter(a => {
      const sub = parseDate(a.submittedDate);
      return sub && daysBetween(sub, NOW) > 21;
    });
    const thisMonth = all.filter(a => {
      const sub = parseDate(a.submittedDate);
      return sub && sub.getMonth() === NOW.getMonth() && sub.getFullYear() === NOW.getFullYear();
    });
    const officers = {};
    active.forEach(a => {
      const off = a.assessment?.officer;
      if (off) officers[off] = (officers[off] || 0) + 1;
    });
    const completedThisMonth = all.filter(a => {
      const sub = parseDate(a.submittedDate);
      return ["approved", "rejected"].includes(a.status) && sub && sub.getMonth() === NOW.getMonth() && sub.getFullYear() === NOW.getFullYear();
    });
    return { active: active.length, unassigned, overdue: overdue.length, thisMonth: thisMonth.length, officers, completedThisMonth: completedThisMonth.length };
  }, [all, role]);

  // ─── Engineer stats ───────────────────────────────────
  const engineerStats = useMemo(() => {
    if (role !== "engineer") return null;
    const mine = apps;
    const active = mine.filter(a => !["approved", "rejected"].includes(a.status));
    const pending = mine.filter(a => a.status === "pending_review");
    const underAssessment = mine.filter(a => a.status === "under_assessment");
    const completed = mine.filter(a => ["approved", "rejected"].includes(a.status));
    const overdue = active.filter(a => {
      const sub = parseDate(a.submittedDate);
      return sub && daysBetween(sub, NOW) > 21;
    });
    const avgDays = active.length > 0
      ? Math.round(active.reduce((sum, a) => {
          const sub = parseDate(a.submittedDate);
          return sum + (sub ? daysBetween(sub, NOW) : 0);
        }, 0) / active.length)
      : 0;
    return { total: mine.length, active: active.length, pending: pending.length, underAssessment: underAssessment.length, completed: completed.length, overdue: overdue.length, avgDays };
  }, [apps, role]);

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>Dashboard</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 16px" }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>

      {/* ═══ MANAGER / ADMIN ═══ */}
      {(role === "admin" || role === "manager") && managerStats && (
        <>
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

          {/* Officer Workload */}
          {Object.keys(managerStats.officers).length > 0 && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a4a", marginBottom: 10 }}>👤 Officer Workload</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(managerStats.officers).sort((a, b) => b[1] - a[1]).map(([name, count]) => {
                  const maxLoad = Math.max(...Object.values(managerStats.officers));
                  return (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#f8fafb", borderRadius: 6, border: "1px solid #eef2f4" }}>
                      <div style={{ width: 26, height: 26, borderRadius: 7, background: count > 5 ? "#e74c3c15" : "#2980b915", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: count > 5 ? "#e74c3c" : "#2980b9" }}>{count}</div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a" }}>{name}</div>
                        <MiniBar value={count} max={maxLoad} color={count > 5 ? "#e74c3c" : "#2980b9"} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Unassigned Applications */}
          {managerStats.unassigned.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e74c3c30", overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 18px", borderBottom: "1px solid #fde8e8", background: "#fef5f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: "#e74c3c" }}>⚠ Unassigned Applications ({managerStats.unassigned.length})</span>
                <span style={{ fontSize: 10, color: "#c0392b" }}>Require officer assignment</span>
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
              {managerStats.unassigned.length > 8 && (
                <div style={{ padding: "8px 18px", textAlign: "center", fontSize: 10, color: "#c0392b", fontWeight: 600 }}>+ {managerStats.unassigned.length - 8} more unassigned</div>
              )}
            </div>
          )}
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

          {/* Urgent cases */}
          {(() => {
            const urgent = apps.filter(a => {
              const sub = parseDate(a.submittedDate);
              return !["approved", "rejected"].includes(a.status) && sub && daysBetween(sub, NOW) > 14;
            }).sort((a, b) => (parseDate(a.submittedDate) || NOW) - (parseDate(b.submittedDate) || NOW));
            if (urgent.length === 0) return null;
            return (
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e67e2230", overflow: "hidden", marginBottom: 14 }}>
                <div style={{ padding: "10px 18px", borderBottom: "1px solid #fef5e7", background: "#fefbf5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: "#e67e22" }}>⏰ Needs Attention ({urgent.length})</span>
                  <span style={{ fontSize: 10, color: "#d35400" }}>Open &gt;14 days</span>
                </div>
                {urgent.slice(0, 5).map(app => {
                  const sub = parseDate(app.submittedDate);
                  const days = sub ? daysBetween(sub, NOW) : 0;
                  return (
                    <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "9px 18px", borderBottom: "1px solid #fef8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#fefcf8"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div>
                        <div style={{ fontSize: 10, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</div>
                      </div>
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

      {/* ═══ RECENT APPLICATIONS ═══ */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #eef2f4", fontWeight: 700, fontSize: 14, color: "#1a3a4a" }}>
          {role === "engineer" ? "My Recent Cases" : "Recent Applications"}
        </div>
        {apps.slice(0, 8).map(app => {
          const sub = parseDate(app.submittedDate);
          const days = sub ? daysBetween(sub, NOW) : 0;
          return (
            <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "10px 18px", borderBottom: "1px solid #f5f7f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div>
                <div style={{ fontSize: 11, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {app.assessment?.officer && role !== "engineer" && <span style={{ fontSize: 9, color: "#95a5a6" }}>{app.assessment.officer}</span>}
                <span style={{ fontSize: 9, color: days > 21 ? "#e74c3c" : "#95a5a6", fontWeight: days > 21 ? 700 : 400 }}>{days}d</span>
                <StatusBadge status={app.status} />
              </div>
            </div>
          );
        })}
        {apps.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#95a5a6", fontSize: 12 }}>No applications to display</div>}
      </div>
    </div>
  );
}
