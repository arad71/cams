import { useState, useEffect, useCallback } from "react";
import api from '../services/api';
import { frontendAppToApiUpdate } from '../utils/transforms';
import { STATUS_CONFIG, ROLE_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';
import MapWithOverlay from '../components/map/MapWithOverlay';
import DocumentList from '../components/ui/DocumentList';
import ApprovalChecklist from '../components/ui/ApprovalChecklist';
import AIExtractionReview from '../components/ui/AIExtractionReview';
import ReportGenerator from '../components/ui/ReportGenerator';
import WorkflowView from '../components/workflow/WorkflowView';

// ═══════════════════════════════════════════════════════
//  Application Detail View
// ═══════════════════════════════════════════════════════

function ApplicationDetailView({ app, apps, onBack, onUpdateApp, onSelectApp, currentUser, reloadApp, users, globalSpeedRoads, globalLotsData, globalRoadNetwork, uiMode = "classic" }) {
  const [localApp, setLocalApp] = useState(JSON.parse(JSON.stringify(app)));
  const [newNote, setNewNote] = useState("");
  const [newStatus, setNewStatus] = useState(app.status);
  const [measureCorrections, setMeasureCorrections] = useState([]);
  const [assignee, setAssignee] = useState(app.assessment.officer);
  const [categories, setCategories] = useState([]);

  // viewMode is now driven by the global uiMode prop
  const viewMode = uiMode;

  const role = currentUser?.role || "engineer";
  const canAssign = role === "admin" || role === "manager";
  const canDecide = role === "admin" || role === "manager";

  // Fetch assessment categories from API once
  useEffect(() => {
    let cancelled = false;
    api.listCategories().then(data => { if (!cancelled) setCategories(data); }).catch(e => console.error(e));
    return () => { cancelled = true; };
  }, []);

  const addNote = async () => {
    if (!newNote.trim()) return;
    try {
      await api.addNote(localApp._dbId, newNote);
      const fresh = await reloadApp(localApp._dbId);
      if (fresh) setLocalApp(fresh);
      setNewNote("");
    } catch (e) { console.error("Add note failed:", e); }
  };

  const saveChanges = async () => {
    try {
      const update = frontendAppToApiUpdate({ ...localApp, status: newStatus, assessment: { ...localApp.assessment, officer: assignee } });
      const selUser = (users || []).find(u => u.name === assignee);
      if (selUser && selUser._dbId !== localApp.assessment.officerId) {
        await api.assignOfficer(localApp._dbId, selUser._dbId);
      }
      await api.updateApp(localApp._dbId, { status: newStatus });
      const fresh = await reloadApp(localApp._dbId);
      if (fresh) setLocalApp(fresh);
    } catch (e) { console.error("Save failed:", e); }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#2980b9", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>← Back</button>
        <span style={{ fontSize: 10, color: "#7a8a94", padding: "4px 10px", borderRadius: 6, background: viewMode === "workflow" ? "#E6F1FB" : "#f0f2f5", border: `1px solid ${viewMode === "workflow" ? "#185FA520" : "#e4e9ec"}` }}>
          {viewMode === "workflow" ? "🔄 Workflow view" : "📋 Classic view"}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>{localApp.id}</h2>
          <p style={{ color: "#7a8a94", fontSize: 13, margin: 0 }}>{localApp.owner.name} — {new Date(localApp.submittedDate).toLocaleDateString("en-AU")}</p>
        </div>
        <StatusBadge status={localApp.status} />
      </div>

      {/* ════════════ WORKFLOW VIEW ════════════ */}
      {viewMode === "workflow" && (
        <WorkflowView
          app={app} apps={apps} onSelectApp={onSelectApp}
          currentUser={currentUser} reloadApp={reloadApp} users={users}
          globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
          globalRoadNetwork={globalRoadNetwork}
          localApp={localApp} setLocalApp={setLocalApp}
          newNote={newNote} setNewNote={setNewNote} addNote={addNote}
          assignee={assignee} setAssignee={setAssignee}
          newStatus={newStatus} setNewStatus={setNewStatus}
          saveChanges={saveChanges}
          measureCorrections={measureCorrections} setMeasureCorrections={setMeasureCorrections}
          categories={categories}
          canAssign={canAssign} canDecide={canDecide}
        />
      )}

      {/* ════════════ CLASSIC VIEW ════════════ */}
      {viewMode === "classic" && (
        <>
          {/* ★ MAP WITH OVERLAY ★ */}
          <div style={{ marginBottom: 16 }}><MapWithOverlay app={localApp} apps={apps} onSelectApp={onSelectApp} speedRoadsData={globalSpeedRoads} lotsData={globalLotsData} roadNetworkData={globalRoadNetwork} /></div>

          {/* Info Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Owner & Property</h4>
              {[["Owner",localApp.owner.name],["Phone",localApp.owner.phone],["Email",localApp.owner.email],["Property",localApp.property.address],["Lot",`${localApp.property.lot} (${localApp.property.plan})`],["Frontage",`${localApp.property.frontage}m`],["Road",`${localApp.property.roadName} (${localApp.property.roadType})`]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #f5f7f8",fontSize:12}}><span style={{color:"#7a8a94"}}>{k}</span><span style={{fontWeight:600,color:"#1a3a4a",textAlign:"right",maxWidth:"55%"}}>{v}</span></div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Crossover & Vegetation</h4>
              {[["Width",`${localApp.crossover.width}m`],["Count",localApp.crossover.count],["Surface",localApp.crossover.surface],["Offset",`${localApp.crossover.offsetFromLeft}m`],["Trees",localApp.vegetation.treesNearby?"Yes":"No"],["Clearing",localApp.vegetation.clearing?"⚠️ Yes":"No"],["Drainage",localApp.vegetation.drainage]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #f5f7f8",fontSize:12}}><span style={{color:"#7a8a94"}}>{k}</span><span style={{fontWeight:600,color:"#1a3a4a"}}>{v}</span></div>
              ))}
            </div>
          </div>

          {/* ★ DOCUMENTS ★ */}
          <div style={{ marginBottom: 14 }}>
            <DocumentList documents={localApp.documents} appDbId={localApp._dbId} app={localApp} currentUser={currentUser} onDocUpdated={async () => { const fresh = await reloadApp(localApp._dbId); if (fresh) setLocalApp(fresh); }}
              onMeasureCorrection={(fieldKey, value, unit) => {
                setMeasureCorrections(prev => [...prev.filter(c => c.field_path !== fieldKey), {
                  field_path: fieldKey,
                  ai_value: (() => { const spd = localApp?.cor_site_plan_data || localApp?.site_plan_data; const ext = spd?.extraction || spd || {}; const parts = fieldKey.split('.'); let v = ext; for (const p of parts) v = v?.[p]; return String(v ?? '—'); })(),
                  correct_value: String(value),
                  type: "measure_override",
                  unit: unit || "m",
                }]);
              }} />
          </div>

          {/* ★ AI SITE PLAN EXTRACTION ★ */}
          <div style={{ marginBottom: 14 }}>
            <AIExtractionReview app={localApp} currentUser={currentUser} onReload={async () => { const fresh = await reloadApp(localApp._dbId); if (fresh) setLocalApp(fresh); }} measureCorrections={measureCorrections} onMeasureCorrectionsApplied={() => setMeasureCorrections([])} />
          </div>

          {/* ★ APPROVAL CHECKLIST ★ */}
          <div style={{ marginBottom: 14 }}>
            <ApprovalChecklist app={localApp} categories={categories} currentUser={currentUser} />
          </div>

          {/* ★ REPORT GENERATOR ★ */}
          <div style={{ marginBottom: 14 }}>
            <ReportGenerator app={localApp} currentUser={currentUser} categories={categories} />
          </div>

          {/* Officer + Notes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Actions</h4>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", display: "block", marginBottom: 3 }}>Assigned Officer</label>
              {canAssign ? (
                <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", marginBottom: 10 }}>
                  <option value="">— Unassigned —</option>
                  {(users || []).filter(u => u.active && (u.role === "engineer" || u.role === "manager")).map(u => {
                    const rc = ROLE_CONFIG[u.role];
                    return <option key={u.id} value={u.name}>{rc.icon} {u.name} ({rc.label})</option>;
                  })}
                </select>
              ) : (
                <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e4e9ec", fontSize: 12, marginBottom: 10, background: "#f8fafb", color: "#1a3a4a", fontWeight: 600 }}>{assignee || "Unassigned"}</div>
              )}
              <label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", display: "block", marginBottom: 3 }}>Status</label>
              {canDecide ? (
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", marginBottom: 10 }}>{Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select>
              ) : (
                <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e4e9ec", fontSize: 12, marginBottom: 10, background: "#f8fafb" }}><StatusBadge status={newStatus} /></div>
              )}
              <button onClick={saveChanges} style={{ width: "100%", padding: "8px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#2980b9,#3498db)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Notes</h4>
              <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 8 }}>
                {localApp.assessment.notes.length === 0 && <div style={{ fontSize: 11, color: "#95a5a6" }}>No notes</div>}
                {localApp.assessment.notes.map((n, i) => <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid #f5f7f8", fontSize: 11 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, color: "#2980b9" }}>{n.author}</span><span style={{ color: "#95a5a6", fontSize: 10 }}>{n.date}</span></div><div style={{ color: "#3a4a5a", lineHeight: 1.4 }}>{n.text}</div></div>)}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} placeholder="Add note..." style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
                <button onClick={addNote} style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "#1a3a4a", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+</button>
              </div>
            </div>
          </div>

          {/* Quick Decision */}
          {canDecide && (
            <div style={{ display: "flex", gap: 6 }}>
              {[{s:"approved",l:"✅ Approve",bg:"#27ae60"},{s:"inspection_required",l:"🔍 Inspect",bg:"#16a085"},{s:"referral_pending",l:"↗️ Refer",bg:"#8e44ad"},{s:"on_hold",l:"⏸ Hold",bg:"#7f8c8d"},{s:"rejected",l:"❌ Reject",bg:"#c0392b"}].map(b => (
                <button key={b.s} onClick={async () => { try { await api.updateApp(localApp._dbId, { status: b.s }); const fresh = await reloadApp(localApp._dbId); if (fresh) { setLocalApp(fresh); setNewStatus(fresh.status); } } catch(e) { console.error(e); } }}
                  style={{ padding: "8px 12px", borderRadius: 7, border: "none", background: b.bg, color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit", flex: 1 }}>{b.l}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Inspections ────────────────────────────────────────

export default ApplicationDetailView;
