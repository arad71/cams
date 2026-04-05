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

function ApplicationDetailView({ app, apps, onBack, onUpdateApp, onSelectApp, currentUser, reloadApp, users, globalSpeedRoads, globalLotsData, globalRoadNetwork, globalContoursData, globalUrbanForestData, globalDrainagePipesData, globalDrainagePitsData, globalWaterPipesData }) {
  const [localApp, setLocalApp] = useState(JSON.parse(JSON.stringify(app)));
  const [newNote, setNewNote] = useState("");
  const [newStatus, setNewStatus] = useState(app.status);
  const [measureCorrections, setMeasureCorrections] = useState([]);
  const [assignee, setAssignee] = useState(app.assessment.officer);
  const [categories, setCategories] = useState([]);

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
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>{localApp.id}</h2>
          <p style={{ color: "#7a8a94", fontSize: 13, margin: 0 }}>{localApp.owner.name} — {new Date(localApp.submittedDate).toLocaleDateString("en-AU")}</p>
        </div>
        <StatusBadge status={localApp.status} />
      </div>

      <WorkflowView
        app={app} apps={apps} onSelectApp={onSelectApp}
        currentUser={currentUser} reloadApp={reloadApp} users={users}
        globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
        globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
        globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
        globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
        localApp={localApp} setLocalApp={setLocalApp}
        newNote={newNote} setNewNote={setNewNote} addNote={addNote}
        assignee={assignee} setAssignee={setAssignee}
        newStatus={newStatus} setNewStatus={setNewStatus}
        saveChanges={saveChanges}
        measureCorrections={measureCorrections} setMeasureCorrections={setMeasureCorrections}
        categories={categories}
        canAssign={canAssign} canDecide={canDecide}
      />
    </div>
  );
}

// ─── Inspections ────────────────────────────────────────

export default ApplicationDetailView;
