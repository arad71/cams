import { useState, useCallback } from "react";
import { STATUS_CONFIG } from '../data/constants';
import StatusBadge from '../components/ui/StatusBadge';
import api from '../services/api';
import { apiAppToFrontend } from '../utils/transforms';

// ─── Styles ────────────────────────────────────────────
const overlay = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(12,31,46,0.55)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modalBox = { background: "#fff", borderRadius: 16, width: "min(680px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(12,31,46,0.28)", overflow: "hidden" };
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
//  Address → Lot Boundary matching (mirrors backend logic)
// ═══════════════════════════════════════════════════════

const ROAD_TYPE_MAP = {
  RD: "RD", ROAD: "RD", CR: "CR", CRES: "CR", CRESCENT: "CR",
  ST: "ST", STREET: "ST", AVE: "AV", AV: "AV", AVENUE: "AV",
  HWY: "HWY", HIGHWAY: "HWY", DR: "DR", DRIVE: "DR",
  CT: "CT", COURT: "CT", WAY: "WAY", PL: "PL", PLACE: "PL",
  CL: "CL", CLOSE: "CL", GDNS: "GDNS", GARDENS: "GDNS",
  LOOP: "LOOP", TCE: "TCE", TERRACE: "TCE", LANE: "LANE",
  BVD: "BVD", BOULEVARD: "BVD", GR: "GR", GROVE: "GR",
  MEWS: "MEWS", GRN: "GRN", GREEN: "GRN", CCT: "CCT",
  CIRCUIT: "CCT", CIR: "CIR", CIRCLE: "CIR",
};

function normaliseRoadType(s) {
  return ROAD_TYPE_MAP[(s || "").toUpperCase().trim()] || (s || "").toUpperCase().trim();
}

/**
 * Parse an address string like "54 Stirling Cr, High Wycombe" into components.
 * Returns { road_number_1, road_name, road_type, locality } or null on failure.
 */
function parseAddress(addr) {
  if (!addr) return null;
  const a = addr.replace(/,/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const tokens = a.split(" ");
  if (tokens.length < 3) return null;

  // First token should start with a number
  const numMatch = tokens[0].match(/^(\d+)/);
  if (!numMatch) return null;
  const number = numMatch[1];
  const rest = tokens.slice(1);

  // Find road type token
  let roadTypeIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (normaliseRoadType(rest[i]) in ROAD_TYPE_MAP || Object.values(ROAD_TYPE_MAP).includes(normaliseRoadType(rest[i]))) {
      // Verify it's a known normalised value
      const normed = normaliseRoadType(rest[i]);
      if (Object.values(ROAD_TYPE_MAP).includes(normed)) {
        roadTypeIdx = i;
        break;
      }
    }
  }
  if (roadTypeIdx < 1) return null; // need at least one name token before type

  const roadName = rest.slice(0, roadTypeIdx).join(" ");
  const roadType = normaliseRoadType(rest[roadTypeIdx]);
  const locality = rest.slice(roadTypeIdx + 1).join(" ");
  if (!locality) return null;

  return { road_number_1: number, road_name: roadName, road_type: roadType, locality };
}

/**
 * Search globalLotsData for a feature matching the parsed address.
 * Returns the matched feature or null.
 */
function findLotByAddress(lotsData, address) {
  if (!lotsData?.features || !address) return null;
  const q = parseAddress(address);
  if (!q) return null;

  for (const feat of lotsData.features) {
    const p = feat.properties || {};
    const pNum  = String(p.road_number_1 || "").trim();
    const pName = (p.road_name || "").toUpperCase().replace(/\s+/g, " ").trim();
    const pType = normaliseRoadType(p.road_type || "");
    const pLoc  = (p.locality || "").toUpperCase().replace(/\s+/g, " ").trim();

    if (pNum === q.road_number_1 && pName === q.road_name && pType === q.road_type && pLoc === q.locality) {
      return feat;
    }
  }
  return null;
}

/**
 * Extract the polygon ring from a GeoJSON feature as [[lat, lng], ...].
 */
function extractPolygon(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  let ring;
  if (g.type === "Polygon") ring = g.coordinates?.[0];
  else if (g.type === "MultiPolygon") ring = g.coordinates?.[0]?.[0];
  if (!ring || ring.length < 3) return null;
  // GeoJSON is [lng, lat] — convert to [lat, lng] for lot_polygon storage
  return ring.map(([lng, lat]) => [lat, lng]);
}


