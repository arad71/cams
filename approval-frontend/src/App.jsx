import { useState, useEffect } from "react";
import api from './services/api';
import { apiAppToFrontend, apiUserToFrontend, frontendAppToApiUpdate } from './utils/transforms';
import { ROLE_CONFIG as ROLE_CONFIG_DEFAULT } from './data/constants';
import LoginScreen from './views/LoginScreen';
import DashboardView from './views/DashboardView';
import FullMapView from './views/FullMapView';
import ApplicationListView from './views/ApplicationListView';
import ApplicationDetailView from './views/ApplicationDetailView';
import InspectionsView from './views/InspectionsView';
import SystemAdmin from './views/SystemAdmin';
import Sidebar from './components/ui/Sidebar';

// ═══════════════════════════════════════════════════════════
//  CITY OF KALAMUNDA — CROSSOVER APPROVAL SYSTEM v3
//  Root app component — state, routing, session management
// ═══════════════════════════════════════════════════════════
export default function KalamundaApprovalPortal() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [apps, setApps] = useState([]);
  const [activeView, setActiveView] = useState("dashboard");
  const [selectedApp, setSelectedApp] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [globalLotsData, setGlobalLotsData] = useState(null);
  const [globalSpeedRoads, setGlobalSpeedRoads] = useState(null);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [siteSettings, setSiteSettings] = useState({});

  // Site branding helpers (used everywhere)
  const S = {
    orgName: siteSettings.org_name || "City of Kalamunda",
    orgShort: siteSettings.org_short_name || "Kalamunda",
    systemName: siteSettings.system_name || "Crossover Approval Management System",
    systemShort: siteSettings.system_short_name || "CAMS",
    version: siteSettings.system_version || "3.1",
    icon: siteSettings.system_icon || "🏛",
    logoUrl: siteSettings.logo_url || "",
    primaryColor: siteSettings.primary_color || "#1abc9c",
    darkColor: siteSettings.dark_color || "#1a3a4a",
    portalTitle: siteSettings.portal_title || "Approval Portal",
    copyright: siteSettings.copyright_text || "© 2026 City of Kalamunda. All rights reserved.",
    contactEmail: siteSettings.contact_email || "",
    contactPhone: siteSettings.contact_phone || "",
    disclaimer: siteSettings.disclaimer || "",
    emailDomain: siteSettings.email_domain || "kalamunda.wa.gov.au",
  };

  // Build ROLE_CONFIG from API roles (fallback to hardcoded)
  const ROLE_CONFIG = roles.length > 0
    ? Object.fromEntries(roles.map(r => [r.code, { label: r.label, icon: r.icon, color: r.color, permissions: r.permissions }]))
    : ROLE_CONFIG_DEFAULT;

  // Load site settings before anything else (login page needs branding)
  useEffect(() => {
    api.getPublicSettings().then(s => { if (s && Object.keys(s).length > 0) setSiteSettings(s); }).catch(() => {});
  }, []);

  // Load lot.geojson and speed_roads.geojson once at app level
  useEffect(() => {
    let cancelled = false;
    async function loadGeoData() {
      try {
        const [lotsRes, roadsRes] = await Promise.all([
          fetch('/lot.geojson', { cache: 'no-cache' }),
          fetch('/speed_roads.geojson', { cache: 'no-cache' }),
        ]);
        if (!cancelled && lotsRes.ok) setGlobalLotsData(await lotsRes.json());
        if (!cancelled && roadsRes.ok) setGlobalSpeedRoads(await roadsRes.json());
      } catch (e) { console.error('Failed to load geojson data:', e); }
    }
    loadGeoData();
    return () => { cancelled = true; };
  }, []);

  // Try restore session from stored token
  useEffect(() => {
    const tryRestore = async () => {
      const token = localStorage.getItem("kala_token");
      if (!token) { setLoading(false); return; }
      try {
        const user = await api.me();
        setCurrentUser(apiUserToFrontend(user));
      } catch { api.logout(); }
      setLoading(false);
    };
    tryRestore();
  }, []);

  // Load apps when user changes
  useEffect(() => {
    if (!currentUser) { setApps([]); return; }
    const loadApps = async () => {
      try {
        const list = await api.listApps();
        const fullApps = await Promise.all(list.map(a => api.getApp(a.id)));
        setApps(fullApps.map(apiAppToFrontend));
      } catch (e) { console.error("Failed to load apps:", e); }
    };
    loadApps();
  }, [currentUser]);

  // Load users for admin
  useEffect(() => {
    if (!currentUser || currentUser.role === "engineer") return;
    const loadUsers = async () => {
      try {
        const uList = await api.listUsers();
        setUsers(uList.map(apiUserToFrontend));
      } catch { /* non-admin cannot list users */ }
    };
    loadUsers();
  }, [currentUser]);

  // Load roles and departments from API
  useEffect(() => {
    if (!currentUser) return;
    const loadLookups = async () => {
      try {
        const [r, d] = await Promise.all([api.listRoles(), api.listDepartments()]);
        if (r && r.length > 0) setRoles(r);
        if (d && d.length > 0) setDepartments(d);
      } catch (e) {
        console.warn("Failed to load roles/departments from API, using defaults:", e.message);
      }
    };
    loadLookups();
  }, [currentUser]);

  // Lot boundaries loaded at top level via globalLotsData

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePwForm, setChangePwForm] = useState({ current: "", new1: "", new2: "" });
  const [changePwError, setChangePwError] = useState(null);
  const [changePwSuccess, setChangePwSuccess] = useState(false);

  // Login/logout
  const handleLogin = (user) => {
    setCurrentUser(user);
    setActiveView("dashboard");
    if (user.must_change_password) setShowChangePassword(true);
  };
  const handleLogout = () => { api.logout(); setCurrentUser(null); setActiveView("dashboard"); setSelectedApp(null); setApps([]); setShowChangePassword(false); };

  const handleChangePassword = async () => {
    setChangePwError(null);
    if (changePwForm.new1.length < 6) { setChangePwError("New password must be at least 6 characters"); return; }
    if (changePwForm.new1 !== changePwForm.new2) { setChangePwError("New passwords do not match"); return; }
    try {
      await api.changePassword(changePwForm.current, changePwForm.new1);
      setChangePwSuccess(true);
      setCurrentUser(prev => ({ ...prev, must_change_password: false }));
      setTimeout(() => { setShowChangePassword(false); setChangePwSuccess(false); setChangePwForm({ current: "", new1: "", new2: "" }); }, 1500);
    } catch (e) { setChangePwError(e.message || "Failed to change password"); }
  };

  // Reload a single app from API
  const reloadApp = async (dbId) => {
    try {
      const fresh = await api.getApp(dbId);
      const converted = apiAppToFrontend(fresh);
      setApps(prev => prev.map(a => a._dbId === dbId ? converted : a));
      if (selectedApp && selectedApp._dbId === dbId) setSelectedApp(converted);
      return converted;
    } catch (e) { console.error("Failed to reload app:", e); }
  };

  // Reload all apps
  const reloadAllApps = async () => {
    try {
      const list = await api.listApps();
      const fullApps = await Promise.all(list.map(a => api.getApp(a.id)));
      setApps(fullApps.map(apiAppToFrontend));
    } catch (e) { console.error("Failed to reload apps:", e); }
  };

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif", color: "#7a8a94" }}>Loading...</div>;
  if (!currentUser) return <LoginScreen onLogin={handleLogin} branding={S} />;

  // Password change modal (shown on first login with temp password)
  const ChangePasswordModal = showChangePassword ? (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(12,31,46,0.6)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", width: "min(400px, 90vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>🔐 Change Password</h3>
        <p style={{ fontSize: 12, color: "#7a8a94", margin: "0 0 16px" }}>
          {currentUser.must_change_password ? "You must change your temporary password before continuing." : "Update your password"}
        </p>
        {changePwSuccess ? (
          <div style={{ padding: "16px", background: "#eafaf1", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>✅</div>
            <div style={{ fontWeight: 700, color: "#27ae60" }}>Password changed successfully!</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Current Password</label>
              <input type="password" value={changePwForm.current} onChange={e => setChangePwForm({...changePwForm, current: e.target.value})}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} placeholder="Enter current / temporary password" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase", display: "block", marginBottom: 3 }}>New Password</label>
              <input type="password" value={changePwForm.new1} onChange={e => setChangePwForm({...changePwForm, new1: e.target.value})}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} placeholder="Min 6 characters" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Confirm New Password</label>
              <input type="password" value={changePwForm.new2} onChange={e => setChangePwForm({...changePwForm, new2: e.target.value})}
                onKeyDown={e => e.key === "Enter" && handleChangePassword()}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} placeholder="Repeat new password" />
            </div>
            {changePwError && <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fdedec", borderRadius: 6, fontSize: 11, color: "#c0392b" }}>⚠️ {changePwError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!currentUser.must_change_password && <button onClick={() => setShowChangePassword(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d5dde2", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>}
              <button onClick={handleChangePassword} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Change Password</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  const role = currentUser.role;
  const visibleApps = role === "engineer"
    ? apps.filter(a => a.assessment.officer === currentUser.name)
    : apps;

  const handleSelectApp = app => { setSelectedApp(app); setActiveView("detail"); };

  const handleUpdateApp = async (u) => {
    try {
      await api.updateApp(u._dbId, frontendAppToApiUpdate(u));
      await reloadApp(u._dbId);
    } catch (e) { console.error("Update failed:", e); }
  };

  const handleAppCreated = async () => {
    await reloadAllApps();
  };

  const renderView = () => {
    if (activeView === "detail" && selectedApp) return <ApplicationDetailView app={selectedApp} apps={visibleApps} onBack={() => { setActiveView("applications"); setSelectedApp(null); }} onUpdateApp={handleUpdateApp} onSelectApp={handleSelectApp} currentUser={currentUser} reloadApp={reloadApp} users={users} globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData} />;
    switch (activeView) {
      case "dashboard": return <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      // case "map": return <FullMapView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} globalSpeedRoads={globalSpeedRoads} />;
      case "pending": return <ApplicationListView apps={visibleApps} filter="pending_review" onSelectApp={handleSelectApp} onAppCreated={handleAppCreated} globalLotsData={globalLotsData} />;
      case "referrals": return <ApplicationListView apps={visibleApps} filter="referral_pending" onSelectApp={handleSelectApp} onAppCreated={handleAppCreated} globalLotsData={globalLotsData} />;
      case "inspections": return <InspectionsView apps={visibleApps} />;
      case "admin": return role === "admin" ? <SystemAdmin users={users} setUsers={setUsers} currentUser={currentUser} ROLE_CONFIG={ROLE_CONFIG} roles={roles} departments={departments} branding={S} /> : <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      default: return <ApplicationListView apps={visibleApps} filter={null} onSelectApp={handleSelectApp} onAppCreated={handleAppCreated} globalLotsData={globalLotsData} />;
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100vw", maxWidth: "100vw", fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f0f3f5", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow-x:hidden}*{box-sizing:border-box}input:focus,select:focus,textarea:focus{border-color:#1abc9c!important;box-shadow:0 0 0 3px rgba(26,188,156,0.1)!important;outline:none}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#c8d0d4;border-radius:3px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}.lot-tooltip{font-family:'DM Sans',sans-serif!important;font-size:11px!important;padding:4px 8px!important;border-radius:4px!important}`}</style>
      {ChangePasswordModal}
      <Sidebar activeView={activeView} setActiveView={v => { setActiveView(v); setSelectedApp(null); }} apps={visibleApps} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} currentUser={currentUser} onLogout={handleLogout} ROLE_CONFIG={ROLE_CONFIG} branding={S} />
      <div style={{ flex: "1 1 0%", padding: "16px 20px", overflowY: "auto", overflowX: "hidden", minWidth: 0, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "6px 12px", background: `${ROLE_CONFIG[role].color}08`, borderRadius: 8, border: `1px solid ${ROLE_CONFIG[role].color}20` }}>
          <span style={{ fontSize: 11, color: ROLE_CONFIG[role].color, fontWeight: 600 }}>{ROLE_CONFIG[role].icon} {currentUser.name} — {ROLE_CONFIG[role].label}</span>
          {role === "engineer" && <span style={{ fontSize: 10, color: "#7a8a94" }}>{visibleApps.length} assigned case{visibleApps.length !== 1 ? "s" : ""}</span>}
        </div>
        {renderView()}
        <div style={{ marginTop: 20, padding: "12px 0", borderTop: "1px solid #e4e9ec", textAlign: "center", fontSize: 10, color: "#95a5a6" }}>
          {S.copyright} · {S.systemShort} v{S.version}
        </div>
      </div>
    </div>
  );
}
