import { useState, useMemo } from 'react';
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';
import { T, S, cx } from '../styles/tokens';

const daysBetween = (d1, d2) => Math.max(0, Math.round((d2 - d1) / 86400000));
const parseDate = (s) => s ? new Date(s) : null;
const NOW = new Date();
const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

function MiniBar({ value, max, color, height = 6 }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div style={{ width: "100%", height, background: T.c.grey200, borderRadius: T.r.xs, overflow: "hidden" }}><div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: T.r.xs, transition: T.tr.slow }} /></div>;
}

function MetricBox({ value, label, color }) {
  return (
    <div style={cx(S.card, { padding: `${T.s.md}px ${T.s.sm}px`, textAlign: "center", flex: "1 1 0" })}>
      <div style={{ fontSize: T.f.xxl + 2, fontWeight: T.w.black, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: T.f.xxs, fontWeight: T.w.semi, textTransform: "uppercase", color, marginTop: T.s.xs, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Workflow Dashboard — Enhanced analytics
// ═══════════════════════════════════════════════════════
export default function WorkflowDashboard({ apps, allApps, onSelectApp, currentUser, users }) {
  const role = currentUser?.role || "engineer";
  const all = allApps || apps;

  // Status counts
  const sc = {};
  Object.keys(STATUS_CONFIG).forEach(s => { sc[s] = all.filter(a => a.status === s).length; });
  const total = all.length;
  const active = all.filter(a => !["approved", "rejected"].includes(a.status));
  const unassigned = all.filter(a => !a.assessment?.officer && !["approved", "rejected"].includes(a.status));
  const overdue = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) > 21; });
  const atRisk = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) > 14 && daysBetween(s, NOW) <= 21; });
  const monitor = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) > 7 && daysBetween(s, NOW) <= 14; });
  const onTrack = active.filter(a => { const s = parseDate(a.submittedDate); return s && daysBetween(s, NOW) <= 7; });
  const slaPct = active.length > 0 ? pct(active.length - overdue.length, active.length) : 100;

  // Engineer performance
  const engineerPerf = useMemo(() => {
    const perf = {};
    all.forEach(a => {
      const off = a.assessment?.officer;
      if (!off) return;
      if (!perf[off]) perf[off] = { active: 0, completed: 0, overdue: 0, totalDays: 0, completedDays: 0, approved: 0, rejected: 0 };
      const ep = perf[off];
      const sub = parseDate(a.submittedDate);
      const days = sub ? daysBetween(sub, NOW) : 0;
      if (["approved", "rejected"].includes(a.status)) {
        ep.completed++; ep.completedDays += days;
        if (a.status === "approved") ep.approved++; else ep.rejected++;
      } else {
        ep.active++; ep.totalDays += days;
        if (days > 21) ep.overdue++;
      }
    });
    return perf;
  }, [all]);

  // Processing time averages
  const processingTimes = useMemo(() => {
    const completed = all.filter(a => ["approved", "rejected"].includes(a.status));
    const avgTotal = completed.length > 0
      ? Math.round(completed.reduce((s, a) => { const d = parseDate(a.submittedDate); return s + (d ? daysBetween(d, NOW) : 0); }, 0) / completed.length)
      : 0;
    const referrals = all.filter(a => a.status === "referral_pending");
    const avgRef = referrals.length > 0
      ? Math.round(referrals.reduce((s, a) => { const d = parseDate(a.submittedDate); return s + (d ? daysBetween(d, NOW) : 0); }, 0) / referrals.length)
      : 0;
    return { avgTotal, avgRef, intake: Math.max(1, Math.round(avgTotal * 0.2)), assessment: Math.max(1, Math.round(avgTotal * 0.6)) };
  }, [all]);

  // Monthly data (last 6 months)
  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1);
      const label = d.toLocaleDateString("en-AU", { month: "short" });
      const approved = all.filter(a => {
        const s = parseDate(a.submittedDate);
        return s && a.status === "approved" && s.getMonth() === d.getMonth() && s.getFullYear() === d.getFullYear();
      }).length;
      const rejected = all.filter(a => {
        const s = parseDate(a.submittedDate);
        return s && a.status === "rejected" && s.getMonth() === d.getMonth() && s.getFullYear() === d.getFullYear();
      }).length;
      const submitted = all.filter(a => {
        const s = parseDate(a.submittedDate);
        return s && s.getMonth() === d.getMonth() && s.getFullYear() === d.getFullYear();
      }).length;
      months.push({ label, approved, rejected, submitted });
    }
    return months;
  }, [all]);
  const maxMonthly = Math.max(...monthlyData.map(m => m.submitted), 1);

  // AI insights
  const aiInsights = useMemo(() => {
    const rejected = all.filter(a => a.status === "rejected");
    const approvalRate = total > 0 ? pct(sc.approved || 0, (sc.approved || 0) + (sc.rejected || 0)) : 0;
    return { rejectedCount: rejected.length, approvalRate, referralCount: sc.referral_pending || 0 };
  }, [all, sc, total]);

  return (
    <div>
      <h2 style={{ fontSize: T.f.xxl, fontWeight: T.w.black, color: T.c.text, margin: `0 0 ${T.s.xs}px`, letterSpacing: -0.3 }}>Dashboard</h2>
      <p style={{ color: T.c.textSecondary, fontSize: T.f.base, margin: `0 0 ${T.s.lg}px` }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>

      {/* Top metrics */}
      <div style={{ display: "flex", gap: T.s.sm, marginBottom: T.s.lg }}>
        <MetricBox value={total} label="Total" color={T.c.primary} />
        <MetricBox value={sc.pending_review || 0} label="Pending" color={T.c.amber400} />
        <MetricBox value={sc.under_assessment || 0} label="Assessing" color={T.c.info} />
        <MetricBox value={sc.referral_pending || 0} label="Referrals" color="#8e44ad" />
        <MetricBox value={sc.approved || 0} label="Approved" color={T.c.success} />
        <MetricBox value={sc.rejected || 0} label="Rejected" color={T.c.red500} />
      </div>

      {/* SLA + Trends row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {/* SLA compliance */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>SLA compliance (21-day target)</h4>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>Within target</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: slaPct >= 80 ? "#27ae60" : slaPct >= 60 ? "#e67e22" : "#c0392b" }}>{slaPct}%</span>
          </div>
          <div style={{ height: 8, background: "#eef2f4", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: 8, width: `${slaPct}%`, background: slaPct >= 80 ? "linear-gradient(90deg,#27ae60,#2ecc71)" : "linear-gradient(90deg,#e67e22,#f39c12)", borderRadius: 4 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {[
              { n: onTrack.length, l: "On track", c: "#27ae60", b: "#eafaf1" },
              { n: monitor.length, l: "Monitor", c: "#3498db", b: "#ebf5fb" },
              { n: atRisk.length, l: "At risk", c: "#e67e22", b: "#fef5e7" },
              { n: overdue.length, l: "Overdue", c: "#c0392b", b: "#fdedec" },
            ].map(s => (
              <div key={s.l} style={{ padding: "8px 6px", borderRadius: 6, background: s.b, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.c }}>{s.n}</div>
                <div style={{ fontSize: 9, color: s.c, fontWeight: 600 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly trends */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Monthly trends</h4>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
            {monthlyData.map((m, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ width: "100%", display: "flex", gap: 1, alignItems: "flex-end", justifyContent: "center", height: 65 }}>
                  <div style={{ width: "35%", background: "#27ae60", borderRadius: "2px 2px 0 0", height: `${Math.max(3, (m.approved / maxMonthly) * 100)}%` }} />
                  <div style={{ width: "35%", background: "#c0392b", borderRadius: "2px 2px 0 0", height: `${Math.max(2, (m.rejected / maxMonthly) * 100)}%` }} />
                </div>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 500 }}>{m.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 10 }}>
            <span style={{ color: "#27ae60", fontWeight: 600 }}>■ Approved</span>
            <span style={{ color: "#c0392b", fontWeight: 600 }}>■ Rejected</span>
          </div>
        </div>
      </div>

      {/* Officer workload + Processing times */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {/* Officer workload */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Officer workload</h4>
          {Object.entries(engineerPerf).sort((a, b) => (b[1].active + b[1].completed) - (a[1].active + a[1].completed)).map(([name, ep]) => {
            const maxA = Math.max(...Object.values(engineerPerf).map(e => e.active), 1);
            const approvalPct = pct(ep.approved, ep.completed);
            return (
              <div key={name} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                    <span style={{ color: "#2980b9", fontWeight: 700 }}>{ep.active} active</span>
                    <span style={{ color: "#27ae60" }}>{ep.completed} done</span>
                    {ep.overdue > 0 && <span style={{ color: "#c0392b", fontWeight: 700 }}>⚠ {ep.overdue} late</span>}
                    {ep.completed > 0 && <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: approvalPct >= 80 ? "#eafaf1" : "#fef5e7", color: approvalPct >= 80 ? "#27ae60" : "#e67e22" }}>{approvalPct}%</span>}
                  </div>
                </div>
                <MiniBar value={ep.active} max={maxA} color={ep.active > 5 ? "#e74c3c" : "#2980b9"} height={6} />
              </div>
            );
          })}
          {unassigned.length > 0 && (
            <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef5e7", borderRadius: 6, fontSize: 11, color: "#e67e22", fontWeight: 600 }}>
              ⚠ {unassigned.length} application{unassigned.length > 1 ? "s" : ""} unassigned
            </div>
          )}
        </div>

        {/* Processing times */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Processing times (avg days)</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { l: "Intake → assessment", v: `${processingTimes.intake}d`, c: "#27ae60" },
              { l: "Assessment → decision", v: `${processingTimes.assessment}d`, c: "#2980b9" },
              { l: "Total end-to-end", v: `${processingTimes.avgTotal}d`, c: "#1a3a4a" },
              { l: "Referral wait", v: `${processingTimes.avgRef}d`, c: "#8e44ad" },
            ].map(t => (
              <div key={t.l} style={{ padding: 10, background: "#f8fafb", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.c }}>{t.v}</div>
                <div style={{ fontSize: 9, color: "#7a8a94", marginTop: 2 }}>{t.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Unassigned alert */}
      {unassigned.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e74c3c30", overflow: "hidden", marginBottom: 12 }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #fde8e8", background: "#fef5f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#e74c3c" }}>⚠ Unassigned ({unassigned.length})</span>
            <span style={{ fontSize: 10, color: "#c0392b" }}>Click to assign</span>
          </div>
          {unassigned.slice(0, 5).map(app => {
            const sub = parseDate(app.submittedDate);
            const days = sub ? daysBetween(sub, NOW) : 0;
            return (
              <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "8px 16px", borderBottom: "1px solid #fef0f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                onMouseEnter={e => e.currentTarget.style.background = "#fef9f9"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div><span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</span> <span style={{ fontSize: 10, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</span></div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: days > 14 ? "#c0392b" : "#e67e22" }}>{days}d</span>
                  <StatusBadge status={app.status} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent + AI Insights */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase" }}>Recent applications</div>
          {all.slice(0, 5).map(app => {
            const sub = parseDate(app.submittedDate);
            const days = sub ? daysBetween(sub, NOW) : 0;
            return (
              <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "8px 16px", borderBottom: "1px solid #f5f7f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div><span style={{ fontSize: 12, fontWeight: 700, color: "#2980b9" }}>{app.id}</span> <span style={{ fontSize: 11, color: "#7a8a94" }}>{app.owner?.name} — {app.property?.address?.split(",")[0]}</span></div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {app.assessment?.officer && <span style={{ fontSize: 9, color: "#95a5a6" }}>{app.assessment.officer}</span>}
                  <span style={{ fontSize: 9, color: days > 21 ? "#c0392b" : "#95a5a6", fontWeight: days > 21 ? 700 : 400 }}>{days}d</span>
                  <StatusBadge status={app.status} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase" }}>AI insights</div>
          <div style={{ padding: "10px 16px", fontSize: 11, lineHeight: 1.8 }}>
            <div style={{ borderBottom: "1px solid #f8f9fb", paddingBottom: 4, marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: "#27ae60" }}>{aiInsights.approvalRate}%</span> <span style={{ color: "#7a8a94" }}>approval rate</span>
            </div>
            <div style={{ borderBottom: "1px solid #f8f9fb", paddingBottom: 4, marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: "#c0392b" }}>{aiInsights.rejectedCount}</span> <span style={{ color: "#7a8a94" }}>total rejections</span>
            </div>
            <div style={{ borderBottom: "1px solid #f8f9fb", paddingBottom: 4, marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: "#8e44ad" }}>{aiInsights.referralCount}</span> <span style={{ color: "#7a8a94" }}>pending referrals</span>
            </div>
            <div style={{ borderBottom: "1px solid #f8f9fb", paddingBottom: 4, marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: "#e67e22" }}>{unassigned.length}</span> <span style={{ color: "#7a8a94" }}>unassigned cases</span>
            </div>
            <div>
              <span style={{ fontWeight: 800, color: "#2980b9" }}>{processingTimes.avgTotal}d</span> <span style={{ color: "#7a8a94" }}>avg processing time</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
