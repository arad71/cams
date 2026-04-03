import { useState, useEffect, useCallback } from "react";
import api from '../../services/api';
import { STATUS_CONFIG, ROLE_CONFIG } from '../../data/constants';
import StatusBadge from '../ui/StatusBadge';
import MapWithOverlay from '../map/MapWithOverlay';
import DocumentList from '../ui/DocumentList';
import ApprovalChecklist from '../ui/ApprovalChecklist';
import AIExtractionReview from '../ui/AIExtractionReview';
import ReportGenerator from '../ui/ReportGenerator';

// ─── Workflow Steps ─────────────────────────────────────
const STEPS = [
  { id: 1, key: "upload",   label: "Upload",   color: "#085041", bg: "#E1F5EE", desc: "Upload documents and create case" },
  { id: 2, key: "extract",  label: "Extract",   color: "#534AB7", bg: "#EEEDFE", desc: "AI extraction and officer verification" },
  { id: 3, key: "assess",   label: "Assess",    color: "#185FA5", bg: "#E6F1FB", desc: "Assessment checklist — AI + officer decisions" },
  { id: 4, key: "review",   label: "Review",    color: "#854F0B", bg: "#FAEEDA", desc: "Manager review and sign-off" },
  { id: 5, key: "decision", label: "Decision",  color: "#993C1D", bg: "#FAECE7", desc: "Final decision and notification" },
];

function statusToStep(status) {
  switch (status) {
    case "pending_review": return 1;
    case "under_assessment": return 3;
    case "referral_pending": return 4;
    case "inspection_required": return 3;
    case "approved": return 5;
    case "rejected": return 5;
    case "on_hold": return 4;
    default: return 1;
  }
}

