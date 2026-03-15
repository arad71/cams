import { useState, useEffect, useRef, useCallback } from "react";

// ─── API Config ─────────────────────────────────────────
const API = "http://localhost:8001/api";

async function api(path, opts = {}) {
  const token = localStorage.getItem("cx_token");
  const headers = { ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw { status: res.status, detail: data.detail || data };
  return data;
}

// ─── Constants (fallbacks until ref data loads) ─────────
const STEPS = [
  { id: 0, label: "Welcome", icon: "🏠" },
  { id: 1, label: "Owner Details", icon: "👤" },
  { id: 2, label: "Property Info", icon: "📍" },
  { id: 3, label: "Crossover Design", icon: "📐" },
  { id: 4, label: "Vegetation & Drainage", icon: "🌳" },
  { id: 5, label: "Documents", icon: "📎" },
  { id: 6, label: "AI Review", icon: "🤖" },
  { id: 7, label: "Submit", icon: "✅" },
];

const ACCEPTED_EXT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.dwg,.dxf";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const STATUS_LABELS = {
  draft: { label: "Draft", color: "#95a5a6", icon: "📝" },
  submitted: { label: "Submitted", color: "#2980b9", icon: "📤" },
  acknowledged: { label: "Acknowledged", color: "#8e44ad", icon: "📬" },
  under_review: { label: "Under Review", color: "#e67e22", icon: "🔍" },
  info_requested: { label: "Info Requested", color: "#f39c12", icon: "❓" },
  approved: { label: "Approved", color: "#27ae60", icon: "✅" },
  rejected: { label: "Rejected", color: "#e74c3c", icon: "❌" },
  withdrawn: { label: "Withdrawn", color: "#7f8c8d", icon: "🚫" },
};

