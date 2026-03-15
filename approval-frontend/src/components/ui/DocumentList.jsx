import { useState } from "react";

// ─── Document List & Viewer ─────────────────────────────
export default function DocumentList({ documents }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [filter, setFilter] = useState("All");
  const [previewDoc, setPreviewDoc] = useState(null);
  if (!documents || documents.length === 0) return <div style={{ padding: 16, color: "#95a5a6", fontSize: 12 }}>No documents submitted.</div>;

  const categories = ["All", ...new Set(documents.map(d => d.category))];
  const filtered = filter === "All" ? documents : documents.filter(d => d.category === filter);

  const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
  const statusColors = { received: "#3498db", verified: "#27ae60", pending: "#e67e22", rejected: "#e74c3c" };

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
      <div style={{ maxHeight: 240, overflowY: "auto" }}>
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
            <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${statusColors[doc.status] || "#95a5a6"}18`, color: statusColors[doc.status] || "#95a5a6" }}>
              {doc.status}
            </span>
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
                  {/* <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
                  <button style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔍 Full View</button> */}
                  <button onClick={() => { const blob = new Blob([`[Mock PDF content for ${selectedDoc.name}]\n\nThis is a placeholder for the actual document file.\nDocument ID: ${selectedDoc.id}\nCategory: ${selectedDoc.category}\nSize: ${selectedDoc.size}\nUploaded: ${selectedDoc.date}`], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = selectedDoc.name + "." + selectedDoc.type; a.click(); URL.revokeObjectURL(url); }}
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
          {/* Document metadata */}
          <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: 10, color: "#7a8a94" }}>
            <span>📅 Uploaded: {selectedDoc.date}</span>
            <span>📁 Category: {selectedDoc.category}</span>
            <span>✅ Status: <strong style={{ color: statusColors[selectedDoc.status] }}>{selectedDoc.status}</strong></span>
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