// ─── Compact card style helpers ─────────────────────────
const card = { background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", overflow: "hidden" };
const cardHdr = { padding: "8px 12px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardBody = { padding: "10px 12px" };
const kvRow = { display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f8f9fb", fontSize: 11 };

// ─── Workflow Stepper ───────────────────────────────────
function Stepper({ currentStep, completedUpTo, onStepClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "10px 14px", background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", marginBottom: 12 }}>
      {STEPS.map((step, i) => {
        const done = step.id < completedUpTo;
        const active = step.id === currentStep;
        const future = step.id > completedUpTo && !active;
        return (
          <div key={step.id} style={{ display: "contents" }}>
            <div style={{ flex: 1, textAlign: "center", cursor: "pointer", opacity: future ? 0.4 : 1 }} onClick={() => onStepClick(step.id)}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, transition: "all 0.2s",
                background: active ? step.color : done ? "#085041" : "#f0f2f5",
                color: active ? step.bg : done ? "#E1F5EE" : "#b0bec5",
                border: active ? `2px solid ${step.color}` : done ? "2px solid #085041" : "1.5px solid #d5dde2",
                boxShadow: active ? `0 0 0 3px ${step.bg}` : "none",
              }}>
                {done ? "✓" : step.id}
              </div>
              <div style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? step.color : done ? "#085041" : "#b0bec5", marginTop: 3 }}>
                {step.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: "0 0 28px", height: 2, background: done || active ? "#085041" : "#e4e9ec", marginTop: -12 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}


// ─── Sidebar ────────────────────────────────────────────
function WorkflowSidebar({ app, currentUser, users, categories, onReload, newNote, setNewNote, addNote, assignee, setAssignee, newStatus, setNewStatus, saveChanges, canAssign, canDecide }) {
  const docs = app.documents || [];
  const spd = app?.cor_site_plan_data || app?.site_plan_data;
  const ext = spd?.extraction || spd || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Documents quick access */}
      <div style={card}>
        <div style={cardHdr}><span>📎 Documents ({docs.length})</span></div>
        <div style={{ maxHeight: 140, overflowY: "auto" }}>
          {docs.length === 0 && <div style={{ padding: 10, fontSize: 11, color: "#95a5a6" }}>No documents</div>}
          {docs.map(d => {
            const icons = { pdf: "📄", jpg: "🖼️", png: "🖼️", jpeg: "🖼️", doc: "📝", dwg: "📐" };
            const sc = { verified: { c: "#27ae60", l: "✓" }, rejected: { c: "#e74c3c", l: "✕" }, received: { c: "#3498db", l: "●" } };
            const st = sc[d.status] || sc.received;
            return (
              <div key={d.id} style={{ padding: "5px 12px", borderBottom: "1px solid #f8f9fb", display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ fontSize: 13 }}>{icons[d.type] || "📄"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, color: "#1a3a4a" }}>{d.name}</span>
                <span style={{ color: st.c, fontSize: 10, fontWeight: 700 }}>{st.l}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI extraction summary */}
      {ext && Object.keys(ext).length > 0 && (
        <div style={card}>
          <div style={cardHdr}><span>🤖 AI Extraction</span></div>
          <div style={cardBody}>
            {[
              ["Width", ext.crossover_dimensions?.width_at_boundary_m ? ext.crossover_dimensions.width_at_boundary_m + "m" : null],
              ["Material", ext.construction?.material],
              ["Splays", ext.crossover_dimensions?.splay_left_m != null ? `${ext.crossover_dimensions.splay_left_m}m / ${ext.crossover_dimensions.splay_right_m}m` : null],
              ["Verge", ext.crossover_dimensions?.verge_depth_m ? ext.crossover_dimensions.verge_depth_m + "m" : null],
              ["Corner", ext.crossover_dimensions?.distance_to_nearest_lot_corner_m ? ext.crossover_dimensions.distance_to_nearest_lot_corner_m + "m" : null],
              ["Trees", ext.vegetation?.trees_nearby != null ? (ext.vegetation.trees_nearby ? "Yes" : "No") : null],
            ].filter(([, v]) => v != null).map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: "#7a8a94" }}>{k}</span><span style={{ fontWeight: 600, color: "#1a3a4a" }}>{v}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment */}
      <div style={card}>
        <div style={cardHdr}><span>👤 Assignment</span></div>
        <div style={cardBody}>
          {canAssign ? (
            <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}>
              <option value="">— Unassigned —</option>
              {(users || []).filter(u => u.active && (u.role === "engineer" || u.role === "manager")).map(u => {
                const rc = ROLE_CONFIG[u.role];
                return <option key={u.id} value={u.name}>{rc?.icon} {u.name}</option>;
              })}
            </select>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 6 }}>{assignee || "Unassigned"}</div>
          )}
          {canDecide && (
            <>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <button onClick={saveChanges} style={{ width: "100%", padding: "6px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#2980b9,#3498db)", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      <div style={card}>
        <div style={cardHdr}><span>💬 Notes ({app.assessment?.notes?.length || 0})</span></div>
        <div style={{ maxHeight: 120, overflowY: "auto", padding: "6px 12px" }}>
          {(app.assessment?.notes || []).length === 0 && <div style={{ fontSize: 11, color: "#95a5a6" }}>No notes</div>}
          {(app.assessment?.notes || []).map((n, i) => (
            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #f5f7f8", fontSize: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: "#2980b9" }}>{n.author}</span>
                <span style={{ color: "#95a5a6", fontSize: 9 }}>{n.date}</span>
              </div>
              <div style={{ color: "#3a4a5a", lineHeight: 1.3 }}>{n.text}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 10px", borderTop: "1px solid #f0f3f5", display: "flex", gap: 4 }}>
          <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} placeholder="Add note..." style={{ flex: 1, padding: "5px 8px", borderRadius: 5, border: "1.5px solid #d5dde2", fontSize: 10, fontFamily: "inherit", outline: "none" }} />
          <button onClick={addNote} style={{ padding: "5px 10px", borderRadius: 5, border: "none", background: "#1a3a4a", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>+</button>
        </div>
      </div>

      {/* Quick Decision */}
      {canDecide && (
        <div style={card}>
          <div style={cardHdr}><span>⚡ Quick Decision</span></div>
          <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { s: "approved", l: "✅ Approve", bg: "#27ae60" },
              { s: "inspection_required", l: "🔍 Inspect", bg: "#16a085" },
              { s: "referral_pending", l: "↗️ Refer", bg: "#8e44ad" },
              { s: "on_hold", l: "⏸ Hold", bg: "#7f8c8d" },
              { s: "rejected", l: "❌ Reject", bg: "#c0392b" },
            ].map(b => (
              <button key={b.s} onClick={async () => {
                try {
                  await api.updateApp(app._dbId, { status: b.s });
                  onReload();
                } catch (e) { console.error(e); }
              }}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "none", background: b.bg, color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                {b.l}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Step Content Renderers ─────────────────────────────

function StepUpload({ app, currentUser, onDocUpdated, onMeasureCorrection }) {
  return (
    <div>
      {/* Info Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={card}>
          <div style={cardHdr}>Owner & Property</div>
          <div style={cardBody}>
            {[["Owner", app.owner?.name], ["Phone", app.owner?.phone], ["Email", app.owner?.email], ["Property", app.property?.address], ["Lot", `${app.property?.lot} (${app.property?.plan})`], ["Frontage", `${app.property?.frontage}m`], ["Road", `${app.property?.roadName} (${app.property?.roadType})`]].map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: "#7a8a94" }}>{k}</span><span style={{ fontWeight: 600, color: "#1a3a4a", textAlign: "right", maxWidth: "55%" }}>{v}</span></div>
            ))}
          </div>
        </div>
        <div style={card}>
          <div style={cardHdr}>Crossover & Vegetation</div>
          <div style={cardBody}>
            {[["Width", `${app.crossover?.width}m`], ["Count", app.crossover?.count], ["Surface", app.crossover?.surface], ["Offset", `${app.crossover?.offsetFromLeft}m`], ["Trees", app.vegetation?.treesNearby ? "Yes" : "No"], ["Clearing", app.vegetation?.clearing ? "⚠️ Yes" : "No"], ["Drainage", app.vegetation?.drainage]].map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: "#7a8a94" }}>{k}</span><span style={{ fontWeight: 600, color: "#1a3a4a" }}>{v}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Documents */}
      <DocumentList documents={app.documents} appDbId={app._dbId} app={app} currentUser={currentUser}
        onDocUpdated={onDocUpdated} onMeasureCorrection={onMeasureCorrection} />
    </div>
  );
}

function StepExtract({ app, currentUser, onReload, measureCorrections, onMeasureCorrectionsApplied }) {
  return (
    <AIExtractionReview app={app} currentUser={currentUser}
      onReload={onReload} measureCorrections={measureCorrections}
      onMeasureCorrectionsApplied={onMeasureCorrectionsApplied} />
  );
}

function StepAssess({ app, apps, onSelectApp, globalSpeedRoads, globalLotsData, globalRoadNetwork, globalContoursData, globalUrbanForestData, globalDrainagePipesData, globalDrainagePitsData, globalWaterPipesData, categories, currentUser }) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <MapWithOverlay app={app} apps={apps} onSelectApp={onSelectApp}
          speedRoadsData={globalSpeedRoads} lotsData={globalLotsData} roadNetworkData={globalRoadNetwork}
          contoursData={globalContoursData} urbanForestData={globalUrbanForestData}
          drainagePipesData={globalDrainagePipesData} drainagePitsData={globalDrainagePitsData}
          waterPipesData={globalWaterPipesData} />
      </div>
      <ApprovalChecklist app={app} categories={categories} currentUser={currentUser} />
    </div>
  );
}

function StepReview({ app, categories, currentUser }) {
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!app?._dbId) return;
    api.listAssessments(app._dbId).then(d => { setAssessments(d || []); setLoading(false); }).catch(() => setLoading(false));
  }, [app?._dbId]);

  const stats = { total: 0, pass: 0, fail: 0, review: 0, oApproved: 0, oRejected: 0, oReferred: 0, oInvestigation: 0, oPending: 0 };
  const flagged = [];
  categories.forEach(cat => (cat.items || []).forEach(item => {
    const a = assessments.find(x => x.item_code === item.code) || {};
    stats.total++;
    if (a.ai_result === "pass") stats.pass++; else if (a.ai_result === "fail") stats.fail++; else stats.review++;
    if (a.officer_result === "approved") stats.oApproved++;
    else if (a.officer_result === "rejected") { stats.oRejected++; flagged.push({ item, a, type: "rejected" }); }
    else if (a.officer_result === "referred") { stats.oReferred++; flagged.push({ item, a, type: "referred" }); }
    else if (a.officer_result === "investigation") { stats.oInvestigation++; flagged.push({ item, a, type: "investigation" }); }
    else stats.oPending++;
  }));

  const docs = app.documents || [];
  const verified = docs.filter(d => d.status === "verified").length;
  const rejected = docs.filter(d => d.status === "rejected").length;
  const pending = docs.length - verified - rejected;
  const borderColors = { rejected: "#e74c3c", referred: "#8e44ad", investigation: "#2980b9" };

  if (loading) return <div style={{ padding: 20, color: "#7a8a94", fontSize: 12 }}>Loading assessment data...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {/* Summary metrics */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", marginBottom: 8 }}>Assessment summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {[
              { n: stats.oApproved, l: "Approved", c: "#27ae60" },
              { n: stats.oRejected, l: "Rejected", c: "#c0392b" },
              { n: stats.oReferred, l: "Referred", c: "#8e44ad" },
              { n: stats.oInvestigation, l: "Investigating", c: "#2980b9" },
            ].map(m => (
              <div key={m.l} style={{ background: "#f8fafb", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: m.c }}>{m.n}</div>
                <div style={{ fontSize: 10, color: m.c }}>{m.l}</div>
              </div>
            ))}
          </div>
          {stats.oPending > 0 && (
            <div style={{ padding: "8px 12px", background: "#fef5e7", borderRadius: 8, fontSize: 11, color: "#854F0B", fontWeight: 600 }}>
              ⏳ {stats.oPending} items still awaiting officer review
            </div>
          )}
        </div>

        {/* Flagged items + doc status */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", marginBottom: 8 }}>Flagged items</div>
          <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 12 }}>
            {flagged.length === 0 && <div style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>No flagged items</div>}
            {flagged.map((f, i) => (
              <div key={i} style={{ padding: "6px 10px", marginBottom: 4, borderLeft: `3px solid ${borderColors[f.type] || "#7f8c8d"}`, background: "#f8fafb", borderRadius: "0 6px 6px 0" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a" }}>{f.item.label}</div>
                <div style={{ fontSize: 10, color: "#7a8a94" }}>{f.a.ai_reason || f.item.reference}</div>
                {f.a.note && <div style={{ fontSize: 10, color: "#854F0B", marginTop: 2 }}>💬 {f.a.note}</div>}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", marginBottom: 6 }}>Document status</div>
          <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
            <span style={{ color: "#27ae60", fontWeight: 700 }}>✅ {verified}</span>
            <span style={{ color: "#e74c3c", fontWeight: 700 }}>❌ {rejected}</span>
            <span style={{ color: "#3498db", fontWeight: 700 }}>📥 {pending}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDecision({ app, currentUser, categories, reloadApp, setLocalApp }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", marginBottom: 8 }}>Decision</div>
          {[
            { s: "approved", l: "Approve", desc: "All requirements met", c: "#27ae60" },
            { s: "on_hold", l: "Approve with conditions", desc: "Approved subject to conditions", c: "#2980b9" },
            { s: "rejected", l: "Reject", desc: "Does not meet requirements", c: "#c0392b" },
          ].map(opt => (
            <label key={opt.s} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: app.status === opt.s ? `2px solid ${opt.c}` : "1px solid #e4e9ec", borderRadius: 8, marginBottom: 6, cursor: "pointer", background: app.status === opt.s ? `${opt.c}08` : "#fff" }}
              onClick={async () => {
                try {
                  await api.updateApp(app._dbId, { status: opt.s });
                  const fresh = await reloadApp(app._dbId);
                  if (fresh) setLocalApp(fresh);
                } catch (e) { console.error(e); }
              }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${app.status === opt.s ? opt.c : "#d5dde2"}`, marginTop: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {app.status === opt.s && <div style={{ width: 6, height: 6, borderRadius: "50%", background: opt.c }} />}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: opt.c }}>{opt.l}</div>
                <div style={{ fontSize: 10, color: "#7a8a94" }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div>
          <ReportGenerator app={app} currentUser={currentUser} categories={categories} />
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
//  Main WorkflowView Component
// ═══════════════════════════════════════════════════════════

export default function WorkflowView({
  app, apps, onSelectApp, currentUser, reloadApp, users,
  globalSpeedRoads, globalLotsData, globalRoadNetwork, globalContoursData,
  globalUrbanForestData, globalDrainagePipesData, globalDrainagePitsData, globalWaterPipesData,
  // Shared state from parent
  localApp, setLocalApp, newNote, setNewNote, addNote,
  assignee, setAssignee, newStatus, setNewStatus, saveChanges,
  measureCorrections, setMeasureCorrections, categories,
  canAssign, canDecide,
}) {
  const autoStep = statusToStep(localApp.status);
  const [currentStep, setCurrentStep] = useState(autoStep);

  // Update step when status changes
  useEffect(() => { setCurrentStep(statusToStep(localApp.status)); }, [localApp.status]);

  // Compute how far the workflow has progressed
  const completedUpTo = Math.max(autoStep, currentStep);

  const stepDef = STEPS.find(s => s.id === currentStep) || STEPS[0];

  const onDocUpdated = async () => {
    const fresh = await reloadApp(localApp._dbId);
    if (fresh) setLocalApp(fresh);
  };

  const onMeasureCorrection = (fieldKey, value, unit) => {
    setMeasureCorrections(prev => [...prev.filter(c => c.field_path !== fieldKey), {
      field_path: fieldKey,
      ai_value: (() => { const spd = localApp?.cor_site_plan_data || localApp?.site_plan_data; const ext = spd?.extraction || spd || {}; const parts = fieldKey.split('.'); let v = ext; for (const p of parts) v = v?.[p]; return String(v ?? '—'); })(),
      correct_value: String(value),
      type: "measure_override",
      unit: unit || "m",
    }]);
  };

  return (
    <div>
      {/* Stepper */}
      <Stepper currentStep={currentStep} completedUpTo={completedUpTo} onStepClick={setCurrentStep} />

      {/* Step header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "6px 12px", background: stepDef.bg, borderRadius: 8, border: `1px solid ${stepDef.color}20` }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", background: stepDef.color, color: stepDef.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{stepDef.id}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: stepDef.color }}>{stepDef.label}</div>
          <div style={{ fontSize: 10, color: stepDef.color, opacity: 0.7 }}>{stepDef.desc}</div>
        </div>
      </div>

      {/* Main grid: step content + sidebar */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 12 }}>
        {/* Step content */}
        <div>
          {currentStep === 1 && (
            <StepUpload app={localApp} currentUser={currentUser}
              onDocUpdated={onDocUpdated} onMeasureCorrection={onMeasureCorrection} />
          )}
          {currentStep === 2 && (
            <StepExtract app={localApp} currentUser={currentUser}
              onReload={onDocUpdated} measureCorrections={measureCorrections}
              onMeasureCorrectionsApplied={() => setMeasureCorrections([])} />
          )}
          {currentStep === 3 && (
            <StepAssess app={localApp} apps={apps} onSelectApp={onSelectApp}
              globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
              globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
              globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
              globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
              categories={categories}
              currentUser={currentUser} />
          )}
          {currentStep === 4 && (
            <StepReview app={localApp} categories={categories} currentUser={currentUser} />
          )}
          {currentStep === 5 && (
            <StepDecision app={localApp} currentUser={currentUser} categories={categories}
              reloadApp={reloadApp} setLocalApp={setLocalApp} />
          )}
        </div>

        {/* Persistent sidebar */}
        <WorkflowSidebar
          app={localApp} currentUser={currentUser} users={users} categories={categories}
          onReload={onDocUpdated} newNote={newNote} setNewNote={setNewNote} addNote={addNote}
          assignee={assignee} setAssignee={setAssignee} newStatus={newStatus} setNewStatus={setNewStatus}
          saveChanges={saveChanges} canAssign={canAssign} canDecide={canDecide}
        />
      </div>
    </div>
  );
}