// ─── Helpers ────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Shared Components ──────────────────────────────────
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #c8d5cb", fontSize: 14, fontFamily: "inherit", background: "#fafcfa", color: "#2c3e2f", outline: "none", boxSizing: "border-box" };
const selectStyle = { ...inputStyle, appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7c6f' stroke-width='1.5' fill='none'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center", paddingRight: 36 };
const btnPrimary = { padding: "10px 28px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #1a5632, #2d8a4e)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 12px rgba(26,86,50,0.2)" };
const btnSecondary = { padding: "10px 24px", borderRadius: 10, border: "1.5px solid #c8d5cb", background: "#fff", color: "#2c3e2f", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };

function FormField({ label, error, required, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#3a4a3d", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label} {required && <span style={{ color: "#c0392b" }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>⚠ {error}</div>}
    </div>
  );
}

function InfoCard({ title, children, color = "#1a5632" }) {
  return (
    <div style={{ background: color + "08", border: `1px solid ${color}25`, borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#3a4a3d" }}>{children}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { label: status, color: "#95a5a6", icon: "•" };
  return <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.color + "18", color: s.color }}>{s.icon} {s.label}</span>;
}

function ProgressBar({ currentStep }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
      {STEPS.map((s, i) => (
        <div key={s.id} style={{ flex: 1, textAlign: "center" }}>
          <div style={{ height: 4, borderRadius: 2, background: i <= currentStep ? "linear-gradient(90deg, #1a5632, #2d8a4e)" : "#e2e8e3", marginBottom: 4, transition: "background 0.3s" }} />
          <div style={{ fontSize: 9, fontWeight: i === currentStep ? 800 : 500, color: i <= currentStep ? "#1a5632" : "#b0bdb2" }}>{s.icon} {s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #e2e8e3", borderTop: "2px solid #1a5632", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />;
}

// ─── AI Chat Hook ───────────────────────────────────────
function useAIChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const sendMessage = async (userMsg, context = "") => {
    const userMessage = { role: "user", content: userMsg };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `You are an expert AI assistant for the City of Kalamunda Crossover Application process. Help applicants with Crossover Guideline v3.1 (June 2022). Key rules: min 3m width, max 4.5m for lots ≤12.5m, max 6m for lots >12.5m. Trees: 3m clearance. Contribution: lesser of half cost or $474 (first crossover only). Processing: ~3 weeks.\n${context ? "Context:\n" + context : ""}`,
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.content?.map(b => b.text || "").join("\n") || "Sorry, please try again." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Unable to connect to AI. Key tips: min 3m wide, trees need 3m clearance, call 1100 before digging, allow 3 weeks. Call 9257 9999 for help." }]);
    }
    setLoading(false);
  };
  return { messages, loading, sendMessage, setMessages };
}

// ═══════════════════════════════════════════════════════════
//  REFERENCE DATA HOOK — loads dropdowns from backend
// ═══════════════════════════════════════════════════════════
function useRefData() {
  const [refData, setRefData] = useState({
    roadTypes: [{ code: "local", label: "Local Road (City managed)" }],
    surfaceMaterials: [{ code: "concrete", label: "Concrete (100mm min, 32MPa)" }],
    lotTypes: [{ code: "res_urban_green", label: "Residential Urban — Green Title" }],
    drainageTypes: [{ code: "swale", label: "Swale / Table Drain" }],
    documentCategories: [{ code: "site_plan", label: "📐 Scaled Site Plan", is_required: true, hint: "" }],
    validationRules: [],
    fees: [],
    loaded: false,
  });
  useEffect(() => {
    (async () => {
      try {
        const [rt, sm, lt, dt, dc, vr, fees] = await Promise.all([
          api("/reference/road-types"), api("/reference/surface-materials"),
          api("/reference/lot-types"), api("/reference/drainage-types"),
          api("/reference/document-categories"), api("/reference/validation-rules"),
          api("/reference/fees"),
        ]);
        setRefData({ roadTypes: rt, surfaceMaterials: sm, lotTypes: lt, drainageTypes: dt,
          documentCategories: dc, validationRules: vr, fees, loaded: true });
      } catch { setRefData(prev => ({ ...prev, loaded: true })); }
    })();
  }, []);
  return refData;
}

// ═══════════════════════════════════════════════════════════
//  LOGIN / REGISTER SCREEN
// ═══════════════════════════════════════════════════════════
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "register") {
        if (!fullName.trim() || !email.trim() || !password.trim()) { setError("All fields required"); setLoading(false); return; }
        const data = await api("/auth/register", { method: "POST", body: JSON.stringify({ full_name: fullName, email, phone, password }) });
        localStorage.setItem("cx_token", data.access_token);
        onAuth(data.applicant);
      } else {
        if (!email.trim() || !password.trim()) { setError("Email and password required"); setLoading(false); return; }
        const form = new URLSearchParams(); form.append("username", email); form.append("password", password);
        const data = await api("/auth/login", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        localStorage.setItem("cx_token", data.access_token);
        onAuth(data.applicant);
      }
    } catch (e) {
      setError(typeof e.detail === "string" ? e.detail : "Invalid credentials");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #e8f0ea 0%, #f5f8f5 50%, #e0ebe2 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(26,86,50,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, #1a5632, #2d8a4e)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><span style={{ fontSize: 28 }}>🏛️</span></div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1a5632", margin: "0 0 4px" }}>City of Kalamunda</h1>
          <p style={{ fontSize: 12, color: "#6b7c6f", margin: 0 }}>Crossover Application Portal</p>
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderRadius: 8, overflow: "hidden", border: "1.5px solid #c8d5cb" }}>
          <button onClick={() => setMode("login")} style={{ flex: 1, padding: "8px", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: mode === "login" ? "#1a5632" : "#fff", color: mode === "login" ? "#fff" : "#6b7c6f" }}>Sign In</button>
          <button onClick={() => setMode("register")} style={{ flex: 1, padding: "8px", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: mode === "register" ? "#1a5632" : "#fff", color: mode === "register" ? "#fff" : "#6b7c6f" }}>Register</button>
        </div>

        {mode === "register" && <>
          <FormField label="Full Name" required><input style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" /></FormField>
          <FormField label="Phone"><input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="0412 345 678" /></FormField>
        </>}
        <FormField label="Email" required><input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" onKeyDown={e => e.key === "Enter" && handleSubmit()} /></FormField>
        <FormField label="Password" required><input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleSubmit()} /></FormField>

        {error && <div style={{ color: "#c0392b", fontSize: 12, marginBottom: 12, padding: "8px 12px", background: "#fdedec", borderRadius: 6 }}>⚠ {error}</div>}

        <button onClick={handleSubmit} disabled={loading}
          style={{ ...btnPrimary, width: "100%", padding: "12px", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#95a5a6" }}>
          Demo: sarah.m@email.com / applicant123
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MY APPLICATIONS DASHBOARD
// ═══════════════════════════════════════════════════════════
function Dashboard({ user, onSelectApp, onNewApp, onLogout }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/applications/");
        setApps(data);
      } catch { }
      setLoading(false);
    })();
  }, []);

  const statusCounts = apps.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1a5632", margin: "0 0 4px" }}>My Applications</h2>
          <p style={{ fontSize: 12, color: "#6b7c6f", margin: 0 }}>Welcome back, {user.full_name}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onNewApp} style={btnPrimary}>+ New Application</button>
          <button onClick={onLogout} style={{ ...btnSecondary, fontSize: 11, padding: "8px 14px" }}>Sign Out</button>
        </div>
      </div>

      {/* Status summary */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {Object.entries(STATUS_LABELS).filter(([k]) => statusCounts[k]).map(([k, v]) => (
          <div key={k} style={{ padding: "8px 14px", borderRadius: 8, background: v.color + "10", border: `1px solid ${v.color}30`, minWidth: 80, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: v.color }}>{statusCounts[k]}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: v.color }}>{v.label.toUpperCase()}</div>
          </div>
        ))}
        {apps.length === 0 && !loading && (
          <div style={{ textAlign: "center", width: "100%", padding: 30, color: "#95a5a6" }}>
            No applications yet. Click <strong>+ New Application</strong> to get started.
          </div>
        )}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 30 }}><Spinner /> Loading...</div>}

      {/* Applications list */}
      {apps.map(a => (
        <div key={a.id} onClick={() => onSelectApp(a.id)}
          style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 10, border: "1px solid #e2e8e3", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "box-shadow 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(26,86,50,0.08)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a5632" }}>{a.ref_number}</span>
              <StatusBadge status={a.status} />
            </div>
            <div style={{ fontSize: 12, color: "#6b7c6f" }}>{a.property_address || "No address yet"}</div>
            <div style={{ fontSize: 10, color: "#b0bdb2", marginTop: 2 }}>
              {a.status === "draft" ? `Step ${a.current_step + 1} of 8` : `Submitted ${formatDate(a.submitted_at)}`}
              {" · Created "}{formatDate(a.created_at)}
            </div>
          </div>
          <span style={{ fontSize: 18, color: "#c8d5cb" }}>→</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  APPLICATION WIZARD (8-step, API-integrated)
// ═══════════════════════════════════════════════════════════
function ApplicationWizard({ appId, user, refData, onBack }) {
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [aiResults, setAiResults] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const saveTimer = useRef(null);

  // Form state (local edits before save)
  const [form, setForm] = useState({});
  const [step, setStep] = useState(0);

  // Load application
  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/applications/${appId}`);
        setApp(data);
        setForm(appToForm(data));
        setStep(data.current_step || 0);
        setAiResults(data.ai_review_data);
        if (data.status === "submitted" || data.status === "approved" || data.status === "rejected" || data.status === "withdrawn") setSubmitted(true);
      } catch { }
      setLoading(false);
    })();
  }, [appId]);

  function appToForm(a) {
    return {
      ownerName: a.owner_name || "", ownerPhone: a.owner_phone || "", ownerEmail: a.owner_email || "",
      ownerPostalAddress: a.owner_postal_address || "",
      propertyAddress: a.property_address || "", lotNumber: a.lot_number || "", planNumber: a.plan_number || "",
      lgaZone: a.lga_zone || "", lotType: a.lot_type || "", lotFrontage: a.lot_frontage ? String(a.lot_frontage) : "",
      existingCrossover: a.existing_crossover ? "yes" : "no", roadType: a.road_type || "local", roadName: a.road_name || "",
      crossoverWidth: a.crossover_width ? String(a.crossover_width) : "3", numberOfCrossovers: a.number_of_crossovers ? String(a.number_of_crossovers) : "1",
      surfaceMaterial: a.surface_material || "concrete", estimatedDate: a.estimated_date || "", daNumber: a.da_number || "",
      offsetFromLeft: a.offset_from_left ? String(a.offset_from_left) : "",
      hasTreesNearby: a.has_trees_nearby ? "yes" : "no", treeProtectionPlan: a.tree_protection_plan || "",
      vegetationCleared: a.vegetation_cleared ? "yes" : "no",
      drainageType: a.drainage_type || "swale", hasCulvert: a.has_culvert ? "yes" : "no",
      declaration: a.declaration_accepted || false,
    };
  }

  function formToApi(f) {
    return {
      current_step: step,
      owner_name: f.ownerName, owner_phone: f.ownerPhone, owner_email: f.ownerEmail,
      owner_postal_address: f.ownerPostalAddress,
      property_address: f.propertyAddress, lot_number: f.lotNumber, plan_number: f.planNumber,
      lga_zone: f.lgaZone, lot_type: f.lotType, lot_frontage: parseFloat(f.lotFrontage) || null,
      existing_crossover: f.existingCrossover === "yes", road_type: f.roadType, road_name: f.roadName,
      crossover_width: parseFloat(f.crossoverWidth) || null, number_of_crossovers: parseInt(f.numberOfCrossovers) || 1,
      surface_material: f.surfaceMaterial, estimated_date: f.estimatedDate, da_number: f.daNumber || null,
      offset_from_left: parseFloat(f.offsetFromLeft) || null,
      has_trees_nearby: f.hasTreesNearby === "yes", tree_protection_plan: f.treeProtectionPlan || null,
      vegetation_cleared: f.vegetationCleared === "yes",
      drainage_type: f.drainageType, has_culvert: f.hasCulvert === "yes",
    };
  }

  // Auto-save debounce
  const scheduleAutoSave = useCallback(() => {
    if (submitted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api(`/applications/${appId}`, { method: "PATCH", body: JSON.stringify(formToApi(form)) });
      } catch { }
    }, 2000);
  }, [form, appId, submitted, step]);

  useEffect(() => { scheduleAutoSave(); return () => saveTimer.current && clearTimeout(saveTimer.current); }, [form, scheduleAutoSave]);

  // Save now (on step change)
  const saveNow = async () => {
    if (submitted) return;
    setSaving(true);
    try {
      const updated = await api(`/applications/${appId}`, { method: "PATCH", body: JSON.stringify(formToApi(form)) });
      setApp(updated);
    } catch { }
    setSaving(false);
  };

  // Validation
  const validate = (s) => {
    const errs = {};
    const f = form;
    if (s === 1) {
      if (!f.ownerName.trim()) errs.ownerName = "Owner name is required";
      if (!f.ownerPhone.trim()) errs.ownerPhone = "Phone is required";
      if (!f.ownerEmail.trim()) errs.ownerEmail = "Email is required";
      else if (!/\S+@\S+\.\S+/.test(f.ownerEmail)) errs.ownerEmail = "Invalid email";
    }
    if (s === 2) {
      if (!f.propertyAddress.trim()) errs.propertyAddress = "Property address is required";
      if (!f.lotFrontage.trim()) errs.lotFrontage = "Lot frontage is required";
      else if (parseFloat(f.lotFrontage) <= 0) errs.lotFrontage = "Must be > 0";
    }
    if (s === 3) {
      const w = parseFloat(f.crossoverWidth), fr = parseFloat(f.lotFrontage);
      if (w < 3) errs.crossoverWidth = "Minimum width is 3.0m";
      else if (fr && fr <= 12.5 && w > 4.5) errs.crossoverWidth = "Max 4.5m for frontage ≤ 12.5m";
      else if (fr && fr > 12.5 && w > 6) errs.crossoverWidth = "Max 6.0m for frontage > 12.5m";
      if (f.numberOfCrossovers === "2" && fr && fr <= 20) errs.numberOfCrossovers = "Dual crossover requires >20m frontage";
      if (!f.estimatedDate) errs.estimatedDate = "Estimated date required";
    }
    if (s === 4) {
      if (f.hasTreesNearby === "yes" && !f.treeProtectionPlan.trim()) errs.treeProtectionPlan = "Tree protection plan required";
    }
    if (s === 5) {
      const cats = (app?.documents || []).map(d => d.category);
      if (!cats.includes("site_plan")) errs.documents = "Scaled Site Plan is required";
      if (!cats.includes("certificate_title")) errs.documents = (errs.documents || "") + " Certificate of Title is required";
    }
    if (s === 7) {
      if (!f.declaration) errs.declaration = "You must accept the declaration";
    }
    return errs;
  };

  const nextStep = async () => {
    const errs = validate(step);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await saveNow();
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const prevStep = () => { if (step > 0) setStep(step - 1); };

  // AI Review
  const runAIReview = async () => {
    setAiLoading(true);
    try {
      await saveNow();
      const results = await api(`/applications/${appId}/ai-review`, { method: "POST" });
      setAiResults(results);
    } catch { }
    setAiLoading(false);
  };

  // Submit
  const handleSubmit = async () => {
    const errs = validate(7);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      await saveNow();
      const result = await api(`/applications/${appId}/submit`, { method: "POST", body: JSON.stringify({ declaration_accepted: true }) });
      setApp(result);
      setSubmitted(true);
    } catch (e) {
      if (e.detail?.errors) setErrors({ submit: e.detail.errors.join(". ") });
      else setErrors({ submit: typeof e.detail === "string" ? e.detail : "Submission failed" });
    }
    setSaving(false);
  };

  // Withdraw
  const handleWithdraw = async () => {
    if (!confirm("Are you sure you want to withdraw this application?")) return;
    try {
      const result = await api(`/applications/${appId}/withdraw`, { method: "POST" });
      setApp(result);
    } catch { }
  };

  if (loading) return <div style={{ textAlign: "center", padding: 60 }}><Spinner /> Loading application...</div>;
  if (!app) return <div style={{ textAlign: "center", padding: 60, color: "#c0392b" }}>Application not found</div>;

  // Read-only submitted view
  if (submitted && app.status !== "info_requested") {
    return <SubmittedView app={app} onBack={onBack} onWithdraw={handleWithdraw} />;
  }

  const u = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const uc = (field) => (e) => setForm({ ...form, [field]: e.target.checked });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={onBack} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 11 }}>← My Applications</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saving && <span style={{ fontSize: 10, color: "#e67e22" }}><Spinner /> Saving...</span>}
          <span style={{ fontSize: 11, color: "#95a5a6" }}>{app.ref_number}</span>
          <StatusBadge status={app.status} />
        </div>
      </div>

      <ProgressBar currentStep={step} />

      <div style={{ background: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 4px 24px rgba(26,86,50,0.06)", border: "1px solid #e2e8e3", marginBottom: 20 }}>

        {/* Step 0: Welcome */}
        {step === 0 && <StepWelcome />}

        {/* Step 1: Owner Details */}
        {step === 1 && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 20px" }}>Owner Details</h3>
            <FormField label="Full Name" required error={errors.ownerName}><input style={inputStyle} value={form.ownerName} onChange={u("ownerName")} placeholder="e.g. Jane Smith" /></FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Phone" required error={errors.ownerPhone}><input style={inputStyle} value={form.ownerPhone} onChange={u("ownerPhone")} placeholder="0412 345 678" /></FormField>
              <FormField label="Email" required error={errors.ownerEmail}><input style={inputStyle} type="email" value={form.ownerEmail} onChange={u("ownerEmail")} placeholder="jane@example.com" /></FormField>
            </div>
            <FormField label="Postal Address"><textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.ownerPostalAddress} onChange={u("ownerPostalAddress")} placeholder="Full postal address" /></FormField>
          </div>
        )}

        {/* Step 2: Property Info */}
        {step === 2 && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 20px" }}>Property Information</h3>
            <FormField label="Property Address" required error={errors.propertyAddress}><input style={inputStyle} value={form.propertyAddress} onChange={u("propertyAddress")} placeholder="e.g. 22 Canning Rd, Kalamunda WA 6076" /></FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Lot Number"><input style={inputStyle} value={form.lotNumber} onChange={u("lotNumber")} placeholder="e.g. Lot 156" /></FormField>
              <FormField label="Plan Number"><input style={inputStyle} value={form.planNumber} onChange={u("planNumber")} placeholder="e.g. P034521" /></FormField>
            </div>
            <FormField label="Lot Type">
              <select style={selectStyle} value={form.lotType} onChange={u("lotType")}>
                <option value="">— Select —</option>
                {refData.lotTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
              </select>
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Lot Frontage (m)" required error={errors.lotFrontage}><input style={inputStyle} type="number" step="0.1" value={form.lotFrontage} onChange={u("lotFrontage")} placeholder="e.g. 18.5" /></FormField>
              <FormField label="Existing Crossover?">
                <select style={selectStyle} value={form.existingCrossover} onChange={u("existingCrossover")}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              </FormField>
            </div>
            <FormField label="Road Name"><input style={inputStyle} value={form.roadName} onChange={u("roadName")} placeholder="e.g. Canning Road" /></FormField>
            <FormField label="Road Type">
              <select style={selectStyle} value={form.roadType} onChange={u("roadType")}>
                {refData.roadTypes.map(rt => <option key={rt.code} value={rt.code}>{rt.label}</option>)}
              </select>
            </FormField>
            {(form.roadType === "red" || form.roadType === "mrwa") && <InfoCard title="⚠ MRWA Referral Required" color="#b8860b">This road is managed by Main Roads WA. Your application will be referred for approval, which may extend processing.</InfoCard>}
            {form.roadType === "blue" && <InfoCard title="⚠ DPLH Referral Required" color="#b8860b">This is an Other Regional Road. Your application will be referred to DPLH.</InfoCard>}
          </div>
        )}

        {/* Step 3: Crossover Design */}
        {step === 3 && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 20px" }}>Crossover Design</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Crossover Width (m)" required error={errors.crossoverWidth} hint={`Min 3.0m, max ${parseFloat(form.lotFrontage) <= 12.5 ? "4.5" : "6.0"}m`}>
                <input style={inputStyle} type="number" step="0.1" min="3" max="6" value={form.crossoverWidth} onChange={u("crossoverWidth")} />
              </FormField>
              <FormField label="Number of Crossovers" error={errors.numberOfCrossovers} hint={parseFloat(form.lotFrontage) > 20 ? "Dual permitted (>20m)" : "Single only (≤20m)"}>
                <select style={selectStyle} value={form.numberOfCrossovers} onChange={u("numberOfCrossovers")}>
                  <option value="1">1 — Single</option><option value="2">2 — Dual</option>
                </select>
              </FormField>
            </div>
            <FormField label="Surface Material">
              <select style={selectStyle} value={form.surfaceMaterial} onChange={u("surfaceMaterial")}>
                {refData.surfaceMaterials.map(sm => <option key={sm.code} value={sm.code}>{sm.label}</option>)}
              </select>
            </FormField>
            <FormField label="Offset from Left Boundary (m)" hint="Distance from left property boundary to crossover edge">
              <input style={inputStyle} type="number" step="0.1" value={form.offsetFromLeft} onChange={u("offsetFromLeft")} placeholder="e.g. 2.5" />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Est. Construction Date" required error={errors.estimatedDate}><input style={inputStyle} type="date" value={form.estimatedDate} onChange={u("estimatedDate")} /></FormField>
              <FormField label="DA Number" hint="If linked to a Development Application"><input style={inputStyle} value={form.daNumber} onChange={u("daNumber")} placeholder="e.g. DA2026/0001" /></FormField>
            </div>
          </div>
        )}

        {/* Step 4: Vegetation & Drainage */}
        {step === 4 && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 20px" }}>Vegetation & Drainage</h3>
            <FormField label="Trees within 3m of proposed crossover?">
              <select style={selectStyle} value={form.hasTreesNearby} onChange={u("hasTreesNearby")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </FormField>
            {form.hasTreesNearby === "yes" && (
              <FormField label="Tree Protection Plan" required error={errors.treeProtectionPlan} hint="Describe tree species, clearance distances, and protection measures">
                <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.treeProtectionPlan} onChange={u("treeProtectionPlan")} placeholder="e.g. Two mature Jarrah trees at 4.2m and 5.1m from proposed crossover. Will install root protection zone fencing." />
              </FormField>
            )}
            <FormField label="Any vegetation to be cleared?">
              <select style={selectStyle} value={form.vegetationCleared} onChange={u("vegetationCleared")}>
                <option value="no">No</option><option value="yes">Yes — clearing required</option>
              </select>
            </FormField>
            {form.vegetationCleared === "yes" && <InfoCard title="⚠ DWER Permit Required" color="#c0392b">Clearing native vegetation requires a permit from DWER. This may significantly delay your application.</InfoCard>}
            <FormField label="Drainage Type">
              <select style={selectStyle} value={form.drainageType} onChange={u("drainageType")}>
                {refData.drainageTypes.map(dt => <option key={dt.code} value={dt.code}>{dt.label}</option>)}
              </select>
            </FormField>
            <FormField label="Culvert / Pipe Required?">
              <select style={selectStyle} value={form.hasCulvert} onChange={u("hasCulvert")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </FormField>
          </div>
        )}

        {/* Step 5: Documents */}
        {step === 5 && <StepDocuments appId={appId} app={app} setApp={setApp} refData={refData} errors={errors} form={form} />}

        {/* Step 6: AI Review */}
        {step === 6 && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 8px" }}>AI-Powered Review</h3>
            <p style={{ color: "#6b7c6f", fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>Run an automated check of your application before submitting.</p>

            <button onClick={runAIReview} disabled={aiLoading} style={{ ...btnPrimary, marginBottom: 20, opacity: aiLoading ? 0.7 : 1 }}>
              {aiLoading ? "⏳ Checking..." : "🤖 Run AI Review"}
            </button>

            {aiResults && (
              <div>
                {aiResults.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 8, marginBottom: 6, alignItems: "flex-start",
                    background: r.status === "pass" ? "#eafaf1" : r.status === "fail" ? "#fdedec" : r.status === "warning" ? "#fef5e7" : "#ebf5fb",
                    border: `1px solid ${r.status === "pass" ? "#27ae6030" : r.status === "fail" ? "#e74c3c30" : r.status === "warning" ? "#e67e2230" : "#2980b930"}` }}>
                    <span style={{ fontSize: 16 }}>{r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : r.status === "warning" ? "⚠️" : "ℹ️"}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e2f" }}>{r.check}</div>
                      <div style={{ fontSize: 11, color: "#6b7c6f", marginTop: 2 }}>{r.message}</div>
                    </div>
                  </div>
                ))}
                {aiResults.some(r => r.status === "fail") && (
                  <InfoCard title="⚠ Issues Found" color="#c0392b">Fix the items marked with ❌ before submitting. Go back to the relevant step to make changes.</InfoCard>
                )}
              </div>
            )}

            <div style={{ marginTop: 20, borderTop: "1px solid #e8ede9", paddingTop: 20 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: "#1a5632", margin: "0 0 12px" }}>💬 Ask Claude AI</h4>
              <AIAssistant form={form} documents={app?.documents || []} />
            </div>
          </div>
        )}

        {/* Step 7: Submit */}
        {step === 7 && (
          <StepSubmitView form={form} setForm={setForm} app={app} errors={errors} refData={refData} />
        )}

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, paddingTop: 20, borderTop: "1px solid #e8ede9" }}>
          <button onClick={prevStep} disabled={step === 0} style={{ ...btnSecondary, opacity: step === 0 ? 0.5 : 1 }}>← Back</button>
          {step < STEPS.length - 1 ? (
            <button onClick={nextStep} style={btnPrimary}>Continue →</button>
          ) : (
            <button onClick={handleSubmit} disabled={saving}
              style={{ ...btnPrimary, background: "linear-gradient(135deg, #27ae60, #2ecc71)", boxShadow: "0 2px 12px rgba(39,174,96,0.3)", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Submitting..." : "✓ Submit Application"}
            </button>
          )}
        </div>
        {errors.submit && <div style={{ color: "#c0392b", fontSize: 12, marginTop: 8, padding: "8px 12px", background: "#fdedec", borderRadius: 6 }}>⚠ {errors.submit}</div>}
      </div>
    </div>
  );
}

// ─── Step 0: Welcome ────────────────────────────────────
function StepWelcome() {
  return (
    <div>
      <h3 style={{ fontSize: 20, fontWeight: 800, color: "#1a5632", margin: "0 0 12px" }}>Welcome to the Crossover Application Portal</h3>
      <p style={{ color: "#6b7c6f", fontSize: 14, lineHeight: 1.7, margin: "0 0 20px" }}>Apply for a new or modified vehicle crossover. This form takes about 10–15 minutes. You can save and return anytime.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[["📋", "8-step guided form", "We walk you through each section"], ["💾", "Auto-saves drafts", "Come back and continue anytime"],
          ["🤖", "AI-powered review", "Get instant feedback before submitting"], ["📎", "Document uploads", "Attach site plans, photos, reports"]
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ background: "#f5f8f5", borderRadius: 10, padding: 14, border: "1px solid #e2e8e3" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a5632" }}>{title}</div>
            <div style={{ fontSize: 11, color: "#6b7c6f" }}>{desc}</div>
          </div>
        ))}
      </div>
      <InfoCard title="📞 Need Help?" color="#2980b9">Call <strong>9257 9999</strong> or email <strong>enquiries@kalamunda.wa.gov.au</strong>. Processing takes approximately 3 weeks.</InfoCard>
    </div>
  );
}

// ─── Step 5: Document Upload (API-integrated) ───────────
function StepDocuments({ appId, app, setApp, refData, errors, form }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const docs = app?.documents || [];
  const categories = refData.documentCategories;

  const uploadFile = async (file, category) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("category_label", categories.find(c => c.code === category)?.label || category);
    try {
      const doc = await api(`/applications/${appId}/documents`, { method: "POST", body: formData });
      setApp(prev => ({ ...prev, documents: [doc, ...(prev.documents || [])] }));
    } catch { }
  };

  const addFiles = async (fileList) => {
    setUploading(true);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.size > MAX_FILE_SIZE) { alert(`${file.name} exceeds 25MB`); continue; }
      // Auto-detect category
      let cat = "other";
      const nm = file.name.toLowerCase(), ext = nm.split(".").pop();
      if (nm.includes("site") || nm.includes("plan") || ext === "dwg" || ext === "dxf") cat = "site_plan";
      else if (nm.includes("title") || nm.includes("certificate")) cat = "certificate_title";
      else if (nm.includes("arborist") || nm.includes("tree")) cat = "arborist_report";
      else if (nm.includes("quote") || nm.includes("estimate")) cat = "contractor_quote";
      else if (file.type?.startsWith("image/")) cat = "photos_existing";
      else if (nm.includes("storm") || nm.includes("drain")) cat = "stormwater_plan";
      else if (nm.includes("da") || nm.includes("approval")) cat = "da_approval";
      await uploadFile(file, cat);
    }
    setUploading(false);
  };

  const removeDoc = async (docId) => {
    try {
      await api(`/applications/${appId}/documents/${docId}`, { method: "DELETE" });
      setApp(prev => ({ ...prev, documents: (prev.documents || []).filter(d => d.id !== docId) }));
    } catch { }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

  const requiredCats = categories.filter(c => c.is_required);
  const uploadedCats = docs.map(d => d.category);

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 8px" }}>Supporting Documents</h3>
      <p style={{ color: "#6b7c6f", fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>Upload your documents. Each file is saved to the server immediately.</p>

      {/* Required checklist */}
      <div style={{ background: "#f5f8f5", borderRadius: 12, padding: "14px 18px", marginBottom: 20, border: "1px solid #e2e8e3" }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: "#1a5632", marginBottom: 10, textTransform: "uppercase" }}>📋 Required Documents</div>
        {requiredCats.map(cat => {
          const done = uploadedCats.includes(cat.code);
          return (
            <div key={cat.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #e8ede9" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, background: done ? "#27ae60" : "#e8ede9", color: done ? "#fff" : "#95a5a6" }}>{done ? "✓" : "—"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: done ? "#2c3e2f" : "#6b7c6f" }}>{cat.label}</div>
                {cat.hint && <div style={{ fontSize: 10, color: "#95a5a6" }}>{cat.hint}</div>}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: done ? "#27ae60" : "#c0392b" }}>{done ? "UPLOADED" : "REQUIRED"}</div>
            </div>
          );
        })}
      </div>

      {/* Drop zone */}
      <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? "#2d8a4e" : "#c8d5cb"}`, borderRadius: 14, padding: "32px 20px", textAlign: "center", cursor: "pointer", marginBottom: 20, background: dragOver ? "rgba(45,138,78,0.06)" : "#fafcfa" }}>
        {uploading ? <><Spinner /><div style={{ marginTop: 8, color: "#6b7c6f", fontSize: 13 }}>Uploading...</div></> : <>
          <div style={{ fontSize: 36, marginBottom: 8 }}>{dragOver ? "📥" : "📎"}</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#1a5632" }}>{dragOver ? "Drop files here" : "Drag & drop or click to browse"}</div>
          <div style={{ fontSize: 12, color: "#6b7c6f" }}>PDF, JPG, PNG, Word, DWG — up to 25MB</div>
        </>}
        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_EXT} onChange={e => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
      </div>

      {errors.documents && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 12 }}>⚠ {errors.documents}</div>}

      {/* Uploaded list */}
      {docs.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#2c3e2f", marginBottom: 10 }}>Uploaded ({docs.length})</div>
          {docs.map(doc => (
            <div key={doc.id} style={{ background: "#fff", borderRadius: 10, border: "1.5px solid #e2e8e3", padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>{doc.file_type?.startsWith("image") ? "🖼️" : doc.file_type === "application/pdf" ? "📕" : "📄"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#2c3e2f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.original_filename}</div>
                <div style={{ fontSize: 10, color: "#95a5a6" }}>{doc.category_label || doc.category} · {formatFileSize(doc.file_size)} · {formatDate(doc.uploaded_at)}</div>
              </div>
              <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: "#eafaf1", color: "#27ae60" }}>{doc.status}</span>
              {(app.status === "draft" || app.status === "info_requested") && (
                <button onClick={() => removeDoc(doc.id)} style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 14 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {docs.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "#95a5a6", fontSize: 13 }}>No documents yet. Upload your site plan and certificate of title.</div>}
    </div>
  );
}

// ─── AI Assistant Component ─────────────────────────────
function AIAssistant({ form, documents }) {
  const { messages, loading, sendMessage } = useAIChat();
  const [input, setInput] = useState("");
  const chatRef = useRef(null);
  const context = `Owner: ${form.ownerName}\nProperty: ${form.propertyAddress}\nFrontage: ${form.lotFrontage}m\nRoad: ${form.roadType}\nWidth: ${form.crossoverWidth}m\nCrossovers: ${form.numberOfCrossovers}\nSurface: ${form.surfaceMaterial}\nTrees: ${form.hasTreesNearby}\nDA: ${form.daNumber || "None"}\nDocuments: ${documents.length}`;

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [messages]);

  const send = () => { if (!input.trim()) return; sendMessage(input, context); setInput(""); };

  return (
    <div style={{ border: "1px solid #e2e8e3", borderRadius: 12, overflow: "hidden" }}>
      <div ref={chatRef} style={{ maxHeight: 200, overflowY: "auto", padding: 12 }}>
        {messages.length === 0 && <div style={{ textAlign: "center", color: "#b0bdb2", fontSize: 12, padding: 16 }}>Ask a question about your application...</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, textAlign: m.role === "user" ? "right" : "left" }}>
            <div style={{ display: "inline-block", maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5, background: m.role === "user" ? "#1a5632" : "#f5f8f5", color: m.role === "user" ? "#fff" : "#2c3e2f" }}>{m.content}</div>
          </div>
        ))}
        {loading && <div style={{ textAlign: "left" }}><span style={{ display: "inline-block", padding: "8px 12px", background: "#f5f8f5", borderRadius: 10, fontSize: 12 }}>Thinking...</span></div>}
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #e2e8e3" }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask Claude AI..." style={{ flex: 1, padding: "10px 14px", border: "none", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
        <button onClick={send} disabled={loading} style={{ padding: "10px 16px", border: "none", background: "#1a5632", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Send</button>
      </div>
    </div>
  );
}

