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
  async changePassword(currentPassword, newPassword) { return this._fetch("/auth/change-password", { method: "POST", body: { current_password: currentPassword, new_password: newPassword } }); },

  // Roles & Departments
  async listRoles() { return this._fetch("/lookups/roles"); },
  async createRole(data) { return this._fetch("/lookups/roles", { method: "POST", body: data }); },
  async updateRole(id, data) { return this._fetch(`/lookups/roles/${id}`, { method: "PATCH", body: data }); },
  async listDepartments() { return this._fetch("/lookups/departments"); },
  async createDepartment(data) { return this._fetch("/lookups/departments", { method: "POST", body: data }); },
  async updateDepartment(id, data) { return this._fetch(`/lookups/departments/${id}`, { method: "PATCH", body: data }); },
  async deleteUser(id) { return this._fetch(`/users/${id}`, { method: "DELETE" }); },

  // Applications
  async listApps(statusFilter) { const q = statusFilter ? `?status=${statusFilter}` : ""; return this._fetch(`/applications/${q}`); },
  async getApp(id) { return this._fetch(`/applications/${id}`); },
  async createApp(data) { return this._fetch("/applications/", { method: "POST", body: data }); },
  async updateApp(id, data) { return this._fetch(`/applications/${id}`, { method: "PATCH", body: data }); },
  async assignOfficer(appId, officerId) { return this._fetch(`/applications/${appId}/assign/${officerId}`, { method: "POST" }); },
  async addNote(appId, text) { return this._fetch(`/applications/${appId}/notes`, { method: "POST", body: { text } }); },
  async addDocument(appId, data) { return this._fetch(`/applications/${appId}/documents`, { method: "POST", body: data }); },
  async uploadDocument(appId, file, category) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category || "Other");
    return this._fetch(`/applications/${appId}/documents/upload`, { method: "POST", body: formData });
  },
  async updateDocStatus(appId, docId, status, reviewNote) {
    const body = {};
    if (status !== undefined) body.status = status;
    if (reviewNote !== undefined) body.review_note = reviewNote;
    return this._fetch(`/applications/${appId}/documents/${docId}`, { method: "PATCH", body });
  },
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
  
  // Assessments (per-application)
  async listAssessments(appId) { return this._fetch(`/applications/${appId}/assessments`); },
  async updateAssessment(appId, itemId, data) { return this._fetch(`/applications/${appId}/assessments/${itemId}`, { method: "PATCH", body: data }); },
  async runAIAssess(appId) { return this._fetch(`/applications/${appId}/assessments/ai-assess`, { method: "POST" }); },
  async bulkOfficerDecision(appId, aiFilter, decision) { return this._fetch(`/applications/${appId}/assessments/bulk-officer`, { method: "POST", body: { ai_result_filter: aiFilter, officer_decision: decision } }); },
  async getAssessmentSummary(appId) { return this._fetch(`/applications/${appId}/assessments/summary`); },

  // Assessment Master Data (categories & items)
  async listCategories() { return this._fetch("/assessment/categories"); },
  async createCategory(data) { return this._fetch("/assessment/categories", { method: "POST", body: data }); },
  async updateCategory(id, data) { return this._fetch(`/assessment/categories/${id}`, { method: "PATCH", body: data }); },
  async createItem(catId, data) { return this._fetch(`/assessment/categories/${catId}/items`, { method: "POST", body: data }); },
  async updateItem(catId, itemId, data) { return this._fetch(`/assessment/categories/${catId}/items/${itemId}`, { method: "PATCH", body: data }); },

  // Assessment Rules
  async listRules(itemCode) { const q = itemCode ? `?item_code=${itemCode}` : ""; return this._fetch(`/assessment/rules${q}`); },
  async createRule(data) { return this._fetch("/assessment/rules", { method: "POST", body: data }); },
  async updateRule(id, data) { return this._fetch(`/assessment/rules/${id}`, { method: "PATCH", body: data }); },
  async deleteRule(id) { return this._fetch(`/assessment/rules/${id}`, { method: "DELETE" }); },

  // Reports
  async generateReport(appId) { return this._fetch(`/applications/${appId}/reports`, { method: "POST" }); },
  async listReports(appId) { return this._fetch(`/applications/${appId}/reports`); },
  async getReport(appId, version) { return this._fetch(`/applications/${appId}/reports/${version}`); },

  // Extract application form data from uploaded PDF
  async extractAppForm(file) {
    const formData = new FormData();
    formData.append("file", file);
    return this._fetch("/extract_app_form", { method: "POST", body: formData });
  },

  // Analyse site plan via AI (Claude vision)
  async analyseSitePlan(file) {
    const formData = new FormData();
    formData.append("file", file);
    const token = this._getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE.replace('/api', '')}/ai/analyse`, { method: "POST", headers, body: formData });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Site plan analysis failed"); }
    return res.json();
  },
};

export default api;
