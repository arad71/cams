import { useState } from "react";


function ReportGenerator({ app, checklist, summary, currentUser, categories = [] }) {
  const [reports, setReports] = useState([]);
  const [viewingReport, setViewingReport] = useState(null);
  const [generating, setGenerating] = useState(false);

  const generateReport = () => {
    setGenerating(true);
    setTimeout(() => {
      const version = reports.length + 1;
      const now = new Date();
      // Snapshot checklist state at generation time
      const checklistSnapshot = {};
      let itemsPassed = 0, itemsFailed = 0, itemsReview = 0, officerApproved = 0, officerRejected = 0;
      categories.forEach(cat => cat.items.forEach(item => {
        const st = checklist[item.code] || {};
        checklistSnapshot[item.code] = { ...st, catLabel: cat.label, catIcon: cat.icon, itemLabel: item.label, itemRef: item.reference };
        if (st.auto === "pass") itemsPassed++;
        else if (st.auto === "fail") itemsFailed++;
        else itemsReview++;
        if (st.officer === "approved") officerApproved++;
        if (st.officer === "rejected") officerRejected++;
      }));

      const report = {
        id: `RPT-${app.id}-V${version}`,
        version,
        generatedAt: now.toISOString(),
        generatedAtLabel: now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        generatedBy: currentUser?.name || "System",
        generatedByRole: currentUser?.role || "—",
        status: app.status,
        appSnapshot: {
          id: app.id, owner: app.owner.name, address: app.property.address,
          lot: app.property.lot, plan: app.property.plan, frontage: app.property.frontage,
          road: app.property.roadName, roadType: app.property.roadType,
          crossoverWidth: app.crossover.width, crossoverSurface: app.crossover.surface,
          crossoverCount: app.crossover.count, officer: app.assessment.officer,
        },
        checklist: checklistSnapshot,
        summary: { ...summary, itemsPassed, itemsFailed, itemsReview, officerApproved, officerRejected },
        notes: [...(app.assessment.notes || [])],
        recommendation: itemsFailed === 0 && officerRejected === 0 ? "APPROVE" : itemsFailed > 3 ? "REJECT" : "REVIEW",
      };
      setReports(prev => [report, ...prev]);
      setViewingReport(report);
      setGenerating(false);
    }, 600);
  };

  const printReport = (report) => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const s = report.appSnapshot;
    const cl = report.checklist;
    const cats = categories;
    let checklistHTML = "";
    cats.forEach(cat => {
      let rows = "";
      cat.items.forEach(item => {
        const r = cl[item.code] || {};
        const aiColor = r.auto === "pass" ? "#27ae60" : r.auto === "fail" ? "#e74c3c" : "#e67e22";
        const offColor = r.officer === "approved" ? "#27ae60" : r.officer === "rejected" ? "#e74c3c" : "#999";
        rows += `<tr>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${item.label}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;"><span style="color:${aiColor};font-weight:700">${(r.auto||"—").toUpperCase()}</span></td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;"><span style="color:${offColor};font-weight:700">${(r.officer||"pending").toUpperCase()}</span></td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${r.note||""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${item.reference}</td>
        </tr>`;
      });
      checklistHTML += `<tr style="background:#f0f3f5"><td colspan="5" style="padding:6px 8px;border:1px solid #ddd;font-weight:700;font-size:12px;">${cat.icon} ${cat.label}</td></tr>${rows}`;
    });

    const recColor = report.recommendation === "APPROVE" ? "#27ae60" : report.recommendation === "REJECT" ? "#e74c3c" : "#e67e22";
    const notesHTML = (report.notes || []).map(n => `<div style="padding:4px 0;border-bottom:1px solid #eee;font-size:11px;"><strong>${n.author}</strong> (${n.date}): ${n.text}</div>`).join("");

    w.document.write(`<!DOCTYPE html><html><head><title>Report ${report.id}</title>
    <style>@media print{body{margin:0;padding:15px}table{page-break-inside:auto}tr{page-break-inside:avoid}}</style></head>
    <body style="font-family:Arial,sans-serif;max-width:850px;margin:0 auto;padding:20px;color:#333;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a3a4a;padding-bottom:12px;margin-bottom:16px;">
        <div><h1 style="margin:0;font-size:20px;color:#1a3a4a;">Council</h1>
          <div style="font-size:12px;color:#666;">Crossover Approval Assessment Report</div></div>
        <div style="text-align:right;"><div style="font-size:14px;font-weight:700;color:#1a3a4a;">${report.id}</div>
          <div style="font-size:11px;color:#666;">Version ${report.version} · ${report.generatedAtLabel}</div>
          <div style="font-size:11px;color:#666;">By: ${report.generatedBy} (${report.generatedByRole})</div></div>
      </div>
      <h2 style="font-size:15px;color:#1a3a4a;margin:0 0 10px;">Application: ${s.id}</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;width:30%;font-size:11px;">Owner</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.owner}</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;width:20%;font-size:11px;">Status</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${report.status.replace(/_/g," ").toUpperCase()}</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Address</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.address}</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Officer</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.officer||"Unassigned"}</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Lot / Plan</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.lot} (${s.plan})</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Road</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.road} (${s.roadType})</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Frontage</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.frontage}m</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Crossover</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.crossoverWidth}m ${s.crossoverSurface} (×${s.crossoverCount})</td></tr>
      </table>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;text-align:center;padding:10px;background:#eafaf1;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#27ae60;">${report.summary.itemsPassed}</div><div style="font-size:10px;color:#27ae60;">AI PASS</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fef5e7;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#e67e22;">${report.summary.itemsReview}</div><div style="font-size:10px;color:#e67e22;">AI REVIEW</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fdedec;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#e74c3c;">${report.summary.itemsFailed}</div><div style="font-size:10px;color:#e74c3c;">AI FAIL</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#f0f3f5;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#2980b9;">${report.summary.officerApproved}</div><div style="font-size:10px;color:#2980b9;">OFFICER ✓</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:${recColor}15;border:2px solid ${recColor};border-radius:6px;"><div style="font-size:18px;font-weight:800;color:${recColor};">${report.recommendation}</div><div style="font-size:10px;color:${recColor};">RECOMMENDATION</div></div>
      </div>
      <h3 style="font-size:13px;color:#1a3a4a;margin:0 0 6px;">Assessment Checklist (${report.summary.t || 60} items)</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead><tr style="background:#1a3a4a;color:#fff;">
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:40%;">Item</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-size:10px;width:10%;">AI</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-size:10px;width:12%;">Officer</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:25%;">Note</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:8%;">Ref</th>
        </tr></thead>
        <tbody>${checklistHTML}</tbody>
      </table>
      ${notesHTML ? `<h3 style="font-size:13px;color:#1a3a4a;margin:0 0 6px;">Officer Notes</h3><div style="margin-bottom:16px;">${notesHTML}</div>` : ""}
      <div style="border-top:2px solid #1a3a4a;padding-top:10px;margin-top:20px;display:flex;justify-content:space-between;font-size:10px;color:#999;">
        <span>Generated: ${report.generatedAtLabel} by ${report.generatedBy}</span>
        <span>${report.id} · Version ${report.version}</span>
        <span>Council · Crossover Approval System v3.1</span>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    w.document.close();
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 2px" }}>📊 Assessment Reports</h4>
          <div style={{ fontSize: 10, color: "#95a5a6" }}>{reports.length} version{reports.length !== 1 ? "s" : ""} generated</div>
        </div>
        <button onClick={generateReport} disabled={generating}
          style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: generating ? "#d5dde2" : "linear-gradient(135deg, #8e44ad, #9b59b6)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: generating ? "default" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
          {generating ? "⏳ Generating..." : "📄 Generate Report V" + (reports.length + 1)}
        </button>
      </div>

      {/* Report history list */}
      {reports.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {reports.map(r => (
            <div key={r.id} style={{ padding: "8px 16px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: viewingReport?.id === r.id ? "#f4ecf7" : "transparent", cursor: "pointer" }}
              onClick={() => setViewingReport(viewingReport?.id === r.id ? null : r)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: r.recommendation === "APPROVE" ? "#eafaf1" : r.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
                  color: r.recommendation === "APPROVE" ? "#27ae60" : r.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                  V{r.version}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>{r.id}</div>
                  <div style={{ fontSize: 10, color: "#95a5a6" }}>{r.generatedAtLabel} · {r.generatedBy}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: r.recommendation === "APPROVE" ? "#eafaf1" : r.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
                  color: r.recommendation === "APPROVE" ? "#27ae60" : r.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                  {r.recommendation}
                </span>
                <button onClick={e => { e.stopPropagation(); printReport(r); }}
                  style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: "#5a6a74" }}>
                  🖨️ Print
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded report view */}
      {viewingReport && (
        <div style={{ borderTop: "2px solid #8e44ad", padding: 16, background: "#faf8fc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1a3a4a" }}>{viewingReport.id}</div>
              <div style={{ fontSize: 11, color: "#7a8a94" }}>Version {viewingReport.version} · {viewingReport.generatedAtLabel} · {viewingReport.generatedBy} ({viewingReport.generatedByRole})</div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => printReport(viewingReport)}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                🖨️ Print / Save PDF
              </button>
              <button onClick={() => setViewingReport(null)}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 13, cursor: "pointer", color: "#95a5a6" }}>✕</button>
            </div>
          </div>

          {/* Summary cards */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { l: "AI PASS", v: viewingReport.summary.itemsPassed, c: "#27ae60", bg: "#eafaf1" },
              { l: "AI REVIEW", v: viewingReport.summary.itemsReview, c: "#e67e22", bg: "#fef5e7" },
              { l: "AI FAIL", v: viewingReport.summary.itemsFailed, c: "#e74c3c", bg: "#fdedec" },
              { l: "OFFICER ✓", v: viewingReport.summary.officerApproved, c: "#2980b9", bg: "#ebf5fb" },
              { l: "OFFICER ✕", v: viewingReport.summary.officerRejected, c: "#e74c3c", bg: "#fdedec" },
            ].map(m => (
              <div key={m.l} style={{ flex: "1 1 70px", textAlign: "center", padding: "8px 6px", background: m.bg, borderRadius: 6, minWidth: 65 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.c }}>{m.v}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: m.c }}>{m.l}</div>
              </div>
            ))}
            <div style={{ flex: "1 1 90px", textAlign: "center", padding: "8px 6px", borderRadius: 6, minWidth: 80,
              background: viewingReport.recommendation === "APPROVE" ? "#eafaf1" : viewingReport.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
              border: `2px solid ${viewingReport.recommendation === "APPROVE" ? "#27ae60" : viewingReport.recommendation === "REJECT" ? "#e74c3c" : "#e67e22"}` }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: viewingReport.recommendation === "APPROVE" ? "#27ae60" : viewingReport.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                {viewingReport.recommendation}
              </div>
              <div style={{ fontSize: 8, fontWeight: 700, color: "#7a8a94" }}>RECOMMENDATION</div>
            </div>
          </div>

          {/* Checklist breakdown by category */}
          <div style={{ maxHeight: 300, overflowY: "auto", borderRadius: 8, border: "1px solid #e4e9ec", background: "#fff" }}>
            {categories.map(cat => {
              const items = cat.items.map(item => ({ ...item, result: viewingReport.checklist[item.code] || {} }));
              const catPass = items.filter(i => i.result.auto === "pass").length;
              const catFail = items.filter(i => i.result.auto === "fail").length;
              return (
                <div key={cat.code}>
                  <div style={{ padding: "6px 10px", background: "#f5f8fa", borderBottom: "1px solid #eef2f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a" }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: 9, color: "#7a8a94" }}>{catPass}✓ {catFail > 0 ? catFail + "✕ " : ""}{cat.items.length} items</span>
                  </div>
                  {items.map(item => {
                    const r = item.result;
                    return (
                      <div key={item.code} style={{ padding: "4px 10px 4px 24px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ width: 50, fontWeight: 700, fontSize: 10, textAlign: "center",
                          color: r.auto === "pass" ? "#27ae60" : r.auto === "fail" ? "#e74c3c" : "#e67e22" }}>
                          {(r.auto || "—").toUpperCase()}
                        </span>
                        <span style={{ width: 60, fontWeight: 700, fontSize: 10, textAlign: "center",
                          color: r.officer === "approved" ? "#27ae60" : r.officer === "rejected" ? "#e74c3c" : "#bdc3c7" }}>
                          {r.officer ? r.officer.toUpperCase() : "PENDING"}
                        </span>
                        <span style={{ flex: 1, color: "#3a4a5a" }}>{item.label}</span>
                        <span style={{ fontSize: 9, color: "#bdc3c7" }}>{item.reference}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Version comparison hint */}
          {reports.length > 1 && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#ebf5fb", borderRadius: 6, fontSize: 10, color: "#2980b9" }}>
              💡 {reports.length} versions generated. Each version captures the checklist state at generation time. Compare versions to track assessment progress.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Application Detail ─────────────────────────────────

export default ReportGenerator;
