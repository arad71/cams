import { useState } from "react";
import { CHECKLIST_CATEGORIES } from '../../data/constants';

// ─── Auto-assess a single checklist item ───────────────
export function autoAssessItem(id, app) {
  const p = app.property, cx = app.crossover, v = app.vegetation;
  const f = p.frontage, w = cx.width, mW = f <= 12.5 ? 4.5 : 6;
  const map = {
    owner_verified: app.owner.name ? "pass" : "fail",
    contact_details: app.owner.phone && app.owner.email ? "pass" : "fail",
    application_complete: app.owner.name && p.address && f ? "pass" : "review",
    fee_paid: "review", declaration_signed: "review",
    lot_identified: p.lot && p.plan ? "pass" : "fail",
    zoning_confirmed: p.lotType ? "pass" : "review",
    frontage_measured: f > 0 ? "pass" : "fail",
    existing_crossover: "pass",
    battleaxe_check: p.lotType?.includes("battleaxe") ? "review" : "pass",
    min_width: w >= 3 ? "pass" : "fail",
    max_width: w <= mW ? "pass" : "fail",
    road_edge_width: w <= 6 ? "pass" : "fail",
    dual_crossover: cx.count > 1 ? (f > 20 ? "pass" : "fail") : "pass",
    separation_dist: cx.count > 1 ? "review" : "pass",
    setback_boundary: cx.offsetFromLeft >= 0.5 && (f - cx.offsetFromLeft - w) >= 0.5 ? "pass" : "review",
    base_course: "review", surface_material: cx.surface ? "pass" : "review",
    concrete_joints: cx.surface?.includes("Concrete") ? "review" : "pass",
    commercial_spec: p.lotType?.includes("commercial") ? "review" : "pass",
    grade_alignment: "review", kerb_transition: "review",
    tree_clearance: v.treesNearby ? "review" : "pass",
    tree_protection: v.treesNearby ? "review" : "pass",
    no_clearing: v.clearing ? "fail" : "pass",
    dwer_permit: v.clearing ? "fail" : "pass",
    arborist_report: v.treesNearby ? "review" : "pass",
    drainage_type: v.drainage ? "pass" : "review",
    detention_ari: "review", culvert_design: v.culvert ? "review" : "pass",
    no_ponding: "review", stormwater_plan: "review",
    sight_triangle: "review", intersection_dist: "review",
    pedestrian_safety: "review", vehicle_turning: "review", driveway_grade: "review",
    road_class: p.roadType ? "pass" : "review",
    mrwa_referral: p.roadType === "red" ? (app.assessment.referral ? "pass" : "fail") : "pass",
    dplh_referral: p.roadType === "blue" ? (app.assessment.referral ? "pass" : "fail") : "pass",
    rav_clearance: p.roadType === "rav" ? "review" : "pass",
    speed_zone: "review",
    dbyd_completed: "review", power_clear: "review", water_clear: "review", gas_clear: "review", telco_clear: "review",
    site_plan: "review", cert_title: "review", photos_provided: "review",
    da_attached: cx.daNumber ? "review" : "pass",
    engineering_dwg: "review",
    first_crossover: cx.daNumber ? "fail" : "pass",
    contribution_calc: "pass",
    not_da_linked: cx.daNumber ? "fail" : "pass",
    receipts_info: "pass",
  };
  return map[id] || "review";
}

