// ─── Address Autocomplete (Nominatim; biased to City of Kalamunda) ───────────
import { useEffect, useRef, useState } from "react";

function AddressAutocomplete({
  label = "Postal Address",
  value,
  onChange,            // (text) => void
  placeholder = "Start typing an address (e.g., 22 Canning Rd, Kalamunda)",
  required = false,
  error,
  hint,
  inputStyle,
  kalamundaBias = true,
}) {
  const [q, setQ] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(-1);
  const [manual, setManual] = useState(false);
  const boxRef = useRef(null);
  const listId = "addr-listbox-" + Math.random().toString(36).slice(2);

  // Close popover on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!boxRef.current || boxRef.current.contains(e.target)) return;
      setOpen(false);
      setCursor(-1);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch from Nominatim
  useEffect(() => {
    if (manual) return;
    if (!q || q.trim().length < 3) { setItems([]); return; }

    const ctl = new AbortController();
    const id = setTimeout(async () => {
      try {
        setLoading(true);
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", q);
        url.searchParams.set("format", "json");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "8");
        // Australia-only bias (optional)
        url.searchParams.set("countrycodes", "au");

        if (kalamundaBias) {
          // Viewbox roughly around City of Kalamunda (minLon,minLat,maxLon,maxLat)
          // You can tweak bounds as needed.
          url.searchParams.set("viewbox", "115.95,-32.10,116.20,-31.85");
          url.searchParams.set("bounded", "1");
        }

        const res = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "Kalamunda-App/1.0 (Applicant Portal)",
          },
          signal: ctl.signal,
        });
        const data = await res.json();
        const mapped = (data || []).map(r => ({
          id: r.place_id,
          label: r.display_name,
          lat: r.lat,
          lon: r.lon,
          raw: r,
        }));
        setItems(mapped);
        setOpen(true);
      } catch {
        // ignore network/abort
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, kalamundaBias, manual]);

  function choose(item) {
    onChange(item.label);
    setQ(item.label);
    setOpen(false);
    setCursor(-1);
  }

  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      if (open && cursor >= 0 && cursor < items.length) {
        e.preventDefault();
        choose(items[cursor]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setCursor(-1);
    }
  }

  return (
    <div ref={boxRef} style={{ marginBottom: 16, position: "relative" }}>
      <label style={{
        display: "block", fontSize: 12, fontWeight: 700, color: "#3a4a3d",
        marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em"
      }}>
        {label} {required && <span style={{ color: "#c0392b" }}>*</span>}
      </label>

      {/* Toggle manual vs search */}
      <div style={{ fontSize: 11, color: "#6b7c6f", marginBottom: 6 }}>
        <button
          type="button"
          onClick={() => { setManual(m => !m); setOpen(false); }}
          style={{ border: "none", background: "none", color: "#1a5632", fontWeight: 700, cursor: "pointer", padding: 0 }}
        >
          {manual ? "🔎 Use address search" : "✏️ Enter manually"}
        </button>
      </div>

      {/* Input */}
      <input
        style={inputStyle}
        value={manual ? value : q}
        onChange={e => {
          if (manual) onChange(e.target.value);
          else setQ(e.target.value);
        }}
        onFocus={() => { if (!manual && items.length > 0) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        role="combobox"
      />

      {/* Hint & Error */}
      {hint && <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>⚠ {error}</div>}

      {/* Suggestions */}
      {!manual && open && (items.length > 0 || loading) && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
            background: "#fff", border: "1px solid #e2e8e3", borderRadius: 8,
            marginTop: 6, maxHeight: 240, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(26,86,50,0.08)",
          }}
        >
          {loading && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "#6b7c6f" }}>Searching…</div>
          )}
          {!loading && items.map((it, idx) => (
            <div
              key={it.id}
              role="option"
              aria-selected={idx === cursor}
              onMouseDown={(e) => e.preventDefault()}         // prevent input blur on click
              onClick={() => choose(it)}
              onMouseEnter={() => setCursor(idx)}
              style={{
                padding: "10px 12px", fontSize: 12,
                background: idx === cursor ? "rgba(45,138,78,0.08)" : "#fff",
                cursor: "pointer", borderBottom: "1px solid #f3f6f3",
              }}
              title={it.label}
            >
              {it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AddressAutocomplete;