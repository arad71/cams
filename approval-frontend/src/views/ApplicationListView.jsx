import { useState } from "react";
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';

// ─── Application List ───────────────────────────────────
export default function ApplicationListView({ apps, filter, onSelectApp }) {
  const [search, setSearch] = useState(""); const [sf, setSf] = useState(filter || "all");
  const filtered = apps.filter(a => { if (sf !== "all" && a.status !== sf) return false; if (search) { const q = search.toLowerCase(); return a.id.toLowerCase().includes(q) || a.owner.name.toLowerCase().includes(q) || a.property.address.toLowerCase().includes(q); } return true; });
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 16px" }}>{filter === "pending_review" ? "Pending Review" : filter === "referral_pending" ? "Referrals" : "All Applications"}</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none" }} />
        <select value={sf} onChange={e => setSf(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
          <option value="all">All</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f5f8fa" }}>{["Ref", "Applicant", "Property", "Road", "Width", "Status"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" }}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(app => (
            <tr key={app.id} onClick={() => onSelectApp(app)} style={{ cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "9px 12px", fontWeight: 700, color: "#2980b9", borderBottom: "1px solid #f0f3f5" }}>{app.id}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}>{app.owner.name}</td>
              <td style={{ padding: "9px 12px", color: "#5a6a74", borderBottom: "1px solid #f0f3f5", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.property.address}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 600, color: app.property.roadType === "red" ? "#c0392b" : app.property.roadType === "blue" ? "#2980b9" : "#5a6a74" }}>{app.property.roadType}</td>
              <td style={{ padding: "9px 12px", fontWeight: 600, borderBottom: "1px solid #f0f3f5" }}>{app.crossover.width}m</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}><StatusBadge status={app.status} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
