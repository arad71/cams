// ═══════════════════════════════════════════════════════════
//  API SERVICE LAYER
// ═══════════════════════════════════════════════════════════
export const API_BASE = "http://localhost:8000/api";

const api = {
  _token: null,
  _setToken(t) { this._token = t; if (t) localStorage.setItem("kala_token", t); else localStorage.removeItem("kala_token"); },
  _getToken() { if (!this._token) this._token = localStorage.getItem("kala_token"); return this._token; },
  async _fetch(path, opts = {}) {
    const token = this._getToken();
    const headers = { ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (opts.body && !(opts.body instanceof FormData)) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.body); }
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 401) { this._setToken(null); throw new Error("Session expired"); }
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
    return data;
  },

  // Auth
  async login(email, password) {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API_BASE}/auth/login`, { method: "POST", body });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Login failed"); }
    const data = await res.json();
    this._setToken(data.access_token);
    return data.user;
  },
  async me() { return this._fetch("/auth/me"); },
  logout() { this._setToken(null); },

  // Users
  async listUsers() { return this._fetch("/users/"); },
  async createUser(data) { return this._fetch("/users/", { method: "POST", body: data }); },
  async updateUser(id, data) { return this._fetch(`/users/${id}`, { method: "PATCH", body: data }); },
  async deleteUser(id) { return this._fetch(`/users/${id}`, { method: "DELETE" }); },

  // Applications
  async listApps(statusFilter) { const q = statusFilter ? `?status=${statusFilter}` : ""; return this._fetch(`/applications/${q}`); },
  async getApp(id) { return this._fetch(`/applications/${id}`); },
  async createApp(data) { return this._fetch("/applications/", { method: "POST", body: data }); },
  async updateApp(id, data) { return this._fetch(`/applications/${id}`, { method: "PATCH", body: data }); },
  async assignOfficer(appId, officerId) { return this._fetch(`/applications/${appId}/assign/${officerId}`, { method: "POST" }); },
  async addNote(appId, text) { return this._fetch(`/applications/${appId}/notes`, { method: "POST", body: { text } }); },
  async addDocument(appId, data) { return this._fetch(`/applications/${appId}/documents`, { method: "POST", body: data }); },
  async updateDocStatus(appId, docId, status) { return this._fetch(`/applications/${appId}/documents/${docId}?status=${status}`, { method: "PATCH" }); },
  async scheduleInspection(appId, data) { return this._fetch(`/applications/${appId}/inspections`, { method: "POST", body: data }); },
  // Verification (category-specific)
  async verifyApplicationDoc(appId, docId) {
    // e.g. POST /api/applications/{appId}/documents/{docId}/verify-application
    return this._fetch(`/applications/${appId}/documents/${docId}/verify-application`, {
      method: "POST"
    });
  },

  async verifySitePlanDoc(appId, docId) {
    // e.g. POST /api/applications/{appId}/documents/{docId}/verify-siteplan`
    return this._fetch(`/applications/${appId}/documents/${docId}/verify-siteplan`, {
      method: "POST"
    });
  },
  
  // Assessments
  async listAssessments(appId) { return this._fetch(`/applications/${appId}/assessments`); },
  async updateAssessment(appId, itemId, data) { return this._fetch(`/applications/${appId}/assessments/${itemId}`, { method: "PATCH", body: data }); },
  async runAIAssess(appId) { return this._fetch(`/applications/${appId}/assessments/ai-assess`, { method: "POST" }); },
  async bulkOfficerDecision(appId, aiFilter, decision) { return this._fetch(`/applications/${appId}/assessments/bulk-officer`, { method: "POST", body: { ai_result_filter: aiFilter, officer_decision: decision } }); },
  async getAssessmentSummary(appId) { return this._fetch(`/applications/${appId}/assessments/summary`); },

  // Reports
  async generateReport(appId) { return this._fetch(`/applications/${appId}/reports`, { method: "POST" }); },
  async listReports(appId) { return this._fetch(`/applications/${appId}/reports`); },
  async getReport(appId, version) { return this._fetch(`/applications/${appId}/reports/${version}`); },
};

export default api;
