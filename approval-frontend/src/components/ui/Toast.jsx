import { useEffect, useState } from "react";

// Non-blocking notifications that replace window.alert().
export function notify(message, type) {
  const text = String(message ?? "");
  const t = type || (/fail|error|could not|unable|invalid/i.test(text) ? "error" : "info");
  window.dispatchEvent(new CustomEvent("cams:notify", { detail: { message: text, type: t } }));
}

const COLORS = {
  info:    { bg: "#1a3a4a", fg: "#ffffff" },
  success: { bg: "#1b7a43", fg: "#ffffff" },
  error:   { bg: "#c0392b", fg: "#ffffff" },
};

export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const onNotify = (e) => {
      const id = Date.now() + Math.random();
      setItems(x => [...x, { id, ...e.detail }]);
      setTimeout(() => setItems(x => x.filter(i => i.id !== id)), e.detail.type === "error" ? 9000 : 5000);
    };
    window.addEventListener("cams:notify", onNotify);
    return () => window.removeEventListener("cams:notify", onNotify);
  }, []);
  return (
    <div aria-live="polite" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 20000, display: "flex", flexDirection: "column", gap: 8, maxWidth: "min(420px, calc(100vw - 32px))" }}>
      {items.map(i => {
        const c = COLORS[i.type] || COLORS.info;
        return (
          <div key={i.id} role={i.type === "error" ? "alert" : "status"}
            style={{ display: "flex", gap: 10, alignItems: "flex-start", background: c.bg, color: c.fg, padding: "10px 12px", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", fontSize: 14, lineHeight: 1.45 }}>
            <span style={{ flex: 1, whiteSpace: "pre-line" }}>{i.message}</span>
            <button aria-label="Dismiss" onClick={() => setItems(x => x.filter(y => y.id !== i.id))}
              style={{ background: "transparent", border: "none", color: c.fg, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}>{"✕"}</button>
          </div>
        );
      })}
    </div>
  );
}
