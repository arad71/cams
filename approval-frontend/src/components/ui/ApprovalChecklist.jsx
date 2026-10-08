import { useState, useEffect, useCallback } from "react";
import api from '../../services/api';
import { T, S, cx } from '../../styles/tokens';

// ─── Approval Checklist UI (API-connected) ─────────────
export default function ApprovalChecklist({ app, categories = [], currentUser }) {
  const [assessments, setAssessments] = useState([]); // CaseAssessmentOut[] from API
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [editNoteId, setEditNoteId] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(null); // item_id being saved
  const [filter, setFilter] = useState("all"); // all | ai_fail | ai_review | pending | rejected

  const appDbId = app?._dbId;

  // Load assessments from API
  const loadAssessments = useCallback(async () => {
    if (!appDbId) return;
    try {
      const data = await api.listAssessments(appDbId);
      setAssessments(data || []);
    } catch (e) {
      console.error("Load assessments failed:", e);
      setAssessments([]);
    }
    setLoading(false);
  }, [appDbId]);

  useEffect(() => { loadAssessments(); }, [loadAssessments]);

  // Build lookup: item_code → assessment record
  const byCode = {};
  assessments.forEach(a => { if (a.item_code) byCode[a.item_code] = a; });

  // Stats
  const stats = { pass: 0, review: 0, fail: 0, total: 0, oApproved: 0, oRejected: 0, oNA: 0, oReferred: 0, oInvestigation: 0, oPending: 0 };
  categories.forEach(cat => (cat.items || []).forEach(item => {
    const a = byCode[item.code];
    stats.total++;
    if (a?.ai_result === "pass") stats.pass++; else if (a?.ai_result === "fail") stats.fail++; else stats.review++;
    if (a?.officer_result === "approved") stats.oApproved++;
    else if (a?.officer_result === "rejected") stats.oRejected++;
    else if (a?.officer_result === "not_required") stats.oNA++;
    else if (a?.officer_result === "referred") stats.oReferred++;
    else if (a?.officer_result === "investigation") stats.oInvestigation++;
    else stats.oPending++;
  }));
  const oDecided = stats.total - stats.oPending;
  const allDone = stats.oPending === 0 && stats.total > 0;
  const allPassed = allDone && stats.oRejected === 0 && stats.oInvestigation === 0;

  // Run Auto-Assess (backend rule engine)
  const runAutoAssess = async () => {
    if (!appDbId) return;
    setSaving("auto");
    try {
      await api.runAIAssess(appDbId);
      await loadAssessments();
    } catch (e) { console.error("Auto-assess failed:", e); }
    setSaving(null);
  };

  // Save officer decision to API
  const setOfficer = async (itemId, val) => {
    if (!appDbId || !itemId) { console.warn("Cannot save: missing appDbId or itemId", { appDbId, itemId }); return; }
    setSaving(itemId);
    try {
      await api.updateAssessment(appDbId, itemId, { officer_result: val });
      await loadAssessments();
    } catch (e) { console.error("Officer decision failed:", e); }
    setSaving(null);
  };

  // Save note to API
  const saveNote = async (itemId) => {
    if (!noteText.trim() || !appDbId || !itemId) { console.warn("Cannot save note: missing data", { appDbId, itemId }); return; }
    setSaving(itemId);
    try {
      await api.updateAssessment(appDbId, itemId, { note: noteText.trim() });
      await loadAssessments();
      setNoteText("");
      setEditNoteId(null);
    } catch (e) { console.error("Save note failed:", e); }
    setSaving(null);
  };

  // Bulk officer decision
  const bulkDecide = async () => {
    if (!appDbId) return;
    setSaving("bulk");
    try {
      // Approve items with AI pass, reject items with AI fail
      await api.bulkOfficerDecision(appDbId, "pass", "approved");
      await api.bulkOfficerDecision(appDbId, "fail", "rejected");
      await api.bulkOfficerDecision(appDbId, "review", "rejected");
      await loadAssessments();
    } catch (e) { console.error("Bulk decide failed:", e); }
    setSaving(null);
  };

  // Bulk accept all AI-pass items
  const acceptAllAIPass = async () => {
    if (!appDbId) return;
    setSaving("acceptAll");
    try {
      await api.bulkOfficerDecision(appDbId, "pass", "approved");
      await loadAssessments();
    } catch (e) { console.error("Accept all AI pass failed:", e); }
    setSaving(null);
  };

  const ac = { pass: "#27ae60", review: "#e67e22", fail: "#c0392b" };
  const ai2 = { pass: "✓", review: "?", fail: "✕" };
  const al = { pass: "PASS", review: "REVIEW", fail: "FAIL" };

  // Filter items
  const matchesFilter = (item) => {
    if (filter === "all") return true;
    const a = byCode[item.code];
    if (filter === "ai_fail") return a?.ai_result === "fail";
    if (filter === "ai_review") return a?.ai_result === "review";
    if (filter === "pending") return !a?.officer_result;
    if (filter === "rejected") return a?.officer_result === "rejected";
    return true;
  };

  // Count filtered items per category
  const filteredCounts = {};
  categories.forEach(cat => {
    filteredCounts[cat.code] = (cat.items || []).filter(matchesFilter).length;
  });

  if (loading) return <div style={{ padding: 20, color: T.c.textSecondary, textAlign: "center" }}>Loading assessments...</div>;

  return (
    <div style={{ background: T.c.card, borderRadius: 12, border: `1px solid ${T.c.borderLight}`, overflow: "hidden", boxShadow: "0 1px 3px rgba(26,58,74,0.04)" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.c.borderLight}`, background: "#f8fafb" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>📋</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: T.c.text, letterSpacing: "-0.01em" }}>Assessment Checklist</span>
            <span style={{ fontSize: 12, color: T.c.textMuted, fontWeight: 500 }}>{stats.total} items</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <button onClick={runAutoAssess} disabled={saving === "auto"}
              style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 600, fontSize: 12, cursor: saving === "auto" ? "wait" : "pointer", fontFamily: "inherit", opacity: saving === "auto" ? 0.6 : 1, boxShadow: "0 1px 4px rgba(26,188,156,0.25)", transition: "all 0.15s" }}>
              {saving === "auto" ? "⟳ Running..." : "🤖 Auto-Assess"}
            </button>
            {stats.pass > 0 && stats.oPending > 0 && (
              <button onClick={acceptAllAIPass} disabled={saving === "acceptAll"}
                style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#27ae60", color: "#fff", fontWeight: 600, fontSize: 12, cursor: saving === "acceptAll" ? "wait" : "pointer", fontFamily: "inherit", opacity: saving === "acceptAll" ? 0.6 : 1, boxShadow: "0 1px 4px rgba(39,174,96,0.25)" }}>
                {saving === "acceptAll" ? "⟳ ..." : `✓ Accept ${stats.pass} AI Pass`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar + stats */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${T.c.borderLight}`, background: "#fdfdfe" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 10, fontSize: 12, fontWeight: 600 }}>
            <span style={{ color: "#27ae60" }}>● {stats.pass} pass</span>
            <span style={{ color: "#e67e22" }}>● {stats.review} review</span>
            <span style={{ color: "#c0392b" }}>● {stats.fail} fail</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: allPassed ? "#27ae60" : T.c.textSecondary }}>Officer: {oDecided}/{stats.total}</span>
        </div>
        <div style={{ height: 5, background: "#eef1f3", borderRadius: 5, overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${(stats.oApproved / Math.max(stats.total, 1)) * 100}%`, background: "#27ae60", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oNA / Math.max(stats.total, 1)) * 100}%`, background: "#7f8c8d", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oReferred / Math.max(stats.total, 1)) * 100}%`, background: "#8e44ad", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oInvestigation / Math.max(stats.total, 1)) * 100}%`, background: "#2980b9", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oRejected / Math.max(stats.total, 1)) * 100}%`, background: "#e74c3c", transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ padding: "4px 16px", borderBottom: `1px solid ${T.c.borderLight}`, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[
          { id: "all", label: "All", count: stats.total },
          { id: "ai_fail", label: "AI Fail", count: stats.fail, color: "#c0392b" },
          { id: "ai_review", label: "AI Review", count: stats.review, color: "#e67e22" },
          { id: "pending", label: "Pending", count: stats.oPending, color: "#5a6a74" },
          { id: "rejected", label: "Rejected", count: stats.oRejected, color: "#c0392b" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            style={{ padding: "2px 8px", borderRadius: 10, border: filter === f.id ? `1.5px solid ${f.color || "#1a3a4a"}` : "1px solid #e4e9ec", background: filter === f.id ? `${f.color || "#1a3a4a"}10` : "#fff", color: filter === f.id ? (f.color || "#1a3a4a") : "#7a8a94", fontSize: 12, fontWeight: filter === f.id ? 700 : 500, cursor: "pointer", fontFamily: "inherit" }}>
            {f.label} {f.count > 0 && <span style={{ fontWeight: 700 }}>({f.count})</span>}
          </button>
        ))}
      </div>

      {/* Categories */}
      {categories.map(cat => {
        const catItems = (cat.items || []).filter(matchesFilter);
        if (filter !== "all" && catItems.length === 0) return null; // Hide empty categories when filtered
        const exp = expandedCat === cat.code || (filter !== "all" && catItems.length > 0); // Auto-expand when filtered
        const allCatItems = cat.items || [];
        const cf = allCatItems.filter(i => byCode[i.code]?.ai_result === "fail" || byCode[i.code]?.officer_result === "rejected").length;
        const co = allCatItems.filter(i => byCode[i.code]?.officer_result).length;
        return (
          <div key={cat.code}>
            <div onClick={() => setExpandedCat(exp && filter === "all" ? null : cat.code)}
              style={{ padding: "8px 16px", borderBottom: `1px solid ${T.c.borderLight}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: exp ? "#f5f8fa" : "transparent" }}
              onMouseEnter={e => { if (!exp) e.currentTarget.style.background = "#fafcfd"; }} onMouseLeave={e => { if (!exp) e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>{cat.icon}</span>
                <span style={{ fontWeight: T.w.bold, fontSize: 12, color: T.c.text }}>{cat.label}</span>
                <span style={{ fontSize: 12, color: "#6b7b85" }}>({filter !== "all" ? `${catItems.length}/` : ""}{allCatItems.length})</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {cf > 0 && <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 12, fontWeight: T.w.bold, background: T.c.dangerLight, color: "#c0392b" }}>{cf}!</span>}
                <span style={{ fontSize: 12, fontWeight: T.w.semi, color: co === allCatItems.length ? "#27ae60" : "#95a5a6" }}>{co}/{allCatItems.length}</span>
                <span style={{ fontSize: 12, color: "#6b7b85", transform: exp ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
              </div>
            </div>
            {exp && catItems.map(item => {
              const a = byCode[item.code] || {};
              const isSaving = saving === a.item_id;
              return (
                <div key={item.code} style={{ padding: "9px 16px 9px 44px", borderBottom: "1px solid #f5f7f8", background: a.officer_result === "rejected" ? "#fef5f5" : a.officer_result === "approved" ? "#f7fdf8" : a.officer_result === "referred" ? "#f9f0fc" : a.officer_result === "investigation" ? "#eef5fb" : a.officer_result === "not_required" ? "#f5f5f5" : "#fff", opacity: isSaving ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {/* Auto badge */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 36 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: T.w.black,
                        background: a.ai_result ? `${ac[a.ai_result]}12` : T.c.borderLight, color: a.ai_result ? ac[a.ai_result] : "#ccc", border: `1.5px solid ${a.ai_result ? ac[a.ai_result] + "60" : "#dde3de"}` }}>
                        {a.ai_result ? ai2[a.ai_result] : "—"}
                      </div>
                      <span style={{ fontSize: 7, fontWeight: T.w.bold, color: a.ai_result ? ac[a.ai_result] : "#ccc" }}>{a.ai_result ? al[a.ai_result] : ""}</span>
                    </div>
                    {/* Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: T.w.semi, color: T.c.text, lineHeight: 1.3 }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: "#6b7b85" }}>{item.reference}</div>
                      {a.ai_reason && <div style={{ marginTop: 2, fontSize: 12, color: T.c.grey800, lineHeight: 1.3 }}>🤖 {a.ai_reason}</div>}
                      {a.ai_confidence != null && <div style={{ marginTop: 1, fontSize: 12, color: T.c.textMuted }}>Confidence: {(a.ai_confidence * 100).toFixed(0)}%</div>}
                      {a.note && (
                        <div style={{ marginTop: 3, padding: "3px 7px", background: T.c.warningLight, borderRadius: 3, fontSize: 12, color: "#7d6608", lineHeight: 1.3 }}>
                          💬 {a.note} {a.note_by_name && <span style={{ color: "#c4a44a" }}>— {a.note_by_name}{a.note_at ? ", " + a.note_at.split("T")[0] : ""}</span>}
                        </div>
                      )}
                      {editNoteId === item.code && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === "Enter" && saveNote(a.item_id)} placeholder="Add a note..." style={{ flex: 1, padding: "3px 7px", borderRadius: 3, border: "1px solid #d5dde2", fontSize: 12, fontFamily: "inherit", outline: "none" }} autoFocus />
                          <button onClick={() => saveNote(a.item_id)} style={{ padding: "3px 7px", borderRadius: 3, border: "none", background: "#1a3a4a", color: T.c.white, fontSize: 12, fontWeight: T.w.bold, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
                          <button onClick={() => setEditNoteId(null)} style={{ padding: "3px 5px", borderRadius: 3, border: "1px solid #d5dde2", background: T.c.card, fontSize: 12, color: T.c.textMuted, cursor: "pointer" }}>✕</button>
                        </div>
                      )}
                    </div>
                    {/* Officer buttons */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 160, flexShrink: 0 }}>
                      {!a.item_id ? (
                        <span style={{ fontSize: 12, color: T.c.textMuted, fontStyle: "italic" }}>Run Auto-Assess first</span>
                      ) : (
                      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {[
                          ["approved", "✓ OK", "#27ae60"],
                          ["rejected", "✕ No", "#c0392b"],
                          ["not_required", "N/A", "#7f8c8d"],
                          ["referred", "↗ Refer", "#8e44ad"],
                          ["investigation", "🔍 Investigate", "#2980b9"],
                        ].map(([val, lbl, clr]) => (
                          <button key={val} onClick={() => setOfficer(a.item_id, val)} disabled={isSaving}
                            style={{ padding: "3px 7px", borderRadius: T.r.sm, fontSize: 12, fontWeight: T.w.bold, cursor: isSaving ? "wait" : "pointer", fontFamily: "inherit", transition: "all 0.15s",
                              border: a.officer_result === val ? `2px solid ${clr}` : "1px solid #d5dde2",
                              background: a.officer_result === val ? `${clr}10` : "#fff",
                              color: a.officer_result === val ? clr : "#95a5a6" }}>
                            {lbl}
                          </button>
                        ))}
                        <button onClick={() => { setEditNoteId(editNoteId === item.code ? null : item.code); setNoteText(a.note || ""); }}
                          style={{ padding: "3px 5px", borderRadius: T.r.sm, border: "1px solid #d5dde2", background: a.note ? "#fef9e7" : "#fff", color: T.c.textMuted, fontSize: 12, cursor: "pointer" }}>💬</button>
                      </div>
                      )}
                      {a.officer_result && a.officer_name && <span style={{ fontSize: 12, color: "#6b7b85" }}>{a.officer_name} {a.officer_assessed_at ? a.officer_assessed_at.split("T")[0] : ""}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Final sign-off bar */}
      <div style={{ padding: "12px 16px", borderTop: "2px solid #eef2f4", background: allPassed ? "#eafaf1" : allDone ? "#fdedec" : "#f8fafb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: T.w.black, fontSize: 13, color: allPassed ? "#1e8449" : allDone ? "#c0392b" : "#5a6a74" }}>
            {allPassed ? "✅ ALL ITEMS CLEARED — Ready for final decision"
              : allDone && stats.oReferred > 0 ? `↗️ ${stats.oReferred} item${stats.oReferred > 1 ? "s" : ""} referred — awaiting external response`
              : allDone && stats.oInvestigation > 0 ? `🔍 ${stats.oInvestigation} item${stats.oInvestigation > 1 ? "s" : ""} under investigation`
              : allDone ? "❌ ITEMS REJECTED — Cannot approve without resolution"
              : `⏳ ${stats.oPending} items awaiting officer review`}
          </div>
          {allDone && <div style={{ fontSize: 12, color: T.c.textSecondary, marginTop: 1 }}>{stats.oApproved} approved, {stats.oRejected} rejected, {stats.oNA} N/A, {stats.oReferred} referred, {stats.oInvestigation} investigating — of {stats.total}</div>}
        </div>
        {!allDone && (
          <button onClick={bulkDecide} disabled={saving === "bulk"}
            style={{ padding: "5px 12px", borderRadius: T.r.md, border: "none", background: "#7f8c8d", color: T.c.white, fontWeight: T.w.bold, fontSize: 12, cursor: saving === "bulk" ? "wait" : "pointer", fontFamily: "inherit", opacity: saving === "bulk" ? 0.6 : 1 }}>
            {saving === "bulk" ? "⟳ Processing..." : "Auto-decide remaining"}
          </button>
        )}
      </div>
    </div>
  );
}
