import { useState } from "react";
import api from '../../services/api';

const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
const STATUS_OPTIONS = [
  { value: "received",  label: "Received",  color: "#3498db", icon: "📥", bg: "#ebf5fb" },
  { value: "verified",  label: "Verified",  color: "#27ae60", icon: "✅", bg: "#eafaf1" },
  { value: "rejected",  label: "Rejected",  color: "#e74c3c", icon: "❌", bg: "#fdedec" },
];

function getStatusConfig(status) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

// ─── Document Review Panel (shown when a doc is selected) ──
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
    setSaving(true);
    setSaved(false);
    try {
      await api.updateDocStatus(appDbId, doc.id, status, note);
      setSaved(true);
      if (onDocUpdated) onDocUpdated();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to update document:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderTop: "2px solid #2980b9", background: "#f8fafb" }}>
      {/* Document info header */}
      <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>{typeIcons[doc.type] || "📄"} {doc.name}</div>
          <div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>{doc.category} · {doc.type.toUpperCase()} · {doc.size} · Uploaded: {doc.date}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
      </div>

      {/* Preview + Download */}
      <div style={{ padding: "0 16px 12px" }}>
        <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e9ec", padding: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>{typeIcons[doc.type] || "📄"}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 8 }}>{doc.name}</div>
          <button onClick={() => {
            const blob = new Blob([`[Document: ${doc.name}]\nID: ${doc.id}\nCategory: ${doc.category}\nSize: ${doc.size}`], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = doc.name; a.click(); URL.revokeObjectURL(url);
          }} style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
        </div>
      </div>

      {/* ★ REVIEW SECTION — Status + Note (like approval checklist) ★ */}
      {canReview && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e4e9ec", overflow: "hidden" }}>
            {/* Review header */}
            <div style={{ padding: "10px 14px", background: `${sc.color}08`, borderBottom: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3a4a", textTransform: "uppercase", letterSpacing: "0.04em" }}>📋 Document Review</span>
              {doc.reviewedBy && (
                <span style={{ fontSize: 10, color: "#7a8a94" }}>
                  Last reviewed by <strong>{doc.reviewedBy}</strong> on {doc.reviewedAt}
                </span>
              )}
            </div>

            {/* Status selector */}
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #f5f7f8" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Review Status</div>
              <div style={{ display: "flex", gap: 6 }}>
                {STATUS_OPTIONS.map(opt => {
                  const active = status === opt.value;
                  return (
                    <button key={opt.value} onClick={() => setStatus(opt.value)}
                      style={{
                        flex: 1, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                        border: active ? `2px solid ${opt.color}` : "1.5px solid #d5dde2",
                        background: active ? opt.bg : "#fff",
                        color: active ? opt.color : "#7a8a94",
                        fontWeight: active ? 800 : 500, fontSize: 12,
                        transition: "all 0.15s",
                      }}>
                      <div style={{ fontSize: 16, marginBottom: 2 }}>{opt.icon}</div>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Review note */}
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #f5f7f8" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#5a6a74", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Review Note</div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add review comments, issues found, or conditions for this document…"
                rows={3}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #d5dde2",
                  fontSize: 12, fontFamily: "inherit", background: "#fafbfc", color: "#1a3a4a",
                  outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5,
                }}
              />
            </div>

            {/* Save button */}
            <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: "#95a5a6" }}>
                {currentUser && <span>Reviewing as <strong style={{ color: "#5a6a74" }}>{currentUser.name}</strong></span>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {saved && <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 600 }}>✅ Saved</span>}
                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  style={{
                    padding: "7px 18px", borderRadius: 8, border: "none",
                    background: hasChanges ? `linear-gradient(135deg, ${sc.color}, ${sc.color}dd)` : "#d5dde2",
                    color: hasChanges ? "#fff" : "#95a5a6",
                    fontWeight: 700, fontSize: 12, cursor: hasChanges ? "pointer" : "default",
                    fontFamily: "inherit", boxShadow: hasChanges ? `0 2px 8px ${sc.color}30` : "none",
                    transition: "all 0.15s",
                  }}
                >
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


// ─── Document List with Review ─────────────────────────
export default function DocumentList({ documents, appDbId, currentUser, onDocUpdated }) {
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [filter, setFilter] = useState("All");

  if (!documents || documents.length === 0) return <div style={{ padding: 16, color: "#95a5a6", fontSize: 12 }}>No documents submitted.</div>;

  const categories = ["All", ...new Set(documents.map(d => d.category))];
  const filtered = filter === "All" ? documents : documents.filter(d => d.category === filter);
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  const verified = documents.filter(d => d.status === "verified").length;
  const rejected = documents.filter(d => d.status === "rejected").length;
  const pending = documents.length - verified - rejected;

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: 0 }}>📎 Documents ({documents.length})</h4>
        <div style={{ display: "flex", gap: 2 }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === c ? "#1a3a4a" : "#f5f8fa", color: filter === c ? "#fff" : "#7a8a94" }}>{c}</button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ padding: "6px 16px", background: "#f8fafb", borderBottom: "1px solid #f0f3f5", display: "flex", gap: 14, fontSize: 10 }}>
        <span style={{ color: "#27ae60", fontWeight: 700 }}>✅ {verified} verified</span>
        <span style={{ color: "#e74c3c", fontWeight: 700 }}>❌ {rejected} rejected</span>
        <span style={{ color: "#3498db", fontWeight: 700 }}>📥 {pending} pending review</span>
      </div>

      {/* Document rows */}
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {filtered.map(doc => {
          const sc = getStatusConfig(doc.status);
          const isSelected = selectedDocId === doc.id;
          return (
            <div key={doc.id}
              onClick={() => setSelectedDocId(isSelected ? null : doc.id)}
              style={{
                padding: "9px 16px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", background: isSelected ? "#ebf5fb" : "transparent", transition: "background 0.15s",
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8fafb"; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 18 }}>{typeIcons[doc.type] || "📄"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                <div style={{ fontSize: 10, color: "#95a5a6" }}>
                  {doc.type.toUpperCase()} · {doc.size} · {doc.date}
                  {doc.reviewedBy && <span style={{ marginLeft: 6, color: "#7a8a94" }}>· Reviewed by {doc.reviewedBy}</span>}
                </div>
              </div>
              {/* Status badge */}
              <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${sc.color}14`, color: sc.color, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 3 }}>
                {sc.icon} {sc.label}
              </span>
              {/* Has note indicator */}
              {doc.reviewNote && <span title={doc.reviewNote} style={{ fontSize: 12, color: "#e67e22" }}>💬</span>}
              {/* Expand indicator */}
              <span style={{ fontSize: 10, color: "#bdc3c7", transition: "transform 0.2s", transform: isSelected ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </div>
          );
        })}
      </div>

      {/* Review panel (expanded below the list) */}
      {selectedDoc && (
        <DocReviewPanel
          doc={selectedDoc}
          appDbId={appDbId}
          currentUser={currentUser}
          onClose={() => setSelectedDocId(null)}
          onDocUpdated={onDocUpdated}
        />
      )}
    </div>
  );
}
