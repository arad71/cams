import { ROLE_CONFIG } from '../../data/constants';

// ═══════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════
export default function Sidebar({ activeView, setActiveView, apps, collapsed, setCollapsed, currentUser, onLogout }) {
  const pend = apps.filter(a => a.status === "pending_review").length;
  const refs = apps.filter(a => a.status === "referral_pending").length;
  const role = currentUser?.role || "engineer";
  const rc = ROLE_CONFIG[role];

  const baseNav = [
    { id: "dashboard", icon: "📊", label: "Dashboard", roles: ["admin", "manager", "engineer"] },
    { id: "map", icon: "🗺️", label: "Property Map", roles: ["admin", "manager", "engineer"] },
    { id: "applications", icon: "📋", label: role === "engineer" ? "My Cases" : "All Applications", badge: apps.length, roles: ["admin", "manager", "engineer"] },
    { id: "pending", icon: "⏳", label: "Pending Review", badge: pend, roles: ["admin", "manager"] },
    { id: "referrals", icon: "↗️", label: "Referrals", badge: refs, roles: ["admin", "manager"] },
    { id: "inspections", icon: "🔍", label: "Inspections", roles: ["admin", "manager", "engineer"] },
    { id: "admin", icon: "⚙️", label: "Administration", roles: ["admin"] },
  ];
  const nav = baseNav.filter(n => n.roles.includes(role));
  const w = collapsed ? 52 : 220;
  return (
    <div style={{ width: w, minWidth: w, maxWidth: w, background: "#0c1f2e", minHeight: "100vh", display: "flex", flexDirection: "column", flexShrink: 0, flexGrow: 0, transition: "all 0.2s ease", overflow: "hidden" }}>
      <div style={{ padding: collapsed ? "12px 8px" : "14px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 4, color: "#1abc9c" }} title="Expand">☰</button>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#1abc9c,#16a085)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🏛</div>
              <div><div style={{ color: "#ecf0f1", fontWeight: 800, fontSize: 11 }}>City of Kalamunda</div><div style={{ color: "#5d7a8c", fontSize: 9 }}>Approval Portal v3.1</div></div>
            </div>
            <button onClick={() => setCollapsed(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#5d7a8c", padding: 2 }} title="Collapse">✕</button>
          </>
        )}
      </div>
      <nav style={{ padding: collapsed ? "8px 4px" : "8px 6px", flex: 1 }}>
        {nav.map(item => {
          const act = activeView === item.id;
          return <button key={item.id} onClick={() => setActiveView(item.id)} title={item.label}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: collapsed ? 0 : 8, padding: collapsed ? "9px 0" : "8px 10px", borderRadius: 6, border: "none", cursor: "pointer", marginBottom: 2, background: act ? "rgba(26,188,156,0.12)" : "transparent", color: act ? "#1abc9c" : "#8da4b4", fontSize: 12, fontWeight: act ? 700 : 500, fontFamily: "inherit", textAlign: "left", justifyContent: collapsed ? "center" : "flex-start" }}>
            <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && <span style={{ flex: 1, whiteSpace: "nowrap" }}>{item.label}</span>}
            {!collapsed && item.badge > 0 && <span style={{ background: act ? "#1abc9c" : "#2c3e50", color: act ? "#0c1f2e" : "#8da4b4", fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 8 }}>{item.badge}</span>}
          </button>;
        })}
      </nav>
      {!collapsed && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: rc.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{currentUser?.initials || "?"}</div>
            <div style={{ flex: 1 }}><div style={{ color: "#bdc3c7", fontSize: 10, fontWeight: 600 }}>{currentUser?.name || "—"}</div><div style={{ color: "#5d7a8c", fontSize: 9 }}>{rc.icon} {rc.label}</div></div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#5d7a8c", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>🚪 Sign Out</button>
        </div>
      )}
    </div>
  );
}
