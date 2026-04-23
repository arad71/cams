import { useState, useEffect, useCallback } from "react";
import api from '../../services/api';
import { STATUS_CONFIG, ROLE_CONFIG } from '../../data/constants';
import StatusBadge from '../ui/StatusBadge';
import MapWithOverlay from '../map/MapWithOverlay';
import DocumentList from '../ui/DocumentList';
import ApprovalChecklist from '../ui/ApprovalChecklist';
import AIExtractionReview from '../ui/AIExtractionReview';
import ReportGenerator from '../ui/ReportGenerator';
import MobileInspection from '../ui/MobileInspection';

// ─── Workflow Steps ─────────────────────────────────────
const STEPS = [
  { id: 1, key: "submit",   label: "Submit",   icon: "📋", color: "#085041", bg: "#E1F5EE", desc: "Documents uploaded · AI extraction complete · Auto-assessed" },
  { id: 2, key: "review",   label: "Review",   icon: "🔍", color: "#534AB7", bg: "#EEEDFE", desc: "Verify AI extractions · Correct errors · Accept/reject items" },
  { id: 3, key: "analyse",  label: "Analyse",  icon: "📐", color: "#185FA5", bg: "#E6F1FB", desc: "Sight triangle · Utility clearance · Measure on map" },
  { id: 4, key: "decision", label: "Decision", icon: "✅", color: "#993C1D", bg: "#FAECE7", desc: "Approve · Reject · Request information · Generate report" },
];

function statusToStep(status) {
  switch (status) {
    case "pending_review": return 1;
    case "under_assessment": return 2;
    case "referral_pending": return 3;
    case "inspection_required": return 3;
    case "approved": return 4;
    case "rejected": return 4;
    case "on_hold": return 2;
    default: return 1;
  }
}

// ─── Compact card style helpers ─────────────────────────
import { T, S, cx } from '../../styles/tokens';
const card = S.cardFlat;
const cardHdr = S.cardHeader;
const cardBody = S.cardBody;
const kvRow = { display: "flex", justifyContent: "space-between", padding: `${T.s.xs}px 0`, borderBottom: `1px solid ${T.c.grey50}`, fontSize: T.f.md };

// ─── Step Completion Stats ──────────────────────────────
function getStepStats(app, assessments = []) {
  const docs = app.documents || [];
  const spd = app?.cor_site_plan_data || app?.site_plan_data;
  const hasSitePlan = docs.some(d => (d.category || "").includes("Site"));
  const hasAppForm = docs.some(d => (d.category || "").includes("Application"));
  const aiExtracted = !!spd?.extraction || !!spd?.crossover_dimensions;
  let aPass = 0, aFail = 0, aReview = 0, aTotal = 0, oDone = 0;
  assessments.forEach(a => { aTotal++; if (a.ai_result === "pass") aPass++; else if (a.ai_result === "fail") aFail++; else aReview++; if (a.officer_result && a.officer_result !== "pending") oDone++; });
  const status = app.status || "pending_review";
  const isDecided = ["approved", "rejected", "conditionally_approved"].includes(status);
  return {
    submit:   { badge: `${docs.length} doc${docs.length !== 1 ? "s" : ""}`, alert: !hasSitePlan ? "No site plan" : null, done: docs.length >= 1 && hasSitePlan },
    review:   { badge: aiExtracted ? `${aPass}✓ ${aFail}✗ ${aReview}?` : "Awaiting", alert: aFail > 0 ? `${aFail} failed` : null, done: aTotal > 0 && oDone > 0 },
    analyse:  { badge: aiExtracted ? "Ready" : "Needs data", alert: null, done: aTotal > 0 && aFail === 0 && aReview === 0 },
    decision: { badge: isDecided ? status.replace(/_/g, " ") : "Pending", alert: null, done: isDecided },
  };
}

