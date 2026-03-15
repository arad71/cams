import { useState } from "react";
import api from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';

// ─── Login Screen ───────────────────────────────────────
export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const iS = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  const handleLogin = async () => {
    if (!email || !password) { setError("Enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const user = await api.login(email, password);
      onLogin(apiUserToFrontend(user));
    } catch (e) { setError(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0c1f2e, #1a3a4a)", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 36px", width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#1abc9c,#16a085)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 12 }}>🏛</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>City of Kalamunda</h1>
          <p style={{ color: "#7a8a94", fontSize: 12, margin: 0 }}>Crossover Approval System v3.1</p>
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#5a6a74", display: "block", marginBottom: 4 }}>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="m.thompson@kalamunda.wa.gov.au" style={{ ...iS, marginBottom: 12 }} />
        <label style={{ fontSize: 11, fontWeight: 700, color: "#5a6a74", display: "block", marginBottom: 4 }}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="Enter password" style={{ ...iS, marginBottom: 6 }} />
        {error && <div style={{ color: "#e74c3c", fontSize: 11, marginBottom: 8, fontWeight: 600 }}>{error}</div>}
        <button onClick={handleLogin} disabled={loading}
          style={{ width: "100%", padding: "11px", borderRadius: 8, border: "none", marginTop: 10,
            background: loading ? "#d5dde2" : "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff",
            fontWeight: 800, fontSize: 13, cursor: loading ? "default" : "pointer", fontFamily: "inherit" }}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <div style={{ marginTop: 16, padding: "10px", background: "#f8fafb", borderRadius: 8, fontSize: 10, color: "#7a8a94", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Demo Accounts:</div>
          <div>🛡️ Admin: m.thompson@kalamunda.wa.gov.au / admin123</div>
          <div>👔 Manager: k.williams@kalamunda.wa.gov.au / manager123</div>
          <div>🔧 Engineer: s.patel@kalamunda.wa.gov.au / engineer123</div>
        </div>
      </div>
    </div>
  );
}
