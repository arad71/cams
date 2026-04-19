// ═══════════════════════════════════════════════════════════
//  API SERVICE LAYER
// ═══════════════════════════════════════════════════════════
// API base: use relative /api path in production (nginx proxies to backend).
// For local dev without Docker, set VITE_API_BASE=http://localhost:8000/api
export const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) || "/api";

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
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(!res.ok ? `Server error (${res.status})` : `Invalid response from server`); }
    if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
    return data;
  },

  // Auth
  async login(email, password) {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API_BASE}/auth/login`, { method: "POST", body });
    if (!res.ok) {
      try { const e = await res.json(); throw new Error(e.detail || "Login failed"); }
      catch (parseErr) {
        if (parseErr.message && !parseErr.message.includes("Unexpected")) throw parseErr;
        throw new Error(`Server error (${res.status}). Backend may not be running — check deployment.`);
      }
    }
    const data = await res.json();
    this._setToken(data.access_token);
    return data.user;
  },
  async getAuthConfig() {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) return { local_enabled: true, entra_enabled: false };
    return res.json();
  },
  async entraTokenExchange(code, redirectUri) {
    const res = await fetch(`${API_BASE}/auth/entra/token?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`, { method: "POST" });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Microsoft login failed"); }
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
  getDocumentFileUrl(appId, docId) {
    const token = this._getToken();
    return `${API_BASE}/applications/${appId}/documents/${docId}/file?token=${encodeURIComponent(token || "")}`;
  },
  getDocumentDownloadUrl(appId, docId) {
    const token = this._getToken();
    return `${API_BASE}/applications/${appId}/documents/${docId}/file?download=true&token=${encodeURIComponent(token || "")}`;
  },
  getDocumentRenderUrl(appId, docId, page = 1) {
    const token = this._getToken();
    return `${API_BASE}/applications/${appId}/documents/${docId}/render?page=${page}&token=${encodeURIComponent(token || "")}`;
  },
  async deleteDocument(appId, docId) { return this._fetch(`/applications/${appId}/documents/${docId}`, { method: "DELETE" }); },
  async ocrRegion(appId, docId, region) { return this._fetch(`/applications/${appId}/documents/${docId}/ocr-region`, { method: "POST", body: region }); },
  async rotatePdf(appId, docId, degrees) { return this._fetch(`/applications/${appId}/documents/${docId}/rotate`, { method: "POST", body: { degrees } }); },
  async extractDocFields(appId, docId, type, method) { return this._fetch(`/applications/${appId}/documents/${docId}/extract-fields`, { method: "POST", body: { type, extraction_method: method || "ai_live" } }); },
  async extractPages(appId, docId, pages, category, method) { return this._fetch(`/applications/${appId}/documents/${docId}/extract-pages`, { method: "POST", body: { pages, category, method } }); },
  async extractSiteplan(appId, docId, pages) { return this._fetch(`/applications/${appId}/documents/${docId}/extract-siteplan?pages=${encodeURIComponent(pages)}`, { method: "POST" }); },
  async saveBoundaries(appId, data) { return this._fetch(`/applications/${appId}/boundaries`, { method: "PUT", body: data }); },
  async scheduleInspection(appId, data) { return this._fetch(`/applications/${appId}/inspections`, { method: "POST", body: data }); },
  async updateInspection(appId, inspId, data) { return this._fetch(`/applications/${appId}/inspections/${inspId}`, { method: "PATCH", body: data }); },
  async uploadInspectionPhoto(appId, inspId, file, caption = "", checklistItem = "") {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("caption", caption);
    formData.append("checklist_item", checklistItem);
    const token = this._getToken();
    const res = await fetch(`${API_BASE}/applications/${appId}/inspections/${inspId}/photo`, {
      method: "POST", body: formData, headers: token ? { "Authorization": `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  // Document AI analysis
  async analyseDocument(appId, docId) { return this._fetch(`/applications/${appId}/documents/${docId}/analyse`, { method: "POST" }); },
  async correctSitePlan(appId, corrections) { return this._fetch(`/applications/${appId}/site-plan-correction`, { method: "PATCH", body: corrections }); },

  // Application soft-delete
  async deleteApplication(appId, reason) { return this._fetch(`/applications/${appId}`, { method: "DELETE", body: { reason } }); },
  async listDeletedApplications() { return this._fetch("/applications/deleted/list"); },
  async restoreApplication(appId) { return this._fetch(`/applications/${appId}/restore`, { method: "POST" }); },

  // AI Training data
  async trainingStats() { return this._fetch("/training/stats"); },
  async trainingVerify(sampleId) { return this._fetch(`/training/samples/${sampleId}/verify`, { method: "POST" }); },
  async trainingCorrect(sampleId, corrections) { return this._fetch(`/training/samples/${sampleId}/correct`, { method: "POST", body: corrections }); },
  async trainingSamples(appId) { return this._fetch(`/training/samples?limit=50&offset=0`); },
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
  async getAuditLog(entityId) { return this._fetch(`/audit?entity_id=${entityId}&entity_type=application&limit=20`); },
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
  async downloadReportPdf(appId, version) {
    const token = this._getToken();
    const res = await fetch(`${API_BASE}/applications/${appId}/reports/${version}/pdf`, {
      headers: token ? { "Authorization": `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`PDF download failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CAMS_Report_v${version}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Extract application form data from uploaded PDF

  // Analyse site plan via AI vision
  async analyseSitePlan(file) {
    const formData = new FormData();
    formData.append("file", file);
    const token = this._getToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const aiBase = API_BASE.endsWith("/api") ? API_BASE.slice(0, -4) : API_BASE.replace("/api", "");
    const res = await fetch(`${aiBase}/ai/analyse`, { method: "POST", headers, body: formData });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Site plan analysis failed"); }
    return res.json();
  },

  // Site Settings
  async getPublicSettings() { const res = await fetch(`${API_BASE}/settings/public`); return res.ok ? res.json() : {}; },
  async getAllSettings() { return this._fetch("/settings/"); },
  async updateSettings(updates) { return this._fetch("/settings/", { method: "PATCH", body: updates }); },
  async resetRules() { return this._fetch("/assessment/reset-rules", { method: "POST" }); },
  async reseedRules() { return this._fetch("/assessment/reseed-rules", { method: "POST" }); },

  // GeoData — Data WA SLIP integration
  async getGeodataStatus() { return this._fetch("/geodata/status"); },
  async refreshGeodata(layer = null) { const q = layer ? `?layer=${layer}` : ""; return this._fetch(`/geodata/refresh${q}`, { method: "POST" }); },
  async getGeodataLots(opts = {}) { const q = new URLSearchParams(opts).toString(); return this._fetch(`/geodata/lots${q ? "?" + q : ""}`); },
  async getGeodataRoads(bbox = null) { const q = bbox ? `?bbox=${bbox}` : ""; return this._fetch(`/geodata/roads${q}`); },
  async getGeodataSpeedLimits() { return this._fetch("/geodata/speed-limits"); },
  async lookupLot(address) { return this._fetch(`/geodata/lookup-lot?address=${encodeURIComponent(address)}`); },
};

export default api;
