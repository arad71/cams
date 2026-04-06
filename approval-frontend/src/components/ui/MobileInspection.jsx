import { useState, useEffect, useRef, useCallback } from "react";
import api from "../../services/api";

// Field checklist items — subset of 206 rules that need site verification
const FIELD_ITEMS = [
  { cat: "Crossover", items: [
    { code: "xo_width", label: "Crossover width matches plan" },
    { code: "xo_alignment", label: "Crossover perpendicular to road" },
    { code: "xo_surface", label: "Surface material as specified" },
    { code: "xo_level", label: "Crossover level flush with footpath" },
    { code: "xo_kerb", label: "Kerb modification correct" },
  ]},
  { cat: "Sight Distance", items: [
    { code: "sight_left", label: "Clear sight line — LEFT" },
    { code: "sight_right", label: "Clear sight line — RIGHT" },
    { code: "fence_truncated", label: "Fence truncated in sight triangle" },
    { code: "vegetation_clear", label: "No vegetation blocking sight" },
  ]},
  { cat: "Road & Verge", items: [
    { code: "road_damage", label: "No road surface damage" },
    { code: "footpath_ok", label: "Footpath reinstated correctly" },
    { code: "verge_ok", label: "Verge condition acceptable" },
    { code: "drainage_ok", label: "Stormwater drainage clear" },
  ]},
  { cat: "Services", items: [
    { code: "pole_clearance", label: "Power pole/light clearance OK" },
    { code: "hydrant_clear", label: "Fire hydrant access maintained" },
    { code: "services_safe", label: "No service conflicts visible" },
  ]},
];