// ─── Blank form state ──────────────────────────────────
const blankForm = {
  owner_name: "", owner_phone: "", owner_email: "", owner_postal_address: "",
  property_address: "", lot_number: "", plan_number: "", lot_type: "green_title",
  frontage: "", depth: "",
  road_name: "", road_type: "local", road_width: "", verge_width: "",
  crossover_width: "", crossover_count: "1", crossover_surface: "concrete",
  crossover_est_date: "", da_number: "", offset_from_left: "",
  trees_nearby: false, tree_protection: "", clearing: false,
  drainage_type: "none", culvert: false,
};


// ═══════════════════════════════════════════════════════
//  New Application Modal
// ═══════════════════════════════════════════════════════
function NewApplicationModal({ onClose, onCreated, globalLotsData }) {
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);

  // Lot boundary state
  const [lotPolygon, setLotPolygon] = useState(null);
  const [lotMatch, setLotMatch] = useState(null); // null | "found" | "not_found" | "parsing_error"
  const [matchedFeatureProps, setMatchedFeatureProps] = useState(null);

  const set = (key) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [key]: val }));
    // If they change the address, reset the lot match status
    if (key === "property_address") {
      setLotMatch(null);
      setLotPolygon(null);
      setMatchedFeatureProps(null);
    }
  };

  // Look up the lot boundary when the address field loses focus
  const handleAddressBlur = useCallback(() => {
    const addr = form.property_address.trim();
    if (!addr) {
      setLotMatch(null);
      setLotPolygon(null);
      setMatchedFeatureProps(null);
      return;
    }

    const parsed = parseAddress(addr);
    if (!parsed) {
      setLotMatch("parsing_error");
      setLotPolygon(null);
      setMatchedFeatureProps(null);
      return;
    }

    const feature = findLotByAddress(globalLotsData, addr);
    if (feature) {
      const poly = extractPolygon(feature);
      setLotPolygon(poly);
      setMatchedFeatureProps(feature.properties);
      setLotMatch("found");

      // Auto-fill lot number and road name if available from the feature
      const fp = feature.properties || {};
      setForm(prev => ({
        ...prev,
        lot_number: prev.lot_number || (fp.lot_number ? String(fp.lot_number) : ""),
        road_name: prev.road_name || (fp.road_name ? (fp.road_name.charAt(0) + fp.road_name.slice(1).toLowerCase() + (fp.road_type ? " " + fp.road_type : "")) : ""),
      }));
    } else {
      setLotMatch("not_found");
      setLotPolygon(null);
      setMatchedFeatureProps(null);
    }
  }, [form.property_address, globalLotsData]);

  const steps = [
    { label: "Owner Details", icon: "👤" },
    { label: "Property & Road", icon: "📍" },
    { label: "Crossover Design", icon: "📐" },
    { label: "Vegetation & Drainage", icon: "🌳" },
  ];

  const canGoNext = () => {
    if (step === 0) return form.owner_name.trim() && form.property_address.trim();
    return true;
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
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
        trees_nearby: form.trees_nearby,
        tree_protection: form.tree_protection || null,
        clearing: form.clearing,
        drainage_type: form.drainage_type || null,
        culvert: form.culvert,
        lot_polygon: lotPolygon,
      };
      const result = await api.createApp(payload);
      onCreated(result);
      onClose();
    } catch (e) {
      setError(e.message || "Failed to create application");
    } finally {
      setSaving(false);
    }
  };

  // ── Lot match feedback banner ───────────────────────
  const renderLotMatchBanner = () => {
    if (!lotMatch) return null;

    if (lotMatch === "found") {
      const fp = matchedFeatureProps || {};
      const coordCount = lotPolygon ? lotPolygon.length : 0;
      return (
        <div style={{ marginTop: 10, padding: "10px 14px", background: "#eafaf1", borderRadius: 8, border: "1px solid #d4efdf", fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 800, color: "#27ae60", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>✅</span> Lot Boundary Found
          </div>
          <div style={{ color: "#2c6e49", fontSize: 11 }}>
            Matched: <strong>{fp.road_number_1} {fp.road_name} {fp.road_type}</strong>, {fp.locality}
            {fp.lot_number && <> — Lot {fp.lot_number}</>}
            <br />
            Boundary polygon saved ({coordCount} points).
          </div>
        </div>
      );
    }

    if (lotMatch === "not_found") {
      return (
        <div style={{ marginTop: 10, padding: "10px 14px", background: "#fef9e7", borderRadius: 8, border: "1px solid #f9e79f", fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 800, color: "#b7950b", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚠️</span> No Lot Boundary Match
          </div>
          <div style={{ color: "#7d6608", fontSize: 11 }}>
            Address could not be matched in the lot database. The boundary can be set manually later. Try a format like: <strong>54 Stirling Cr, High Wycombe</strong>
          </div>
        </div>
      );
    }

    if (lotMatch === "parsing_error") {
      return (
        <div style={{ marginTop: 10, padding: "10px 14px", background: "#f9f0f0", borderRadius: 8, border: "1px solid #e6d5d5", fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 800, color: "#a04040", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <span>ℹ️</span> Could Not Parse Address
          </div>
          <div style={{ color: "#784040", fontSize: 11 }}>
            Enter a full address with street number, street name, road type, and suburb.<br />
            Example: <strong>12 Railway Rd, Kalamunda</strong>
          </div>
        </div>
      );
    }
    return null;
  };

  // ── Step 0: Owner Details ─────────────────────────────
  const renderOwnerStep = () => (
    <>
      <div style={sectionTitle}><span>👤</span> Owner / Applicant Information</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Full Name" required span={2}>
          <input style={inputBase} value={form.owner_name} onChange={set("owner_name")} placeholder="e.g. John Smith" />
        </Field>
        <Field label="Phone">
          <input style={inputBase} value={form.owner_phone} onChange={set("owner_phone")} placeholder="04xx xxx xxx" />
        </Field>
        <Field label="Email">
          <input style={inputBase} type="email" value={form.owner_email} onChange={set("owner_email")} placeholder="john@example.com" />
        </Field>
        <Field label="Postal Address" span={2}>
          <input style={inputBase} value={form.owner_postal_address} onChange={set("owner_postal_address")} placeholder="Postal address for correspondence" />
        </Field>
      </div>
      <div style={{ ...sectionTitle, marginTop: 22 }}><span>📍</span> Property Address</div>
      <Field label="Property Address" required>
        <input
          style={{
            ...inputBase,
            borderColor: lotMatch === "found" ? "#27ae60" : lotMatch === "not_found" ? "#f39c12" : "#d5dde2",
          }}
          value={form.property_address}
          onChange={set("property_address")}
          onBlur={handleAddressBlur}
          placeholder="e.g. 54 Stirling Cr, High Wycombe"
        />
      </Field>
      {renderLotMatchBanner()}
    </>
  );

  // ── Step 1: Property & Road ───────────────────────────
  const renderPropertyStep = () => (
    <>
      <div style={sectionTitle}><span>📍</span> Lot / Property Details</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Lot Number">
          <input style={inputBase} value={form.lot_number} onChange={set("lot_number")} placeholder="e.g. 145" />
        </Field>
        <Field label="Plan / Diagram Number">
          <input style={inputBase} value={form.plan_number} onChange={set("plan_number")} placeholder="e.g. P012345" />
        </Field>
        <Field label="Lot Type">
          <select style={selectBase} value={form.lot_type} onChange={set("lot_type")}>
            <option value="green_title">Green Title</option>
            <option value="strata">Strata</option>
            <option value="survey_strata">Survey Strata</option>
            <option value="battleaxe">Battleaxe</option>
            <option value="commercial">Commercial</option>
          </select>
        </Field>
        <Field label="Frontage (m)">
          <input style={inputBase} type="number" step="0.1" value={form.frontage} onChange={set("frontage")} placeholder="0.0" />
        </Field>
        <Field label="Depth (m)">
          <input style={inputBase} type="number" step="0.1" value={form.depth} onChange={set("depth")} placeholder="0.0" />
        </Field>
        <Field label="DA / Approval Number">
          <input style={inputBase} value={form.da_number} onChange={set("da_number")} placeholder="Optional" />
        </Field>
      </div>

      {/* Lot boundary status on step 1 too */}
      {lotMatch === "found" && lotPolygon && (
        <div style={{ marginTop: 14, padding: "10px 14px", background: "#eafaf1", borderRadius: 8, border: "1px solid #d4efdf", fontSize: 11, color: "#2c6e49" }}>
          <strong style={{ color: "#27ae60" }}>✅ Lot Boundary:</strong> {lotPolygon.length} coordinate points captured from lot database.
        </div>
      )}

      <div style={{ ...sectionTitle, marginTop: 22 }}><span>🛣️</span> Road Information</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Road Name" span={2}>
          <input style={inputBase} value={form.road_name} onChange={set("road_name")} placeholder="e.g. Railway Road" />
        </Field>
        <Field label="Road Classification">
          <select style={selectBase} value={form.road_type} onChange={set("road_type")}>
            <option value="local">Local</option>
            <option value="red">Red (District Distributor)</option>
            <option value="blue">Blue (Local Distributor)</option>
            <option value="green">Green (Access)</option>
          </select>
        </Field>
        <Field label="Road Width (m)">
          <input style={inputBase} type="number" step="0.1" value={form.road_width} onChange={set("road_width")} placeholder="0.0" />
        </Field>
        <Field label="Verge Width (m)">
          <input style={inputBase} type="number" step="0.1" value={form.verge_width} onChange={set("verge_width")} placeholder="0.0" />
        </Field>
      </div>
    </>
  );

  // ── Step 2: Crossover Design ──────────────────────────
  const renderCrossoverStep = () => (
    <>
      <div style={sectionTitle}><span>📐</span> Crossover Design</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
        <Field label="Crossover Width (m)">
          <input style={inputBase} type="number" step="0.1" value={form.crossover_width} onChange={set("crossover_width")} placeholder="e.g. 4.5" />
        </Field>
        <Field label="Number of Crossovers">
          <select style={selectBase} value={form.crossover_count} onChange={set("crossover_count")}>
            <option value="1">1 — Single</option>
            <option value="2">2 — Dual</option>
          </select>
        </Field>
        <Field label="Surface Material">
          <select style={selectBase} value={form.crossover_surface} onChange={set("crossover_surface")}>
            <option value="concrete">Concrete</option>
            <option value="asphalt">Asphalt</option>
            <option value="brick_paver">Brick Paver</option>
            <option value="gravel">Gravel</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Offset from Left Boundary (m)">
          <input style={inputBase} type="number" step="0.1" value={form.offset_from_left} onChange={set("offset_from_left")} placeholder="0.0" />
        </Field>
        <Field label="Est. Construction Date" span={2}>
          <input style={inputBase} type="date" value={form.crossover_est_date} onChange={set("crossover_est_date")} />
        </Field>
      </div>
      <div style={{ marginTop: 14, padding: "10px 14px", background: "#f5f8fa", borderRadius: 8, fontSize: 11, color: "#5a6a74", lineHeight: 1.6 }}>
        <strong style={{ color: "#1a3a4a" }}>ℹ️ Width Guidelines:</strong> Minimum 3.0m at property boundary. Maximum depends on lot frontage. Second crossover permitted only if frontage exceeds 20m.
      </div>
    </>
  );

  // ── Step 3: Vegetation & Drainage ─────────────────────
  const renderEnvironmentStep = () => (
    <>
      <div style={sectionTitle}><span>🌳</span> Vegetation</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Trees within 3m of crossover?" span={2}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer" }}>
            <input type="checkbox" checked={form.trees_nearby} onChange={set("trees_nearby")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />
            Yes — trees or significant vegetation are present nearby
          </label>
        </Field>
        {form.trees_nearby && (
          <Field label="Tree Protection Measures" span={2}>
            <input style={inputBase} value={form.tree_protection} onChange={set("tree_protection")} placeholder="Describe proposed tree protection plan" />
          </Field>
        )}
        <Field label="Vegetation Clearing Required?" span={2}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer" }}>
            <input type="checkbox" checked={form.clearing} onChange={set("clearing")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />
            Yes — clearing of vegetation will be required
          </label>
        </Field>
      </div>

      <div style={{ ...sectionTitle, marginTop: 22 }}><span>💧</span> Drainage & Stormwater</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <Field label="Drainage Type">
          <select style={selectBase} value={form.drainage_type} onChange={set("drainage_type")}>
            <option value="none">None Required</option>
            <option value="dish_drain">Dish Drain</option>
            <option value="pipe_culvert">Pipe Culvert</option>
            <option value="swale">Swale</option>
            <option value="kerb_inlet">Kerb Inlet</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Culvert Required?">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2c3e2f", cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={form.culvert} onChange={set("culvert")} style={{ width: 16, height: 16, accentColor: "#1abc9c" }} />
            Yes — culvert or pipe crossing needed
          </label>
        </Field>
      </div>
    </>
  );

  const stepRenderers = [renderOwnerStep, renderPropertyStep, renderCrossoverStep, renderEnvironmentStep];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1a3a4a", margin: 0 }}>New Application</h2>
            <div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>Crossover permit application — City of Kalamunda</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#7a8a94", cursor: "pointer", padding: "2px 6px", borderRadius: 4 }} title="Close">&times;</button>
        </div>

        {/* Step Indicator */}
        <div style={{ display: "flex", gap: 0, padding: "0 24px", background: "#f8fafb", borderBottom: "1px solid #edf1f4" }}>
          {steps.map((s, i) => (
            <button key={i} onClick={() => { if (i <= step || canGoNext()) setStep(i); }}
              style={{ flex: 1, padding: "10px 6px", background: "none", border: "none", borderBottom: step === i ? "2.5px solid #1abc9c" : "2.5px solid transparent", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
              <div style={{ fontSize: 13, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontSize: 10, fontWeight: step === i ? 800 : 500, color: step === i ? "#1abc9c" : i < step ? "#1a3a4a" : "#9aabb5", textTransform: "uppercase", letterSpacing: "0.03em" }}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px 20px", overflowY: "auto", flex: 1 }}>
          {stepRenderers[step]()}
          {error && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#fdedec", borderRadius: 8, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #edf1f4", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafb" }}>
          <div style={{ fontSize: 11, color: "#9aabb5" }}>
            Step {step + 1} of {steps.length}
            {lotMatch === "found" && <span style={{ color: "#27ae60", marginLeft: 10 }}>📐 Boundary captured</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && (
              <button style={btnSecondary} onClick={() => setStep(s => s - 1)}>← Back</button>
            )}
            {step < steps.length - 1 ? (
              <button style={{ ...btnPrimary, opacity: canGoNext() ? 1 : 0.5 }} disabled={!canGoNext()} onClick={() => { if (canGoNext()) setStep(s => s + 1); }}>
                Next →
              </button>
            ) : (
              <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={handleSubmit}>
                {saving ? "Submitting…" : "✅ Submit Application"}
              </button>
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
  const [search, setSearch] = useState("");
  const [sf, setSf] = useState(filter || "all");
  const [showNewModal, setShowNewModal] = useState(false);

  const filtered = apps.filter(a => {
    if (sf !== "all" && a.status !== sf) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.id.toLowerCase().includes(q) || a.owner.name.toLowerCase().includes(q) || a.property.address.toLowerCase().includes(q);
    }
    return true;
  });

  const handleCreated = (apiResult) => {
    const converted = apiAppToFrontend(apiResult);
    if (onAppCreated) onAppCreated(converted);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: 0 }}>
          {filter === "pending_review" ? "Pending Review" : filter === "referral_pending" ? "Referrals" : "All Applications"}
        </h2>
        <button
          onClick={() => setShowNewModal(true)}
          style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, padding: "9px 22px", fontSize: 12 }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>＋</span> New Application
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by reference, applicant, or address…"
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none" }} />
        <select value={sf} onChange={e => setSf(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f5f8fa" }}>
              {["Ref", "Applicant", "Property", "Road", "Width", "Status"].map(h => (
                <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "32px 12px", textAlign: "center", color: "#9aabb5", fontSize: 13 }}>
                  {search ? "No applications match your search." : "No applications found."}
                </td>
              </tr>
            ) : filtered.map(app => (
              <tr key={app.id} onClick={() => onSelectApp(app)} style={{ cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "9px 12px", fontWeight: 700, color: "#2980b9", borderBottom: "1px solid #f0f3f5" }}>{app.id}</td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}>{app.owner.name}</td>
                <td style={{ padding: "9px 12px", color: "#5a6a74", borderBottom: "1px solid #f0f3f5", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.property.address}</td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 600, color: app.property.roadType === "red" ? "#c0392b" : app.property.roadType === "blue" ? "#2980b9" : "#5a6a74" }}>{app.property.roadType}</td>
                <td style={{ padding: "9px 12px", fontWeight: 600, borderBottom: "1px solid #f0f3f5" }}>{app.crossover.width}m</td>
                <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}><StatusBadge status={app.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNewModal && (
        <NewApplicationModal
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
          globalLotsData={globalLotsData}
        />
      )}
    </div>
  );
}
