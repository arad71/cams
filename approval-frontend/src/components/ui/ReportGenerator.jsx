import { useState, useEffect } from "react";
import api from "../../services/api";
import { T, S, cx } from '../../styles/tokens';

export default function ReportGenerator({ app }) {
  const [reports, setReports] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null);

  // Load existing reports
  useEffect(() => {
    if (!app?._dbId) return;
    api.listReports(app._dbId).then(setReports).catch(() => {});
  }, [app?._dbId]);

  const generateReport = async () => {
    setGenerating(true);
    setError(null);
    try {
      const report = await api.generateReport(app._dbId);
      setReports(prev => [report, ...prev.filter(r => r.id !== report.id)]);
    } catch (e) {
      setError(e.message);
    }
    setGenerating(false);
  };

  const downloadPdf = async (version) => {
    setDownloading(version);
    setError(null);
    try {
      await api.downloadReportPdf(app._dbId, version);
    } catch (e) {
      setError(e.message);
    }
    setDownloading(null);
  };

  const recColor = (rec) => {
    if (!rec) return "#7a8a94";
    const r = rec.toUpperCase();
    return r === "APPROVE" ? "#27ae60" : r === "REJECT" ? "#e74c3c" : "#e67e22";
  };

  return (
    <div style={{ background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: T.w.black, color: T.c.text }}>Assessment Reports</div>
          <div style={{ fontSize: 11, color: T.c.textMuted, marginTop: 2 }}>
            {reports.length} version{reports.length !== 1 ? "s" : ""} generated
          </div>
        </div>
        <button onClick={generateReport} disabled={generating}
          style={{ padding: "8px 16px", borderRadius: T.r.md, border: "none", background: generating ? "#bdc3c7" : "linear-gradient(135deg, #1a3a4a, #2c3e50)", color: T.c.white, fontWeight: T.w.bold, fontSize: 12, cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {generating ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: T.c.dangerLight, border: "1px solid #f5c6cb", borderRadius: T.r.md, color: T.c.danger, fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: T.c.grey400, fontSize: 12 }}>
          No reports generated yet. Click "Generate Report" to create a snapshot of the current assessment.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reports.map(r => {
            const sum = r.summary_data || {};
            const rec = r.recommendation || "REVIEW";
            const date = r.created_at ? new Date(r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: T.c.bgAlt, borderRadius: T.r.md, border: `1px solid ${T.c.borderLight}` }}>
                <div style={{ width: 36, height: 36, borderRadius: T.r.md, background: "#1a3a4a", color: T.c.white, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: T.w.black, fontSize: 13, flexShrink: 0 }}>
                  V{r.version}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: T.w.bold, color: T.c.text }}>
                    Version {r.version}
                    <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: T.r.sm, fontSize: 10, fontWeight: T.w.black, color: recColor(rec), background: recColor(rec) + "15" }}>
                      {rec}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: T.c.textMuted, marginTop: 2 }}>
                    {date} — {r.generated_by_name || "System"} — {sum.ai_pass || 0} pass, {sum.ai_fail || 0} fail, {sum.ai_review || 0} review
                  </div>
                </div>
                <button onClick={() => downloadPdf(r.version)} disabled={downloading === r.version}
                  style={{ padding: "6px 12px", borderRadius: T.r.md, border: "1.5px solid #e74c3c", background: downloading === r.version ? "#fce4ec" : "#fff", color: T.c.danger, fontWeight: T.w.bold, fontSize: 10, cursor: downloading === r.version ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {downloading === r.version ? "Downloading..." : "PDF"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
