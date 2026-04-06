import { useState, useEffect, useRef } from "react";
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
    key: "property", label: "Property & Road", icon: "🏠",
    fields: [
      { path: "lot_number", label: "Lot" },
      { path: "street_address", label: "Address" },
      { path: "is_corner_lot", label: "Corner Lot", type: "bool" },
      { path: "corner_roads", label: "Corner Roads" },
      { path: "is_battleaxe", label: "Battleaxe", type: "bool" },
      { path: "da_linked", label: "DA-Linked", type: "bool" },
    ],
  },
  {
    key: "crossover_dimensions", label: "Crossover", icon: "📐",
    fields: [
      { path: "width_at_boundary_m", label: "Width at Boundary", unit: "m" },
      { path: "total_width_at_road_m", label: "Total Width (incl splays)", unit: "m" },
      { path: "verge_depth_m", label: "Verge Depth", unit: "m" },
      { path: "crossover_length_m", label: "Length", unit: "m" },
      { path: "distance_to_left_boundary_m", label: "→ Left Boundary", unit: "m" },
      { path: "left_boundary_feature", label: "  Left Feature" },
      { path: "distance_to_right_boundary_m", label: "→ Right Boundary", unit: "m" },
      { path: "right_boundary_feature", label: "  Right Feature" },
      { path: "constrained_side", label: "Constrained Side" },
      { path: "distance_to_nearest_lot_corner_m", label: "→ Lot Corner", unit: "m" },
      { path: "distance_to_intersection_tangent_m", label: "→ Intersection", unit: "m" },
    ],
  },
  {
    key: "siteplan_measurements", label: "Site & Road", icon: "📏",
    fields: [
      { path: "crossover_on_road", label: "Crossover Road" },
      { path: "road_name", label: "Primary Road" },
      { path: "secondary_road_name", label: "Secondary Road" },
      { path: "road_speed_zone_kmh", label: "Speed", unit: "km/h" },
      { path: "road_classification", label: "Road Class" },
      { path: "lot_frontage_m", label: "Lot Frontage", unit: "m" },
      { path: "lot_depth_m", label: "Lot Depth", unit: "m" },
      { path: "building_setback_front_m", label: "Front Setback", unit: "m" },
      { path: "building_setback_left_m", label: "Left Setback", unit: "m" },
      { path: "building_setback_right_m", label: "Right Setback", unit: "m" },
      { path: "building_setback_rear_m", label: "Rear Setback", unit: "m" },
      { path: "garage_setback_to_crossover_road_m", label: "Garage to Crossover Road", unit: "m" },
      { path: "garage_to_kerb_m", label: "Garage to Kerb", unit: "m" },
      { path: "garage_nearest_boundary_m", label: "Garage to Nearest Boundary", unit: "m" },
      { path: "garage_nearest_boundary_side", label: "Nearest Boundary Side" },
    ],
  },
  {
    key: "construction", label: "Construction", icon: "🔨",
    fields: [
      { path: "material", label: "Material" },
      { path: "kerb_type", label: "Kerb Type" },
      { path: "footpath_exists", label: "Footpath", type: "bool" },
      { path: "construction_standard", label: "Standard" },
    ],
  },
  {
    key: "utilities", label: "Utilities", icon: "⚡",
    fields: [
      { path: "power_conflict", label: "Power Conflict", type: "bool" },
      { path: "water_conflict", label: "Water Conflict", type: "bool" },
      { path: "sewer_conflict", label: "Sewer Conflict", type: "bool" },
      { path: "stormwater_conflict", label: "Stormwater Conflict", type: "bool" },
      { path: "utility_summary", label: "Summary" },
    ],
  },
  {
    key: "additional_findings", label: "Sight & Obstructions", icon: "👁",
    fields: [
      { path: "fence_left_of_crossover", label: "Fence Left" },
      { path: "fence_right_of_crossover", label: "Fence Right" },
      { path: "retaining_wall_near_crossover", label: "Retaining Wall" },
      { path: "sight_obstruction_notes", label: "Obstruction Notes" },
      { path: "vegetation_on_verge", label: "Vegetation on Verge", type: "bool" },
      { path: "trees_on_verge", label: "Trees on Verge", type: "bool" },
      { path: "street_light_near_crossover", label: "Street Light", type: "bool" },
      { path: "notes", label: "Notes" },
    ],
  },
];

function formatValue(val, type) {
  if (val === null || val === undefined) return "—";
  if (type === "bool") return val ? "Yes ✅" : "No ❌";
  if (Array.isArray(val)) return val.join(", ") || "—";
  if (typeof val === "object") {
    // For fence/wall objects, format nicely
    if (val.exists === false) return "None";
    const parts = [];
    if (val.type) parts.push(val.type);
    if (val.height_m) parts.push(`${val.height_m}m`);
    if (val.distance_from_crossover_m) parts.push(`${val.distance_from_crossover_m}m away`);
    if (val.side) parts.push(val.side);
    if (val.truncated) parts.push("truncated ✓");
    if (val.exists && parts.length === 0) return "Yes";
    return parts.join(", ") || JSON.stringify(val);
  }
  return String(val);
}

