import { STATUS_CONFIG } from '../data/constants';
import MetricCard from '../components/ui/MetricCard';
import StatusBadge from '../components/ui/StatusBadge';
import LeafletMap from '../components/map/LeafletMap';

// ─── Dashboard ──────────────────────────────────────────
export default function DashboardView({ apps, onSelectApp, globalLotsData }) {
  const sc = {}; Object.keys(STATUS_CONFIG).forEach(s => { sc[s] = apps.filter(a => a.status === s).length; });
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>Dashboard</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 20px" }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <MetricCard label="Active" value={apps.filter(a => !["approved","rejected"].includes(a.status)).length} color="#2980b9" />
        <MetricCard label="Pending" value={sc.pending_review} color="#e67e22" />
        <MetricCard label="Referrals" value={sc.referral_pending} color="#8e44ad" />
        <MetricCard label="Approved" value={sc.approved} color="#27ae60" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <LeafletMap apps={apps} onSelectApp={onSelectApp} height={380} allLotsData={globalLotsData} />
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #eef2f4", fontWeight: 700, fontSize: 14, color: "#1a3a4a" }}>Recent Applications</div>
        {apps.slice(0, 5).map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "10px 18px", borderBottom: "1px solid #f5f7f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div><div style={{ fontSize: 11, color: "#7a8a94" }}>{app.owner.name} — {app.property.address.split(",")[0]}</div></div>
            <StatusBadge status={app.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