// ─── Collapsible Section ───────────────────────────────
function CollapsibleSection({ title, icon, defaultOpen = true, badge, color = "#1a3a4a", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 12 }}>
      <div onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          background: open ? `${color}08` : "#f8fafb", borderRadius: open ? "10px 10px 0 0" : 10,
          border: `1px solid ${open ? color + "20" : "#e8ecef"}`,
          borderBottom: open ? "none" : undefined,
          cursor: "pointer", transition: "all 0.2s ease", userSelect: "none",
        }}>
        <span style={{ fontSize: 12, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: open ? color : "#5a6a74", flex: 1 }}>{title}</span>
        {badge && <span style={{ fontSize: 9, fontWeight: 600, color: "#7a8a94", background: "#f0f3f5", padding: "2px 8px", borderRadius: 10 }}>{badge}</span>}
      </div>
      {open && (
        <div style={{ border: `1px solid ${color}20`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: 1, background: "#fff" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Workflow Stepper — Professional vertical sidebar ─────────────
function Stepper({ currentStep, completedUpTo, onStepClick, stepStats }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {STEPS.map((step, i) => {
        const done = step.id < completedUpTo;
        const active = step.id === currentStep;
        const future = step.id > completedUpTo && !active;
        const stats = stepStats?.[step.key];
        const hasAlert = stats?.alert;
        return (
          <div key={step.id}>
            <div onClick={() => onStepClick(step.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer",
                borderRadius: 10,
                background: active ? step.bg : "transparent",
                border: active ? `1.5px solid ${step.color}25` : "1.5px solid transparent",
                transition: "all 0.2s ease",
                opacity: future ? 0.45 : 1,
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "#f5f7fa"; e.currentTarget.style.transform = "translateX(2px)"; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "none"; } }}>
              {/* Step circle */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: done ? 12 : 13,
                  fontWeight: T.w.bold,
                  background: active ? step.color : done ? "#085041" : "#f0f3f5",
                  color: active || done ? "#fff" : "#b0bec5",
                  border: "none",
                  boxShadow: active ? `0 2px 8px ${step.color}40` : done ? "0 1px 3px rgba(8,80,65,0.2)" : "none",
                  transition: "all 0.2s ease",
                }}>
                  {done ? "✓" : step.icon}
                </div>
                {hasAlert && <div style={{ position: "absolute", top: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: "#e74c3c", border: "2px solid #fff" }} />}
              </div>
              {/* Step text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: active ? 700 : done ? 600 : 500,
                  color: active ? step.color : done ? "#085041" : "#95a5a6",
                  lineHeight: 1.2, letterSpacing: active ? "0.01em" : 0,
                }}>
                  {step.label}
                </div>
                {stats && (
                  <div style={{
                    fontSize: 9, marginTop: 2, fontWeight: 600,
                    color: hasAlert ? "#e74c3c" : stats.done ? "#27ae60" : active ? step.color + "99" : "#b0bec5",
                  }}>
                    {hasAlert || stats.badge}
                  </div>
                )}
              </div>
            </div>
            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div style={{
                marginLeft: 25, width: 2, height: 12,
                background: done || active ? `linear-gradient(${step.color}60, ${STEPS[i + 1].color}60)` : "#e8ecef",
                borderRadius: 1,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}


// ─── Sidebar ────────────────────────────────────────────
function WorkflowSidebar({ app, currentUser, users, categories, onReload, newNote, setNewNote, addNote, assignee, setAssignee, newStatus, setNewStatus, saveChanges, canAssign, canDecide, onInspect, auditLog = [], stepStats = {} }) {
  const docs = app.documents || [];
  const spd = app?.cor_site_plan_data || app?.site_plan_data;
  const ext = spd?.extraction || spd || {};
  const dims = ext?.crossover_dimensions || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Key Metrics */}
      <div style={card}>
        <div style={cardHdr}><span>📊 Key Metrics</span></div>
        <div style={{ padding: "8px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {[
            { l: "Width", v: dims.width_at_boundary_m ? `${dims.width_at_boundary_m}m` : "—", ok: dims.width_at_boundary_m >= 3.0 },
            { l: "Road Width", v: dims.total_width_at_road_m ? `${dims.total_width_at_road_m}m` : "—", ok: dims.total_width_at_road_m <= 6.0 },
            { l: "L Boundary", v: dims.distance_to_left_boundary_m != null ? `${dims.distance_to_left_boundary_m}m` : "—", ok: dims.distance_to_left_boundary_m >= 0.5 },
            { l: "R Boundary", v: dims.distance_to_right_boundary_m != null ? `${dims.distance_to_right_boundary_m}m` : "—", ok: dims.distance_to_right_boundary_m >= 0.5 },
          ].map(m => (
            <div key={m.l} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 10 }}>
              <span style={{ color: T.c.textSecondary }}>{m.l}</span>
              <span style={{ fontWeight: T.w.bold, color: m.v === "—" ? T.c.grey400 : m.ok ? "#27ae60" : "#e74c3c" }}>{m.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Field Inspection button */}
      <div style={card}>
        <div style={{ padding: "10px 12px", display: "flex", gap: 8 }}>
          <button onClick={() => onInspect && onInspect("Pre-construction")}
            style={{ flex: 1, padding: "8px 0", borderRadius: T.r.md, border: "none", background: "linear-gradient(135deg, #e67e22, #f39c12)", color: T.c.white, fontWeight: T.w.bold, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🔍 Pre-Inspect
          </button>
          <button onClick={() => onInspect && onInspect("Post-construction")}
            style={{ flex: 1, padding: "8px 0", borderRadius: T.r.md, border: "none", background: "linear-gradient(135deg, #27ae60, #2ecc71)", color: T.c.white, fontWeight: T.w.bold, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🔍 Post-Inspect
          </button>
        </div>
        {(app.inspections || []).length > 0 && (
          <div style={{ padding: "0 12px 8px", fontSize: 10, color: T.c.textSecondary }}>
            {(app.inspections || []).map((insp, i) => {
              const fc = insp.field_checklist || {};
              const photos = insp.photos || [];
              const passCount = Object.values(fc).filter(v => v.result === "pass").length;
              const failCount = Object.values(fc).filter(v => v.result === "fail").length;
              const statusColor = insp.status === "passed" ? "#27ae60" : insp.status === "failed" ? "#e74c3c" : "#3498db";
              return (
                <details key={i} style={{ marginBottom: 4 }}>
                  <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", padding: "3px 0", listStyle: "none" }}>
                    <span>{insp.inspection_type}</span>
                    <span style={{ fontWeight: T.w.bold, color: statusColor }}>{insp.status} {passCount > 0 && `(${passCount}✓ ${failCount}✕)`}</span>
                  </summary>
                  <div style={{ padding: "4px 0 4px 8px", borderLeft: `2px solid ${statusColor}`, marginTop: 2 }}>
                    {/* Checklist summary */}
                    {Object.entries(fc).map(([code, data]) => (
                      <div key={code} style={{ display: "flex", gap: 4, alignItems: "center", padding: "1px 0" }}>
                        <span style={{ color: data.result === "pass" ? "#27ae60" : data.result === "fail" ? "#e74c3c" : "#95a5a6", fontWeight: T.w.bold }}>
                          {data.result === "pass" ? "✓" : data.result === "fail" ? "✕" : "—"}
                        </span>
                        <span style={{ flex: 1 }}>{code.replace(/_/g, " ")}</span>
                      </div>
                    ))}
                    {insp.notes && <div style={{ marginTop: 4, fontStyle: "italic", color: T.c.grey800 }}>{insp.notes}</div>}
                    {/* Photos */}
                    {photos.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                        {photos.map((p, j) => (
                          <a key={j} href={`/api/applications/${app._dbId}/inspections/${insp.id}/photos/${p.filename}`} target="_blank" rel="noreferrer"
                            style={{ width: 48, height: 48, borderRadius: T.r.sm, overflow: "hidden", border: "1px solid #d5dde2", display: "block" }}>
                            <img src={`/api/applications/${app._dbId}/inspections/${insp.id}/photos/${p.filename}`}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              alt={p.checklist_item || "inspection"} />
                          </a>
                        ))}
                      </div>
                    )}
                    {insp.gps_lat && (
                      <div style={{ marginTop: 4, fontSize: 9, color: T.c.textMuted }}>
                        GPS: {insp.gps_lat.toFixed(5)}, {insp.gps_lng?.toFixed(5)} ({insp.gps_accuracy_m?.toFixed(0)}m)
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>

      {/* Documents quick access */}
      <div style={card}>
        <div style={cardHdr}><span>📎 Documents ({docs.length})</span></div>
        <div style={{ maxHeight: 140, overflowY: "auto" }}>
          {docs.length === 0 && <div style={{ padding: 10, fontSize: 11, color: T.c.textMuted }}>No documents</div>}
          {docs.map(d => {
            const icons = { pdf: "📄", jpg: "🖼️", png: "🖼️", jpeg: "🖼️", doc: "📝", dwg: "📐" };
            const sc = { verified: { c: "#27ae60", l: "✓" }, rejected: { c: "#e74c3c", l: "✕" }, received: { c: "#3498db", l: "●" } };
            const st = sc[d.status] || sc.received;
            return (
              <div key={d.id} style={{ padding: "5px 12px", borderBottom: "1px solid #f8f9fb", display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ fontSize: 13 }}>{icons[d.type] || "📄"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, color: T.c.text }}>{d.name}</span>
                <span style={{ color: st.c, fontSize: 10, fontWeight: T.w.bold }}>{st.l}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI extraction summary */}
      {ext && Object.keys(ext).length > 0 && (
        <div style={card}>
          <div style={cardHdr}><span>🤖 AI Extraction</span></div>
          <div style={cardBody}>
            {[
              ["Width", ext.crossover_dimensions?.width_at_boundary_m ? ext.crossover_dimensions.width_at_boundary_m + "m" : null],
              ["Material", ext.construction?.material],
              ["Splays", ext.crossover_dimensions?.splay_left_m != null ? `${ext.crossover_dimensions.splay_left_m}m / ${ext.crossover_dimensions.splay_right_m}m` : null],
              ["Verge", ext.crossover_dimensions?.verge_depth_m ? ext.crossover_dimensions.verge_depth_m + "m" : null],
              ["Corner", ext.crossover_dimensions?.distance_to_nearest_lot_corner_m ? ext.crossover_dimensions.distance_to_nearest_lot_corner_m + "m" : null],
              ["Trees", ext.vegetation?.trees_nearby != null ? (ext.vegetation.trees_nearby ? "Yes" : "No") : null],
            ].filter(([, v]) => v != null).map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: T.c.textSecondary }}>{k}</span><span style={{ fontWeight: T.w.semi, color: T.c.text }}>{v}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment */}
      <div style={card}>
        <div style={cardHdr}><span>👤 Assignment</span></div>
        <div style={cardBody}>
          {canAssign ? (
            <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}>
              <option value="">— Unassigned —</option>
              {(users || []).filter(u => u.active && (u.role === "engineer" || u.role === "manager")).map(u => {
                const rc = ROLE_CONFIG[u.role];
                return <option key={u.id} value={u.name}>{rc?.icon} {u.name}</option>;
              })}
            </select>
          ) : (
            <div style={{ fontSize: 12, fontWeight: T.w.semi, color: T.c.text, marginBottom: 6 }}>{assignee || "Unassigned"}</div>
          )}
          {canDecide && (
            <>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ width: "100%", padding: "6px 8px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", marginBottom: 6 }}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <button onClick={saveChanges} style={{ width: "100%", padding: "6px", borderRadius: T.r.md, border: "none", background: "linear-gradient(135deg,#2980b9,#3498db)", color: T.c.white, fontWeight: T.w.bold, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      <div style={card}>
        <div style={cardHdr}><span>💬 Notes ({app.assessment?.notes?.length || 0})</span></div>
        <div style={{ maxHeight: 120, overflowY: "auto", padding: "6px 12px" }}>
          {(app.assessment?.notes || []).length === 0 && <div style={{ fontSize: 11, color: T.c.textMuted }}>No notes</div>}
          {(app.assessment?.notes || []).map((n, i) => (
            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #f5f7f8", fontSize: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: T.w.bold, color: T.c.info }}>{n.author}</span>
                <span style={{ color: T.c.textMuted, fontSize: 9 }}>{n.date}</span>
              </div>
              <div style={{ color: "#3a4a5a", lineHeight: 1.3 }}>{n.text}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 10px", borderTop: "1px solid #f0f3f5", display: "flex", gap: 4 }}>
          <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} placeholder="Add note..." style={{ flex: 1, padding: "5px 8px", borderRadius: 5, border: "1.5px solid #d5dde2", fontSize: 10, fontFamily: "inherit", outline: "none" }} />
          <button onClick={addNote} style={{ padding: "5px 10px", borderRadius: 5, border: "none", background: "#1a3a4a", color: T.c.white, fontWeight: T.w.bold, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>+</button>
        </div>
      </div>

      {/* Quick Decision */}
      {canDecide && (
        <div style={card}>
          <div style={cardHdr}><span>⚡ Quick Decision</span></div>
          <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { s: "approved", l: "✅ Approve", bg: "#27ae60" },
              { s: "inspection_required", l: "🔍 Inspect", bg: "#16a085" },
              { s: "referral_pending", l: "↗️ Refer", bg: "#8e44ad" },
              { s: "on_hold", l: "⏸ Hold", bg: "#7f8c8d" },
              { s: "rejected", l: "❌ Reject", bg: "#c0392b" },
            ].map(b => (
              <button key={b.s} onClick={async () => {
                try {
                  await api.updateApp(app._dbId, { status: b.s });
                  onReload();
                } catch (e) { console.error(e); }
              }}
                style={{ width: "100%", padding: "6px 10px", borderRadius: T.r.md, border: "none", background: b.bg, color: T.c.white, fontWeight: T.w.bold, fontSize: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                {b.l}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Activity Timeline */}
      {auditLog.length > 0 && (
        <div style={card}>
          <div style={cardHdr}><span>🕐 Activity Timeline</span></div>
          <div style={{ maxHeight: 260, overflowY: "auto", padding: "8px 12px" }}>
            {auditLog.slice(0, 20).map((log, i) => {
              const icons = { create: "🆕", update: "✏️", upload: "📤", extract: "🤖", view: "👁", download: "📥", rotate: "🔄", delete: "🗑", assess: "📋", correct: "📐", approve: "✅", reject: "❌" };
              const colors = { create: "#27ae60", upload: "#3498db", extract: "#8e44ad", delete: "#c0392b", assess: "#e67e22", correct: "#16a085", approve: "#27ae60", reject: "#c0392b", update: "#7a8a94" };
              const time = log.created_at ? new Date(log.created_at) : null;
              const timeStr = time ? `${time.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} ${time.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}` : "";
              const actionColor = colors[log.action] || "#7a8a94";
              const isLast = i === Math.min(auditLog.length, 20) - 1;
              return (
                <div key={i} style={{ display: "flex", gap: 8, position: "relative", paddingBottom: isLast ? 0 : 8 }}>
                  {/* Timeline line */}
                  {!isLast && <div style={{ position: "absolute", left: 9, top: 18, bottom: 0, width: 1.5, background: "#e4e9ec" }} />}
                  {/* Dot */}
                  <div style={{ width: 19, height: 19, borderRadius: "50%", background: `${actionColor}15`, border: `2px solid ${actionColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, flexShrink: 0, zIndex: 1 }}>
                    {icons[log.action] || "●"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                    <div style={{ color: T.c.text, fontWeight: 500, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
                      {log.description || log.action}
                    </div>
                    <div style={{ color: T.c.textMuted, fontSize: 8, marginTop: 1 }}>
                      {log.user_email?.split("@")[0] || "system"} · {timeStr}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StepUpload({ app, currentUser, onDocUpdated, onMeasureCorrection, onGeorefPoints }) {
  return (
    <div>
      {/* Info Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={card}>
          <div style={cardHdr}>Owner & Property</div>
          <div style={cardBody}>
            {[["Owner", app.owner?.name], ["Phone", app.owner?.phone], ["Email", app.owner?.email], ["Property", app.property?.address], ["Lot", `${app.property?.lot} (${app.property?.plan})`], ["Frontage", `${app.property?.frontage}m`], ["Road", `${app.property?.roadName} (${app.property?.roadType})`]].map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: T.c.textSecondary }}>{k}</span><span style={{ fontWeight: T.w.semi, color: T.c.text, textAlign: "right", maxWidth: "55%" }}>{v}</span></div>
            ))}
          </div>
        </div>
        <div style={card}>
          <div style={cardHdr}>Crossover & Vegetation</div>
          <div style={cardBody}>
            {[["Width", `${app.crossover?.width}m`], ["Count", app.crossover?.count], ["Surface", app.crossover?.surface], ["Offset", `${app.crossover?.offsetFromLeft}m`], ["Trees", app.vegetation?.treesNearby ? "Yes" : "No"], ["Clearing", app.vegetation?.clearing ? "⚠️ Yes" : "No"], ["Drainage", app.vegetation?.drainage]].map(([k, v]) => (
              <div key={k} style={kvRow}><span style={{ color: T.c.textSecondary }}>{k}</span><span style={{ fontWeight: T.w.semi, color: T.c.text }}>{v}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Documents */}
      <DocumentList documents={app.documents} appDbId={app._dbId} app={app} currentUser={currentUser}
        onDocUpdated={onDocUpdated} onMeasureCorrection={onMeasureCorrection} onGeorefPoints={onGeorefPoints} />
    </div>
  );
}

function StepExtract({ app, currentUser, onReload, measureCorrections, onMeasureCorrectionsApplied }) {
  return (
    <AIExtractionReview app={app} currentUser={currentUser}
      onReload={onReload} measureCorrections={measureCorrections}
      onMeasureCorrectionsApplied={onMeasureCorrectionsApplied} />
  );
}

function StepAssess({ app, apps, onSelectApp, globalSpeedRoads, globalLotsData, globalRoadNetwork, globalContoursData, globalUrbanForestData, globalDrainagePipesData, globalDrainagePitsData, globalWaterPipesData, globalPowerBuriedData, globalPowerOverheadData, globalPowerStructuresData, globalGasMainsData, globalGasValvesData, globalPowerTransformersData, globalPowerStreetlightsData, categories, currentUser, onMeasureCorrection, georefData, onGeorefDone, mode = "both" }) {
  return (
    <div>
      {(mode === "both" || mode === "map") && (
        <div style={{ marginBottom: mode === "both" ? 12 : 0 }}>
          <MapWithOverlay app={app} apps={apps} onSelectApp={onSelectApp}
            speedRoadsData={globalSpeedRoads} lotsData={globalLotsData} roadNetworkData={globalRoadNetwork}
            contoursData={globalContoursData} urbanForestData={globalUrbanForestData}
            drainagePipesData={globalDrainagePipesData} drainagePitsData={globalDrainagePitsData}
            waterPipesData={globalWaterPipesData}
            powerBuriedData={globalPowerBuriedData} powerOverheadData={globalPowerOverheadData}
            powerStructuresData={globalPowerStructuresData} gasMainsData={globalGasMainsData}
            gasValvesData={globalGasValvesData} powerTransformersData={globalPowerTransformersData}
            powerStreetlightsData={globalPowerStreetlightsData}
            onMeasureCorrection={onMeasureCorrection}
            georefData={georefData} onGeorefDone={onGeorefDone} />
        </div>
      )}
      {(mode === "both" || mode === "checklist") && (
        <ApprovalChecklist app={app} categories={categories} currentUser={currentUser} />
      )}
    </div>
  );
}

function StepReview({ app, categories, currentUser }) {
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!app?._dbId) return;
    api.listAssessments(app._dbId).then(d => { setAssessments(d || []); setLoading(false); }).catch(() => setLoading(false));
  }, [app?._dbId]);

  const stats = { total: 0, pass: 0, fail: 0, review: 0, oApproved: 0, oRejected: 0, oReferred: 0, oInvestigation: 0, oPending: 0 };
  const flagged = [];
  categories.forEach(cat => (cat.items || []).forEach(item => {
    const a = assessments.find(x => x.item_code === item.code) || {};
    stats.total++;
    if (a.ai_result === "pass") stats.pass++; else if (a.ai_result === "fail") stats.fail++; else stats.review++;
    if (a.officer_result === "approved") stats.oApproved++;
    else if (a.officer_result === "rejected") { stats.oRejected++; flagged.push({ item, a, type: "rejected" }); }
    else if (a.officer_result === "referred") { stats.oReferred++; flagged.push({ item, a, type: "referred" }); }
    else if (a.officer_result === "investigation") { stats.oInvestigation++; flagged.push({ item, a, type: "investigation" }); }
    else stats.oPending++;
  }));

  const docs = app.documents || [];
  const verified = docs.filter(d => d.status === "verified").length;
  const rejected = docs.filter(d => d.status === "rejected").length;
  const pending = docs.length - verified - rejected;
  const borderColors = { rejected: "#e74c3c", referred: "#8e44ad", investigation: "#2980b9" };

  if (loading) return <div style={{ padding: 20, color: T.c.textSecondary, fontSize: 12 }}>Loading assessment data...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {/* Summary metrics */}
        <div>
          <div style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", marginBottom: 8 }}>Assessment summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {[
              { n: stats.oApproved, l: "Approved", c: "#27ae60" },
              { n: stats.oRejected, l: "Rejected", c: "#c0392b" },
              { n: stats.oReferred, l: "Referred", c: "#8e44ad" },
              { n: stats.oInvestigation, l: "Investigating", c: "#2980b9" },
            ].map(m => (
              <div key={m.l} style={{ background: T.c.bgAlt, borderRadius: T.r.md, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: T.w.black, color: m.c }}>{m.n}</div>
                <div style={{ fontSize: 10, color: m.c }}>{m.l}</div>
              </div>
            ))}
          </div>
          {stats.oPending > 0 && (
            <div style={{ padding: "8px 12px", background: "#fef5e7", borderRadius: T.r.md, fontSize: 11, color: "#854F0B", fontWeight: T.w.semi }}>
              ⏳ {stats.oPending} items still awaiting officer review
            </div>
          )}
        </div>

        {/* Flagged items + doc status */}
        <div>
          <div style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", marginBottom: 8 }}>Flagged items</div>
          <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 12 }}>
            {flagged.length === 0 && <div style={{ fontSize: 11, color: T.c.success, fontWeight: T.w.semi }}>No flagged items</div>}
            {flagged.map((f, i) => (
              <div key={i} style={{ padding: "6px 10px", marginBottom: 4, borderLeft: `3px solid ${borderColors[f.type] || "#7f8c8d"}`, background: T.c.bgAlt, borderRadius: "0 6px 6px 0" }}>
                <div style={{ fontSize: 11, fontWeight: T.w.semi, color: T.c.text }}>{f.item.label}</div>
                <div style={{ fontSize: 10, color: T.c.textSecondary }}>{f.a.ai_reason || f.item.reference}</div>
                {f.a.note && <div style={{ fontSize: 10, color: "#854F0B", marginTop: 2 }}>💬 {f.a.note}</div>}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", marginBottom: 6 }}>Document status</div>
          <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
            <span style={{ color: T.c.success, fontWeight: T.w.bold }}>✅ {verified}</span>
            <span style={{ color: T.c.danger, fontWeight: T.w.bold }}>❌ {rejected}</span>
            <span style={{ color: T.c.info, fontWeight: T.w.bold }}>📥 {pending}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const CONDITION_TEMPLATES = [
  { cat: "Construction", items: [
    "Crossover to be constructed to Type 1 standard (urban, fully sealed) per R-030.",
    "Crossover surface to be concrete, minimum 100mm thickness on 150mm compacted base course per R-120/R-122.",
    "Crossover to include minimum two expansion joints per R-126.",
    "Crossover to be constructed flush with existing footpath per R-110.",
  ]},
  { cat: "Dimensions", items: [
    "Crossover width at property boundary not to exceed 3.0m per R-083.",
    "Crossover width at property boundary not to exceed 6.0m (includes 1.5m splays each side) per R-083.",
    "Crossover to be perpendicular (90 degrees) to road centreline per R-081.",
    "Minimum 6.0m separation from intersection tangent point per R-100.",
  ]},
  { cat: "Sight Distance", items: [
    "Fence/wall within sight triangle to be truncated to 0.75m maximum height per AS 2890.1.",
    "Vegetation within sight triangle to be maintained below 0.65m height.",
    "No obstruction between 0.65m and 1.5m height within the sight triangle area.",
    "Existing fence to be cut back at 45 degrees within 1.5m of crossover edge.",
  ]},
  { cat: "Drainage & Verge", items: [
    "Stormwater runoff from crossover not to discharge onto road surface or adjacent properties.",
    "Existing street tree to be protected during construction — no root disturbance within drip line.",
    "Verge to be reinstated to council standard after crossover construction.",
    "Existing crossover to be removed and verge reinstated at owner's expense.",
  ]},
  { cat: "Services & Safety", items: [
    "Dial Before You Dig enquiry to be completed prior to excavation.",
    "Any damaged kerb, footpath, or verge to be repaired to council standard at owner's expense.",
    "Street light/power pole clearance to be maintained — minimum 1.0m from crossover edge.",
    "Fire hydrant access to be maintained — no obstruction within 1.0m.",
  ]},
];

function StepDecision({ app, currentUser, categories, reloadApp, setLocalApp }) {
  const [conditions, setConditions] = useState(app.conditions || []);
  const [decisionNote, setDecisionNote] = useState(app.decision_note || "");
  const [customCondition, setCustomCondition] = useState("");
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const addCondition = (text) => {
    if (!conditions.includes(text)) setConditions(prev => [...prev, text]);
  };
  const removeCondition = (idx) => setConditions(prev => prev.filter((_, i) => i !== idx));

  const saveDecision = async (newStatus) => {
    setSaving(true);
    try {
      await api.updateApp(app._dbId, { status: newStatus, conditions, decision_note: decisionNote });
      const fresh = await reloadApp(app._dbId);
      if (fresh) setLocalApp(fresh);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Left: Decision + Conditions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", marginBottom: 8 }}>Decision</div>
          {[
            { s: "approved", l: "Approve", desc: "All requirements met", c: "#27ae60" },
            { s: "conditionally_approved", l: "Approve with Conditions", desc: "Approved subject to conditions below", c: "#2980b9" },
            { s: "rejected", l: "Reject", desc: "Does not meet requirements", c: "#c0392b" },
          ].map(opt => (
            <div key={opt.s} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: app.status === opt.s ? `2px solid ${opt.c}` : "1px solid #e4e9ec", borderRadius: T.r.md, marginBottom: 6, cursor: saving ? "not-allowed" : "pointer", background: app.status === opt.s ? `${opt.c}08` : "#fff" }}
              onClick={() => { if (!saving) saveDecision(opt.s); }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${app.status === opt.s ? opt.c : T.c.grey400}`, marginTop: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {app.status === opt.s && <div style={{ width: 6, height: 6, borderRadius: "50%", background: opt.c }} />}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: T.w.bold, color: opt.c }}>{opt.l}</div>
                <div style={{ fontSize: 10, color: T.c.textSecondary }}>{opt.desc}</div>
              </div>
            </div>
          ))}

          {/* Decision note */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", marginBottom: 4 }}>Decision Note</div>
            <textarea value={decisionNote} onChange={e => setDecisionNote(e.target.value)}
              onBlur={async () => { try { await api.updateApp(app._dbId, { decision_note: decisionNote }); } catch {} }}
              placeholder="Optional — reason for decision..."
              style={{ width: "100%", minHeight: 50, padding: "8px 10px", borderRadius: T.r.md, border: `1px solid ${T.c.border}`, fontSize: 11, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <ReportGenerator app={app} />
          </div>
        </div>

        {/* Right: Conditions */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase" }}>Conditions ({conditions.length})</div>
            <button onClick={() => setShowTemplates(!showTemplates)}
              style={{ padding: "3px 10px", borderRadius: T.r.sm, border: "1px solid #2980b9", background: showTemplates ? "#ebf5fb" : "#fff", color: T.c.info, fontSize: 9, fontWeight: T.w.bold, cursor: "pointer", fontFamily: "inherit" }}>
              {showTemplates ? "Hide Templates" : "Add from Templates"}
            </button>
          </div>

          {/* Current conditions */}
          {conditions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              {conditions.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "6px 10px", background: T.c.bg, borderRadius: T.r.md, border: `1px solid ${T.c.borderLight}` }}>
                  <span style={{ fontSize: 10, fontWeight: T.w.black, color: T.c.info, marginTop: 1, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontSize: 10, color: T.c.text, flex: 1, lineHeight: 1.4 }}>{c}</span>
                  <button onClick={() => removeCondition(i)} style={{ background: "none", border: "none", color: T.c.grey400, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>x</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 12, textAlign: "center", color: T.c.grey400, fontSize: 11, background: "#fafbfc", borderRadius: T.r.md, marginBottom: 10 }}>
              No conditions added. Use templates or type custom.
            </div>
          )}

          {/* Custom condition input */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <input value={customCondition} onChange={e => setCustomCondition(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && customCondition.trim()) { addCondition(customCondition.trim()); setCustomCondition(""); } }}
              placeholder="Type custom condition..."
              style={{ flex: 1, padding: "6px 10px", borderRadius: T.r.md, border: `1px solid ${T.c.border}`, fontSize: 10, fontFamily: "inherit", outline: "none" }} />
            <button onClick={() => { if (customCondition.trim()) { addCondition(customCondition.trim()); setCustomCondition(""); } }}
              disabled={!customCondition.trim()}
              style={{ padding: "6px 10px", borderRadius: T.r.md, border: "none", background: customCondition.trim() ? "#2980b9" : "#bdc3c7", color: T.c.white, fontSize: 10, fontWeight: T.w.bold, cursor: customCondition.trim() ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Add</button>
          </div>

          {/* Save conditions */}
          {conditions.length > 0 && (
            <button onClick={async () => { try { await api.updateApp(app._dbId, { conditions }); const fresh = await reloadApp(app._dbId); if (fresh) setLocalApp(fresh); } catch {} }}
              style={{ width: "100%", padding: "7px 0", borderRadius: T.r.md, border: "none", background: "linear-gradient(135deg, #2980b9, #3498db)", color: T.c.white, fontSize: 11, fontWeight: T.w.bold, cursor: "pointer", fontFamily: "inherit", marginBottom: 10 }}>
              Save {conditions.length} Condition{conditions.length !== 1 ? "s" : ""}
            </button>
          )}

          {/* Template picker */}
          {showTemplates && (
            <div style={{ border: `1px solid ${T.c.border}`, borderRadius: T.r.md, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
              {CONDITION_TEMPLATES.map(cat => (
                <div key={cat.cat}>
                  <div style={{ padding: "6px 12px", background: T.c.bg, fontSize: 10, fontWeight: T.w.bold, color: T.c.textSecondary, textTransform: "uppercase", borderBottom: `1px solid ${T.c.borderLight}` }}>{cat.cat}</div>
                  {cat.items.map((item, i) => {
                    const added = conditions.includes(item);
                    return (
                      <div key={i} onClick={() => { if (!added) addCondition(item); }}
                        style={{ padding: "6px 12px", fontSize: 10, color: added ? "#27ae60" : "#1a3a4a", cursor: added ? "default" : "pointer", borderBottom: "1px solid #f5f7f8", background: added ? "#eafaf115" : "transparent", lineHeight: 1.4 }}
                        onMouseEnter={e => { if (!added) e.currentTarget.style.background = "#f0f8ff"; }}
                        onMouseLeave={e => { if (!added) e.currentTarget.style.background = "transparent"; }}>
                        {added ? "✅ " : "＋ "}{item}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
//  Main WorkflowView Component
// ═══════════════════════════════════════════════════════════

export default function WorkflowView({
  app, apps, onSelectApp, onBack, currentUser, reloadApp, reloadAllApps, users,
  globalSpeedRoads, globalLotsData, globalRoadNetwork, globalContoursData,
  globalUrbanForestData, globalDrainagePipesData, globalDrainagePitsData, globalWaterPipesData,
  globalPowerBuriedData, globalPowerOverheadData, globalPowerStructuresData, globalGasMainsData,
  globalGasValvesData, globalPowerTransformersData, globalPowerStreetlightsData,
  // Shared state from parent
  localApp, setLocalApp, newNote, setNewNote, addNote,
  assignee, setAssignee, newStatus, setNewStatus, saveChanges,
  measureCorrections, setMeasureCorrections, categories,
  canAssign, canDecide,
}) {
  const autoStep = statusToStep(localApp.status);
  const [currentStep, setCurrentStep] = useState(autoStep);
  const [showInspection, setShowInspection] = useState(false);
  const [activeInspection, setActiveInspection] = useState(null);
  const [georefData, setGeorefData] = useState(null); // {planPts, imgUrl, imgW, imgH}
  const [assessments, setAssessments] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [showMap, setShowMap] = useState(currentStep === 2 || currentStep === 3);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Load assessments for step stats
  useEffect(() => {
    if (!localApp?._dbId) return;
    api.listAssessments(localApp._dbId).then(d => setAssessments(d || [])).catch(() => {});
  }, [localApp?._dbId, currentStep]);

  // Load audit log for activity timeline
  useEffect(() => {
    if (!localApp?._dbId) return;
    api.getAuditLog(String(localApp._dbId)).then(d => setAuditLog(d?.logs || d || [])).catch(() => {});
  }, [localApp?._dbId]);

  const stepStats = getStepStats(localApp, assessments);

  const handleGeorefPlanPoints = (planPts, imgUrl, imgW, imgH) => {
    setGeorefData({ planPts, imgUrl, imgW, imgH });
    setCurrentStep(3); // Switch to Assess tab where the map is
  };

  const startInspection = async (type) => {
    try {
      // Find existing in-progress inspection or create new one
      const existing = (localApp.inspections || []).find(i => i.inspection_type === type && (i.status === "scheduled" || i.status === "in_progress"));
      if (existing) {
        setActiveInspection(existing);
      } else {
        const newInsp = await api.scheduleInspection(localApp._dbId, {
          inspection_type: type,
          scheduled_date: new Date().toISOString(),
          inspector_id: currentUser?.id,
        });
        setActiveInspection(newInsp);
      }
      setShowInspection(true);
    } catch (e) { console.error("Failed to start inspection:", e); }
  };

  // Update step when status changes
  useEffect(() => { setCurrentStep(statusToStep(localApp.status)); }, [localApp.status]);

  // Compute how far the workflow has progressed
  const completedUpTo = Math.max(autoStep, currentStep);

  const stepDef = STEPS.find(s => s.id === currentStep) || STEPS[0];

  const onDocUpdated = async () => {
    const fresh = await reloadApp(localApp._dbId);
    if (fresh) setLocalApp(fresh);
  };

  const onMeasureCorrection = async (fieldKey, value, unit) => {
    // 1. Update local state for UI
    setMeasureCorrections(prev => [...prev.filter(c => c.field_path !== fieldKey), {
      field_path: fieldKey,
      ai_value: (() => { const spd = localApp?.cor_site_plan_data || localApp?.site_plan_data; const ext = spd?.extraction || spd || {}; const parts = fieldKey.split('.'); let v = ext; for (const p of parts) v = v?.[p]; return String(v ?? '—'); })(),
      correct_value: String(value),
      type: "measure_override",
      unit: unit || "m",
    }]);

    // 2. Save to backend immediately
    try {
      await api.correctSitePlan(localApp._dbId, { [fieldKey]: value });
      // Reload app to get updated data
      if (reloadApp) {
        const updated = await reloadApp(localApp._dbId);
        if (updated) setLocalApp(prev => ({ ...prev, ...updated, _dbId: prev._dbId }));
      }
    } catch (e) {
      console.error("Measure correction save failed:", e);
    }
  };

  const handleDeleteApp = async () => {
    if (!deleteReason.trim()) return;
    setDeleting(true);
    try {
      await api.deleteApplication(localApp._dbId, deleteReason.trim());
      setShowDeleteModal(false);
      setDeleteReason("");
      // Refresh the app list so the deleted app disappears, then navigate back
      if (reloadAllApps) await reloadAllApps();
      if (onBack) onBack();
      else if (onSelectApp) onSelectApp(null);
    } catch (e) { alert("Delete failed: " + (e.message || e)); }
    setDeleting(false);
  };

  return (
    <div>
      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowDeleteModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: T.r.lg, padding: 24, width: 420, maxWidth: "90vw", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: T.w.black, color: "#c0392b", marginBottom: 4 }}>🗑️ Delete Application</div>
            <div style={{ fontSize: 13, color: T.c.textSecondary, marginBottom: 16 }}>
              This will soft-delete <strong>{localApp.ref_number}</strong> ({localApp.property_address}). It can be restored from System Administration.
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: T.w.bold, color: T.c.grey800, display: "block", marginBottom: 4 }}>Reason for deletion *</label>
              <textarea
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="e.g. Duplicate application, Submitted in error, Owner withdrew…"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: T.r.md, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowDeleteModal(false); setDeleteReason(""); }}
                style={{ padding: "8px 20px", borderRadius: T.r.md, border: "1px solid #d5dde2", background: "#fff", color: T.c.textSecondary, fontSize: 12, fontWeight: T.w.bold, cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button onClick={handleDeleteApp} disabled={!deleteReason.trim() || deleting}
                style={{ padding: "8px 20px", borderRadius: T.r.md, border: "none", background: !deleteReason.trim() || deleting ? "#ccc" : "#c0392b", color: "#fff", fontSize: 12, fontWeight: T.w.bold, cursor: !deleteReason.trim() || deleting ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {deleting ? "Deleting…" : "Delete Application"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main layout: vertical stepper left + content right */}
      <div className="workflow-grid" style={{ display: "grid", gridTemplateColumns: "160px minmax(0, 1fr) 240px", gap: 12 }}>
        {/* Left: Vertical Stepper */}
        <div className="workflow-stepper" style={{ background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`, padding: "10px 6px", alignSelf: "start", position: "sticky", top: 8 }}>
          <Stepper currentStep={currentStep} completedUpTo={completedUpTo} onStepClick={setCurrentStep} stepStats={stepStats} />
          {/* Quick actions under stepper */}
          <div style={{ borderTop: `1px solid ${T.c.borderLight}`, marginTop: 8, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {currentStep !== 3 && (
              <button onClick={() => setShowMap(m => !m)}
                style={{ padding: "4px 8px", borderRadius: T.r.sm, border: `1px solid ${showMap ? "#185FA5" : "#d5dde2"}`, background: showMap ? "#E6F1FB" : "#fff", color: showMap ? "#185FA5" : "#7a8a94", fontSize: 9, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left" }}>
                🗺️ {showMap ? "Hide Map" : "Show Map"}
              </button>
            )}
            {currentUser?.role === "admin" && (
              <button onClick={() => setShowDeleteModal(true)}
                style={{ padding: "4px 8px", borderRadius: T.r.sm, border: "1px solid #e74c3c40", background: "#fdf0ef", color: "#c0392b", fontSize: 9, fontWeight: T.w.semi, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left" }}>
                🗑️ Delete
              </button>
            )}
          </div>
        </div>

        {/* Right: Step content */}
        <div>
          {/* Mobile stepper (hidden on desktop) */}
          <div className="workflow-stepper-mobile" style={{ display: "none", gap: 4, marginBottom: 8, overflowX: "auto", padding: "6px 0" }}>
            {STEPS.map(step => {
              const active = step.id === currentStep;
              const done = step.id < completedUpTo;
              return (
                <button key={step.id} onClick={() => setCurrentStep(step.id)}
                  style={{ padding: "4px 10px", borderRadius: 12, border: active ? `2px solid ${step.color}` : "1px solid #d5dde2", background: active ? `${step.color}10` : done ? "#08504110" : "#fff", color: active ? step.color : done ? "#085041" : "#7a8a94", fontSize: 10, fontWeight: active ? 700 : 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {stepStats?.[step.key]?.done ? "✓ " : ""}{step.label}
                </button>
              );
            })}
          </div>
          {/* Step header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: "10px 16px", background: stepDef.bg, borderRadius: 12,
            border: `1px solid ${stepDef.color}18`,
            boxShadow: `0 1px 4px ${stepDef.color}08`,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", background: stepDef.color, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: T.w.bold,
              boxShadow: `0 2px 6px ${stepDef.color}30`,
            }}>{stepDef.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: T.w.bold, color: stepDef.color, letterSpacing: "-0.01em" }}>
                Step {stepDef.id}: {stepDef.label}
              </div>
              <div style={{ fontSize: 10, color: stepDef.color, opacity: 0.65, marginTop: 1 }}>{stepDef.desc}</div>
            </div>
            {currentStep < 4 && (
              <button onClick={() => setCurrentStep(currentStep + 1)}
                style={{
                  padding: "6px 14px", borderRadius: 8, border: "none",
                  background: STEPS[currentStep]?.color || "#333",
                  color: "#fff", fontSize: 10, fontWeight: T.w.bold,
                  cursor: "pointer", fontFamily: "inherit",
                  boxShadow: `0 2px 6px ${STEPS[currentStep]?.color || "#333"}30`,
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "none"}>
                {STEPS[currentStep]?.label || "Next"} →
              </button>
            )}
          </div>
          {/* Step 1: Submit — upload docs, auto-extract, auto-assess */}
          {currentStep === 1 && (
            <StepUpload app={localApp} currentUser={currentUser}
              onDocUpdated={onDocUpdated} onMeasureCorrection={onMeasureCorrection}
              onGeorefPoints={handleGeorefPlanPoints} />
          )}
          {/* Step 2: Review — extraction expanded, map and checklist as separate collapsibles */}
          {currentStep === 2 && (
            <>
              <StepExtract app={localApp} currentUser={currentUser}
                onReload={onDocUpdated} measureCorrections={measureCorrections}
                onMeasureCorrectionsApplied={() => setMeasureCorrections([])} />
              <CollapsibleSection title="Assessment Checklist" icon="📋" defaultOpen={false} badge={stepStats.review?.badge} color="#085041">
                <StepAssess app={localApp} apps={apps} onSelectApp={onSelectApp}
                  globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
                  globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
                  globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
                  globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
                  globalPowerBuriedData={globalPowerBuriedData} globalPowerOverheadData={globalPowerOverheadData}
                  globalPowerStructuresData={globalPowerStructuresData} globalGasMainsData={globalGasMainsData}
                  categories={categories}
                  currentUser={currentUser}
                  onMeasureCorrection={onMeasureCorrection}
                  georefData={georefData} onGeorefDone={() => setGeorefData(null)}
                  mode="checklist" />
              </CollapsibleSection>
              <CollapsibleSection title="Map View" icon="🗺️" defaultOpen={false} badge="View lot on map" color="#185FA5">
                <StepAssess app={localApp} apps={apps} onSelectApp={onSelectApp}
                  globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
                  globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
                  globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
                  globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
                  globalPowerBuriedData={globalPowerBuriedData} globalPowerOverheadData={globalPowerOverheadData}
                  globalPowerStructuresData={globalPowerStructuresData} globalGasMainsData={globalGasMainsData}
                  categories={categories}
                  currentUser={currentUser}
                  onMeasureCorrection={onMeasureCorrection}
                  georefData={georefData} onGeorefDone={() => setGeorefData(null)}
                  mode="map" />
              </CollapsibleSection>
            </>
          )}
          {/* Step 3: Analyse — separate collapsible sections for map and checklist */}
          {currentStep === 3 && (
            <>
              <CollapsibleSection title="Map Analysis" icon="🗺️" defaultOpen={false} badge="Sight · Measure · Utilities" color="#185FA5">
                <StepAssess app={localApp} apps={apps} onSelectApp={onSelectApp}
                  globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
                  globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
                  globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
                  globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
                  globalPowerBuriedData={globalPowerBuriedData} globalPowerOverheadData={globalPowerOverheadData}
                  globalPowerStructuresData={globalPowerStructuresData} globalGasMainsData={globalGasMainsData}
                  categories={categories}
                  currentUser={currentUser}
                  onMeasureCorrection={onMeasureCorrection}
                  georefData={georefData} onGeorefDone={() => setGeorefData(null)}
                  mode="map" />
              </CollapsibleSection>
              <CollapsibleSection title="Assessment Checklist" icon="📋" defaultOpen={false} badge={stepStats.review?.badge} color="#085041">
                <StepAssess app={localApp} apps={apps} onSelectApp={onSelectApp}
                  globalSpeedRoads={globalSpeedRoads} globalLotsData={globalLotsData}
                  globalRoadNetwork={globalRoadNetwork} globalContoursData={globalContoursData}
                  globalUrbanForestData={globalUrbanForestData} globalDrainagePipesData={globalDrainagePipesData}
                  globalDrainagePitsData={globalDrainagePitsData} globalWaterPipesData={globalWaterPipesData}
                  globalPowerBuriedData={globalPowerBuriedData} globalPowerOverheadData={globalPowerOverheadData}
                  globalPowerStructuresData={globalPowerStructuresData} globalGasMainsData={globalGasMainsData}
                  categories={categories}
                  currentUser={currentUser}
                  onMeasureCorrection={onMeasureCorrection}
                  georefData={georefData} onGeorefDone={() => setGeorefData(null)}
                  mode="checklist" />
              </CollapsibleSection>
            </>
          )}
          {/* Step 4: Decision — approve/reject/request info + report */}
          {currentStep === 4 && (
            <StepDecision app={localApp} currentUser={currentUser} categories={categories}
              reloadApp={reloadApp} setLocalApp={setLocalApp} />
          )}
        </div>

        {/* Right sidebar */}
        <div className="workflow-sidebar">
          <WorkflowSidebar
            app={localApp} currentUser={currentUser} users={users} categories={categories}
            onReload={onDocUpdated} newNote={newNote} setNewNote={setNewNote} addNote={addNote}
            assignee={assignee} setAssignee={setAssignee} newStatus={newStatus} setNewStatus={setNewStatus}
            saveChanges={saveChanges} canAssign={canAssign} canDecide={canDecide}
            onInspect={startInspection} auditLog={auditLog} stepStats={stepStats}
          />
        </div>
      </div>

      {/* Collapsible map for non-Assess steps */}
      {currentStep !== 3 && showMap && (
        <div style={{ marginTop: 12 }}>
          <MapWithOverlay app={localApp} apps={apps} onSelectApp={onSelectApp}
            speedRoadsData={globalSpeedRoads} lotsData={globalLotsData} roadNetworkData={globalRoadNetwork}
            contoursData={globalContoursData} urbanForestData={globalUrbanForestData}
            drainagePipesData={globalDrainagePipesData} drainagePitsData={globalDrainagePitsData}
            waterPipesData={globalWaterPipesData} />
        </div>
      )}

      {/* Mobile Inspection Overlay */}
      {showInspection && activeInspection && (
        <MobileInspection
          app={localApp}
          inspection={activeInspection}
          onClose={() => setShowInspection(false)}
          onUpdate={async () => { const fresh = await reloadApp(localApp._dbId); if (fresh) setLocalApp(fresh); }}
        />
      )}
    </div>
  );
}