export default function MobileInspection({ app, inspection, onClose, onUpdate }) {
  const [checklist, setChecklist] = useState(inspection?.field_checklist || {});
  const [notes, setNotes] = useState(inspection?.notes || "");
  const [gps, setGps] = useState({ lat: inspection?.gps_lat, lng: inspection?.gps_lng, acc: inspection?.gps_accuracy_m });
  const [gpsStatus, setGpsStatus] = useState(null);
  const [photos, setPhotos] = useState(inspection?.photos || []);
  const [saving, setSaving] = useState(false);
  const [activePhoto, setActivePhoto] = useState(null); // checklist item code waiting for photo
  const fileRef = useRef(null);
  const autoSaveTimer = useRef(null);

  // GPS capture
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus("not supported"); return; }
    setGpsStatus("acquiring");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
        setGpsStatus("locked");
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Auto-save every 10s when changes made
  const save = useCallback(async () => {
    if (!app?._dbId || !inspection?.id) return;
    setSaving(true);
    try {
      await api.updateInspection(app._dbId, inspection.id, {
        field_checklist: checklist,
        notes,
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        gps_accuracy_m: gps.acc,
        status: "in_progress",
      });
    } catch (e) { console.error("Save failed:", e); }
    setSaving(false);
  }, [app, inspection, checklist, notes, gps]);

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(save, 10000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [checklist, notes, save]);

  const setResult = (code, result) => {
    setChecklist(prev => ({ ...prev, [code]: { ...(prev[code] || {}), result } }));
  };

  const setItemNote = (code, note) => {
    setChecklist(prev => ({ ...prev, [code]: { ...(prev[code] || {}), note } }));
  };

  const takePhoto = (code) => {
    setActivePhoto(code);
    if (fileRef.current) fileRef.current.click();
  };

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !app?._dbId || !inspection?.id) return;
    try {
      const result = await api.uploadInspectionPhoto(app._dbId, inspection.id, file, "", activePhoto || "");
      setPhotos(prev => [...prev, { ...result, checklist_item: activePhoto, timestamp: new Date().toISOString() }]);
      // Link photo to checklist item
      if (activePhoto) {
        setChecklist(prev => ({
          ...prev,
          [activePhoto]: {
            ...(prev[activePhoto] || {}),
            photo_ids: [...((prev[activePhoto] || {}).photo_ids || []), result.id],
          },
        }));
      }
    } catch (err) { console.error("Photo upload failed:", err); }
    setActivePhoto(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const completeInspection = async (result) => {
    setSaving(true);
    try {
      await api.updateInspection(app._dbId, inspection.id, {
        field_checklist: checklist,
        notes,
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        gps_accuracy_m: gps.acc,
        status: result,
        completed_date: new Date().toISOString(),
      });
      if (onUpdate) onUpdate();
      if (onClose) onClose();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  // Count results
  const allItems = FIELD_ITEMS.flatMap(c => c.items);
  const completed = allItems.filter(it => checklist[it.code]?.result).length;
  const failed = allItems.filter(it => checklist[it.code]?.result === "fail").length;
  const passed = allItems.filter(it => checklist[it.code]?.result === "pass").length;

  const ext = app?.cor_site_plan_data?.extraction || app?.site_plan_data?.extraction || {};
  const crossoverRoad = ext?.siteplan_measurements?.crossover_on_road || ext?.siteplan_measurements?.road_name || app?.road_name || "";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#f5f8fa", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Hidden file input for camera */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} style={{ display: "none" }} />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a3a4a, #2c5364)", padding: "12px 16px", color: "#fff", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Field Inspection</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{app?.ref_number || ""} — {app?.property_address || ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Close</button>
        </div>
        {/* Quick info bar */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 10, opacity: 0.8 }}>
          {crossoverRoad && <span>Road: {crossoverRoad}</span>}
          <span>{inspection?.inspection_type || "Inspection"}</span>
          <span style={{ marginLeft: "auto", color: gpsStatus === "locked" ? "#1abc9c" : "#f39c12" }}>
            {gpsStatus === "locked" ? `GPS: ${gps.acc?.toFixed(0)}m` : gpsStatus === "acquiring" ? "GPS..." : "No GPS"}
          </span>
          {saving && <span style={{ color: "#1abc9c" }}>Saving...</span>}
        </div>
        {/* Progress bar */}
        <div style={{ marginTop: 8, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(completed / allItems.length * 100)}%`, background: failed > 0 ? "#e74c3c" : "#1abc9c", transition: "width 0.3s" }} />
        </div>
        <div style={{ fontSize: 10, marginTop: 3, opacity: 0.7 }}>
          {completed}/{allItems.length} checked — {passed} pass, {failed} fail, {photos.length} photos
        </div>
      </div>

      {/* Checklist */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {FIELD_ITEMS.map(cat => (
          <div key={cat.cat} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8a94", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid #e4e9ec", marginBottom: 6 }}>{cat.cat}</div>
            {cat.items.map(item => {
              const result = checklist[item.code]?.result;
              const note = checklist[item.code]?.note || "";
              const hasPhoto = (checklist[item.code]?.photo_ids || []).length > 0;
              return (
                <div key={item.code} style={{ background: "#fff", borderRadius: 8, border: `1px solid ${result === "fail" ? "#f5c6cb" : result === "pass" ? "#d4efdf" : "#e4e9ec"}`, padding: "10px 12px", marginBottom: 6 }}>
                  {/* Item label + result buttons */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1a3a4a" }}>{item.label}</div>
                    {/* Pass / Fail / N/A buttons */}
                    {["pass", "fail", "na"].map(r => (
                      <button key={r} onClick={() => setResult(item.code, result === r ? null : r)}
                        style={{
                          width: 44, height: 36, borderRadius: 6, border: "none", fontWeight: 800, fontSize: 11, cursor: "pointer",
                          background: result === r ? (r === "pass" ? "#27ae60" : r === "fail" ? "#e74c3c" : "#95a5a6") : "#f0f2f5",
                          color: result === r ? "#fff" : "#7a8a94",
                        }}>
                        {r === "pass" ? "✓" : r === "fail" ? "✕" : "N/A"}
                      </button>
                    ))}
                  </div>
                  {/* Photo + note row */}
                  <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                    <button onClick={() => takePhoto(item.code)}
                      style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #3498db", background: hasPhoto ? "#ebf5fb" : "#fff", color: "#3498db", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      📷 {hasPhoto ? "Add Photo" : "Photo"}
                    </button>
                    <input value={note} onChange={e => setItemNote(item.code, e.target.value)}
                      placeholder="Note..."
                      style={{ flex: 1, padding: "4px 8px", borderRadius: 5, border: "1px solid #e4e9ec", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* General notes */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8a94", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid #e4e9ec", marginBottom: 6 }}>General Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Overall inspection notes..."
            style={{ width: "100%", minHeight: 80, padding: "10px 12px", borderRadius: 8, border: "1px solid #e4e9ec", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Photo gallery */}
        {photos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8a94", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid #e4e9ec", marginBottom: 6 }}>Photos ({photos.length})</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {photos.map((p, i) => (
                <div key={i} style={{ width: 72, height: 72, borderRadius: 6, background: "#e4e9ec", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#7a8a94", overflow: "hidden", border: "1px solid #d5dde2" }}>
                  <div style={{ textAlign: "center", padding: 4 }}>
                    <div style={{ fontSize: 18 }}>📷</div>
                    <div>{p.checklist_item || "general"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div style={{ flexShrink: 0, padding: "10px 12px", background: "#fff", borderTop: "2px solid #e4e9ec", display: "flex", gap: 8 }}>
        <button onClick={save}
          style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "1px solid #3498db", background: "#fff", color: "#3498db", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Save Progress
        </button>
        <button onClick={() => completeInspection("passed")} disabled={saving}
          style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: "#27ae60", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Pass ✓
        </button>
        <button onClick={() => completeInspection("failed")} disabled={saving}
          style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: "none", background: "#e74c3c", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Fail ✕
        </button>
      </div>
    </div>
  );
}