// ─── Step 7: Submit View ────────────────────────────────
function StepSubmitView({ form, setForm, app, errors, refData }) {
  const frontage = parseFloat(form.lotFrontage) || 0;
  const eligible = form.existingCrossover === "no" && !form.daNumber;
  const docs = app?.documents || [];

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1a5632", margin: "0 0 20px" }}>Review & Submit</h3>
      <div style={{ background: "#f5f8f5", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #e2e8e3" }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "#1a5632" }}>Application Summary</h4>
        {[["Owner", form.ownerName], ["Phone", form.ownerPhone], ["Email", form.ownerEmail], ["Property", form.propertyAddress],
          ["Lot", `${form.lotNumber} (${form.planNumber})`], ["Frontage", `${form.lotFrontage}m`],
          ["Road", `${form.roadName} (${refData.roadTypes.find(r => r.code === form.roadType)?.label || form.roadType})`],
          ["Crossover Width", `${form.crossoverWidth}m`], ["Count", form.numberOfCrossovers],
          ["Surface", refData.surfaceMaterials.find(m => m.code === form.surfaceMaterial)?.label || form.surfaceMaterial],
          ["Est. Date", form.estimatedDate], ["DA", form.daNumber || "N/A"], ["Trees", form.hasTreesNearby === "yes" ? "Yes" : "No"],
          ["Drainage", refData.drainageTypes.find(d => d.code === form.drainageType)?.label || form.drainageType],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e8ede9", fontSize: 13 }}>
            <span style={{ color: "#6b7c6f" }}>{k}</span><span style={{ fontWeight: 600, color: "#2c3e2f" }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ background: "#f5f8f5", borderRadius: 12, padding: 20, marginBottom: 20, border: "1px solid #e2e8e3" }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "#1a5632" }}>📎 Documents ({docs.length})</h4>
        {docs.length === 0 ? <div style={{ color: "#c0392b", fontSize: 13 }}>⚠ No documents — go back to Step 5</div> :
          docs.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #e8ede9" }}>
              <span>📎</span>
              <div style={{ flex: 1, fontSize: 12 }}><span style={{ fontWeight: 600 }}>{d.category_label || d.category}:</span> {d.original_filename}</div>
              <span style={{ fontSize: 10, color: "#27ae60", fontWeight: 700 }}>{formatFileSize(d.file_size)}</span>
            </div>
          ))}
      </div>

      {eligible && <InfoCard title="💰 Contribution Eligibility" color="#27ae60">Eligible for up to <strong>$474</strong> (or half cost). Apply within 6 months with receipts.</InfoCard>}
      {(form.roadType === "red" || form.roadType === "blue" || form.roadType === "mrwa") && <InfoCard title="📋 Referral" color="#b8860b">Application will be referred externally. This may extend processing.</InfoCard>}

      <div style={{ background: "#fff9e6", border: "1px solid #f0d860", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <label style={{ display: "flex", gap: 10, cursor: "pointer", fontSize: 13, lineHeight: 1.6, color: "#5a4a00" }}>
          <input type="checkbox" checked={form.declaration} onChange={e => setForm({ ...form, declaration: e.target.checked })} style={{ marginTop: 3, flexShrink: 0 }} />
          <span>I, <strong>{form.ownerName || "[Owner]"}</strong>, declare the information and documents provided are true and accurate. I will construct in accordance with the City's specification and protect verge trees and vegetation. No works will commence until approved.</span>
        </label>
        {errors.declaration && <div style={{ fontSize: 12, color: "#c0392b", marginTop: 8 }}>⚠ {errors.declaration}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SUBMITTED VIEW — tracking, messages, status timeline
// ═══════════════════════════════════════════════════════════
function SubmittedView({ app, onBack, onWithdraw }) {
  const [tab, setTab] = useState("summary"); // summary | tracking | messages
  const [messages, setMessages] = useState(app.messages || []);
  const [newMsg, setNewMsg] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  const sendMessage = async () => {
    if (!newMsg.trim()) return;
    setSendingMsg(true);
    try {
      const msg = await api(`/applications/${app.id}/messages`, { method: "POST", body: JSON.stringify({ subject: "Applicant message", body: newMsg }) });
      setMessages(prev => [msg, ...prev]);
      setNewMsg("");
    } catch { }
    setSendingMsg(false);
  };

  const docs = app.documents || [];
  const history = app.status_history || [];
  const canWithdraw = !["approved", "rejected", "withdrawn"].includes(app.status);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={onBack} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 11 }}>← My Applications</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a5632" }}>{app.ref_number}</span>
          <StatusBadge status={app.status} />
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 20, padding: "28px 24px", boxShadow: "0 4px 24px rgba(26,86,50,0.06)", border: "1px solid #e2e8e3" }}>
        {/* Success header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: app.status === "approved" ? "linear-gradient(135deg, #27ae60, #2ecc71)" : app.status === "rejected" ? "linear-gradient(135deg, #c0392b, #e74c3c)" : "linear-gradient(135deg, #2980b9, #3498db)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: 28 }}>
            {STATUS_LABELS[app.status]?.icon || "📤"}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1a5632", margin: "0 0 4px" }}>Application {STATUS_LABELS[app.status]?.label}</h2>
          <p style={{ color: "#6b7c6f", fontSize: 12, margin: 0 }}>Submitted {formatDateTime(app.submitted_at)}</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderRadius: 8, overflow: "hidden", border: "1.5px solid #e2e8e3" }}>
          {[["summary", "📋 Summary"], ["tracking", "📍 Tracking"], ["messages", "💬 Messages"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: "8px", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: tab === k ? "#1a5632" : "#fff", color: tab === k ? "#fff" : "#6b7c6f" }}>{l}
              {k === "messages" && messages.filter(m => !m.is_read && m.sender_type !== "applicant").length > 0 && <span style={{ marginLeft: 4, background: "#e74c3c", color: "#fff", borderRadius: 8, padding: "1px 5px", fontSize: 9 }}>{messages.filter(m => !m.is_read && m.sender_type !== "applicant").length}</span>}
            </button>
          ))}
        </div>

        {/* Summary tab */}
        {tab === "summary" && (
          <div>
            <div style={{ background: "#f5f8f5", borderRadius: 12, padding: 16, marginBottom: 16, border: "1px solid #e2e8e3" }}>
              {[["Reference", app.ref_number], ["Property", app.property_address], ["Owner", app.owner_name],
                ["Frontage", `${app.lot_frontage}m`], ["Crossover", `${app.crossover_width}m ${app.surface_material}`],
                ["Road", `${app.road_name} (${app.road_type})`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #e8ede9", fontSize: 12 }}>
                  <span style={{ color: "#6b7c6f" }}>{k}</span><span style={{ fontWeight: 600, color: "#2c3e2f" }}>{v || "—"}</span>
                </div>
              ))}
            </div>
            {docs.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1a5632", marginBottom: 8 }}>📎 Documents ({docs.length})</div>
                {docs.map(d => (
                  <div key={d.id} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between" }}>
                    <span>{d.category_label || d.category}: {d.original_filename}</span>
                    <span style={{ color: "#95a5a6" }}>{formatFileSize(d.file_size)}</span>
                  </div>
                ))}
              </div>
            )}
            {app.contribution_eligible && <InfoCard title="💰 Contribution" color="#27ae60">Eligible — up to <strong>${app.contribution_amount}</strong></InfoCard>}
          </div>
        )}

        {/* Tracking tab */}
        {tab === "tracking" && (
          <div>
            {history.length === 0 ? <div style={{ color: "#95a5a6", fontSize: 12, textAlign: "center", padding: 20 }}>No history yet</div> :
              history.map((h, i) => (
                <div key={h.id} style={{ display: "flex", gap: 12, marginBottom: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: i === 0 ? "#1a5632" : "#d5dde2", flexShrink: 0 }} />
                    {i < history.length - 1 && <div style={{ width: 2, flex: 1, background: "#e2e8e3" }} />}
                  </div>
                  <div style={{ paddingBottom: 16 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <StatusBadge status={h.new_status} />
                      <span style={{ fontSize: 10, color: "#95a5a6" }}>{formatDateTime(h.changed_at)}</span>
                    </div>
                    {h.changed_by && <div style={{ fontSize: 10, color: "#95a5a6", marginTop: 2 }}>by {h.changed_by}</div>}
                    {h.reason && <div style={{ fontSize: 11, color: "#6b7c6f", marginTop: 2 }}>{h.reason}</div>}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Messages tab */}
        {tab === "messages" && (
          <div>
            <div style={{ maxHeight: 250, overflowY: "auto", marginBottom: 12 }}>
              {messages.length === 0 && <div style={{ color: "#95a5a6", fontSize: 12, textAlign: "center", padding: 20 }}>No messages yet</div>}
              {messages.map(m => (
                <div key={m.id} style={{ marginBottom: 8, textAlign: m.sender_type === "applicant" ? "right" : "left" }}>
                  <div style={{ display: "inline-block", maxWidth: "80%", padding: "8px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
                    background: m.sender_type === "applicant" ? "#1a5632" : m.sender_type === "system" ? "#fef5e7" : "#f5f8f5",
                    color: m.sender_type === "applicant" ? "#fff" : "#2c3e2f" }}>
                    {m.sender_type !== "applicant" && <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>{m.sender_name || m.sender_type}</div>}
                    {m.subject && <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{m.subject}</div>}
                    {m.body}
                  </div>
                  <div style={{ fontSize: 9, color: "#b0bdb2", marginTop: 2 }}>{formatDateTime(m.created_at)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Type a message..." style={{ flex: 1, ...inputStyle, padding: "8px 12px", fontSize: 12 }} />
              <button onClick={sendMessage} disabled={sendingMsg} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#1a5632", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Send</button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e8ede9", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11, color: "#95a5a6" }}>📞 9257 9999 | enquiries@kalamunda.wa.gov.au</div>
          {canWithdraw && <button onClick={onWithdraw} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #e74c3c30", background: "#fdedec", color: "#c0392b", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>🚫 Withdraw</button>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN APPLICATION
// ═══════════════════════════════════════════════════════════
export default function KalamundaCrossoverApp() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard"); // dashboard | wizard
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const refData = useRefData();

  // Check existing token on mount
  useEffect(() => {
    const token = localStorage.getItem("cx_token");
    if (token) {
      (async () => {
        try {
          const me = await api("/auth/me");
          setUser(me);
        } catch {
          localStorage.removeItem("cx_token");
        }
        setAuthChecked(true);
      })();
    } else {
      setAuthChecked(true);
    }
  }, []);

  const handleAuth = (applicant) => { setUser(applicant); setView("dashboard"); };
  const handleLogout = () => { localStorage.removeItem("cx_token"); setUser(null); setView("dashboard"); };

  const handleSelectApp = (id) => { setSelectedAppId(id); setView("wizard"); };
  const handleNewApp = async () => {
    try {
      const newApp = await api("/applications/", { method: "POST", body: JSON.stringify({}) });
      setSelectedAppId(newApp.id);
      setView("wizard");
    } catch { }
  };
  const handleBackToDashboard = () => { setView("dashboard"); setSelectedAppId(null); };

  if (!authChecked) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}><Spinner /> Loading...</div>;
  if (!user) return <AuthScreen onAuth={handleAuth} />;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #e8f0ea 0%, #f5f8f5 50%, #e0ebe2 100%)", padding: "24px 16px", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        @keyframes spin { to { transform: rotate(360deg) } }
        input:focus, select:focus, textarea:focus { border-color: #2d8a4e !important; box-shadow: 0 0 0 3px rgba(45,138,78,0.12) !important; }
        * { box-sizing: border-box; }`}
      </style>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, #1a5632, #2d8a4e)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} onClick={handleBackToDashboard}><span style={{ fontSize: 22 }}>🏛️</span></div>
          <div><div style={{ fontWeight: 800, fontSize: 16, color: "#1a5632", cursor: "pointer" }} onClick={handleBackToDashboard}>City of Kalamunda</div><div style={{ fontSize: 12, color: "#6b7c6f" }}>Crossover Application Portal</div></div>
          <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 11, color: "#6b7c6f" }}>
            <div>{user.full_name}</div>
            <div style={{ fontSize: 10, color: "#b0bdb2" }}>{user.email}</div>
          </div>
        </div>

        {view === "dashboard" && (
          <Dashboard user={user} onSelectApp={handleSelectApp} onNewApp={handleNewApp} onLogout={handleLogout} />
        )}

        {view === "wizard" && selectedAppId && (
          <ApplicationWizard appId={selectedAppId} user={user} refData={refData} onBack={handleBackToDashboard} />
        )}

        <div style={{ textAlign: "center", fontSize: 11, color: "#8a9a8c", lineHeight: 1.6, marginTop: 20 }}>
          City of Kalamunda | 2 Railway Road, Kalamunda WA 6076 | 9257 9999 | enquiries@kalamunda.wa.gov.au<br />Crossover Guideline v3.1 (23/06/2022)
        </div>
      </div>
    </div>
  );
}
