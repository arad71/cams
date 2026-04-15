import { useState, useRef, useEffect } from "react";
import api from '../../services/api';
import SitePlanMeasure from './SitePlanMeasure';
import { T, S, cx } from '../../styles/tokens';

const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", jpeg: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
const STATUS_OPTIONS = [
  { value: "received",  label: "Received",  color: T.c.info, icon: "📥", bg: "#ebf5fb" },
  { value: "verified",  label: "Verified",  color: T.c.success, icon: "✅", bg: "#eafaf1" },
  { value: "rejected",  label: "Rejected",  color: T.c.danger, icon: "❌", bg: "#fdedec" },
];

function getStatusConfig(status) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

// ─── Floating Document Viewer ─────────────────────────
function DocViewer({ doc, appDbId, onClose }) {
  const [pos, setPos] = useState({ x: 80, y: 60 });
  const [size, setSize] = useState({ w: 640, h: 520 });
  const [dragging, setDragging] = useState(false);
  const [dragOff, setDragOff] = useState({ x: 0, y: 0 });
  const [maximized, setMaximized] = useState(false);
  const prevState = useRef(null);

  const fileUrl = api.getDocumentFileUrl(appDbId, doc.id);
  const downloadUrl = api.getDocumentDownloadUrl(appDbId, doc.id);
  const isImage = ["jpg", "jpeg", "png", "gif"].includes((doc.type || "").toLowerCase());
  const isPdf = (doc.type || "").toLowerCase() === "pdf";

  // Drag handlers
  const onMouseDown = (e) => {
    if (maximized) return;
    setDragging(true);
    setDragOff({ x: e.clientX - pos.x, y: e.clientY - pos.y });
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => setPos({ x: e.clientX - dragOff.x, y: e.clientY - dragOff.y });
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, dragOff]);

  const toggleMaximize = () => {
    if (maximized) {
      if (prevState.current) { setPos(prevState.current.pos); setSize(prevState.current.size); }
      setMaximized(false);
    } else {
      prevState.current = { pos: { ...pos }, size: { ...size } };
      setPos({ x: 0, y: 0 });
      setSize({ w: window.innerWidth, h: window.innerHeight });
      setMaximized(true);
    }
  };

  const style = maximized
    ? { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 10001 }
    : { position: "fixed", top: pos.y, left: pos.x, width: size.w, height: size.h, zIndex: 10001 };

  return (
    <div style={{ ...style, background: T.c.card, borderRadius: maximized ? 0 : 12, boxShadow: "0 12px 48px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden", border: maximized ? "none" : "1px solid #d5dde2" }}>
      {/* Title bar */}
      <div onMouseDown={onMouseDown}
        style={{ padding: "8px 12px", background: "#1a3a4a", color: T.c.white, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: maximized ? "default" : "move", flexShrink: 0, userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{typeIcons[doc.type] || "📄"}</span>
          <span style={{ fontSize: 12, fontWeight: T.w.bold, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{doc.type.toUpperCase()} · {doc.size}</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <a href={downloadUrl} download={doc.name} title="Download"
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: T.c.white, fontSize: 12, cursor: "pointer", borderRadius: T.r.sm, padding: "2px 6px", textDecoration: "none", display: "flex", alignItems: "center" }}>📥</a>
          <button onClick={() => window.open(fileUrl, "_blank")} title="Open in new tab"
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: T.c.white, fontSize: 12, cursor: "pointer", borderRadius: T.r.sm, padding: "2px 6px" }}>↗</button>
          <button onClick={toggleMaximize} title={maximized ? "Restore" : "Maximize"}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: T.c.white, fontSize: 12, cursor: "pointer", borderRadius: T.r.sm, padding: "2px 6px" }}>{maximized ? "❐" : "□"}</button>
          <button onClick={onClose} title="Close"
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: T.c.white, fontSize: 14, cursor: "pointer", borderRadius: T.r.sm, padding: "2px 6px" }}>✕</button>
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", background: "#e8ecef" }}>
        {isPdf ? (
          <iframe src={`${fileUrl}#toolbar=1&navpanes=1`} style={{ width: "100%", height: "100%", border: "none" }} title={doc.name} />
        ) : isImage ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: 12 }}>
            <img src={fileUrl} alt={doc.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: T.r.sm, boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <span style={{ fontSize: 48 }}>{typeIcons[doc.type] || "📄"}</span>
            <div style={{ fontSize: 13, color: T.c.grey800, fontWeight: T.w.semi }}>Preview not available for {doc.type.toUpperCase()} files</div>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={downloadUrl} download={doc.name}
                style={{ padding: "8px 18px", borderRadius: T.r.md, background: "#2980b9", color: T.c.white, fontWeight: T.w.bold, fontSize: 12, textDecoration: "none" }}>📥 Download</a>
              <button onClick={() => window.open(fileUrl, "_blank")}
                style={{ padding: "8px 18px", borderRadius: T.r.md, background: T.c.primary, color: T.c.white, fontWeight: T.w.bold, fontSize: 12, border: "none", cursor: "pointer", fontFamily: "inherit" }}>↗ Open in Browser</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Document Review Panel ───────────────────────────
function DocReviewPanel({ doc, appDbId, currentUser, onClose, onDocUpdated }) {
  const [status, setStatus] = useState(doc.status || "received");
  const [note, setNote] = useState(doc.reviewNote || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canReview = currentUser && (currentUser.role === "admin" || currentUser.role === "manager" || currentUser.role === "engineer");
  const hasChanges = status !== (doc.status || "received") || note !== (doc.reviewNote || "");
  const sc = getStatusConfig(status);

  const handleSave = async () => {
    if (!appDbId || !canReview) return;
    setSaving(true); setSaved(false);
    try {
      await api.updateDocStatus(appDbId, doc.id, status, note);
      setSaved(true);
      if (onDocUpdated) onDocUpdated();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error("Failed to update document:", e); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ borderTop: "2px solid #2980b9", background: T.c.bgAlt }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: T.w.bold, color: T.c.text }}>{typeIcons[doc.type] || "📄"} {doc.name}</div>
          <div style={{ fontSize: 11, color: T.c.textSecondary, marginTop: 2 }}>{doc.category} · {doc.type.toUpperCase()} · {doc.size} · Uploaded: {doc.date}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: T.c.textMuted }}>✕</button>
      </div>

      {canReview && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: `${sc.color}08`, borderBottom: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: T.w.black, color: T.c.text, textTransform: "uppercase" }}>📋 Document Review</span>
              {doc.reviewedBy && <span style={{ fontSize: 12, color: T.c.textSecondary }}>Last reviewed by <strong>{doc.reviewedBy}</strong> on {doc.reviewedAt}</span>}
            </div>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #f5f7f8" }}>
              <div style={{ fontSize: 12, fontWeight: T.w.semi, color: T.c.grey800, marginBottom: 6, textTransform: "uppercase" }}>Review Status</div>
              <div style={{ display: "flex", gap: 6 }}>
                {STATUS_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setStatus(opt.value)}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: T.r.md, cursor: "pointer", fontFamily: "inherit",
                      border: status === opt.value ? `2px solid ${opt.color}` : "1.5px solid #d5dde2",
                      background: status === opt.value ? opt.bg : "#fff",
                      color: status === opt.value ? opt.color : "#7a8a94",
                      fontWeight: status === opt.value ? 800 : 500, fontSize: 12 }}>
                    <div style={{ fontSize: 16, marginBottom: 2 }}>{opt.icon}</div>{opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #f5f7f8" }}>
              <div style={{ fontSize: 12, fontWeight: T.w.semi, color: T.c.grey800, marginBottom: 6, textTransform: "uppercase" }}>Review Note</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add review comments…" rows={3}
                style={{ width: "100%", padding: "8px 10px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", background: "#fafbfc", color: T.c.text, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>
            <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: T.c.textMuted }}>{currentUser && <span>Reviewing as <strong style={{ color: T.c.grey800 }}>{currentUser.name}</strong></span>}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {saved && <span style={{ fontSize: 11, color: T.c.success, fontWeight: T.w.semi }}>✅ Saved</span>}
                <button onClick={handleSave} disabled={saving || !hasChanges}
                  style={{ padding: "7px 18px", borderRadius: T.r.md, border: "none",
                    background: hasChanges ? `linear-gradient(135deg, ${sc.color}, ${sc.color}dd)` : T.c.grey400,
                    color: hasChanges ? "#fff" : "#95a5a6", fontWeight: T.w.bold, fontSize: 12,
                    cursor: hasChanges ? "pointer" : "default", fontFamily: "inherit" }}>
                  {saving ? "Saving…" : hasChanges ? `💾 Save as ${getStatusConfig(status).label}` : "No Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Upload categories available in assessment view
const UPLOAD_CATEGORIES = [
  { id: "Application Form", icon: "📄", accept: ".pdf" },
  { id: "Site Plan", icon: "📐", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "Building Application", icon: "🏗️", accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx" },
  { id: "Certificate of Title", icon: "📜", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "Engineering Drawing", icon: "📏", accept: ".pdf,.jpg,.jpeg,.png,.dwg" },
  { id: "Site Photos", icon: "📷", accept: ".jpg,.jpeg,.png,.webp" },
  { id: "Arborist Report", icon: "🌳", accept: ".pdf,.doc,.docx" },
  { id: "Stormwater Plan", icon: "💧", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "Dial Before You Dig", icon: "⚡", accept: ".pdf" },
  { id: "Inspection Report", icon: "🔍", accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx" },
  { id: "Other Documents", icon: "📎", accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx" },
];


// ─── Document List with Review + Viewer + Upload ─────
export default function DocumentList({ documents, appDbId, app, currentUser, onDocUpdated, onMeasureCorrection, onGeorefPoints }) {
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [filter, setFilter] = useState("All");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadCat, setUploadCat] = useState(UPLOAD_CATEGORIES[0].id);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [extractDoc, setExtractDoc] = useState(null); // doc to extract pages from
  const [extractPages, setExtractPages] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState(null);
  const [deleteDoc, setDeleteDoc] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showMeasure, setShowMeasure] = useState(false);
  const [measureDocId, setMeasureDocId] = useState(null);
  const fileInputRef = useRef(null);

  const canUpload = currentUser && ["admin", "manager", "engineer"].includes(currentUser.role);

  const handleExtractSiteplan = async () => {
    if (!extractDoc || !extractPages.trim() || !appDbId) return;
    setExtracting(true);
    setExtractResult(null);
    try {
      const result = await api.extractSiteplan(appDbId, extractDoc.id, extractPages.trim());
      setExtractResult(result);
      if (onDocUpdated) onDocUpdated();
    } catch (err) {
      setExtractResult({ success: false, message: err.message || "Extraction failed" });
    }
    setExtracting(false);
  };

  const handleAnalyseExtracted = async () => {
    if (!extractResult?.site_plan_doc_id || !appDbId) return;
    setExtracting(true);
    try {
      await api.analyseDocument(appDbId, extractResult.site_plan_doc_id);
      setExtractResult(prev => ({ ...prev, analysed: true, message: prev.message + " AI analysis complete." }));
      if (onDocUpdated) onDocUpdated();
      setTimeout(() => { setExtractDoc(null); setExtractPages(""); setExtractResult(null); }, 2500);
    } catch (err) {
      setExtractResult(prev => ({ ...prev, analyseError: err.message || "Analysis failed" }));
    }
    setExtracting(false);
  };

  const [formExtracting, setFormExtracting] = useState(false);
  const [formExtractResult, setFormExtractResult] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !appDbId) return;
    setUploading(true);
    setUploadSuccess(null);
    setFormExtractResult(null);
    try {
      await api.uploadDocument(appDbId, file, uploadCat);
      setUploadSuccess(file.name);
      if (onDocUpdated) onDocUpdated();

      // Auto-extract fields from Application Form PDF
      if (uploadCat === "Application Form" && file.name.toLowerCase().endsWith(".pdf")) {
        setFormExtracting(true);
        try {
          const result = await api.extractAppForm(file);
          const values = result.values || {};
          const mapping = {
            lot_owner_name: "owner_name", phone: "owner_phone", email: "owner_email",
            postal_address: "owner_postal_address", property_address: "property_address",
            estimated_construction_date: "crossover_est_date",
            dev_application_number: "da_number", date_signed: "date_signed",
          };
          const updates = {};
          const filled = [];
          const names = {
            lot_owner_name: "Owner", phone: "Phone", email: "Email",
            postal_address: "Postal Address", property_address: "Property Address",
            estimated_construction_date: "Est. Date", dev_application_number: "DA Number",
            lot_owner_signature: "Signature",
          };
          for (const [extractKey, appKey] of Object.entries(mapping)) {
            const val = values[extractKey];
            if (val && typeof val === "string" && val.trim()) {
              updates[appKey] = val.trim();
              filled.push(extractKey);
            }
          }
          // Handle signature
          const sig = values.lot_owner_signature;
          if (sig && sig.trim() && sig.trim().toLowerCase() !== "not signed" && sig.trim() !== "-") {
            updates.declaration_signed = true;
            filled.push("lot_owner_signature");
          }
          // Save extracted fields to the application
          if (Object.keys(updates).length > 0) {
            await api.updateApp(appDbId, updates);
            if (onDocUpdated) onDocUpdated();
          }
          setFormExtractResult({
            success: true,
            message: `Extracted ${filled.length} fields: ${filled.map(f => names[f] || f).join(", ")}`,
          });
        } catch (err) {
          setFormExtractResult({ success: false, message: `Extraction failed: ${err.message}` });
        }
        setFormExtracting(false);
      }

      setTimeout(() => { setUploadSuccess(null); if (!formExtracting) setShowUpload(false); }, 3000);
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadSuccess(null);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const docs = documents || [];
  const categories = ["All", ...new Set(docs.map(d => d.category))];
  const filtered = filter === "All" ? docs : docs.filter(d => d.category === filter);
  const selectedDoc = docs.find(d => d.id === selectedDocId);

  const verified = docs.filter(d => d.status === "verified").length;
  const rejected = docs.filter(d => d.status === "rejected").length;
  const pending = docs.length - verified - rejected;

  return (
    <div style={{ background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.c.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", margin: 0 }}>📎 Documents ({docs.length})</h4>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "3px 8px", borderRadius: T.r.sm, border: "none", fontSize: 11, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit",
              background: filter === c ? "#1a3a4a" : "#f5f8fa", color: filter === c ? "#fff" : "#7a8a94" }}>{c}</button>
          ))}
          {canUpload && (
            <button onClick={() => setShowUpload(!showUpload)}
              style={{ padding: "3px 10px", borderRadius: T.r.sm, border: showUpload ? "2px solid #1abc9c" : "1px solid #d5dde2", fontSize: 11, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit",
                background: showUpload ? "#e8f8f5" : "#fff", color: showUpload ? "#1abc9c" : "#7a8a94", marginLeft: 4 }}>
              {showUpload ? "✕ Close" : "＋ Upload"}
            </button>
          )}
        </div>
      </div>

      {/* Upload panel */}
      {showUpload && canUpload && (
        <div style={{ padding: "10px 16px", background: "#f0faf7", borderBottom: "1px solid #d5f5e3" }}>
          <div style={{ fontSize: 12, fontWeight: T.w.semi, color: "#1abc9c", marginBottom: 6, textTransform: "uppercase" }}>Upload New Document</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={uploadCat} onChange={e => setUploadCat(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", background: T.c.card, color: T.c.text, outline: "none", cursor: "pointer" }}>
              {UPLOAD_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.id}</option>
              ))}
            </select>
            <label style={{ padding: "6px 14px", borderRadius: T.r.md, border: "none", background: "linear-gradient(135deg, #1abc9c, #16a085)", color: T.c.white, fontSize: 11, fontWeight: T.w.bold, cursor: uploading ? "default" : "pointer", fontFamily: "inherit", opacity: uploading ? 0.6 : 1 }}>
              {uploading ? "⟳ Uploading..." : "📤 Choose File"}
              <input ref={fileInputRef} type="file" accept={UPLOAD_CATEGORIES.find(c => c.id === uploadCat)?.accept || "*"} onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
            </label>
            {uploadSuccess && <span style={{ fontSize: 11, color: T.c.success, fontWeight: T.w.semi }}>✅ {uploadSuccess} uploaded</span>}
            {formExtracting && <span style={{ fontSize: 11, color: "#8e44ad", fontWeight: T.w.semi }}>🤖 Extracting form fields...</span>}
            {formExtractResult && (
              <span style={{ fontSize: 11, color: formExtractResult.success ? "#27ae60" : "#e74c3c", fontWeight: T.w.semi }}>
                {formExtractResult.success ? "✅" : "⚠"} {formExtractResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div style={{ padding: "6px 16px", background: T.c.bgAlt, borderBottom: `1px solid ${T.c.borderLight}`, display: "flex", gap: 14, fontSize: 10 }}>
        <span style={{ color: T.c.success, fontWeight: T.w.bold }}>✅ {verified} verified</span>
        <span style={{ color: T.c.danger, fontWeight: T.w.bold }}>❌ {rejected} rejected</span>
        <span style={{ color: T.c.info, fontWeight: T.w.bold }}>📥 {pending} pending</span>
      </div>

      {/* Document rows */}
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {filtered.map(doc => {
          const sc = getStatusConfig(doc.status);
          const isSelected = selectedDocId === doc.id;
          return (
            <div key={doc.id} style={{ borderBottom: "1px solid #f8fafb" }}>
              <div style={{ padding: "9px 16px", display: "flex", alignItems: "center", gap: 10, background: isSelected ? "#ebf5fb" : "transparent", transition: "background 0.15s" }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8fafb"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? "#ebf5fb" : "transparent"; }}>
                <span style={{ fontSize: 18 }}>{typeIcons[doc.type] || "📄"}</span>
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setSelectedDocId(isSelected ? null : doc.id)}>
                  <div style={{ fontSize: 12, fontWeight: T.w.semi, color: T.c.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                  <div style={{ fontSize: 12, color: T.c.textMuted }}>
                    {doc.type.toUpperCase()} · {doc.size} · {doc.date}
                    {doc.reviewedBy && <span style={{ marginLeft: 6, color: T.c.textSecondary }}>· {doc.reviewedBy}</span>}
                  </div>
                </div>
                {/* View button */}
                <button onClick={(e) => { e.stopPropagation(); setViewerDoc(doc); }}
                  title="Open document viewer"
                  style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #d5dde2", background: T.c.card, color: T.c.info, fontSize: 12, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  👁 View
                </button>
                {/* Download button */}
                <a href={api.getDocumentDownloadUrl(appDbId, doc.id)} download={doc.name}
                  onClick={(e) => e.stopPropagation()}
                  title="Download file"
                  style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #27ae6040", background: T.c.successLight, color: T.c.success, fontSize: 12, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none", display: "inline-block" }}>
                  📥 Download
                </a>
                {/* Measure button — for site plan docs */}
                {(doc.category || "").toLowerCase().includes("site") && ["pdf","jpg","jpeg","png"].includes((doc.type || "").toLowerCase()) && (
                  <button onClick={(e) => { e.stopPropagation(); setMeasureDocId(doc.id); setShowMeasure(true); }}
                    title="Open measurement tool on this document"
                    style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #00838f40", background: "#e0f7fa", color: "#00838f", fontSize: 12, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    📏 Measure
                  </button>
                )}
                {/* Extract pages button — for multi-page PDFs (building apps, site plans, titles, other docs) */}
                {canUpload && doc.type === "pdf" && ["Building Application", "Other Documents", "Site Plan", "Certificate of Title"].includes(doc.category) && (
                  <button onClick={(e) => { e.stopPropagation(); setExtractDoc(doc); setExtractPages(""); setExtractResult(null); }}
                    title="Extract pages from this document"
                    style={{ padding: "6px 14px", borderRadius: T.r.md, border: "1px solid #8e44ad40", background: "#f4ecf7", color: "#8e44ad", fontSize: 12, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    ✂ Extract
                  </button>
                )}
                {/* AI field extraction for forms and titles */}
                {canUpload && ["pdf","jpg","jpeg","png"].includes((doc.type || "").toLowerCase()) && ["Application Form", "Certificate of Title"].includes(doc.category) && (
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const type = doc.category === "Certificate of Title" ? "certificate_of_title" : "application_form";
                    try {
                      setFormExtracting(true);
                      setFormExtractResult(null);
                      const result = await api.extractDocFields(appDbId, doc.id, type);
                      setFormExtractResult({ success: true, message: result.message || `Extracted ${result.count} fields` });
                      if (onDocUpdated) onDocUpdated();
                    } catch (err) {
                      setFormExtractResult({ success: false, message: `Extraction failed: ${err.message}` });
                    } finally { setFormExtracting(false); }
                  }}
                    disabled={formExtracting}
                    title={`Extract data from ${doc.category} using AI`}
                    style={{ padding: "6px 14px", borderRadius: T.r.md, border: "1px solid #16a08540", background: "#e8f8f5", color: "#16a085", fontSize: 12, fontWeight: T.w.semi, cursor: formExtracting ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: formExtracting ? 0.6 : 1 }}>
                    {formExtracting ? "⏳ Extracting..." : "🤖 AI Read"}
                  </button>
                )}
                {/* Delete button */}
                {canUpload && (
                  <button onClick={(e) => { e.stopPropagation(); setDeleteDoc(doc); }}
                    title="Delete document"
                    style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${T.c.border}`, background: T.c.card, color: T.c.danger, fontSize: 12, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    🗑
                  </button>
                )}
                {/* Status badge */}
                <span style={{ padding: "3px 8px", borderRadius: T.r.sm, fontSize: 12, fontWeight: T.w.semi, background: `${sc.color}14`, color: sc.color, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
                  {sc.icon} {sc.label}
                </span>
                {doc.reviewNote && <span title={doc.reviewNote} style={{ fontSize: 12, color: T.c.amber400 }}>💬</span>}
                <span onClick={() => setSelectedDocId(isSelected ? null : doc.id)}
                  style={{ fontSize: 10, color: T.c.grey400, cursor: "pointer", transition: "transform 0.2s", transform: isSelected ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Review panel */}
      {selectedDoc && (
        <DocReviewPanel doc={selectedDoc} appDbId={appDbId} currentUser={currentUser}
          onClose={() => setSelectedDocId(null)} onDocUpdated={onDocUpdated} />
      )}

      {/* Floating document viewer */}
      {viewerDoc && (
        <DocViewer doc={viewerDoc} appDbId={appDbId} onClose={() => setViewerDoc(null)} />
      )}

      {/* Delete confirmation popup */}
      {deleteDoc && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteDoc(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.c.card, borderRadius: 16, width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #fde8e8", background: "#fef5f5" }}>
              <div style={{ fontSize: 15, fontWeight: T.w.black, color: T.c.danger }}>🗑 Delete Document</div>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 12, fontWeight: T.w.bold, color: T.c.text, marginBottom: 8 }}>{deleteDoc.name}</div>
              <div style={{ fontSize: 11, color: T.c.textSecondary, marginBottom: 12 }}>{deleteDoc.category} · {deleteDoc.type?.toUpperCase()} · {deleteDoc.size}</div>

              <div style={{ background: "#fef5e7", borderRadius: T.r.md, padding: "10px 12px", marginBottom: 12, border: "1px solid #f9e79f" }}>
                <div style={{ fontSize: 10, fontWeight: T.w.black, color: "#b7950b", marginBottom: 4 }}>⚠ Warning — This action cannot be undone</div>
                <div style={{ fontSize: 10, color: "#7d6608", lineHeight: 1.5 }}>
                  The following will be permanently deleted:
                </div>
                <ul style={{ fontSize: 10, color: "#7d6608", margin: "4px 0 0 16px", padding: 0, lineHeight: 1.6 }}>
                  <li>The document file from server storage</li>
                  {deleteDoc.category?.toLowerCase().includes("site") && (
                    <>
                      <li><strong>AI site plan analysis data</strong> for this application</li>
                      <li>AI training samples and officer corrections linked to this document</li>
                      <li>Assessment results that relied on this analysis will need re-evaluation</li>
                    </>
                  )}
                  {!deleteDoc.category?.toLowerCase().includes("site") && (
                    <li>AI training samples linked to this document (if any)</li>
                  )}
                </ul>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setDeleteDoc(null)}
                  style={{ padding: "8px 16px", borderRadius: T.r.md, border: "1px solid #d5dde2", background: T.c.card, color: T.c.grey800, fontWeight: T.w.semi, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
                <button onClick={async () => {
                  setDeleting(true);
                  try {
                    await api.deleteDocument(appDbId, deleteDoc.id);
                    if (onDocUpdated) onDocUpdated();
                    setDeleteDoc(null);
                  } catch (err) {
                    console.error("Delete failed:", err);
                    alert("Delete failed: " + (err.message || "Unknown error"));
                  }
                  setDeleting(false);
                }} disabled={deleting}
                  style={{ padding: "8px 20px", borderRadius: T.r.md, border: "none",
                    background: deleting ? T.c.grey400 : "linear-gradient(135deg, #e74c3c, #c0392b)",
                    color: deleting ? "#95a5a6" : "#fff",
                    fontWeight: T.w.bold, fontSize: 12, cursor: deleting ? "default" : "pointer", fontFamily: "inherit" }}>
                  {deleting ? "⟳ Deleting..." : "🗑 Delete Permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extract Site Plan popup */}
      {/* AI extraction result toast */}
      {formExtractResult && !showUpload && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 10001, padding: "12px 20px", borderRadius: T.r.md,
          background: formExtractResult.success ? "#eafaf1" : "#fdedec", border: `1px solid ${formExtractResult.success ? "#27ae60" : "#e74c3c"}`,
          color: formExtractResult.success ? "#27ae60" : "#e74c3c", fontSize: 12, fontWeight: T.w.semi, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", gap: 8, maxWidth: 400 }}
          onClick={() => setFormExtractResult(null)}>
          {formExtractResult.success ? "✅" : "⚠"} {formExtractResult.message}
          <button onClick={() => setFormExtractResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, marginLeft: 8 }}>✕</button>
        </div>
      )}

      {extractDoc && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setExtractDoc(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.c.card, borderRadius: 16, width: 420, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.c.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: T.w.black, color: T.c.text }}>📐 Extract Site Plan Pages</div>
                <div style={{ fontSize: 11, color: T.c.textSecondary, marginTop: 2 }}>From: {extractDoc.name}</div>
              </div>
              <button onClick={() => setExtractDoc(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: T.c.textMuted }}>✕</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 11, color: T.c.grey800, marginBottom: 10, lineHeight: 1.5 }}>
                Enter the page number(s) that contain the site plan. The selected pages will be extracted as a separate Site Plan document and automatically analysed by AI.
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: T.w.semi, color: T.c.grey800, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Site Plan Page Number(s)</label>
                <input
                  value={extractPages}
                  onChange={e => setExtractPages(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleExtractSiteplan()}
                  placeholder="e.g. 3 or 3,4"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: T.c.text, fontWeight: T.w.bold }}
                  autoFocus
                />
                <div style={{ fontSize: 11, color: T.c.textMuted, marginTop: 4 }}>
                  Separate multiple pages with commas. Open the document viewer to identify the site plan page(s).
                </div>
              </div>
              {extractResult && (
                <div style={{ padding: "8px 12px", borderRadius: T.r.md, marginBottom: 12,
                  background: extractResult.success ? "#eafaf1" : "#fdedec",
                  color: extractResult.success ? "#27ae60" : "#e74c3c",
                  fontSize: 11, fontWeight: T.w.semi }}>
                  {extractResult.success ? `✅ ${extractResult.message}` : `⚠ ${extractResult.message}`}
                  {extractResult.analyseError && <div style={{ color: T.c.danger, marginTop: 4 }}>⚠ {extractResult.analyseError}</div>}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setExtractDoc(null)}
                  style={{ padding: "8px 16px", borderRadius: T.r.md, border: "1px solid #d5dde2", background: T.c.card, color: T.c.grey800, fontWeight: T.w.semi, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  {extractResult?.success ? "Close" : "Cancel"}
                </button>
                {/* Extract button — shown before extraction */}
                {!extractResult?.success && (
                  <button onClick={handleExtractSiteplan} disabled={extracting || !extractPages.trim()}
                    style={{ padding: "8px 20px", borderRadius: T.r.md, border: "none",
                      background: extractPages.trim() && !extracting ? "linear-gradient(135deg, #8e44ad, #6c3483)" : T.c.grey400,
                      color: extractPages.trim() && !extracting ? "#fff" : "#95a5a6",
                      fontWeight: T.w.bold, fontSize: 12, cursor: extractPages.trim() && !extracting ? "pointer" : "default", fontFamily: "inherit" }}>
                    {extracting ? "⟳ Extracting..." : "✂ Extract Pages"}
                  </button>
                )}
                {/* Analyse button — shown after successful extraction */}
                {extractResult?.success && !extractResult?.analysed && (
                  <button onClick={handleAnalyseExtracted} disabled={extracting}
                    style={{ padding: "8px 20px", borderRadius: T.r.md, border: "none",
                      background: extracting ? T.c.grey400 : "linear-gradient(135deg, #27ae60, #1e8449)",
                      color: extracting ? "#95a5a6" : "#fff",
                      fontWeight: T.w.bold, fontSize: 12, cursor: extracting ? "default" : "pointer", fontFamily: "inherit" }}>
                    {extracting ? "⟳ Analysing..." : "🤖 Analyse Site Plan"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Site Plan Measure Tool */}
      {showMeasure && (() => {
        // Use specific doc if clicked from row, otherwise find site plan
        const spDoc = measureDocId
          ? docs.find(d => String(d.id) === String(measureDocId))
          : docs.find(d => {
              const cat = (d.category || "").toLowerCase();
              return (cat.includes("site") || cat === "site_plan") && ["pdf","jpg","jpeg","png","gif","webp"].includes((d.type || "").toLowerCase());
            });
        if (!spDoc) {
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'grid', placeItems: 'center' }}
              onClick={() => { setShowMeasure(false); setMeasureDocId(null); }}>
              <div style={{ background: '#1a2a3a', color: '#fff', padding: 24, borderRadius: T.r.lg, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: T.w.bold, marginBottom: 8 }}>No Site Plan Found</div>
                <div style={{ fontSize: 12, color: '#7a8a94' }}>Upload a document with category "Site Plan" first.</div>
              </div>
            </div>
          );
        }
        const imgUrl = spDoc.type === "pdf"
          ? api.getDocumentRenderUrl(appDbId, spDoc.id, 1)
          : api.getDocumentFileUrl(appDbId, spDoc.id);
        return (
          <SitePlanMeasure
            imgUrl={imgUrl}
            appRef={`${app?.ref_number || app?.id} — ${spDoc.name}`}
            savedItems={app?.site_plan_measures || []}
            appData={app}
            onClose={() => { setShowMeasure(false); setMeasureDocId(null); }}
            onSaveMeasures={(measures) => {
              api.updateApp(appDbId, { site_plan_measures: measures }).catch(err => console.warn('Auto-save measures failed:', err));
            }}
            onSaveField={(fieldKey, value, unit) => {
              if (onMeasureCorrection) {
                onMeasureCorrection(fieldKey, value, unit);
                alert(`📏 Measurement ${value} ${unit} added as pending correction for "${fieldKey}".\n\nGo to AI Site Plan Analysis section → Save Corrections → Verify.`);
              }
            }}
            onGeorefPoints={onGeorefPoints}
          />
        );
      })()}
    </div>
  );
}
