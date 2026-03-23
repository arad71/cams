import { useState } from "react";
import api from '../../services/api';

/**
 * AI Extraction Review Panel
 * 
 * Shows the structured data Claude extracted from the site plan.
 * Officers can:
 *   ✓ Verify — confirm AI was correct (green tick)
 *   ✎ Correct — edit any value inline (saves as ground truth for model training)
 *   🤖 Re-analyse — trigger AI analysis on an uploaded document
 * 
 * Every verification/correction is saved to ai_training_samples/corrections
 * tables for future model training.
 */

const FIELD_GROUPS = [
  {
    key: "crossover_dimensions", label: "Crossover Dimensions", icon: "📐",
    fields: [
      { path: "width_at_boundary_m", label: "Width at Boundary", unit: "m" },
      { path: "splay_left_m", label: "Splay Left", unit: "m" },
      { path: "splay_right_m", label: "Splay Right", unit: "m" },
      { path: "total_width_at_road_m", label: "Total Width at Road", unit: "m" },
      { path: "verge_depth_m", label: "Verge Depth", unit: "m" },
      { path: "crossover_length_m", label: "Crossover Length", unit: "m" },
    ],
  },
  {
    key: "construction", label: "Construction", icon: "🔨",
    fields: [
      { path: "material", label: "Material" },
      { path: "thickness_mm", label: "Thickness", unit: "mm" },
      { path: "expansion_joints", label: "Expansion Joints", type: "bool" },
      { path: "base_course_specified", label: "Base Course", type: "bool" },
      { path: "kerb_type", label: "Kerb Type" },
      { path: "footpath_exists", label: "Footpath Exists", type: "bool" },
    ],
  },
  {
    key: "drainage", label: "Drainage", icon: "💧",
    fields: [
      { path: "drainage_plan_included", label: "Drainage Plan", type: "bool" },
      { path: "soakwells_proposed", label: "Soakwells", type: "bool" },
      { path: "storage_tanks_proposed", label: "Storage Tanks", type: "bool" },
      { path: "pipe_diameter_mm", label: "Pipe Diameter", unit: "mm" },
      { path: "stormwater_notes", label: "Stormwater Notes" },
    ],
  },
  {
    key: "siteplan_measurements", label: "Site Measurements", icon: "📏",
    fields: [
      { path: "lot_frontage_m", label: "Lot Frontage", unit: "m" },
      { path: "existing_driveway_width_m", label: "Existing Driveway", unit: "m" },
      { path: "road_name", label: "Road Name" },
    ],
  },
  {
    key: "additional_findings", label: "Additional", icon: "📋",
    fields: [
      { path: "vegetation_on_verge", label: "Vegetation on Verge", type: "bool" },
      { path: "is_subdivision", label: "Subdivision", type: "bool" },
      { path: "notes", label: "Notes" },
    ],
  },
];

function formatValue(val, type) {
  if (val === null || val === undefined) return "—";
  if (type === "bool") return val ? "Yes ✅" : "No ❌";
  return String(val);
}