// ─── Approval Checklist UI ──────────────────────────────
export default function ApprovalChecklist({ app, checklist, setChecklist, onAssessAll }) {
  const [expandedCat, setExpandedCat] = useState(null);
  const [editNoteId, setEditNoteId] = useState(null);
  const [noteText, setNoteText] = useState("");

  const stats = { pass: 0, review: 0, fail: 0, total: 0, oApproved: 0, oRejected: 0, oPending: 0 };
  CHECKLIST_CATEGORIES.forEach(cat => cat.items.forEach(item => {
    const s = checklist[item.id];
    stats.total++;
    if (s?.auto === "pass") stats.pass++; else if (s?.auto === "fail") stats.fail++; else stats.review++;
    if (s?.officer === "approved") stats.oApproved++; else if (s?.officer === "rejected") stats.oRejected++; else stats.oPending++;
  }));
  const allDone = stats.oPending === 0 && stats.total > 0;
  const allPassed = allDone && stats.oRejected === 0;

  const setOfficer = (id, val) => setChecklist(p => ({ ...p, [id]: { ...p[id], officer: val, officerBy: "M. Thompson", officerDate: new Date().toISOString().split("T")[0] } }));
  const saveNote = (id) => { if (!noteText.trim()) return; setChecklist(p => ({ ...p, [id]: { ...p[id], note: noteText, noteBy: "M. Thompson", noteDate: new Date().toISOString().split("T")[0] } })); setNoteText(""); setEditNoteId(null); };

  const ac = { pass: "#27ae60", review: "#e67e22", fail: "#c0392b" };
  const ai2 = { pass: "✓", review: "?", fail: "✕" };
  const al = { pass: "PASS", review: "REVIEW", fail: "FAIL" };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #eef2f4", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafb", flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#1a3a4a" }}>Approval Checklist</span>
          <span style={{ fontSize: 10, color: "#95a5a6" }}>v3.1 — {stats.total} items</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[["pass", stats.pass], ["review", stats.review], ["fail", stats.fail]].map(([k, v]) => (
            <span key={k} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${ac[k]}12`, color: ac[k] }}>{v} {al[k]}</span>
          ))}
          <button onClick={onAssessAll} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>🤖 Auto-Assess</button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ padding: "6px 16px", borderBottom: "1px solid #eef2f4", background: "#fafcfd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Officer Sign-Off</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: allPassed ? "#27ae60" : "#1a3a4a" }}>{stats.oApproved + stats.oRejected}/{stats.total}</span>
        </div>
        <div style={{ height: 5, background: "#eef2f4", borderRadius: 3, overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${(stats.oApproved / Math.max(stats.total, 1)) * 100}%`, background: "#27ae60", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oRejected / Math.max(stats.total, 1)) * 100}%`, background: "#e74c3c", transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 9, color: "#95a5a6" }}>
          <span>🟢 {stats.oApproved}</span><span>🔴 {stats.oRejected}</span><span>⬜ {stats.oPending}</span>
        </div>
      </div>

      {/* Categories */}
      {CHECKLIST_CATEGORIES.map(cat => {
        const exp = expandedCat === cat.id;
        const cf = cat.items.filter(i => checklist[i.id]?.auto === "fail" || checklist[i.id]?.officer === "rejected").length;
        const co = cat.items.filter(i => checklist[i.id]?.officer).length;
        return (
          <div key={cat.id}>
            <div onClick={() => setExpandedCat(exp ? null : cat.id)}
              style={{ padding: "9px 16px", borderBottom: "1px solid #f0f3f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: exp ? "#f5f8fa" : "transparent" }}
              onMouseEnter={e => { if (!exp) e.currentTarget.style.background = "#fafcfd"; }} onMouseLeave={e => { if (!exp) e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14 }}>{cat.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: "#1a3a4a" }}>{cat.label}</span>
                <span style={{ fontSize: 10, color: "#b0bdb2" }}>({cat.items.length})</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {cf > 0 && <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: "#fdedec", color: "#c0392b" }}>{cf}!</span>}
                <span style={{ fontSize: 10, fontWeight: 600, color: co === cat.items.length ? "#27ae60" : "#95a5a6" }}>{co}/{cat.items.length}</span>
                <span style={{ fontSize: 11, color: "#b0bdb2", transform: exp ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
              </div>
            </div>
            {exp && cat.items.map(item => {
              const s = checklist[item.id] || {};
              return (
                <div key={item.id} style={{ padding: "9px 16px 9px 44px", borderBottom: "1px solid #f5f7f8", background: s.officer === "rejected" ? "#fef5f5" : s.officer === "approved" ? "#f7fdf8" : "#fff" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {/* Auto badge */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 36 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800,
                        background: s.auto ? `${ac[s.auto]}12` : "#f0f3f5", color: s.auto ? ac[s.auto] : "#ccc", border: `1.5px solid ${s.auto ? ac[s.auto] + "60" : "#dde3de"}` }}>
                        {s.auto ? ai2[s.auto] : "—"}
                      </div>
                      <span style={{ fontSize: 7, fontWeight: 700, color: s.auto ? ac[s.auto] : "#ccc" }}>{s.auto ? al[s.auto] : ""}</span>
                    </div>
                    {/* Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", lineHeight: 1.3 }}>{item.label}</div>
                      <div style={{ fontSize: 9, color: "#b0bdb2" }}>{item.ref}</div>
                      {s.note && <div style={{ marginTop: 3, padding: "3px 7px", background: "#fef9e7", borderRadius: 3, fontSize: 10, color: "#7d6608", lineHeight: 1.3 }}>💬 {s.note} <span style={{ color: "#c4a44a" }}>— {s.noteBy}, {s.noteDate}</span></div>}
                      {editNoteId === item.id && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === "Enter" && saveNote(item.id)} placeholder="Note..." style={{ flex: 1, padding: "3px 7px", borderRadius: 3, border: "1px solid #d5dde2", fontSize: 10, fontFamily: "inherit", outline: "none" }} autoFocus />
                          <button onClick={() => saveNote(item.id)} style={{ padding: "3px 7px", borderRadius: 3, border: "none", background: "#1a3a4a", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>OK</button>
                          <button onClick={() => setEditNoteId(null)} style={{ padding: "3px 5px", borderRadius: 3, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, color: "#95a5a6", cursor: "pointer" }}>✕</button>
                        </div>
                      )}
                    </div>
                    {/* Officer buttons */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 110, flexShrink: 0 }}>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[["approved", "✓ OK", "#27ae60"], ["rejected", "✕ No", "#c0392b"]].map(([val, lbl, clr]) => (
                          <button key={val} onClick={() => setOfficer(item.id, val)}
                            style={{ padding: "3px 9px", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                              border: s.officer === val ? `2px solid ${clr}` : "1px solid #d5dde2",
                              background: s.officer === val ? `${clr}10` : "#fff",
                              color: s.officer === val ? clr : "#95a5a6" }}>
                            {lbl}
                          </button>
                        ))}
                        <button onClick={() => { setEditNoteId(editNoteId === item.id ? null : item.id); setNoteText(s.note || ""); }}
                          style={{ padding: "3px 5px", borderRadius: 4, border: "1px solid #d5dde2", background: s.note ? "#fef9e7" : "#fff", color: "#95a5a6", fontSize: 10, cursor: "pointer" }}>💬</button>
                      </div>
                      {s.officer && <span style={{ fontSize: 8, color: "#b0bdb2" }}>{s.officerBy} {s.officerDate}</span>}
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
          <div style={{ fontWeight: 800, fontSize: 12, color: allPassed ? "#1e8449" : allDone ? "#c0392b" : "#5a6a74" }}>
            {allPassed ? "✅ ALL ITEMS APPROVED — Ready for final decision" : allDone ? "❌ ITEMS REJECTED — Cannot approve without resolution" : `⏳ ${stats.oPending} items awaiting officer review`}
          </div>
          {allDone && <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 1 }}>{stats.oApproved} approved, {stats.oRejected} rejected of {stats.total}</div>}
        </div>
        {!allDone && (
          <button onClick={() => {
            const u = { ...checklist };
            CHECKLIST_CATEGORIES.forEach(c => c.items.forEach(i => {
              if (u[i.id] && !u[i.id].officer) u[i.id] = { ...u[i.id], officer: u[i.id].auto === "pass" ? "approved" : "rejected", officerBy: "M. Thompson", officerDate: new Date().toISOString().split("T")[0] };
            }));
            setChecklist(u);
          }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#7f8c8d", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
            Auto-decide remaining
          </button>
        )}
      </div>
    </div>
  );
}
