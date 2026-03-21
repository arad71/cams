import { useState, useEffect, useCallback } from "react";
import api, { API_BASE } from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';

export default function LoginScreen({ onLogin, branding: B = {} }) {
  const orgName = B.orgName || "City of Kalamunda";
  const systemName = B.systemName || "Crossover Approval System";
  const version = B.version || "3.1";
  const icon = B.icon || "🏛";
  const primaryColor = B.primaryColor || "#1abc9c";
  const darkColor = B.darkColor || "#1a3a4a";
  const copyright = B.copyright || "";
  const disclaimer = B.disclaimer || "";
  const emailDomain = B.emailDomain || "kalamunda.wa.gov.au";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState(null);
  const iS = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  // Load auth config on mount
  useEffect(() => {
    api.getAuthConfig().then(setAuthConfig).catch(() => setAuthConfig({ local_enabled: true, entra_enabled: false }));
  }, []);

  // Handle Microsoft redirect callback (code in URL hash/params)
  const handleEntraCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);

    setLoading(true);
    setError("");
    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const user = await api.entraTokenExchange(code, redirectUri);
      onLogin(apiUserToFrontend(user));
    } catch (e) {
      setError(e.message || "Microsoft login failed");
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  useEffect(() => { handleEntraCallback(); }, [handleEntraCallback]);

  // Local login
  const handleLogin = async () => {
    if (!email || !password) { setError("Enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const user = await api.login(email, password);
      onLogin(apiUserToFrontend(user));
    } catch (e) { setError(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  // Microsoft login — redirect to Entra authorization endpoint
  const handleMicrosoftLogin = () => {
    if (!authConfig?.entra_enabled) return;
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      client_id: authConfig.entra_client_id,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      prompt: "select_account",
    });
    window.location.href = `${authConfig.entra_authority}/oauth2/v2.0/authorize?${params}`;
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0c1f2e, #1a3a4a)", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 36px", width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg,${primaryColor},${primaryColor}dd)`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 12 }}>{icon}</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: darkColor, margin: "0 0 4px" }}>{orgName}</h1>
          <p style={{ color: "#7a8a94", fontSize: 12, margin: 0 }}>{systemName} v{version}</p>
        </div>

        {/* Microsoft SSO Button */}
        {authConfig?.entra_enabled && (
          <>
            <button onClick={handleMicrosoftLogin} disabled={loading}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1.5px solid #d5dde2", background: "#fff",
                cursor: loading ? "default" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 }}>
              <svg width="20" height="20" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>Sign in with Microsoft</span>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: "#e4e9ec" }} />
              <span style={{ fontSize: 10, color: "#95a5a6", fontWeight: 600 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "#e4e9ec" }} />
            </div>
          </>
        )}

        {/* Local Login Form */}
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

        {/* WA Gov compliance note when Entra is enabled */}
        {authConfig?.entra_enabled && (
          <div style={{ marginTop: 14, padding: "8px 10px", background: "#ebf5fb", borderRadius: 6, fontSize: 9, color: "#2980b9", lineHeight: 1.5 }}>
            🔐 <strong>WA Government MFA:</strong> Microsoft sign-in enforces multi-factor authentication per WA Digital Security Policy. Local accounts are available for external users.
          </div>
        )}

        {/* Demo accounts — only show when Entra is not configured */}
        {!authConfig?.entra_enabled && (
          <div style={{ marginTop: 16, padding: "10px", background: "#f8fafb", borderRadius: 8, fontSize: 10, color: "#7a8a94", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Demo Accounts:</div>
            <div>🛡️ Admin: m.thompson@kalamunda.wa.gov.au / admin123</div>
            <div>👔 Manager: k.williams@kalamunda.wa.gov.au / manager123</div>
            <div>🔧 Engineer: s.patel@kalamunda.wa.gov.au / engineer123</div>
          </div>
        )}
      </div>
    </div>
  );
}