export default function AIExtractionReview({ app, currentUser, onReload }) {
  const hasCorrected = !!app?.cor_site_plan_data;
  const spd = app?.cor_site_plan_data || app?.site_plan_data;
  const orgSpd = app?.org_site_plan_data || app?.site_plan_data;
  const extraction = spd?.extraction || {};
  const compliance = spd?.compliance || {};
  const [collapsed, setCollapsed] = useState(true);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [corrections, setCorrections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  if (!spd) {
    return (
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a4a" }}>🤖 AI Site Plan Analysis</div>
            <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>No AI analysis data available. Upload a site plan document to trigger automatic analysis.</div>
          </div>
          {app?.documents?.some(d => d.category?.toLowerCase().includes("site")) && (
            <button onClick={async () => {
              const sitePlanDoc = app.documents.find(d => d.category?.toLowerCase().includes("site"));
              if (!sitePlanDoc) return;
              setAnalysing(true);
              try {
                await api.analyseDocument(app._dbId, sitePlanDoc.id);
                if (onReload) onReload();
              } catch (e) { console.error("Analysis failed:", e); }
              setAnalysing(false);
            }} disabled={analysing}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#8e44ad,#6c3483)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              {analysing ? "⟳ Analysing..." : "🤖 Run AI Analysis"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const recommendation = compliance?.recommendation || "N/A";
  const summary = compliance?.summary || {};
  const recColors = {
    APPROVED: "#27ae60", CONDITIONAL_APPROVAL: "#e67e22",
    REQUIRES_FURTHER_INFORMATION: "#f39c12", DOES_NOT_COMPLY: "#e74c3c", REFUSED: "#c0392b",
  };

  const startEdit = (groupKey, fieldPath, currentVal) => {
    setEditingField(`${groupKey}.${fieldPath}`);
    setEditValue(currentVal === null || currentVal === undefined ? "" : String(currentVal));
  };

  const saveEdit = (groupKey, fieldPath, aiValue) => {
    const fullPath = `${groupKey}.${fieldPath}`;
    if (editValue !== String(aiValue ?? "")) {
      setCorrections(prev => [...prev.filter(c => c.field_path !== fullPath), {
        field_path: fullPath,
        ai_value: String(aiValue ?? ""),
        correct_value: editValue,
        type: aiValue === null || aiValue === undefined ? "missing" : "value_wrong",
      }]);
    }
    setEditingField(null);
  };

  const cancelEdit = () => { setEditingField(null); setEditValue(""); };

  const submitCorrections = async () => {
    if (corrections.length === 0) return;
    setSaving(true);
    try {
      // 1. Apply corrections to site_plan_data → updates cor_site_plan_data + re-runs assessment
      const correctionMap = {};
      corrections.forEach(c => { correctionMap[c.field_path] = c.correct_value; });
      await api.correctSitePlan(app._dbId, correctionMap);

      // 2. Also save to training data for model improvement
      try {
        const samplesResp = await api.trainingSamples(app._dbId);
        const sample = (samplesResp?.samples || []).find(s => s.application_id === app._dbId);
        if (sample) await api.trainingCorrect(sample.id, corrections);
      } catch (e) { console.warn("Training save skipped:", e); }

      setCorrections([]);
      setSaved(true);
      if (onReload) onReload(); // Reload app to reflect updated site_plan_data + assessment
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { console.error("Save corrections failed:", e); }
    setSaving(false);
  };

  const verifyAll = async () => {
    setSaving(true);
    try {
      const samplesResp = await api.trainingSamples(app._dbId);
      const samples = (samplesResp?.samples || []).filter(s => s.application_id === app._dbId);
      for (const s of samples) {
        await api.trainingVerify(s.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { console.error("Verify failed:", e); }
    setSaving(false);
  };

  const getCorrectedValue = (groupKey, fieldPath) => {
    const c = corrections.find(c => c.field_path === `${groupKey}.${fieldPath}`);
    return c ? c.correct_value : null;
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {/* Header — clickable to expand/collapse */}
      <div onClick={() => setCollapsed(!collapsed)}
        style={{ padding: "12px 16px", borderBottom: collapsed ? "none" : "1px solid #eef2f4", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafb", cursor: "pointer", userSelect: "none" }}
        onMouseEnter={e => e.currentTarget.style.background = "#eef2f4"} onMouseLeave={e => e.currentTarget.style.background = "#f8fafb"}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#95a5a6", transition: "transform 0.2s", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}>▶</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a4a" }}>🤖 AI Site Plan Analysis</div>
            <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 2 }}>
              {spd.ai_model || "Claude"} · {spd.source_pages || 1} page(s) · {spd.analysed_at ? spd.analysed_at.split("T")[0] : ""}
              {hasCorrected && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 3, background: "#fef5e7", color: "#e67e22", fontWeight: 700, fontSize: 9 }}>✎ Officer Corrected</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 800,
            background: `${recColors[recommendation] || "#7f8c8d"}15`,
            color: recColors[recommendation] || "#7f8c8d" }}>
            {recommendation.replace(/_/g, " ")}
          </span>
          <span style={{ fontSize: 10, color: "#95a5a6" }}>
            {summary.passed || 0}✓ {summary.failed || 0}✕ {summary.requires_verification || 0}?
          </span>
        </div>
      </div>

      {!collapsed && (<>
      {/* Field groups */}
      {FIELD_GROUPS.map(group => {
        const groupData = extraction[group.key] || {};
        const hasData = group.fields.some(f => groupData[f.path] !== null && groupData[f.path] !== undefined);
        if (!hasData) return null;

        return (
          <div key={group.key} style={{ borderBottom: "1px solid #f0f3f5" }}>
            <div style={{ padding: "8px 16px", background: "#fafcfd", fontSize: 10, fontWeight: 800, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {group.icon} {group.label}
            </div>
            {group.fields.map(field => {
              const val = groupData[field.path];
              if (val === null && val === undefined) return null;
              const fullKey = `${group.key}.${field.path}`;
              const isEditing = editingField === fullKey;
              const corrected = getCorrectedValue(group.key, field.path);

              return (
                <div key={field.path} style={{ padding: "6px 16px 6px 32px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #f8fafb",
                  background: corrected !== null ? "#fef9e7" : "transparent" }}>
                  <div style={{ flex: 1, fontSize: 11, color: "#5a6a74" }}>{field.label}</div>
                  {isEditing ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input value={editValue} onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(group.key, field.path, val); if (e.key === "Escape") cancelEdit(); }}
                        style={{ padding: "3px 6px", borderRadius: 4, border: "1.5px solid #f39c12", fontSize: 11, width: 100, fontFamily: "inherit", outline: "none" }} autoFocus />
                      <button onClick={() => saveEdit(group.key, field.path, val)} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#27ae60", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>✓</button>
                      <button onClick={cancelEdit} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, cursor: "pointer" }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: corrected !== null ? "#b7950b" : "#1a3a4a" }}>
                        {corrected !== null ? (
                          <><s style={{ color: "#ccc", fontWeight: 400 }}>{formatValue(val, field.type)}</s> → {corrected}</>
                        ) : formatValue(val, field.type)}
                        {field.unit && val !== null && val !== undefined && <span style={{ fontSize: 9, color: "#95a5a6", marginLeft: 2 }}>{field.unit}</span>}
                      </span>
                      <button onClick={() => startEdit(group.key, field.path, val)} title="Correct this value"
                        style={{ padding: "1px 4px", borderRadius: 3, border: "1px solid #e4e9ec", background: "#fff", fontSize: 9, cursor: "pointer", color: "#95a5a6", opacity: 0.6 }}>✎</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Actions bar */}
      <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafb" }}>
        <div style={{ fontSize: 10, color: "#7a8a94" }}>
          {corrections.length > 0 && <span style={{ color: "#e67e22", fontWeight: 700 }}>⚠ {corrections.length} correction{corrections.length > 1 ? "s" : ""} pending</span>}
          {saved && <span style={{ color: "#27ae60", fontWeight: 700, marginLeft: 8 }}>✅ Saved to training data</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {corrections.length > 0 ? (
            <button onClick={submitCorrections} disabled={saving}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#e67e22", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
              {saving ? "⟳ Saving..." : `💾 Save ${corrections.length} Correction${corrections.length > 1 ? "s" : ""}`}
            </button>
          ) : (
            <button onClick={verifyAll} disabled={saving}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#27ae60", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
              {saving ? "⟳ Verifying..." : "✓ Verify AI Correct"}
            </button>
          )}
        </div>
      </div>
      </>)}
    </div>
  );
}