const EMPTY_CORRECTIONS = [];

export default function AIExtractionReview({ app, currentUser, onReload, measureCorrections, onMeasureCorrectionsApplied }) {
  const hasCorrected = !!app?.cor_site_plan_data;
  const spd = app?.cor_site_plan_data || app?.site_plan_data;
  const orgSpd = app?.org_site_plan_data || app?.site_plan_data;
  const extraction = spd?.extraction || {};
  const compliance = spd?.compliance || {};
  const [collapsed, setCollapsed] = useState(true);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [corrections, setCorrections] = useState([]);

  // Lock state — prevents re-running analysis
  const [locked, setLocked] = useState(() => app?.extraction_locked || false);
  const [rerunning, setRerunning] = useState(false);

  const toggleLock = async () => {
    const newLocked = !locked;
    setLocked(newLocked);
    try {
      await api.updateApp(app._dbId, { extraction_locked: newLocked });
    } catch (e) { console.warn("Lock save failed:", e); }
  };

  const rerunAnalysis = async () => {
    if (locked || rerunning) return;
    const sitePlanDoc = app?.documents?.find(d =>
      d.category?.toLowerCase().includes("site") || d.doc_type?.toLowerCase().includes("site")
    );
    if (!sitePlanDoc) { alert("No site plan document found. Upload a site plan first."); return; }
    setRerunning(true);
    try {
      await api.analyseDocument(app._dbId, sitePlanDoc.id);
      if (onReload) await onReload();
    } catch (e) { console.error("Re-run failed:", e); alert("Analysis failed: " + e.message); }
    setRerunning(false);
  };

  // Merge incoming measure corrections into pending corrections
  const prevMeasureLen = useRef(0);
  useEffect(() => {
    const mc = measureCorrections || EMPTY_CORRECTIONS;
    if (mc.length > 0 && mc.length !== prevMeasureLen.current) {
      prevMeasureLen.current = mc.length;
      setCorrections(prev => {
        let merged = [...prev];
        for (const c of mc) {
          merged = merged.filter(x => x.field_path !== c.field_path);
          merged.push(c);
        }
        return merged;
      });
      setCollapsed(false);
    }
  }, [measureCorrections]);
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
      if (onMeasureCorrectionsApplied) onMeasureCorrectionsApplied();
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
          <span style={{ fontSize: 12, color: "#95a5a6", transition: "transform 0.2s", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}>▶</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a4a" }}>🤖 AI Site Plan Analysis</div>
            <div style={{ fontSize: 12, color: "#7a8a94", marginTop: 2 }}>
              {spd.ai_model || "Claude"} · {spd.source_pages || 1} page(s) · {spd.analysed_at ? spd.analysed_at.split("T")[0] : ""}
              {hasCorrected && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 3, background: "#fef5e7", color: "#e67e22", fontWeight: 700, fontSize: 9 }}>✎ Officer Corrected</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={e => e.stopPropagation()}>
          {/* Re-run analysis button */}
          {!locked && (
            <button onClick={rerunAnalysis} disabled={rerunning}
              title="Re-run AI site plan analysis"
              style={{ padding: "4px 8px", borderRadius: 5, border: "none", background: rerunning ? "#E8EAF6" : "linear-gradient(135deg,#8e44ad,#6c3483)", color: rerunning ? "#5C6BC0" : "#fff", fontWeight: 700, fontSize: 9, cursor: rerunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {rerunning ? "⟳ Running..." : "🔄 Re-run"}
            </button>
          )}
          {/* Lock/unlock button */}
          <button onClick={toggleLock}
            title={locked ? "Unlock — allow re-running analysis" : "Lock — prevent re-running analysis"}
            style={{ padding: "4px 8px", borderRadius: 5, border: locked ? "1.5px solid #e74c3c" : "1px solid #dce1e6", background: locked ? "#fdedec" : "#fff", color: locked ? "#e74c3c" : "#95a5a6", fontWeight: 700, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
            {locked ? "🔒 Locked" : "🔓 Lock"}
          </button>
          <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 800,
            background: `${recColors[recommendation] || "#7f8c8d"}15`,
            color: recColors[recommendation] || "#7f8c8d" }}>
            {recommendation.replace(/_/g, " ")}
          </span>
          <span style={{ fontSize: 12, color: "#95a5a6" }}>
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
            <div style={{ padding: "8px 16px", background: "#fafcfd", fontSize: 12, fontWeight: 800, color: "#5a6a74", textTransform: "uppercase", letterSpacing: "0.04em" }}>
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
                      <button onClick={() => saveEdit(group.key, field.path, val)} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#27ae60", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓</button>
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
        <div style={{ fontSize: 12, color: "#7a8a94" }}>
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
