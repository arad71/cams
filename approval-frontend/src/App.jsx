import { useState, useEffect } from "react";
import api from './services/api';
import { apiAppToFrontend, apiUserToFrontend, frontendAppToApiUpdate } from './utils/transforms';
import { ROLE_CONFIG } from './data/constants';
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

  // Load lot.geojson once at app level so all views can resolve coords
  useEffect(() => {
    let cancelled = false;
    async function loadLots() {
      try {
        const res = await fetch('/lot.geojson', { cache: 'no-cache' });
        if (!res.ok) return;
        const gj = await res.json();
        if (!cancelled) setGlobalLotsData(gj);
      } catch (e) { console.error('Failed to load lot.geojson:', e); }
    }
    loadLots();
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

  // Lot boundaries loaded at top level via globalLotsData

  // Login/logout
  const handleLogin = (user) => { setCurrentUser(user); setActiveView("dashboard"); };
  const handleLogout = () => { api.logout(); setCurrentUser(null); setActiveView("dashboard"); setSelectedApp(null); setApps([]); };

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
  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

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

  const renderView = () => {
    if (activeView === "detail" && selectedApp) return <ApplicationDetailView app={selectedApp} apps={visibleApps} onBack={() => { setActiveView("applications"); setSelectedApp(null); }} onUpdateApp={handleUpdateApp} onSelectApp={handleSelectApp} currentUser={currentUser} reloadApp={reloadApp} users={users} />;
    switch (activeView) {
      case "dashboard": return <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      case "map": return <FullMapView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      case "pending": return <ApplicationListView apps={visibleApps} filter="pending_review" onSelectApp={handleSelectApp} />;
      case "referrals": return <ApplicationListView apps={visibleApps} filter="referral_pending" onSelectApp={handleSelectApp} />;
      case "inspections": return <InspectionsView apps={visibleApps} />;
      case "admin": return role === "admin" ? <SystemAdmin users={users} setUsers={setUsers} currentUser={currentUser} /> : <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      default: return <ApplicationListView apps={visibleApps} filter={null} onSelectApp={handleSelectApp} />;
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100vw", maxWidth: "100vw", fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f0f3f5", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow-x:hidden}*{box-sizing:border-box}input:focus,select:focus,textarea:focus{border-color:#1abc9c!important;box-shadow:0 0 0 3px rgba(26,188,156,0.1)!important;outline:none}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#c8d0d4;border-radius:3px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}.lot-tooltip{font-family:'DM Sans',sans-serif!important;font-size:11px!important;padding:4px 8px!important;border-radius:4px!important}`}</style>
      <Sidebar activeView={activeView} setActiveView={v => { setActiveView(v); setSelectedApp(null); }} apps={visibleApps} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} currentUser={currentUser} onLogout={handleLogout} />
      <div style={{ flex: "1 1 0%", padding: "16px 20px", overflowY: "auto", overflowX: "hidden", minWidth: 0, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "6px 12px", background: `${ROLE_CONFIG[role].color}08`, borderRadius: 8, border: `1px solid ${ROLE_CONFIG[role].color}20` }}>
          <span style={{ fontSize: 11, color: ROLE_CONFIG[role].color, fontWeight: 600 }}>{ROLE_CONFIG[role].icon} {currentUser.name} — {ROLE_CONFIG[role].label}</span>
          {role === "engineer" && <span style={{ fontSize: 10, color: "#7a8a94" }}>{visibleApps.length} assigned case{visibleApps.length !== 1 ? "s" : ""}</span>}
        </div>
        {renderView()}
      </div>
    </div>
  );
}
