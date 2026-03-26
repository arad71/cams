import { useState, useRef, useEffect, useCallback } from "react";
import api from '../../services/api';

const STEPS = [
  { key: "site_lot_boundary", label: "Lot Boundary", color: "#00ffff", icon: "🏠", hint: "Click on each corner of the lot boundary. Close by clicking near the first point." },
  { key: "site_building_boundary", label: "Building Boundary", color: "#ff6600", icon: "🏗️", hint: "Click on each corner of the building footprint. Close by clicking near the first point." },
  { key: "site_crossover", label: "Crossover / Driveway", color: "#ffff00", icon: "🛣️", hint: "Click on each corner of the crossover/driveway area. Close by clicking near the first point." },
];

export default function BoundaryDrawer({ appDbId, app, sitePlanDoc, onClose, onSaved }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [step, setStep] = useState(0); // 0=lot, 1=building, 2=crossover
  const [points, setPoints] = useState([[], [], []]); // 3 polygons
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load existing boundaries
  useEffect(() => {
    const existing = [
      app?.site_lot_boundary || [],
      app?.site_building_boundary || [],
      app?.site_crossover || [],
    ];
    if (existing.some(e => e.length > 0)) setPoints(existing);
  }, [app]);

  const imgUrl = sitePlanDoc
    ? (sitePlanDoc.type === "pdf"
      ? api.getDocumentRenderUrl(appDbId, sitePlanDoc.id, 1)
      : api.getDocumentFileUrl(appDbId, sitePlanDoc.id))
    : null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    const ctx = canvas.getContext("2d");

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const scaleX = canvas.width / imgSize.w;
    const scaleY = canvas.height / imgSize.h;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw all polygons
    points.forEach((poly, si) => {
      if (poly.length === 0) return;
      const cfg = STEPS[si];
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = si === step ? 2.5 : 1.5;
      ctx.setLineDash(si === step ? [] : [6, 4]);
      ctx.fillStyle = cfg.color + "22";

      ctx.beginPath();
      poly.forEach((pt, i) => {
        const x = pt[0] * scaleX, y = pt[1] * scaleY;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (poly.length > 2) { ctx.closePath(); ctx.fill(); }
      ctx.stroke();

      // Draw points
      poly.forEach((pt, i) => {
        const x = pt[0] * scaleX, y = pt[1] * scaleY;
        ctx.beginPath();
        ctx.arc(x, y, si === step ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#ff0000" : cfg.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Label
      if (poly.length > 0) {
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length * scaleX;
        const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length * scaleY;
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(cx - 30, cy - 8, 60, 16);
        ctx.fillStyle = cfg.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cfg.label, cx, cy);
      }
    });

    // Current step indicator
    ctx.setLineDash([]);
  }, [points, step, imgLoaded, imgSize]);

  useEffect(() => { draw(); }, [draw]);

  const handleClick = (e) => {
    if (!imgLoaded) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = imgSize.w / canvas.offsetWidth;
    const scaleY = imgSize.h / canvas.offsetHeight;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const poly = points[step];

    // Check if clicking near the first point to close polygon
    if (poly.length >= 3) {
      const dx = poly[0][0] - x, dy = poly[0][1] - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const closeDist = Math.max(imgSize.w, imgSize.h) * 0.02; // 2% of image
      if (dist < closeDist) {
        // Close polygon and move to next step
        if (step < 2) setStep(step + 1);
        return;
      }
    }

    const updated = [...points];
    updated[step] = [...poly, [Math.round(x), Math.round(y)]];
    setPoints(updated);
  };

  const handleUndo = () => {
    const updated = [...points];
    updated[step] = updated[step].slice(0, -1);
    setPoints(updated);
  };

  const handleClear = () => {
    const updated = [...points];
    updated[step] = [];
    setPoints(updated);
  };

  // Close polygon: ensure last point == first point
  const closePoly = (poly) => {
    if (!poly || poly.length < 3) return null; // Return null if not a valid polygon
    const first = poly[0], last = poly[poly.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return poly;
    return [...poly, [first[0], first[1]]];
  };

  // Crop lot boundary area from the site plan image
  const cropLotBoundary = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded || points[0].length < 3) return null;

    const lotPts = points[0];
    // Get bounding box in image coordinates
    const xs = lotPts.map(p => p[0]);
    const ys = lotPts.map(p => p[1]);
    const minX = Math.max(0, Math.min(...xs) - 10);
    const minY = Math.max(0, Math.min(...ys) - 10);
    const maxX = Math.min(imgSize.w, Math.max(...xs) + 10);
    const maxY = Math.min(imgSize.h, Math.max(...ys) + 10);
    const cropW = maxX - minX;
    const cropH = maxY - minY;
    if (cropW < 10 || cropH < 10) return null;

    // Create offscreen canvas and draw cropped area
    const offCanvas = document.createElement("canvas");
    offCanvas.width = cropW;
    offCanvas.height = cropH;
    const ctx = offCanvas.getContext("2d");
    ctx.drawImage(img, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return offCanvas.toDataURL("image/png");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const lotImage = cropLotBoundary();
      await api.saveBoundaries(appDbId, {
        site_lot_boundary: closePoly(points[0]),
        site_building_boundary: closePoly(points[1]),
        site_crossover: closePoly(points[2]),
        site_lot_image: lotImage,
      });
      setSaved(true);
      if (onSaved) onSaved();
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      alert("Save failed: " + (err.message || "Unknown error"));
    }
    setSaving(false);
  };

  const hasData = points.some(p => p.length >= 3);
  const hasAnyPoints = points.some(p => p.length > 0);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 10001, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "10px 20px", background: "#1a2a3a", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>📐 Boundary Analysis — Draw on Site Plan</div>
          <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 2 }}>Click corners to draw polygons. Close each polygon by clicking near the first point (red dot).</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saved && <span style={{ color: "#27ae60", fontWeight: 700, fontSize: 12 }}>✅ Saved</span>}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: saving ? "#555" : "linear-gradient(135deg, #27ae60, #1e8449)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
            {saving ? "⟳ Saving..." : "💾 Save Boundaries"}
          </button>
          <button onClick={onClose}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #555", background: "transparent", color: "#aaa", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      {/* Step tabs */}
      <div style={{ padding: "8px 20px", background: "#0d1b2a", display: "flex", gap: 8, flexShrink: 0 }}>
        {STEPS.map((s, i) => (
          <button key={s.key} onClick={() => setStep(i)}
            style={{ padding: "6px 14px", borderRadius: 6, border: step === i ? `2px solid ${s.color}` : "1px solid #333",
              background: step === i ? s.color + "22" : "#1a2a3a", color: step === i ? s.color : "#777",
              fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
            {s.icon} {s.label}
            {points[i].length > 0 && <span style={{ background: s.color, color: "#000", borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 800 }}>{points[i].length}pts</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: STEPS[step].color, fontWeight: 600 }}>
          {STEPS[step].hint}
        </span>
        <button onClick={handleUndo} disabled={points[step].length === 0}
          style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #444", background: "#1a2a3a", color: points[step].length > 0 ? "#ffaa00" : "#444", fontSize: 10, fontWeight: 700, cursor: points[step].length > 0 ? "pointer" : "default", fontFamily: "inherit" }}>
          ↩ Undo
        </button>
        <button onClick={handleClear} disabled={points[step].length === 0}
          style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #444", background: "#1a2a3a", color: points[step].length > 0 ? "#e74c3c" : "#444", fontSize: 10, fontWeight: 700, cursor: points[step].length > 0 ? "pointer" : "default", fontFamily: "inherit" }}>
          🗑 Clear
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {!imgUrl && <div style={{ padding: 40, textAlign: "center", color: "#777" }}>No site plan document found. Upload a Site Plan first.</div>}
        {imgUrl && (
          <>
            <img
              ref={imgRef}
              src={imgUrl}
              alt="Site Plan"
              onLoad={(e) => { setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setImgLoaded(true); }}
              style={{ display: "none" }}
            />
            <canvas
              ref={canvasRef}
              onClick={handleClick}
              style={{ width: "100%", height: "100%", cursor: "crosshair", display: imgLoaded ? "block" : "none" }}
            />
            {!imgLoaded && <div style={{ padding: 40, textAlign: "center", color: "#777" }}>Loading site plan...</div>}
          </>
        )}
      </div>
    </div>
  );
}
