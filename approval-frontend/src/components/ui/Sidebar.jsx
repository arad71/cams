import { ROLE_CONFIG as ROLE_CONFIG_DEFAULT } from '../../data/constants';
import { T } from '../../styles/tokens';

const sidebarBg = "#0b1a26";
const sidebarBorder = "rgba(255,255,255,0.05)";
const activeColor = T.c.accent;
const textDim = "#8ba3b5";
const textDimmer = "#506878";

export default function Sidebar({ activeView, setActiveView, apps, collapsed, setCollapsed, currentUser, onLogout, ROLE_CONFIG: ROLE_CONFIG_PROP, branding: B = {}, mobile = false, open = false, onClose = () => {} }) {
  const ROLE_CONFIG = ROLE_CONFIG_PROP || ROLE_CONFIG_DEFAULT;
  const orgName = B.orgName || "Council";
  const portalTitle = B.portalTitle || "Approval Portal";
  const version = B.version || "3.1";
  const icon = B.icon || "\u{1f3db}";
  const primaryColor = B.primaryColor || T.c.accent;
  const pend = apps.filter(a => a.status === "pending_review").length;
  const refs = apps.filter(a => a.status === "referral_pending").length;
  const role = currentUser?.role || "engineer";
  const rc = ROLE_CONFIG[role];

  const baseNav = [
    { id: "exec_dashboard", icon: "\u{1f4ca}", label: "Dashboard", roles: ["viewer"] },
    { id: "dashboard", icon: "\u{1f4ca}", label: "Dashboard", roles: ["admin", "manager", "engineer"] },
    { id: "applications", icon: "\u{1f4cb}", label: role === "engineer" ? "My Cases" : "All Applications", badge: apps.length, roles: ["admin", "manager", "engineer"] },
    { id: "pending", icon: "\u{23f3}", label: "Pending Review", badge: pend, roles: ["admin", "manager"] },
    { id: "referrals", icon: "\u{2197}\u{fe0f}", label: "Referrals", badge: refs, roles: ["admin", "manager"] },
    { id: "inspections", icon: "\u{1f50d}", label: "Inspections", roles: ["admin", "manager", "engineer"] },
    { id: "admin", icon: "\u{2699}\u{fe0f}", label: "Administration", roles: ["admin"] },
  ];
  const nav = baseNav.filter(n => n.roles.includes(role));
  const w = collapsed ? 56 : (mobile ? 260 : 224);
  // On phones the sidebar is an off-canvas drawer opened from the top bar.
  const mobileStyle = mobile ? {
    position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 1200,
    transform: open ? "translateX(0)" : "translateX(-105%)",
    transition: "transform 0.25s ease", boxShadow: open ? "0 0 40px rgba(0,0,0,0.35)" : "none",
  } : {};

  return (
    <>
    {mobile && open && <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(12,31,46,0.45)", zIndex: 1100 }} />}
    <div aria-hidden={mobile && !open ? "true" : undefined} style={{ width: w, minWidth: w, maxWidth: w, background: sidebarBg, minHeight: "100vh", display: "flex", flexDirection: "column", flexShrink: 0, transition: T.tr.base, overflow: "hidden", borderRight: `1px solid ${sidebarBorder}`, ...mobileStyle }}>
      {/* Logo / Brand */}
      <div style={{ padding: collapsed ? `${T.s.md}px ${T.s.sm}px` : `${T.s.lg}px`, borderBottom: `1px solid ${sidebarBorder}`, display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: T.s.xs, color: activeColor }} title="Expand">{"\u2630"}</button>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: T.s.sm }}>
              <div style={{ width: 32, height: 32, borderRadius: T.r.md, background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: `0 2px 8px ${primaryColor}40` }}>{icon}</div>
              <div>
                <div style={{ color: "#ecf0f1", fontWeight: T.w.black, fontSize: T.f.md, letterSpacing: -0.2 }}>{orgName}</div>
                <div style={{ color: textDimmer, fontSize: T.f.xxs }}>{portalTitle} v{version}</div>
              </div>
            </div>
            <button onClick={() => mobile ? onClose() : setCollapsed(true)} aria-label={mobile ? "Close menu" : "Collapse menu"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: textDimmer, padding: 2 }} title="Collapse">{"\u2715"}</button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ padding: collapsed ? `${T.s.sm}px ${T.s.xs}px` : `${T.s.sm}px`, flex: 1 }}>
        {nav.map(item => {
          const act = activeView === item.id;
          return (
            <button key={item.id} onClick={() => { setActiveView(item.id); if (mobile) onClose(); }} title={item.label}
              style={{
                width: "100%", display: "flex", alignItems: "center",
                gap: collapsed ? 0 : 10,
                padding: collapsed ? `${T.s.sm + 1}px 0` : `8px 12px`,
                borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
                background: act ? `${activeColor}15` : "transparent",
                color: act ? activeColor : textDim,
                fontSize: 13, fontWeight: act ? 600 : 400,
                fontFamily: "inherit", textAlign: "left",
                justifyContent: collapsed ? "center" : "flex-start",
                transition: "all 0.15s ease",
                letterSpacing: act ? "0.01em" : 0,
              }}
              onMouseEnter={e => { if (!act) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#b0c8d8"; } }}
              onMouseLeave={e => { if (!act) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = textDim; } }}>
              <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span style={{ flex: 1, whiteSpace: "nowrap" }}>{item.label}</span>}
              {!collapsed && item.badge > 0 && (
                <span style={{ background: act ? activeColor : "#2c3e50", color: act ? sidebarBg : textDim, fontSize: T.f.xs, fontWeight: T.w.black, padding: `2px 6px`, borderRadius: T.r.pill, minWidth: 20, textAlign: "center" }}>{item.badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User / Sign Out */}
      {!collapsed && (
        <div style={{ padding: `${T.s.md}px ${T.s.lg}px`, borderTop: `1px solid ${sidebarBorder}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: T.s.sm, marginBottom: T.s.sm }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: rc.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: T.f.sm, color: T.c.white, fontWeight: T.w.black }}>{currentUser?.initials || "?"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#bdc3c7", fontSize: T.f.md, fontWeight: T.w.semi }}>{currentUser?.name || "\u2014"}</div>
              <div style={{ color: textDimmer, fontSize: T.f.xxs }}>{rc.icon} {rc.label}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: `${T.s.xs + 1}px`, borderRadius: T.r.sm, border: `1px solid rgba(255,255,255,0.08)`, background: "transparent", color: textDimmer, fontSize: T.f.md, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", transition: T.tr.fast }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"}>
            {"\u{1f6aa}"} Sign Out
          </button>
        </div>
      )}
    </div>
    </>
  );
}
