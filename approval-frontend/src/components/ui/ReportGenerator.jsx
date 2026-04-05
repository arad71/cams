import { useState, useEffect } from "react";
import api from "../../services/api";

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
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#1a3a4a" }}>Assessment Reports</div>
          <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>
            {reports.length} version{reports.length !== 1 ? "s" : ""} generated
          </div>
        </div>
        <button onClick={generateReport} disabled={generating}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: generating ? "#bdc3c7" : "linear-gradient(135deg, #1a3a4a, #2c3e50)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {generating ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#fdedec", border: "1px solid #f5c6cb", borderRadius: 6, color: "#e74c3c", fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#bdc3c7", fontSize: 12 }}>
          No reports generated yet. Click "Generate Report" to create a snapshot of the current assessment.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reports.map(r => {
            const sum = r.summary_data || {};
            const rec = r.recommendation || "REVIEW";
            const date = r.created_at ? new Date(r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f8fafb", borderRadius: 8, border: "1px solid #eef2f4" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1a3a4a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  V{r.version}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>
                    Version {r.version}
                    <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800, color: recColor(rec), background: recColor(rec) + "15" }}>
                      {rec}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#95a5a6", marginTop: 2 }}>
                    {date} — {r.generated_by_name || "System"} — {sum.ai_pass || 0} pass, {sum.ai_fail || 0} fail, {sum.ai_review || 0} review
                  </div>
                </div>
                <button onClick={() => downloadPdf(r.version)} disabled={downloading === r.version}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1.5px solid #e74c3c", background: downloading === r.version ? "#fce4ec" : "#fff", color: "#e74c3c", fontWeight: 700, fontSize: 10, cursor: downloading === r.version ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
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
