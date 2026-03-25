import { useState, useRef, useEffect } from "react";
import api from '../../services/api';

const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", jpeg: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
const STATUS_OPTIONS = [
  { value: "received",  label: "Received",  color: "#3498db", icon: "📥", bg: "#ebf5fb" },
  { value: "verified",  label: "Verified",  color: "#27ae60", icon: "✅", bg: "#eafaf1" },
  { value: "rejected",  label: "Rejected",  color: "#e74c3c", icon: "❌", bg: "#fdedec" },
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
    <div style={{ ...style, background: "#fff", borderRadius: maximized ? 0 : 12, boxShadow: "0 12px 48px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden", border: maximized ? "none" : "1px solid #d5dde2" }}>
      {/* Title bar */}
      <div onMouseDown={onMouseDown}
        style={{ padding: "8px 12px", background: "#1a3a4a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: maximized ? "default" : "move", flexShrink: 0, userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{typeIcons[doc.type] || "📄"}</span>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{doc.type.toUpperCase()} · {doc.size}</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={() => window.open(fileUrl, "_blank")} title="Open in new tab"
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 12, cursor: "pointer", borderRadius: 4, padding: "2px 6px" }}>↗</button>
          <button onClick={toggleMaximize} title={maximized ? "Restore" : "Maximize"}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 12, cursor: "pointer", borderRadius: 4, padding: "2px 6px" }}>{maximized ? "❐" : "□"}</button>
          <button onClick={onClose} title="Close"
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 14, cursor: "pointer", borderRadius: 4, padding: "2px 6px" }}>✕</button>
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", background: "#e8ecef" }}>
        {isPdf ? (
          <iframe src={fileUrl} style={{ width: "100%", height: "100%", border: "none" }} title={doc.name} />
        ) : isImage ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: 12 }}>
            <img src={fileUrl} alt={doc.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <span style={{ fontSize: 48 }}>{typeIcons[doc.type] || "📄"}</span>
            <div style={{ fontSize: 13, color: "#5a6a74", fontWeight: 600 }}>Preview not available for {doc.type.toUpperCase()} files</div>
            <a href={fileUrl} download={doc.name}
              style={{ padding: "8px 18px", borderRadius: 8, background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 12, textDecoration: "none" }}>📥 Download File</a>
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
    <div style={{ borderTop: "2px solid #2980b9", background: "#f8fafb" }}>
      <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>{typeIcons[doc.type] || "📄"} {doc.name}</div>
          <div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>{doc.category} · {doc.type.toUpperCase()} · {doc.size} · Uploaded: {doc.date}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
      </div>

      {canReview && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: `${sc.color}08`, borderBottom: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3a4a", textTransform: "uppercase" }}>📋 Document Review</span>
              {doc.reviewedBy && <span style={{ fontSize: 10, color: "#7a8a94" }}>Last reviewed by <strong>{doc.reviewedBy}</strong> on {doc.reviewedAt}</span>}
            </div>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #f5f7f8" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", marginBottom: 6, textTransform: "uppercase" }}>Review Status</div>
              <div style={{ display: "flex", gap: 6 }}>
                {STATUS_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setStatus(opt.value)}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
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
              <div style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", marginBottom: 6, textTransform: "uppercase" }}>Review Note</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add review comments…" rows={3}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", background: "#fafbfc", color: "#1a3a4a", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>
            <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: "#95a5a6" }}>{currentUser && <span>Reviewing as <strong style={{ color: "#5a6a74" }}>{currentUser.name}</strong></span>}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {saved && <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>✅ Saved</span>}
                <button onClick={handleSave} disabled={saving || !hasChanges}
                  style={{ padding: "7px 18px", borderRadius: 8, border: "none",
                    background: hasChanges ? `linear-gradient(135deg, ${sc.color}, ${sc.color}dd)` : "#d5dde2",
                    color: hasChanges ? "#fff" : "#95a5a6", fontWeight: 700, fontSize: 12,
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
export default function DocumentList({ documents, appDbId, currentUser, onDocUpdated }) {
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [filter, setFilter] = useState("All");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadCat, setUploadCat] = useState(UPLOAD_CATEGORIES[0].id);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const fileInputRef = useRef(null);

  const canUpload = currentUser && ["admin", "manager", "engineer"].includes(currentUser.role);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !appDbId) return;
    setUploading(true);
    setUploadSuccess(null);
    try {
      await api.uploadDocument(appDbId, file, uploadCat);
      setUploadSuccess(file.name);
      if (onDocUpdated) onDocUpdated();
      setTimeout(() => { setUploadSuccess(null); setShowUpload(false); }, 2000);
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
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: 0 }}>📎 Documents ({docs.length})</h4>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === c ? "#1a3a4a" : "#f5f8fa", color: filter === c ? "#fff" : "#7a8a94" }}>{c}</button>
          ))}
          {canUpload && (
            <button onClick={() => setShowUpload(!showUpload)}
              style={{ padding: "3px 10px", borderRadius: 4, border: showUpload ? "2px solid #1abc9c" : "1px solid #d5dde2", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                background: showUpload ? "#e8f8f5" : "#fff", color: showUpload ? "#1abc9c" : "#7a8a94", marginLeft: 4 }}>
              {showUpload ? "✕ Close" : "＋ Upload"}
            </button>
          )}
        </div>
      </div>

      {/* Upload panel */}
      {showUpload && canUpload && (
        <div style={{ padding: "10px 16px", background: "#f0faf7", borderBottom: "1px solid #d5f5e3" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1abc9c", marginBottom: 6, textTransform: "uppercase" }}>Upload New Document</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={uploadCat} onChange={e => setUploadCat(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", background: "#fff", color: "#1a3a4a", outline: "none", cursor: "pointer" }}>
              {UPLOAD_CATEGORIES.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.id}</option>
              ))}
            </select>
            <label style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #1abc9c, #16a085)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: uploading ? "default" : "pointer", fontFamily: "inherit", opacity: uploading ? 0.6 : 1 }}>
              {uploading ? "⟳ Uploading..." : "📤 Choose File"}
              <input ref={fileInputRef} type="file" accept={UPLOAD_CATEGORIES.find(c => c.id === uploadCat)?.accept || "*"} onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
            </label>
            {uploadSuccess && <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>✅ {uploadSuccess} uploaded</span>}
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div style={{ padding: "6px 16px", background: "#f8fafb", borderBottom: "1px solid #f0f3f5", display: "flex", gap: 14, fontSize: 10 }}>
        <span style={{ color: "#27ae60", fontWeight: 700 }}>✅ {verified} verified</span>
        <span style={{ color: "#e74c3c", fontWeight: 700 }}>❌ {rejected} rejected</span>
        <span style={{ color: "#3498db", fontWeight: 700 }}>📥 {pending} pending</span>
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
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                  <div style={{ fontSize: 10, color: "#95a5a6" }}>
                    {doc.type.toUpperCase()} · {doc.size} · {doc.date}
                    {doc.reviewedBy && <span style={{ marginLeft: 6, color: "#7a8a94" }}>· {doc.reviewedBy}</span>}
                  </div>
                </div>
                {/* View button */}
                <button onClick={(e) => { e.stopPropagation(); setViewerDoc(doc); }}
                  title="Open document viewer"
                  style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #d5dde2", background: "#fff", color: "#2980b9", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  👁 View
                </button>
                {/* Delete button */}
                {canUpload && (
                  <button onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) {
                      api.deleteDocument(appDbId, doc.id).then(() => { if (onDocUpdated) onDocUpdated(); }).catch(err => console.error("Delete failed:", err));
                    }
                  }}
                    title="Delete document"
                    style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #e4e9ec", background: "#fff", color: "#e74c3c", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    🗑
                  </button>
                )}
                {/* Status badge */}
                <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${sc.color}14`, color: sc.color, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
                  {sc.icon} {sc.label}
                </span>
                {doc.reviewNote && <span title={doc.reviewNote} style={{ fontSize: 12, color: "#e67e22" }}>💬</span>}
                <span onClick={() => setSelectedDocId(isSelected ? null : doc.id)}
                  style={{ fontSize: 10, color: "#bdc3c7", cursor: "pointer", transition: "transform 0.2s", transform: isSelected ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
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
    </div>
  );
}
