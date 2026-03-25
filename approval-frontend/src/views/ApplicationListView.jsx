import { useState, useCallback, useRef, useEffect } from "react";
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';
import api from '../services/api';
import { apiAppToFrontend } from '../utils/transforms';

// ─── Styles ────────────────────────────────────────────
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(12,31,46,0.55)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modalBox = { background: "#fff", borderRadius: 16, width: "min(720px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(12,31,46,0.28)", overflow: "hidden" };
const inputBase = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fafbfc", color: "#1a3a4a", outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" };
const selectBase = { ...inputBase, appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b8090' stroke-width='1.5' fill='none'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 32 };
const labelStyle = { display: "block", fontSize: 10, fontWeight: 700, color: "#5a6a74", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" };
const sectionTitle = { fontSize: 12, fontWeight: 800, color: "#1a3a4a", margin: "18px 0 10px", paddingBottom: 6, borderBottom: "1px solid #edf1f4", display: "flex", alignItems: "center", gap: 6 };
const btnPrimary = { padding: "10px 28px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #1abc9c, #16a085)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 12px rgba(26,188,156,0.25)", transition: "opacity 0.15s" };
const btnSecondary = { padding: "10px 24px", borderRadius: 10, border: "1.5px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };

function Field({ label, required, span, children }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={labelStyle}>{label}{required && <span style={{ color: "#c0392b" }}> *</span>}</label>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Address → Lot Boundary matching
// ═══════════════════════════════════════════════════════
const ROAD_TYPE_MAP = {
  // Standard abbreviations → canonical form (matching lot.geojson)
  RD: "RD", ROAD: "RD", CR: "CR", CRES: "CR", CRESCENT: "CR", ST: "ST", STREET: "ST",
  AVE: "AV", AV: "AV", AVENUE: "AV", HWY: "HWY", HIGHWAY: "HWY", DR: "DR", DRIVE: "DR",
  CT: "CT", COURT: "CT", WAY: "WAY", PL: "PL", PLACE: "PL", CL: "CL", CLOSE: "CL",
  GDNS: "GDNS", GARDENS: "GDNS", LOOP: "LOOP", TCE: "TCE", TERRACE: "TCE", LANE: "LANE",
  BVD: "BVD", BOULEVARD: "BVD", GR: "GR", GROVE: "GR", MEWS: "MEWS", GRN: "GRN",
  GREEN: "GRN", CCT: "CCT", CIRCUIT: "CCT", CIR: "CIR", CIRCLE: "CIR",
  // Extended types from City of Kalamunda lot.geojson
  APP: "APP", APPROACH: "APP", BEND: "BEND", CH: "CH", CHASE: "CH",
  CNR: "CNR", CORNER: "CNR", CRSS: "CRSS", CROSS: "CRSS", CROSSING: "CRSS",
  ELB: "ELB", ELBOW: "ELB", ENT: "ENT", ENTRANCE: "ENT",
  FAWY: "FAWY", FAIRWAY: "FAWY", HTS: "HTS", HEIGHTS: "HTS",
  LINK: "LINK", MALL: "MALL", PASS: "PASS", PASSAGE: "PASS",
  PDE: "PDE", PARADE: "PDE", REST: "REST", RISE: "RISE",
  RMBL: "RMBL", RAMBLE: "RMBL", RTT: "RTT", RETREAT: "RTT",
  SQ: "SQ", SQUARE: "SQ", TURN: "TURN", VALE: "VALE",
  VIEW: "VIEW", VSTA: "VSTA", VISTA: "VSTA",
};
const ALL_ROAD_TYPES = new Set(Object.values(ROAD_TYPE_MAP));
function normaliseRoadType(s) { return ROAD_TYPE_MAP[(s || "").toUpperCase().trim()] || (s || "").toUpperCase().trim(); }

function parseAddress(addr) {
  if (!addr) return null;
  const tokens = addr.replace(/,/g, " ").replace(/\s+/g, " ").trim().toUpperCase().split(" ");
  if (tokens.length < 2) return null;
  const numMatch = tokens[0].match(/^(\d+[A-Z]?)/);
  if (!numMatch) return null;
  const rest = tokens.slice(1);
  let rti = -1;
  for (let i = 0; i < rest.length; i++) { if (ALL_ROAD_TYPES.has(normaliseRoadType(rest[i]))) { rti = i; break; } }
  // If no road type found, treat all remaining as road name (fuzzy match will handle it)
  if (rti < 1) {
    const road_name = rest.join(" ");
    if (!road_name) return null;
    return { road_number_1: numMatch[1], road_name, road_type: null, locality: null };
  }
  const locality = rest.slice(rti + 1).join(" ") || null;
  return { road_number_1: numMatch[1], road_name: rest.slice(0, rti).join(" "), road_type: normaliseRoadType(rest[rti]), locality };
}

function findLotByAddress(lotsData, address) {
  if (!lotsData?.features || !address) return null;
  // Strip postcodes and clean
  const cleaned = address.replace(/\b\d{4}\b/g, "").trim();
  const q = parseAddress(cleaned);
  if (!q) return null;

  // Score each feature — higher is better
  let bestFeat = null, bestScore = 0;
  for (const feat of lotsData.features) {
    const p = feat.properties || {};
    const pNum = String(p.road_number_1 || "").trim();
    const pName = (p.road_name || "").toUpperCase().replace(/\s+/g, " ").trim();
    const pType = normaliseRoadType(p.road_type || "");
    const pLoc = (p.locality || "").toUpperCase().replace(/\s+/g, " ").trim();

    // Must match number
    if (pNum !== q.road_number_1) continue;

    let score = 0;

    // Road name: exact match (3), starts-with or contains (2), partial (1)
    if (pName === q.road_name) score += 3;
    else if (pName.startsWith(q.road_name) || q.road_name.startsWith(pName)) score += 2;
    else if (pName.includes(q.road_name) || q.road_name.includes(pName)) score += 1;
    else continue; // no name match at all → skip

    // Road type: exact (2), skip if query has no type (neutral)
    if (q.road_type) {
      if (pType === q.road_type) score += 2;
    }

    // Locality: exact (3), partial (1), not provided = neutral
    if (q.locality) {
      if (pLoc === q.locality) score += 3;
      else if (pLoc.includes(q.locality) || q.locality.includes(pLoc)) score += 1;
    }

    if (score > bestScore) { bestScore = score; bestFeat = feat; }
  }
  return bestFeat;
}

function extractPolygon(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  let ring = g.type === "Polygon" ? g.coordinates?.[0] : g.type === "MultiPolygon" ? g.coordinates?.[0]?.[0] : null;
  if (!ring || ring.length < 3) return null;
  // Convert [lng, lat] → [lat, lng]
  let poly = ring.map(([lng, lat]) => [lat, lng]);
  // Remove closing point for simplification
  if (poly.length > 3 && poly[0][0] === poly[poly.length-1][0] && poly[0][1] === poly[poly.length-1][1]) poly = poly.slice(0, -1);
  // Remove collinear mid-side points (Douglas-Peucker)
  poly = simplifyPolygon(poly);
  // Re-close
  if (poly.length >= 3) poly.push([poly[0][0], poly[0][1]]);
  return poly;
}

// Douglas-Peucker polygon simplification — removes mid-side points
function simplifyPolygon(points, epsilon) {
  if (points.length <= 4) return points;
  // Auto epsilon: 1% of bounding box diagonal
  if (!epsilon) {
    const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
    const diag = Math.sqrt(Math.pow(Math.max(...lats) - Math.min(...lats), 2) + Math.pow(Math.max(...lngs) - Math.min(...lngs), 2));
    epsilon = diag * 0.01;
  }
  function perpDist(pt, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt(Math.pow(pt[0]-a[0], 2) + Math.pow(pt[1]-a[1], 2));
    const t = Math.max(0, Math.min(1, ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / lenSq));
    return Math.sqrt(Math.pow(pt[0] - (a[0]+t*dx), 2) + Math.pow(pt[1] - (a[1]+t*dy), 2));
  }
  function dp(pts, eps) {
    if (pts.length <= 2) return pts;
    let dmax = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpDist(pts[i], pts[0], pts[pts.length-1]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      const left = dp(pts.slice(0, idx + 1), eps);
      const right = dp(pts.slice(idx), eps);
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length-1]];
  }
  // For closed polygon: run on the open ring
  const simplified = dp([...points, points[0]], epsilon);
  // Remove re-added closing point
  if (simplified.length > 1 && simplified[0][0] === simplified[simplified.length-1][0] && simplified[0][1] === simplified[simplified.length-1][1]) {
    return simplified.slice(0, -1);
  }
  return simplified;
}

// ─── Document categories ───────────────────────────────
const DOC_CATEGORIES = [
  { id: "application_form", label: "Application Form", icon: "📄", accept: ".pdf", hint: "Upload the crossover application form PDF — fields will be auto-extracted", extract: "form" },
  { id: "site_plan", label: "Site Plan", icon: "📐", accept: ".pdf,.jpg,.jpeg,.png", hint: "Site plan — AI will extract dimensions, materials, and compliance data", extract: "siteplan" },
  { id: "building_application", label: "Building Application", icon: "🏗️", accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx", hint: "Building application / development approval documents" },
  { id: "certificate_of_title", label: "Certificate of Title", icon: "📜", accept: ".pdf,.jpg,.jpeg,.png", hint: "Current Certificate of Title" },
  { id: "engineering_drawing", label: "Engineering Drawing", icon: "📏", accept: ".pdf,.jpg,.jpeg,.png,.dwg", hint: "Engineering/structural drawings for non-standard crossovers" },
  { id: "photos", label: "Site Photos", icon: "📷", accept: ".jpg,.jpeg,.png,.webp", hint: "Photos of the verge, existing crossover, and street frontage" },
  { id: "arborist_report", label: "Arborist Report", icon: "🌳", accept: ".pdf,.doc,.docx", hint: "Arborist report if trees within 3m of proposed crossover" },
  { id: "stormwater_plan", label: "Stormwater/Drainage Plan", icon: "💧", accept: ".pdf,.jpg,.jpeg,.png", hint: "Stormwater management or drainage plan" },
  { id: "dbyd_report", label: "Dial Before You Dig", icon: "⚡", accept: ".pdf", hint: "DBYD search results for underground services" },
  { id: "other", label: "Other Documents", icon: "📎", accept: ".pdf,.jpg,.jpeg,.png,.doc,.docx", hint: "Any other supporting documents" },
];

const blankForm = {
  owner_name: "", owner_phone: "", owner_email: "", owner_postal_address: "",
  property_address: "", lot_number: "", plan_number: "", lot_type: "green_title",
  frontage: "", depth: "", road_name: "", road_type: "local", road_width: "", verge_width: "",
  crossover_width: "", crossover_count: "1", crossover_surface: "concrete",
  crossover_est_date: "", da_number: "", offset_from_left: "",
  declaration_signed: false, date_signed: "", attachment_count: "",
  trees_nearby: false, tree_protection: "", clearing: false, drainage_type: "none", culvert: false,
};

// ═══════════════════════════════════════════════════════
//  Document Upload Card
// ═══════════════════════════════════════════════════════
function DocUploadCard({ cat, file, onFileChange, processing, processResult, skipped, onSkip }) {
  const inputRef = useRef(null);
  const hasFile = !!file;
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, border: hasFile ? "1.5px solid #27ae60" : skipped ? "1.5px solid #95a5a6" : "1.5px dashed #c8d5cb", background: hasFile ? "#f0faf3" : skipped ? "#f8f9fa" : "#fafcfa", transition: "all 0.2s", opacity: skipped ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{cat.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a4a" }}>{cat.label}</div>
          <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 1 }}>{cat.hint}</div>
        </div>
        {hasFile && <span style={{ fontSize: 14, color: "#27ae60" }}>✓</span>}
        {skipped && !hasFile && <span style={{ fontSize: 10, color: "#95a5a6", fontWeight: 700 }}>Later</span>}
      </div>
      {hasFile ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#e8f5e9", borderRadius: 6 }}>
          <span style={{ fontSize: 11, color: "#2c6e49", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
          <button onClick={() => onFileChange(null)} style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "2px 6px" }}>✕</button>
        </div>
      ) : skipped ? (
        <button onClick={() => onSkip(false)}
          style={{ width: "100%", padding: "7px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 600, color: "#2980b9", fontFamily: "inherit" }}>
          ↩ Upload now instead
        </button>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => inputRef.current?.click()} disabled={processing}
            style={{ flex: 1, padding: "8px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#5a6a74", fontFamily: "inherit" }}>
            {processing ? "⏳ Analysing…" : "Choose File"}
          </button>
          <button onClick={() => onSkip(true)}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #e4e9ec", background: "#f8f9fa", cursor: "pointer", fontSize: 10, fontWeight: 600, color: "#95a5a6", fontFamily: "inherit" }}>
            Add later
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" accept={cat.accept} style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onSkip(false); onFileChange(f); } e.target.value = ""; }} />
      {processResult && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: 11, lineHeight: 1.5,
          background: processResult.success ? "#eafaf1" : "#fef9e7",
          border: processResult.success ? "1px solid #d4efdf" : "1px solid #f9e79f",
          color: processResult.success ? "#2c6e49" : "#7d6608" }}>
          {processResult.success ? (
            <><strong style={{ color: "#27ae60" }}>✅ {processResult.title}</strong> — {processResult.message}
              {processResult.details && <div style={{ marginTop: 4, fontSize: 10, color: "#5a7a64" }}>{processResult.details}</div>}
            </>
          ) : (<><strong>⚠️ {processResult.title || "Issue"}</strong> — {processResult.message}</>)}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════
//  New Application Modal
// ═══════════════════════════════════════════════════════
function NewApplicationModal({ onClose, onCreated, globalLotsData }) {
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [lotPolygon, setLotPolygon] = useState(null);
  const [lotMatch, setLotMatch] = useState(null);
  const [matchedFeatureProps, setMatchedFeatureProps] = useState(null);
  const [documents, setDocuments] = useState({});
  const [processing, setProcessing] = useState({});  // { catId: true/false }
  const [processResults, setProcessResults] = useState({});  // { catId: result }
  const [sitePlanData, setSitePlanData] = useState(null);  // full AI extraction JSON

  const set = (key) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [key]: val }));
    if (key === "property_address") { setLotMatch(null); setLotPolygon(null); setMatchedFeatureProps(null); }
  };

  // ── Lot lookup ────────────────────────────────────────
  const lookupLotBoundary = useCallback((address) => {
    const addr = (address || "").trim();
    if (!addr) { setLotMatch(null); setLotPolygon(null); setMatchedFeatureProps(null); return; }
    const parsed = parseAddress(addr);
    if (!parsed) { setLotMatch("parsing_error"); setLotPolygon(null); setMatchedFeatureProps(null); return; }
    const feature = findLotByAddress(globalLotsData, addr);
    if (feature) {
      const poly = extractPolygon(feature);
      setLotPolygon(poly); setMatchedFeatureProps(feature.properties); setLotMatch("found");
      const fp = feature.properties || {};
      setForm(prev => ({
        ...prev,
        lot_number: prev.lot_number || (fp.lot_number ? String(fp.lot_number) : ""),
        road_name: prev.road_name || (fp.road_name ? (fp.road_name.charAt(0) + fp.road_name.slice(1).toLowerCase() + (fp.road_type ? " " + fp.road_type : "")) : ""),
      }));
    } else { setLotMatch("not_found"); setLotPolygon(null); setMatchedFeatureProps(null); }
  }, [globalLotsData]);

  // ── Address autocomplete from lot.geojson ───────────────
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Build reverse road type lookup: canonical → all variants
  // e.g. "CR" → ["CR", "CRES", "CRESCENT"]
  const ROAD_TYPE_VARIANTS = useRef(null);
  if (!ROAD_TYPE_VARIANTS.current) {
    const rev = {};
    for (const [variant, canonical] of Object.entries(ROAD_TYPE_MAP)) {
      if (!rev[canonical]) rev[canonical] = new Set();
      rev[canonical].add(variant);
      rev[canonical].add(canonical);
    }
    ROAD_TYPE_VARIANTS.current = rev;
  }

  // Search lot.geojson features by partial address text
  const searchLots = useCallback((query) => {
    if (!query || query.length < 2 || !globalLotsData?.features) { setSuggestions([]); return; }
    // Clean: remove commas, strip postcodes (4-digit numbers), normalise whitespace
    const cleaned = query.toUpperCase().replace(/,/g, " ").replace(/\b\d{4}\b/g, "").replace(/\s+/g, " ").trim();
    if (!cleaned) { setSuggestions([]); return; }

    // Normalise each token: convert road type variants to canonical form
    const rawTokens = cleaned.split(" ").filter(Boolean);
    const tokens = rawTokens.map(t => {
      const canonical = ROAD_TYPE_MAP[t];
      return canonical || t; // normalise "CRESCENT" → "CR", "ROAD" → "RD", etc.
    });

    const results = [];
    for (const feat of globalLotsData.features) {
      if (results.length >= 10) break;
      const p = feat.properties || {};
      const num = String(p.road_number_1 || "");
      const name = (p.road_name || "").toUpperCase();
      const type = (p.road_type || "").toUpperCase();
      const loc = (p.locality || "").toUpperCase();

      // Build searchable text: include canonical type AND all variants
      const typeVariants = ROAD_TYPE_VARIANTS.current[type] ? [...ROAD_TYPE_VARIANTS.current[type]].join(" ") : type;
      const full = `${num} ${name} ${type} ${typeVariants} ${loc}`;

      // Score: each matching token adds points
      let score = 0;
      let allMatch = true;
      for (const t of tokens) {
        if (full.includes(t)) {
          score += (t === num ? 3 : t === name ? 3 : t === type ? 2 : 1);
        } else {
          allMatch = false;
        }
      }
      // Require at least all tokens match, or score high enough for partial
      if (allMatch || (score >= tokens.length && score >= 3)) {
        const display = [num, name, type].filter(Boolean).join(" ");
        const displayFull = [display, loc].filter(Boolean).join(", ");
        results.push({ display: displayFull, num, name, type, loc, feature: feat, score });
      }
    }
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    setSuggestions(results.slice(0, 8));
    setShowSuggestions(results.length > 0);
  }, [globalLotsData]);

  const handleAddressInput = useCallback((e) => {
    const val = e.target.value;
    setForm(prev => ({ ...prev, property_address: val }));
    setLotMatch(null); setLotPolygon(null); setMatchedFeatureProps(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLots(val), 150);
  }, [searchLots]);

  // Select a suggestion
  const selectSuggestion = useCallback((s) => {
    setForm(prev => ({ ...prev, property_address: s.display }));
    setShowSuggestions(false);
    setSuggestions([]);
    const poly = extractPolygon(s.feature);
    const fp = s.feature.properties || {};
    if (poly) {
      setLotPolygon(poly); setMatchedFeatureProps(fp); setLotMatch("found");
      setForm(prev => ({
        ...prev, property_address: s.display,
        lot_number: prev.lot_number || (fp.lot_number ? String(fp.lot_number) : ""),
        road_name: prev.road_name || (fp.road_name ? (fp.road_name.charAt(0) + fp.road_name.slice(1).toLowerCase() + (fp.road_type ? " " + fp.road_type : "")) : ""),
      }));
    } else {
      setLotMatch("not_found"); setLotPolygon(null); setMatchedFeatureProps(null);
    }
  }, []);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Blur fallback — for manually typed addresses without selecting a suggestion
  const handleAddressBlur = useCallback(() => {
    setTimeout(() => {
      if (!showSuggestions) lookupLotBoundary(form.property_address);
    }, 250);
  }, [form.property_address, lookupLotBoundary, showSuggestions]);

  // ── Application Form PDF extraction ──────────────────
  const handleAppFormUpload = useCallback(async (file) => {
    setDocuments(prev => ({ ...prev, application_form: file }));
    if (!file) { setProcessResults(prev => ({ ...prev, application_form: null })); return; }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setProcessResults(prev => ({ ...prev, application_form: { success: false, title: "Not a PDF", message: "Auto-extraction only works with PDF files." } }));
      return;
    }
    setProcessing(prev => ({ ...prev, application_form: true }));
    setProcessResults(prev => ({ ...prev, application_form: null }));
    try {
      const result = await api.extractAppForm(file);
      const values = result.values || {};
      const mapping = { lot_owner_name: "owner_name", phone: "owner_phone", email: "owner_email", postal_address: "owner_postal_address", property_address: "property_address", estimated_construction_date: "crossover_est_date", dev_application_number: "da_number", date_signed: "date_signed", num_attachments: "attachment_count" };
      const filled = [];
      const updates = {};
      for (const [ek, fk] of Object.entries(mapping)) {
        let val = values[ek];
        if (val && typeof val === "string" && val.trim()) {
          updates[fk] = val.trim(); filled.push(ek);
        }
      }
      // Handle signature as boolean
      const sig = values.lot_owner_signature;
      if (sig && typeof sig === "string" && sig.trim() && sig.trim().toLowerCase() !== "not signed" && sig.trim() !== "-") {
        updates.declaration_signed = true; filled.push("lot_owner_signature");
      }
      if (Object.keys(updates).length > 0) {
        setForm(prev => {
          const m = { ...prev };
          for (const [k, v] of Object.entries(updates)) {
            // Only overwrite empty fields; handle booleans/numbers properly
            if (typeof v === "boolean") { m[k] = v; }
            else if (typeof m[k] === "string" && !m[k].trim()) { m[k] = v; }
            else if (!m[k]) { m[k] = v; }
          }
          return m;
        });
        if (updates.property_address) setTimeout(() => lookupLotBoundary(updates.property_address), 100);
      }
      const names = { lot_owner_name: "Owner Name", phone: "Phone", email: "Email", postal_address: "Postal Address", property_address: "Property Address", estimated_construction_date: "Est. Date", dev_application_number: "DA Number" };
      setProcessResults(prev => ({ ...prev, application_form: { success: true, title: "Form data extracted", message: `${filled.length} of ${result.summary?.total_fields || 10} fields auto-filled`, details: filled.length > 0 ? "Filled: " + filled.map(f => names[f] || f).join(", ") : null } }));
    } catch (e) {
      setProcessResults(prev => ({ ...prev, application_form: { success: false, title: "Extraction failed", message: e.message || "Fill in fields manually." } }));
    } finally {
      setProcessing(prev => ({ ...prev, application_form: false }));
    }
  }, [lookupLotBoundary]);

  // ── Site Plan AI analysis ────────────────────────────
  const handleSitePlanUpload = useCallback(async (file) => {
    setDocuments(prev => ({ ...prev, site_plan: file }));
    if (!file) { setProcessResults(prev => ({ ...prev, site_plan: null })); setSitePlanData(null); return; }
    setProcessing(prev => ({ ...prev, site_plan: true }));
    setProcessResults(prev => ({ ...prev, site_plan: null }));
    try {
      const result = await api.analyseSitePlan(file);

      // Check for error response
      if (result.error) {
        setProcessResults(prev => ({ ...prev, site_plan: { success: false, title: "Analysis error", message: result.error } }));
        return;
      }

      // Store the full extraction JSON for saving to site_plan_data
      setSitePlanData(result);

      // Extract and auto-fill relevant application fields
      const ext = result.extraction || {};
      const dims = ext.crossover_dimensions || {};
      const cons = ext.construction || {};
      const site = ext.siteplan_measurements || {};
      const drain = ext.drainage || {};
      const prop = ext.property || {};
      const additional = ext.additional_findings || {};

      const filledFields = [];

      setForm(prev => {
        const m = { ...prev };

        // Crossover width
        if (dims.width_at_boundary_m && !m.crossover_width) {
          m.crossover_width = String(dims.width_at_boundary_m);
          filledFields.push("Crossover Width");
        }

        // Surface material
        if (cons.material && (!m.crossover_surface || m.crossover_surface === "concrete")) {
          const mat = cons.material.toLowerCase();
          if (mat.includes("asphalt")) m.crossover_surface = "asphalt";
          else if (mat.includes("brick") || mat.includes("paver")) m.crossover_surface = "brick_paver";
          else if (mat.includes("gravel")) m.crossover_surface = "gravel";
          else if (mat.includes("concrete")) m.crossover_surface = "concrete";
          else m.crossover_surface = "other";
          filledFields.push("Surface Material");
        }

        // Road name from site plan
        if (site.road_name && !m.road_name) {
          m.road_name = site.road_name;
          filledFields.push("Road Name");
        }

        // Lot frontage
        if (site.lot_frontage_m && !m.frontage) {
          m.frontage = String(site.lot_frontage_m);
          filledFields.push("Frontage");
        }

        // Verge width / depth
        if (dims.verge_depth_m && !m.verge_width) {
          m.verge_width = String(dims.verge_depth_m);
          filledFields.push("Verge Width");
        }

        // Lot number from site plan property info
        if (prop.lot_number && !m.lot_number) {
          m.lot_number = String(prop.lot_number);
          filledFields.push("Lot Number");
        }

        // Offset from left (splay)
        if (dims.splay_left_m && !m.offset_from_left) {
          m.offset_from_left = String(dims.splay_left_m);
          filledFields.push("Offset/Splay Left");
        }

        // Drainage type
        if (!m.drainage_type || m.drainage_type === "none") {
          if (drain.soakwells_proposed || drain.storage_tanks_proposed) {
            m.drainage_type = "pipe_culvert";
            filledFields.push("Drainage Type");
          } else if (drain.connection_to_council_drain) {
            m.drainage_type = "kerb_inlet";
            filledFields.push("Drainage Type");
          } else if (drain.drainage_plan_included) {
            m.drainage_type = "other";
            filledFields.push("Drainage Type");
          }
        }

        // Culvert
        if (drain.pipe_diameter_mm && !m.culvert) {
          m.culvert = true;
          filledFields.push("Culvert");
        }

        // Vegetation on verge
        if (additional.vegetation_on_verge === true && !m.trees_nearby) {
          m.trees_nearby = true;
          filledFields.push("Trees Nearby");
        }

        return m;
      });

      // Build compliance summary
      const comp = result.compliance || {};
      const summary = comp.summary || {};
      const recommendation = comp.recommendation || "N/A";

      setProcessResults(prev => ({ ...prev, site_plan: {
        success: true,
        title: "Site plan analysed",
        message: `${filledFields.length} fields auto-filled. Compliance: ${summary.passed || 0} pass, ${summary.failed || 0} fail, ${summary.requires_verification || 0} to verify.`,
        details: filledFields.length > 0
          ? `Filled: ${filledFields.join(", ")}. Recommendation: ${recommendation.replace(/_/g, " ")}`
          : `Recommendation: ${recommendation.replace(/_/g, " ")}. Data saved for assessment.`,
      } }));
    } catch (e) {
      setProcessResults(prev => ({ ...prev, site_plan: { success: false, title: "Analysis failed", message: e.message || "Site plan could not be analysed. Data can be entered manually." } }));
    } finally {
      setProcessing(prev => ({ ...prev, site_plan: false }));
    }
  }, []);

  // ── Generic doc handler ──────────────────────────────
  const handleDocChange = useCallback((catId, file) => {
    if (catId === "application_form") { handleAppFormUpload(file); return; }
    if (catId === "site_plan") { handleSitePlanUpload(file); return; }
    setDocuments(prev => { const n = { ...prev }; if (file) n[catId] = file; else delete n[catId]; return n; });
    if (!file) setProcessResults(prev => ({ ...prev, [catId]: null }));
  }, [handleAppFormUpload, handleSitePlanUpload]);

  const steps = [
    { label: "Documents & Owner", icon: "📄" },
    { label: "Property & Road", icon: "📍" },
    { label: "Crossover Design", icon: "📐" },
    { label: "Vegetation & Drainage", icon: "🌳" },
  ];

  const canGoNext = () => {
    if (step === 0) return !!(form.owner_name.trim() && form.property_address.trim());
    if (step === 1) return true;
    if (step === 2) return true;
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true); setError(null);
    try {
      const payload = {
        owner_name: form.owner_name,
        owner_phone: form.owner_phone || null,
        owner_email: form.owner_email || null,
        owner_postal_address: form.owner_postal_address || null,
        property_address: form.property_address,
        lot_number: form.lot_number || null,
        plan_number: form.plan_number || null,
        lot_type: form.lot_type || null,
        frontage: form.frontage ? parseFloat(form.frontage) : null,
        depth: form.depth ? parseFloat(form.depth) : null,
        road_name: form.road_name || null,
        road_type: form.road_type || "local",
        road_width: form.road_width ? parseFloat(form.road_width) : null,
        verge_width: form.verge_width ? parseFloat(form.verge_width) : null,
        crossover_width: form.crossover_width ? parseFloat(form.crossover_width) : null,
        crossover_count: parseInt(form.crossover_count) || 1,
        crossover_surface: form.crossover_surface || null,
        crossover_est_date: form.crossover_est_date || null,
        da_number: form.da_number || null,
        offset_from_left: form.offset_from_left ? parseFloat(form.offset_from_left) : null,
        declaration_signed: !!form.declaration_signed,
        date_signed: form.date_signed || null,
        attachment_count: form.attachment_count ? parseInt(form.attachment_count) : null,
        trees_nearby: form.trees_nearby,
        tree_protection: form.tree_protection || null,
        clearing: form.clearing,
        drainage_type: form.drainage_type || null,
        culvert: form.culvert,
        lot_polygon: lotPolygon,
        site_plan_data: sitePlanData,
      };
      const result = await api.createApp(payload);
      const appId = result.id;
      const catLabels = {}; DOC_CATEGORIES.forEach(c => { catLabels[c.id] = c.label; });
      for (const [catId, file] of Object.entries(documents)) {
        if (file) {
          try {
            await api.uploadDocument(appId, file, catLabels[catId] || catId);
          } catch (de) { console.warn(`Failed to upload doc ${file.name}:`, de); }
        }
      }
      onCreated(result); onClose();
    } catch (e) { setError(e.message || "Failed to create application"); } finally { setSaving(false); }
  };

  // ── Lot match banner ──────────────────────────────────
  const renderLotBanner = () => {
    if (!lotMatch) return null;
    if (lotMatch === "found") { const fp = matchedFeatureProps || {}; return (<div style={{ marginTop: 10, padding: "10px 14px", background: "#eafaf1", borderRadius: 8, border: "1px solid #d4efdf", fontSize: 12, lineHeight: 1.6 }}><div style={{ fontWeight: 800, color: "#27ae60", marginBottom: 4 }}>✅ Lot Boundary Found</div><div style={{ color: "#2c6e49", fontSize: 11 }}>Matched: <strong>{fp.road_number_1} {fp.road_name} {fp.road_type}</strong>, {fp.locality}{fp.lot_number && <> — Lot {fp.lot_number}</>} — {lotPolygon?.length || 0} boundary points.</div></div>); }
    if (lotMatch === "not_found") return (<div style={{ marginTop: 10, padding: "10px 14px", background: "#fef9e7", borderRadius: 8, border: "1px solid #f9e79f", fontSize: 12 }}><strong style={{ color: "#b7950b" }}>⚠️ No Exact Lot Match</strong> <span style={{ color: "#7d6608", fontSize: 11 }}>— Boundary not found. You can still proceed — the lot boundary can be added later. Try format: <strong>54 Stirling Cr, High Wycombe</strong></span></div>);
    if (lotMatch === "parsing_error") return (<div style={{ marginTop: 10, padding: "10px 14px", background: "#f9f0f0", borderRadius: 8, border: "1px solid #e6d5d5", fontSize: 12 }}><strong style={{ color: "#a04040" }}>ℹ️ Could Not Parse Address</strong> <span style={{ color: "#784040", fontSize: 11 }}>— You can still proceed. Try: <strong>12 Railway Rd, Kalamunda</strong> or <strong>5 Mead St Kalamunda</strong></span></div>);
    return null;
  };

  // ══════════════════════════════════════════════════════
  //  STEP RENDERERS
  // ══════════════════════════════════════════════════════
  const [skippedDocs, setSkippedDocs] = useState({});  // { catId: true }
  const [showDocUpload] = useState(true);

  const renderStep0 = () => (
    <>
      <div style={sectionTitle}><span>📎</span> Upload Documents</div>
      <div style={{ fontSize: 11, color: "#7a8a94", marginBottom: 10, lineHeight: 1.5 }}>
        Upload documents now or click <strong>"Add later"</strong> on any item to skip — you can always upload from the application detail page.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        {DOC_CATEGORIES.map(cat => (
          <DocUploadCard key={cat.id} cat={cat} file={documents[cat.id] || null}
            onFileChange={f => handleDocChange(cat.id, f)}
            processing={!!processing[cat.id]}
            processResult={processResults[cat.id] || null}
            skipped={!!skippedDocs[cat.id]}
            onSkip={(val) => setSkippedDocs(prev => ({ ...prev, [cat.id]: val }))} />
        ))}
      </div>
      <div style={sectionTitle}><span>👤</span> Owner / Applicant Information</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Full Name" required span={2}><input style={inputBase} value={form.owner_name} onChange={set("owner_name")} placeholder="e.g. John Smith" /></Field>
        <Field label="Phone"><input style={inputBase} value={form.owner_phone} onChange={set("owner_phone")} placeholder="04xx xxx xxx" /></Field>
        <Field label="Email"><input style={inputBase} type="email" value={form.owner_email} onChange={set("owner_email")} placeholder="john@example.com" /></Field>
        <Field label="Postal Address" span={2}><input style={inputBase} value={form.owner_postal_address} onChange={set("owner_postal_address")} placeholder="Postal address for correspondence" /></Field>
      </div>
      <div style={{ ...sectionTitle, marginTop: 22 }}><span>📍</span> Property Address</div>
      <Field label="Property Address" required>
        <div style={{ position: "relative" }} ref={suggestionsRef}>
          <input style={{ ...inputBase, borderColor: lotMatch === "found" ? "#27ae60" : lotMatch === "not_found" ? "#f39c12" : "#d5dde2" }}
            value={form.property_address} onChange={handleAddressInput} onBlur={handleAddressBlur}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="Start typing an address... e.g. 54 Stirling" autoComplete="off" />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999, background: "#fff", borderRadius: "0 0 8px 8px", border: "1.5px solid #d5dde2", borderTop: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", maxHeight: 220, overflowY: "auto" }}
              onMouseDown={e => e.preventDefault()}>
              {suggestions.map((s, i) => (
                <div key={i} onClick={(e) => { e.stopPropagation(); selectSuggestion(s); }}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f5f7f8", fontSize: 12, color: "#1a3a4a" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f8ff"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontWeight: 600 }}>{s.display}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>
      {renderLotBanner()}
    </>
  );

  const renderStep1 = () => (
    <>
      <div style={sectionTitle}><span>📍</span> Lot / Property Details</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Lot Number"><input style={inputBase} value={form.lot_number} onChange={set("lot_number")} placeholder="e.g. 145" /></Field>
        <Field label="Plan / Diagram Number"><input style={inputBase} value={form.plan_number} onChange={set("plan_number")} placeholder="e.g. P012345" /></Field>
        <Field label="Lot Type"><select style={selectBase} value={form.lot_type} onChange={set("lot_type")}><option value="green_title">Green Title</option><option value="strata">Strata</option><option value="survey_strata">Survey Strata</option><option value="battleaxe">Battleaxe</option><option value="commercial">Commercial</option></select></Field>
        <Field label="Frontage (m)"><input style={inputBase} type="number" step="0.1" value={form.frontage} onChange={set("frontage")} placeholder="0.0" /></Field>
        <Field label="Depth (m)"><input style={inputBase} type="number" step="0.1" value={form.depth} onChange={set("depth")} placeholder="0.0" /></Field>
        <Field label="DA / Approval Number"><input style={inputBase} value={form.da_number} onChange={set("da_number")} placeholder="Optional" /></Field>
      </div>
      {lotMatch === "found" && lotPolygon && (<div style={{ marginTop: 14, padding: "10px 14px", background: "#eafaf1", borderRadius: 8, border: "1px solid #d4efdf", fontSize: 11, color: "#2c6e49" }}><strong style={{ color: "#27ae60" }}>✅ Lot Boundary:</strong> {lotPolygon.length} points captured.</div>)}
      <div style={{ ...sectionTitle, marginTop: 22 }}><span>🛣️</span> Road Information</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Road Name" span={2}><input style={inputBase} value={form.road_name} onChange={set("road_name")} placeholder="e.g. Railway Road" /></Field>
        <Field label="Road Classification"><select style={selectBase} value={form.road_type} onChange={set("road_type")}><option value="local">Local</option><option value="red">Red (District Distributor)</option><option value="blue">Blue (Local Distributor)</option><option value="green">Green (Access)</option></select></Field>
        <Field label="Road Width (m)"><input style={inputBase} type="number" step="0.1" value={form.road_width} onChange={set("road_width")} placeholder="0.0" /></Field>
        <Field label="Verge Width (m)"><input style={inputBase} type="number" step="0.1" value={form.verge_width} onChange={set("verge_width")} placeholder="0.0" /></Field>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      <div style={sectionTitle}><span>📐</span> Crossover Design</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Crossover Width (m)"><input style={inputBase} type="number" step="0.1" value={form.crossover_width} onChange={set("crossover_width")} placeholder="e.g. 4.5" /></Field>
        <Field label="Number of Crossovers"><select style={selectBase} value={form.crossover_count} onChange={set("crossover_count")}><option value="1">1 — Single</option><option value="2">2 — Dual</option></select></Field>
        <Field label="Surface Material"><select style={selectBase} value={form.crossover_surface} onChange={set("crossover_surface")}><option value="concrete">Concrete</option><option value="asphalt">Asphalt</option><option value="brick_paver">Brick Paver</option><option value="gravel">Gravel</option><option value="other">Other</option></select></Field>
        <Field label="Offset from Left Boundary (m)"><input style={inputBase} type="number" step="0.1" value={form.offset_from_left} onChange={set("offset_from_left")} placeholder="0.0" /></Field>
        <Field label="Est. Construction Date" span={2}><input style={inputBase} type="text" value={form.crossover_est_date} onChange={set("crossover_est_date")} placeholder="e.g. 15/03/2026" /></Field>
      </div>
      {sitePlanData && (<div style={{ marginTop: 14, padding: "10px 14px", background: "#ebf5fb", borderRadius: 8, border: "1px solid #d4e6f1", fontSize: 11, color: "#2471a3", lineHeight: 1.6 }}><strong>📐 AI Site Plan Data:</strong> Full extraction with {(sitePlanData.compliance?.checks || []).length} compliance checks stored. Recommendation: <strong>{(sitePlanData.compliance?.recommendation || "N/A").replace(/_/g, " ")}</strong></div>)}
      <div style={{ marginTop: 14, padding: "10px 14px", background: "#f5f8fa", borderRadius: 8, fontSize: 11, color: "#5a6a74", lineHeight: 1.6 }}><strong style={{ color: "#1a3a4a" }}>ℹ️ Width Guidelines:</strong> Minimum 3.0m at property boundary. Maximum depends on lot frontage. Second crossover permitted only if frontage exceeds 20m.</div>
    </>
  );

  const renderStep3 = () => (
    <>
      <div style={sectionTitle}><span>🌳</span> Vegetation</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Trees within 3m of crossover?" span={2}><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer" }}><input type="checkbox" checked={form.trees_nearby} onChange={set("trees_nearby")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />Yes — trees or significant vegetation are present nearby</label></Field>
        {form.trees_nearby && <Field label="Tree Protection Measures" span={2}><input style={inputBase} value={form.tree_protection} onChange={set("tree_protection")} placeholder="Describe proposed tree protection plan" /></Field>}
        <Field label="Vegetation Clearing Required?" span={2}><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer" }}><input type="checkbox" checked={form.clearing} onChange={set("clearing")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />Yes — clearing of vegetation will be required</label></Field>
      </div>
      <div style={{ ...sectionTitle, marginTop: 22 }}><span>💧</span> Drainage & Stormwater</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Drainage Type"><select style={selectBase} value={form.drainage_type} onChange={set("drainage_type")}><option value="none">None Required</option><option value="dish_drain">Dish Drain</option><option value="pipe_culvert">Pipe Culvert</option><option value="swale">Swale</option><option value="kerb_inlet">Kerb Inlet</option><option value="other">Other</option></select></Field>
        <Field label="Culvert Required?"><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer", marginTop: 4 }}><input type="checkbox" checked={form.culvert} onChange={set("culvert")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />Yes — culvert or pipe crossing needed</label></Field>
      </div>
    </>
  );

  const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3];
  const docCount = Object.keys(documents).length;
  const anyProcessing = Object.values(processing).some(v => v);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><h2 style={{ fontSize: 18, fontWeight: 800, color: "#1a3a4a", margin: 0 }}>New Application</h2><div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>Crossover permit application — City of Kalamunda</div></div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#7a8a94", cursor: "pointer", padding: "2px 6px", borderRadius: 4 }} title="Close">&times;</button>
        </div>
        <div style={{ display: "flex", gap: 0, padding: "0 24px", background: "#f8fafb", borderBottom: "1px solid #edf1f4" }}>
          {steps.map((s, i) => (
            <button key={i} onClick={() => { if (i <= step || canGoNext()) setStep(i); }}
              style={{ flex: 1, padding: "10px 6px", background: "none", border: "none", borderBottom: step === i ? "2.5px solid #1abc9c" : "2.5px solid transparent", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
              <div style={{ fontSize: 13, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontSize: 10, fontWeight: step === i ? 800 : 500, color: step === i ? "#1abc9c" : i < step ? "#1a3a4a" : "#9aabb5", textTransform: "uppercase", letterSpacing: "0.03em" }}>{s.label}</div>
            </button>
          ))}
        </div>
        <div style={{ padding: "16px 24px 20px", overflowY: "auto", flex: 1 }}>
          {stepRenderers[step]()}
          {error && <div style={{ marginTop: 14, padding: "10px 14px", background: "#fdedec", borderRadius: 8, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>⚠️ {error}</div>}
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafb" }}>
          <div style={{ fontSize: 11, color: "#9aabb5" }}>
            Step {step + 1} of {steps.length}
            {docCount > 0 && <span style={{ color: "#2980b9", marginLeft: 10 }}>📎 {docCount} doc{docCount > 1 ? "s" : ""}</span>}
            {sitePlanData && <span style={{ color: "#8e44ad", marginLeft: 10 }}>🤖 AI</span>}
            {lotMatch === "found" && <span style={{ color: "#27ae60", marginLeft: 10 }}>📐 Boundary</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && <button style={btnSecondary} onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < steps.length - 1 ? (
              <button style={{ ...btnPrimary, opacity: canGoNext() ? 1 : 0.5 }} disabled={!canGoNext()} onClick={() => { if (canGoNext()) setStep(s => s + 1); }}>Next →</button>
            ) : (
              <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving || anyProcessing} onClick={handleSubmit}>{saving ? "Submitting…" : "✅ Submit Application"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  Application List View
// ═══════════════════════════════════════════════════════
export default function ApplicationListView({ apps, filter, onSelectApp, onAppCreated, globalLotsData }) {
  const [search, setSearch] = useState(""); const [sf, setSf] = useState(filter || "all"); const [showNewModal, setShowNewModal] = useState(false);
  const filtered = apps.filter(a => { if (sf !== "all" && a.status !== sf) return false; if (search) { const q = search.toLowerCase(); return a.id.toLowerCase().includes(q) || a.owner.name.toLowerCase().includes(q) || a.property.address.toLowerCase().includes(q); } return true; });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: 0 }}>{filter === "pending_review" ? "Pending Review" : filter === "referral_pending" ? "Referrals" : "All Applications"}</h2>
        <button onClick={() => setShowNewModal(true)} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, padding: "9px 22px", fontSize: 12 }}><span style={{ fontSize: 15, lineHeight: 1 }}>＋</span> New Application</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by reference, applicant, or address…" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none" }} />
        <select value={sf} onChange={e => setSf(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff" }}><option value="all">All Statuses</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f5f8fa" }}>{["Ref", "Applicant", "Property", "Road", "Width", "Status"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" }}>{h}</th>)}</tr></thead>
          <tbody>{filtered.length === 0 ? (<tr><td colSpan={6} style={{ padding: "32px 12px", textAlign: "center", color: "#9aabb5", fontSize: 13 }}>{search ? "No applications match your search." : "No applications found."}</td></tr>) : filtered.map(app => (
            <tr key={app.id} onClick={() => onSelectApp(app)} style={{ cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "9px 12px", fontWeight: 700, color: "#2980b9", borderBottom: "1px solid #f0f3f5" }}>{app.id}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}>{app.owner.name}</td>
              <td style={{ padding: "9px 12px", color: "#5a6a74", borderBottom: "1px solid #f0f3f5", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.property.address}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 600, color: app.property.roadType === "red" ? "#c0392b" : app.property.roadType === "blue" ? "#2980b9" : "#5a6a74" }}>{app.property.roadType}</td>
              <td style={{ padding: "9px 12px", fontWeight: 600, borderBottom: "1px solid #f0f3f5" }}>{app.crossover.width}m</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}><StatusBadge status={app.status} /></td>
            </tr>))}</tbody>
        </table>
      </div>
      {showNewModal && <NewApplicationModal onClose={() => setShowNewModal(false)} onCreated={(r) => { if (onAppCreated) onAppCreated(apiAppToFrontend(r)); }} globalLotsData={globalLotsData} />}
    </div>
  );
}
