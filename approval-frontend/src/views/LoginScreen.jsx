import { useState, useEffect, useCallback } from "react";
import api, { API_BASE } from '../services/api';
import { apiUserToFrontend } from '../utils/transforms';
import { T, S, cx } from '../styles/tokens';

export default function LoginScreen({ onLogin, branding: B = {} }) {
  const orgName = B.orgName || "Council";
  const systemName = B.systemName || "Crossover Approval System";
  const version = B.version || "3.1";
  const icon = B.icon || "\u{1f3db}";
  const primaryColor = B.primaryColor || T.c.accent;
  const darkColor = B.darkColor || T.c.primary;
  const copyright = B.copyright || "";
  const disclaimer = B.disclaimer || "";
  const emailDomain = B.emailDomain || "council.wa.gov.au";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState(null);

  useEffect(() => {
    api.getAuthConfig().then(setAuthConfig).catch(() => setAuthConfig({ local_enabled: true, entra_enabled: false }));
  }, []);

  const handleEntraCallback = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    setLoading(true); setError("");
    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const user = await api.entraTokenExchange(code, redirectUri);
      onLogin(apiUserToFrontend(user));
    } catch (e) { setError(e.message || "Microsoft login failed"); }
    finally { setLoading(false); }
  }, [onLogin]);

  useEffect(() => { handleEntraCallback(); }, [handleEntraCallback]);

  const handleLogin = async () => {
    if (!email || !password) { setError("Enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const user = await api.login(email, password);
      onLogin(apiUserToFrontend(user));
    } catch (e) { setError(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  const handleMicrosoftLogin = () => {
    if (!authConfig?.entra_enabled) return;
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      client_id: authConfig.entra_client_id, response_type: "code",
      redirect_uri: redirectUri, response_mode: "query",
      scope: "openid profile email", prompt: "select_account",
    });
    window.location.href = `${authConfig.entra_authority}/oauth2/v2.0/authorize?${params}`;
  };

  const inputStyle = cx(S.input, { marginBottom: T.s.md });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${T.c.navy800}, ${T.c.primary})` }}>
      <div style={{ background: T.c.card, borderRadius: T.r.xl, padding: `${T.s.xxxl + 8}px ${T.s.xxxl}px`, width: 388, boxShadow: T.sh.xl }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: T.s.xxl }}>
          <div style={{ width: 56, height: 56, borderRadius: T.r.lg, background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: T.s.md, boxShadow: `0 4px 16px ${primaryColor}40` }}>{icon}</div>
          <h1 style={{ fontSize: T.f.xl, fontWeight: T.w.black, color: darkColor, margin: `0 0 ${T.s.xs}px`, letterSpacing: -0.3 }}>{orgName}</h1>
          <p style={{ color: T.c.textSecondary, fontSize: T.f.md, margin: 0 }}>{systemName} v{version}</p>
        </div>

        {/* Microsoft SSO */}
        {authConfig?.entra_enabled && (
          <>
            <button onClick={handleMicrosoftLogin} disabled={loading}
              style={cx(S.btnOutline, { width: "100%", padding: `${T.s.md}px ${T.s.lg}px`, marginBottom: T.s.lg, display: "flex", alignItems: "center", justifyContent: "center", gap: T.s.sm })}>
              <svg width="20" height="20" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
              <span style={{ fontSize: T.f.base, fontWeight: T.w.bold, color: T.c.primary }}>Sign in with Microsoft</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: T.s.md, marginBottom: T.s.lg }}>
              <div style={{ flex: 1, height: 1, background: T.c.border }} />
              <span style={{ fontSize: T.f.md, color: T.c.textMuted, fontWeight: T.w.semi }}>OR</span>
              <div style={{ flex: 1, height: 1, background: T.c.border }} />
            </div>
          </>
        )}

        {/* Local Login */}
        <label style={cx(S.label, { marginBottom: T.s.xs })}>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder={`user@${emailDomain}`} style={inputStyle} />

        <label style={cx(S.label, { marginBottom: T.s.xs })}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="Enter password" style={cx(S.input, { marginBottom: T.s.sm })} />

        {error && <div style={{ color: T.c.danger, fontSize: T.f.md, marginBottom: T.s.sm, fontWeight: T.w.semi }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading}
          style={cx(S.btnPrimary, { width: "100%", padding: `${T.s.md}px`, marginTop: T.s.sm, fontSize: T.f.base,
            background: loading ? T.c.grey400 : `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`,
            cursor: loading ? "default" : "pointer" })}>
          {loading ? "Signing in..." : "Sign In"}
        </button>

        {/* WA Gov MFA note */}
        {authConfig?.entra_enabled && (
          <div style={{ marginTop: T.s.lg, padding: `${T.s.sm}px ${T.s.md}px`, background: T.c.infoLight, borderRadius: T.r.md, fontSize: T.f.xs, color: T.c.info, lineHeight: 1.5 }}>
            {"\u{1f510}"} <strong>WA Government MFA:</strong> Microsoft sign-in enforces multi-factor authentication per WA Digital Security Policy. Local accounts are available for external users.
          </div>
        )}

        {/* Demo accounts */}
        {!authConfig?.entra_enabled && (
          <div style={{ marginTop: T.s.xl, padding: T.s.md, background: T.c.bg, borderRadius: T.r.md, fontSize: T.f.md, color: T.c.textSecondary, lineHeight: 1.7 }}>
            <div style={{ fontWeight: T.w.bold, marginBottom: T.s.xs }}>Demo Accounts:</div>
            <div>{"\u{1f6e1}\ufe0f"} Admin: admin@{emailDomain} / admin123</div>
            <div>{"\u{1f454}"} Manager: manager@{emailDomain} / manager123</div>
            <div>{"\u{1f527}"} Engineer: engineer@{emailDomain} / engineer123</div>
            <div>{"\u{1f441}"} Viewer: viewer@{emailDomain} / viewer123</div>
          </div>
        )}

        {(disclaimer || copyright) && (
          <div style={{ marginTop: T.s.lg, textAlign: "center", fontSize: T.f.xxs, color: T.c.textPlaceholder, lineHeight: 1.5 }}>
            {disclaimer && <div>{disclaimer}</div>}
            {copyright && <div style={{ marginTop: 2 }}>{copyright}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
