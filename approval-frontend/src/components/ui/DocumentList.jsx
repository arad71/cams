import { useState } from "react";
import api from '../../services/api';

// ─── Document List & Viewer with Verification Actions ──
export default function DocumentList({ documents, appDbId, currentUser, onDocUpdated }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [filter, setFilter] = useState("All");
  const [previewDoc, setPreviewDoc] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // docId being acted on

  if (!documents || documents.length === 0) return <div style={{ padding: 16, color: "#95a5a6", fontSize: 12 }}>No documents submitted.</div>;

  const categories = ["All", ...new Set(documents.map(d => d.category))];
  const filtered = filter === "All" ? documents : documents.filter(d => d.category === filter);

  const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
  const statusColors = { received: "#3498db", verified: "#27ae60", pending: "#e67e22", rejected: "#e74c3c" };
  const statusIcons = { received: "📥", verified: "✅", pending: "⏳", rejected: "❌" };

  const canVerify = currentUser && (currentUser.role === "admin" || currentUser.role === "manager" || currentUser.role === "engineer");

  // Handle doc status change via API
  const handleStatusChange = async (doc, newStatus) => {
    if (!appDbId) return;
    setActionLoading(doc.id);
    try {
      await api.updateDocStatus(appDbId, doc.id, newStatus);
      if (onDocUpdated) onDocUpdated();
    } catch (e) {
      console.error("Failed to update document status:", e);
    } finally {
      setActionLoading(null);
    }
  };

  // Render action buttons for a document
  const renderActions = (doc) => {
    if (!canVerify) return null;
    const loading = actionLoading === doc.id;

    if (doc.status === "verified") {
      return (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#27ae60", fontWeight: 700 }}>✅ Verified</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleStatusChange(doc, "received"); }}
            disabled={loading}
            style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            title="Undo verification"
          >↩ Undo</button>
        </div>
      );
    }

    if (doc.status === "rejected") {
      return (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#e74c3c", fontWeight: 700 }}>❌ Rejected</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleStatusChange(doc, "received"); }}
            disabled={loading}
            style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            title="Reset to received"
          >↩ Reset</button>
        </div>
      );
    }

    // received or pending — show verify/reject buttons
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button
          onClick={(e) => { e.stopPropagation(); handleStatusChange(doc, "verified"); }}
          disabled={loading}
          style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: loading ? "#bdc3c7" : "#27ae60", color: "#fff", fontSize: 9, fontWeight: 700, cursor: loading ? "default" : "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
          title="Mark as verified"
        >{loading ? "…" : "✓ Verify"}</button>
        <button
          onClick={(e) => { e.stopPropagation(); handleStatusChange(doc, "rejected"); }}
          disabled={loading}
          style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: loading ? "#bdc3c7" : "#e74c3c", color: "#fff", fontSize: 9, fontWeight: 700, cursor: loading ? "default" : "pointer", fontFamily: "inherit", transition: "background 0.15s" }}
          title="Mark as rejected"
        >{loading ? "…" : "✗ Reject"}</button>
      </div>
    );
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: 0 }}>📎 Documents ({documents.length})</h4>
        <div style={{ display: "flex", gap: 2 }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === c ? "#1a3a4a" : "#f5f8fa", color: filter === c ? "#fff" : "#7a8a94" }}>{c}</button>
          ))}
        </div>
      </div>

      {/* Document verification summary bar */}
      {canVerify && documents.length > 0 && (
        <div style={{ padding: "6px 16px", background: "#f8fafb", borderBottom: "1px solid #f0f3f5", display: "flex", gap: 12, fontSize: 10, color: "#7a8a94" }}>
          <span style={{ color: "#27ae60", fontWeight: 700 }}>✅ {documents.filter(d => d.status === "verified").length} verified</span>
          <span style={{ color: "#e74c3c", fontWeight: 700 }}>❌ {documents.filter(d => d.status === "rejected").length} rejected</span>
          <span style={{ color: "#3498db", fontWeight: 700 }}>📥 {documents.filter(d => d.status === "received" || d.status === "pending").length} pending</span>
        </div>
      )}

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {filtered.map(doc => (
          <div key={doc.id} onClick={() => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc)}
            style={{ padding: "8px 16px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              background: selectedDoc?.id === doc.id ? "#ebf5fb" : "transparent", transition: "background 0.15s" }}
            onMouseEnter={e => { if (selectedDoc?.id !== doc.id) e.currentTarget.style.background = "#f8fafb"; }}
            onMouseLeave={e => { if (selectedDoc?.id !== doc.id) e.currentTarget.style.background = "transparent"; }}>
            <span style={{ fontSize: 18 }}>{typeIcons[doc.type] || "📄"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
              <div style={{ fontSize: 10, color: "#95a5a6" }}>{doc.type.toUpperCase()} · {doc.size} · {doc.date}</div>
            </div>
            {/* Status badge */}
            <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${statusColors[doc.status] || "#95a5a6"}18`, color: statusColors[doc.status] || "#95a5a6", whiteSpace: "nowrap" }}>
              {statusIcons[doc.status] || "📄"} {doc.status}
            </span>
            {/* Verify/reject actions inline */}
            {renderActions(doc)}
          </div>
        ))}
      </div>

      {/* Document Viewer */}
      {selectedDoc && (
        <div style={{ borderTop: "2px solid #2980b9", padding: 16, background: "#f8fafb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>{typeIcons[selectedDoc.type] || "📄"} {selectedDoc.name}</div>
              <div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>{selectedDoc.category} · {selectedDoc.type.toUpperCase()} · {selectedDoc.size}</div>
            </div>
            <button onClick={() => setSelectedDoc(null)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
          </div>

          {/* Preview area */}
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e9ec", padding: 20, minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            {selectedDoc.type === "pdf" ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a", marginBottom: 4 }}>{selectedDoc.name}</div>
                <div style={{ fontSize: 11, color: "#7a8a94", marginBottom: 12 }}>PDF Document · {selectedDoc.size}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                  <button onClick={() => { const blob = new Blob([`[Mock PDF content for ${selectedDoc.name}]\n\nDocument ID: ${selectedDoc.id}\nCategory: ${selectedDoc.category}\nSize: ${selectedDoc.size}\nUploaded: ${selectedDoc.date}`], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = selectedDoc.name + "." + selectedDoc.type; a.click(); URL.revokeObjectURL(url); }}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
                  <button onClick={() => setPreviewDoc(selectedDoc)}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔍 Full View</button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: "100%", height: 160, background: "linear-gradient(135deg, #dfe6e9, #b2bec3)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 48 }}>🖼️</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>{selectedDoc.name}</div>
                <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 2, marginBottom: 8 }}>{selectedDoc.type.toUpperCase()} · {selectedDoc.size}</div>
                <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
              </div>
            )}
          </div>

          {/* Document metadata + verification actions in detail view */}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#7a8a94" }}>
              <span>📅 Uploaded: {selectedDoc.date}</span>
              <span>📁 Category: {selectedDoc.category}</span>
              <span>Status: <strong style={{ color: statusColors[selectedDoc.status] }}>{statusIcons[selectedDoc.status]} {selectedDoc.status}</strong></span>
            </div>
            {/* Larger verify/reject buttons in detail panel */}
            {canVerify && selectedDoc.status !== "verified" && selectedDoc.status !== "rejected" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => handleStatusChange(selectedDoc, "verified")}
                  disabled={actionLoading === selectedDoc.id}
                  style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#27ae60", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                >✅ Mark Verified</button>
                <button
                  onClick={() => handleStatusChange(selectedDoc, "rejected")}
                  disabled={actionLoading === selectedDoc.id}
                  style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#e74c3c", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                >❌ Reject</button>
              </div>
            )}
            {canVerify && selectedDoc.status === "verified" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 700 }}>✅ Verified</span>
                <button onClick={() => handleStatusChange(selectedDoc, "received")} disabled={actionLoading === selectedDoc.id}
                  style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontWeight: 600, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>↩ Undo</button>
              </div>
            )}
            {canVerify && selectedDoc.status === "rejected" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#e74c3c", fontWeight: 700 }}>❌ Rejected</span>
                <button onClick={() => handleStatusChange(selectedDoc, "received")} disabled={actionLoading === selectedDoc.id}
                  style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontWeight: 600, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>↩ Reset</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-screen document preview modal */}
      {previewDoc && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setPreviewDoc(null)}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", padding: 24, position: "relative" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#1a3a4a" }}>{previewDoc.name}</div>
                <div style={{ fontSize: 12, color: "#7a8a94", marginTop: 2 }}>{previewDoc.category} · {previewDoc.type.toUpperCase()} · {previewDoc.size}</div>
              </div>
              <button onClick={() => setPreviewDoc(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#95a5a6", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ background: "#f5f8fa", borderRadius: 10, padding: 40, textAlign: "center", minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1px solid #e4e9ec" }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>{previewDoc.type === "pdf" ? "📄" : "🖼️"}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a4a", marginBottom: 4 }}>{previewDoc.name}</div>
              <div style={{ fontSize: 12, color: "#7a8a94", marginBottom: 16 }}>{previewDoc.type.toUpperCase()} · {previewDoc.size}</div>
              <div style={{ fontSize: 12, color: "#95a5a6", marginBottom: 20, maxWidth: 350 }}>
                This is a mock preview. In production, the actual document would render here via a document viewer.
              </div>
              <button onClick={() => { const blob = new Blob([`[Mock content for ${previewDoc.name}]`], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = previewDoc.name + "." + previewDoc.type; a.click(); URL.revokeObjectURL(url); }}
                style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>📥 Download File</button>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 16, fontSize: 11, color: "#7a8a94" }}>
              <span>📅 Uploaded: {previewDoc.date}</span>
              <span>📁 Category: {previewDoc.category}</span>
              <span>✅ Status: {previewDoc.status}</span>
              <span>🆔 {previewDoc.id}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
