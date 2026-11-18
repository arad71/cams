import { useCallback, useEffect, useState } from "react";
import { T } from "../../styles/tokens";
import api from "../../services/api";
import { notify } from "./Toast";

// Shows which cadastre lot the application is on, whether the site plan matches
// that lot, and whether the plan has been aligned to the map.
const TONE = {
  ok:   { fg: "#1b7a43", bg: "#e8f5ee", label: "OK" },
  warn: { fg: "#946200", bg: "#fdf3dc", label: "Check" },
  bad:  { fg: "#c0392b", bg: "#fdecea", label: "Problem" },
  none: { fg: "#5a6a74", bg: "#eef2f4", label: "Not yet" },
};

function Row({ title, tone, children, action }) {
  const t = TONE[tone] || TONE.none;
  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 14px", borderTop: `1px solid ${T.c.borderLight}`, alignItems: "flex-start" }}>
      <span style={{ flex: "0 0 auto", minWidth: 64, textAlign: "center", fontSize: 12, fontWeight: 700, color: t.fg, background: t.bg, borderRadius: 10, padding: "2px 8px" }}>{t.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.c.text }}>{title}</div>
        <div style={{ fontSize: 13, color: T.c.textSecondary, lineHeight: 1.45, marginTop: 2 }}>{children}</div>
      </div>
      {action}
    </div>
  );
}

const btn = { flex: "0 0 auto", padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.c.border}`, background: "#fff", color: T.c.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

export default function SiteLocationPanel({ app, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const id = app?._dbId;

  const load = useCallback(async () => {
    if (!id) return;
    try { setData(await api.getSiteLocation(id)); } catch (e) { setData({ error: e.message }); }
  }, [id]);
  useEffect(() => { load(); }, [load, app?.site_plan_data, app?.georef_overlay, app?.lot_polygon]);

  const run = async (kind) => {
    setBusy(kind);
    try {
      const r = kind === "lot" ? await api.resolveLot(id) : await api.autoAlignPlan(id);
      setData(r);
      if (kind === "align" && r?.result?.status !== "aligned") notify(r?.result?.reason || "Couldn't align the plan automatically.", "error");
      if (kind === "align" && r?.result?.status === "aligned") notify("Site plan aligned to the lot.", "success");
      if (onChanged) await onChanged();
    } catch (e) { notify(e.message || "Request failed", "error"); }
    setBusy(null);
  };

  if (!id) return null;
  if (!data) return <div style={{ padding: 12, fontSize: 13, color: T.c.textMuted }}>Checking the site location…</div>;
  if (data.error) return null;

  const lm = data.lot_match;
  const lotTone = !lm ? "none" : lm.status === "matched" ? (lm.confidence === "high" ? "ok" : "warn") : lm.status === "ambiguous" ? "warn" : "bad";
  const pc = data.plan_check || {};
  const pcTone = pc.status === "match" ? "ok" : pc.status === "mismatch" ? "bad" : "none";
  const al = data.alignment || {};
  const alTone = al.status === "ok" ? "ok" : al.status === "warn" ? "warn" : "none";

  return (
    <section aria-label="Site location" style={{ background: T.c.card, border: `1px solid ${T.c.border}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: T.c.textSecondary, textTransform: "uppercase", letterSpacing: 0.3 }}>Site location</div>

      <Row title="Cadastre lot" tone={lotTone}
        action={<button style={btn} disabled={!!busy} onClick={() => run("lot")}>{busy === "lot" ? "Checking…" : "Re-check lot"}</button>}>
        {!lm && "Not checked yet."}
        {lm?.lot && <>Lot {lm.lot.lot_number}, {lm.lot.address}. </>}
        {lm?.status === "matched" && <>Found by {lm.method}.</>}
        {lm && lm.status !== "matched" && <> {lm.reason}</>}
      </Row>

      <Row title="Site plan vs cadastre" tone={pcTone}>
        {pc.summary}
        {pc.checks?.length > 0 && (
          <table style={{ marginTop: 6, borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["", "Plan", "Cadastre", ""].map((h, i) => <th key={i} style={{ textAlign: "left", padding: "2px 12px 2px 0", color: T.c.textMuted, fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{pc.checks.map(c => (
              <tr key={c.item}>
                <td style={{ padding: "2px 12px 2px 0" }}>{c.item}</td>
                <td style={{ padding: "2px 12px 2px 0", fontVariantNumeric: "tabular-nums" }}>{c.plan} {c.unit}</td>
                <td style={{ padding: "2px 12px 2px 0", fontVariantNumeric: "tabular-nums" }}>{c.cadastre} {c.unit}</td>
                <td style={{ color: c.ok ? "#1b7a43" : "#c0392b", fontWeight: 700 }}>{c.ok ? "✓" : "✗ differs"}</td>
              </tr>))}
            </tbody>
          </table>
        )}
      </Row>

      <Row title="Plan on the map" tone={alTone}
        action={<button style={btn} disabled={!!busy || !app?.lot_polygon} onClick={() => run("align")}>{busy === "align" ? "Aligning…" : (al.status === "none" ? "Align automatically" : "Re-align")}</button>}>
        {al.summary}.
        {(al.warnings || []).map((w, i) => <div key={i} style={{ color: "#946200" }}>⚠ {w}</div>)}
        {al.status === "none" && <div>If automatic alignment fails, use the 🗺️ georeference button next to the site plan under Documents.</div>}
      </Row>
    </section>
  );
}
