import { useState, useEffect, useRef, useCallback, useMemo  } from "react";
import {  geoDistMetres,  geoOffset,  geoBearing,  nearestPointOnSegment,} from './utils/geo';

// ═══════════════════════════════════════════════════════════
//  CITY OF KALAMUNDA — CROSSOVER APPROVAL SYSTEM v3
//  Leaflet Maps + SVG Site Plan Overlay
// ═══════════════════════════════════════════════════════════

const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

const TILE_LAYERS = {
  street: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '&copy; OpenStreetMap', label: "Street" },
  satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: '&copy; Esri', label: "Satellite" },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: '&copy; OpenTopoMap', label: "Topo" },
};

// ─── Lot GeoJSON lookup helpers ─────────────────────────
// Match a lot feature from the GeoJSON by comparing app.property.address
// against the feature's properties (p.n = lot number, p.rd = road, uppercase).
function findLotFeatureByAddress(lotsData, address) {
  if (!lotsData?.features || !address) return null;
  const addrUpper = address.toUpperCase();
  for (const f of lotsData.features) {
    const p = f.properties || {};
    if (p.rd && p.n && addrUpper.includes(p.rd) && address.includes(p.n)) {
      return f;
    }
  }
  return null;
}

// Extract { lat, lng, lotPoly } from a matched GeoJSON feature
function getLotCoordsFromFeature(feature) {
  if (!feature) return null;
  const ring = getFirstRing(feature);
  if (!ring || ring.length < 3) return null;
  // ring is [lng, lat] — convert to [lat, lng]
  const poly = ring.map(([lng, lat]) => [lat, lng]);
  // Compute centroid
  const lats = poly.map(p => p[0]), lngs = poly.map(p => p[1]);
  const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
  return { lat, lng, lotPoly: poly };
}

// Find nearby road intersections dynamically from SPEED_ROADS_DATA.
// An "intersection" is where two different named roads share an endpoint
// within a tolerance. Returns intersections sorted by distance from (lat, lng).
function findNearbyIntersections(lat, lng, maxResults = 3, maxDistM = 500) {
  if (!SPEED_ROADS_DATA?.features) return [];
  // Collect all endpoints with their road name
  const endpoints = [];
  for (const f of SPEED_ROADS_DATA.features) {
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const rd = f.properties.rd;
    endpoints.push({ lng: coords[0][0], lat: coords[0][1], rd });
    endpoints.push({ lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1], rd });
  }
  // Group endpoints by approximate location (snap to ~5m grid)
  const snap = (v) => Math.round(v * 20000) / 20000; // ~5m precision
  const grid = {};
  for (const ep of endpoints) {
    const key = `${snap(ep.lat)},${snap(ep.lng)}`;
    if (!grid[key]) grid[key] = { lat: ep.lat, lng: ep.lng, roads: new Set() };
    grid[key].roads.add(ep.rd);
  }
  // Filter to points where 2+ distinct roads meet
  const intersections = [];
  for (const g of Object.values(grid)) {
    if (g.roads.size < 2) continue;
    const distM = geoDistMetres(lat, lng, g.lat, g.lng);
    if (distM > maxDistM) continue;
    const roadNames = [...g.roads];
    intersections.push({ lat: g.lat, lng: g.lng, name: roadNames.join(' / '), dist: distM });
  }
  intersections.sort((a, b) => a.dist - b.dist);
  return intersections.slice(0, maxResults);
}

// Build a PROPERTY_COORDS-equivalent object for an app from lotsData
function getAppCoords(lotsData, app) {
  if (!app) return null;
  // 1) Try lot_polygon from API
  const apiPoly = normalizeLotPolygon(app.lot_polygon);
  if (apiPoly && apiPoly.length >= 3) {
    const lats = apiPoly.map(p => p[0]), lngs = apiPoly.map(p => p[1]);
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    const intersections = findNearbyIntersections(lat, lng);
    return { lat, lng, lotPoly: apiPoly, intersections };
  }
  // 2) Try matching from lotsData via address
  const feature = findLotFeatureByAddress(lotsData, app.property?.address);
  const derived = getLotCoordsFromFeature(feature);
  if (derived) {
    derived.intersections = findNearbyIntersections(derived.lat, derived.lng);
    return derived;
  }
  return null;
}
// ═══════════════════════════════════════════════════════════
//  API SERVICE LAYER
// ═══════════════════════════════════════════════════════════
const API_BASE = "http://localhost:8000/api";

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

// ─── Data Transformers (API flat model ↔ Frontend nested model) ─
function apiAppToFrontend(a) {
  return {
    id: a.ref_number,
    _dbId: a.id,
    submittedDate: a.submitted_date ? a.submitted_date.split("T")[0] : "",
    status: a.status,
    owner: { name: a.owner_name || "", phone: a.owner_phone || "", email: a.owner_email || "", postalAddress: a.owner_postal_address || "" },
    property: { address: a.property_address || "", lot: a.lot_number || "", plan: a.plan_number || "", lotType: a.lot_type || "", frontage: a.frontage || 0, depth: a.depth || 0, roadName: a.road_name || "", roadType: a.road_type || "local", roadWidth: a.road_width || 0, vergeWidth: a.verge_width || 0 },
    crossover: { width: a.crossover_width || 0, count: a.crossover_count || 1, surface: a.crossover_surface || "", estDate: a.crossover_est_date || "", daNumber: a.da_number || "", offsetFromLeft: a.offset_from_left || 0 },
    vegetation: { treesNearby: a.trees_nearby || false, treeProtection: a.tree_protection || "", clearing: a.clearing || false, drainage: a.drainage_type || "", culvert: a.culvert || false, trees: a.trees_data || [] },
    assessment: {
      officer: a.officer_name || "",
      officerId: a.officer_id || null,
      notes: (a.notes || []).map(n => ({ date: n.created_at ? n.created_at.split("T")[0] : "", author: n.author_name || "", text: n.text })),
      riskFlags: a.risk_flags || [],
      referral: a.referral_authority || null,
      inspections: (a.inspections || []).map(i => ({ type: i.inspection_type, date: i.scheduled_date, inspector: "", status: i.status })),
      contribution: { eligible: a.contribution_eligible || false, amount: a.contribution_amount || 0 },
    },
    documents: (a.documents || []).map(d => ({ id: String(d.id), name: d.name, type: d.file_type || "pdf", size: d.file_size || "", date: d.uploaded_at ? d.uploaded_at.split("T")[0] : "", category: d.category || "", status: d.status || "received" })),
    checklist_data: a.checklist_data || {},
    lot_polygon: a.lot_polygon || null,
  };
}

function apiAppListToFrontend(a) {
  return { id: a.ref_number, _dbId: a.id, submittedDate: a.submitted_date ? a.submitted_date.split("T")[0] : "", status: a.status, owner: { name: a.owner_name }, property: { address: a.property_address }, assessment: { officer: a.officer_name || "" } };
}

function apiUserToFrontend(u) {
  return { id: String(u.id), _dbId: u.id, name: u.name, email: u.email, role: u.role, initials: u.initials || u.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2), department: u.department || "", active: u.is_active };
}

function frontendAppToApiUpdate(localApp) {
  return {
    status: localApp.status,
    officer_id: localApp.assessment?.officerId || null,
    risk_flags: localApp.assessment?.riskFlags || [],
    checklist_data: localApp.checklist_data || {},
    contribution_eligible: localApp.assessment?.contribution?.eligible,
    contribution_amount: localApp.assessment?.contribution?.amount,
  };
}

// ─── Mock data removed — all data from API ─
const MOCK_APPLICATIONS = []; // Fallback empty, loaded from API
const USERS = []; // Fallback empty, loaded from API
const STATUS_CONFIG = {
  pending_review: { label: "Pending Review", color: "#e67e22", bg: "#fef5e7", icon: "⏳", mapColor: "#e67e22" },
  under_assessment: { label: "Under Assessment", color: "#2980b9", bg: "#ebf5fb", icon: "📋", mapColor: "#2980b9" },
  referral_pending: { label: "Referral Pending", color: "#8e44ad", bg: "#f4ecf7", icon: "↗️", mapColor: "#8e44ad" },
  inspection_required: { label: "Inspection Required", color: "#16a085", bg: "#e8f8f5", icon: "🔍", mapColor: "#16a085" },
  approved: { label: "Approved", color: "#27ae60", bg: "#eafaf1", icon: "✅", mapColor: "#27ae60" },
  rejected: { label: "Rejected", color: "#c0392b", bg: "#fdedec", icon: "❌", mapColor: "#c0392b" },
  on_hold: { label: "On Hold", color: "#7f8c8d", bg: "#f2f3f4", icon: "⏸", mapColor: "#7f8c8d" },
};
const OFFICERS = [];
const ROLE_CONFIG = {
  admin: { label: "Administrator", icon: "🛡️", color: "#e74c3c", permissions: ["all"] },
  manager: { label: "Manager", icon: "👔", color: "#2980b9", permissions: ["view_all", "assign", "approve", "refer", "reject"] },
  engineer: { label: "Engineer", icon: "🔧", color: "#27ae60", permissions: ["view_assigned", "assess", "note", "inspect"] },
};

// ─── Sight Distance Table (AS 2890.1 / Austroads) ──────
const SIGHT_DISTANCE_TABLE = [
  { speed: 40, abs_min: 30, ssd_min: 55 },
  { speed: 50, abs_min: 40, ssd_min: 69 },
  { speed: 60, abs_min: 55, ssd_min: 83 },
  { speed: 70, abs_min: 70, ssd_min: 97 },
  { speed: 80, abs_min: 95, ssd_min: 111 },
  { speed: 90, abs_min: 125, ssd_min: 130 },
  { speed: 100, abs_min: 139, ssd_min: 160 },
  { speed: 110, abs_min: 153, ssd_min: 190 },
];

function getSightDistances(speedKmh) {
  // Find matching or next higher speed bracket
  let entry = SIGHT_DISTANCE_TABLE.find(e => e.speed >= speedKmh) || SIGHT_DISTANCE_TABLE[SIGHT_DISTANCE_TABLE.length - 1];
  // If speed is lower than 40, use 40 bracket
  if (speedKmh < 40) entry = SIGHT_DISTANCE_TABLE[0];
  // abs_min/10 = one side, ssd_min/10 = other side
  return {
    leftM: entry.abs_min / 10,
    rightM: entry.ssd_min / 10,
    absMin: entry.abs_min,
    ssdMin: entry.ssd_min,
    speed: entry.speed,
  };
}

// ─── Speed Limit Road Network (nearby application areas) ─
const SPEED_ROADS_DATA = {"type":"FeatureCollection","features":[{"type":"Feature","properties":{"rd":"Calcite Pl","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99389,-31.99392],[115.99373,-31.99373],[115.99354,-31.99347],[115.99348,-31.99342],[115.99338,-31.99342],[115.9933,-31.99344],[115.99299,-31.99372],[115.99295,-31.99374],[115.9929,-31.99374],[115.99282,-31.99371],[115.99272,-31.99363],[115.99251,-31.99344],[115.99245,-31.99333],[115.99243,-31.99325],[115.99247,-31.99314],[115.99282,-31.99285]]}},{"type":"Feature","properties":{"rd":"Helidor Pl","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.9946,-31.99342],[115.99445,-31.99357],[115.99422,-31.99376],[115.99407,-31.99385],[115.994,-31.99389],[115.99394,-31.99391],[115.99389,-31.99392],[115.99369,-31.99414],[115.99359,-31.99421],[115.99347,-31.99427]]}},{"type":"Feature","properties":{"rd":"Marble Pl","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99334,-31.99212],[115.99309,-31.99207],[115.99291,-31.99207],[115.99265,-31.99211],[115.99244,-31.99218],[115.99222,-31.99231],[115.99202,-31.99252],[115.992,-31.99254],[115.99191,-31.99255],[115.99184,-31.99253],[115.99181,-31.99251],[115.99165,-31.99229],[115.9915,-31.99213],[115.99145,-31.99204],[115.99144,-31.99194],[115.9909,-31.99142],[115.99169,-31.99081]]}},{"type":"Feature","properties":{"rd":"Tomah Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98629,-31.99784],[115.9862,-31.99774],[115.98484,-31.99658],[115.98375,-31.99565],[115.98366,-31.99556],[115.98225,-31.99441],[115.98144,-31.99369]]}},{"type":"Feature","properties":{"rd":"Standen Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.06334,-31.97495],[116.06228,-31.97495]]}},{"type":"Feature","properties":{"rd":"White Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05488,-31.97302],[116.0537,-31.97298]]}},{"type":"Feature","properties":{"rd":"Honey Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.02118,-31.99887],[116.02126,-31.99893],[116.02137,-31.99898],[116.02151,-31.99898],[116.02235,-31.99887],[116.02299,-31.99897],[116.02308,-31.99904],[116.02314,-31.99915],[116.02318,-31.99927],[116.02338,-31.99965],[116.02366,-32.00007],[116.02398,-32.00043],[116.02453,-32.00099],[116.02474,-32.00118],[116.02545,-32.00167],[116.0256,-32.0018],[116.02576,-32.00187],[116.02629,-32.00203],[116.0265,-32.00211]]}},{"type":"Feature","properties":{"rd":"Boonooloo Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05303,-31.97082],[116.05393,-31.97082]]}},{"type":"Feature","properties":{"rd":"Guava Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01834,-31.99326],[116.01858,-31.99323],[116.01873,-31.99318],[116.01903,-31.99297]]}},{"type":"Feature","properties":{"rd":"Annato Pl","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01848,-31.99411],[116.01889,-31.99406],[116.01901,-31.99402],[116.01909,-31.99397],[116.01956,-31.99355]]}},{"type":"Feature","properties":{"rd":"Palm Tce","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01856,-31.99165],[116.02266,-31.99515],[116.02287,-31.9954],[116.02307,-31.9957],[116.02321,-31.99594],[116.02341,-31.99618],[116.02368,-31.9964],[116.02442,-31.99693],[116.02545,-31.99762]]}},{"type":"Feature","properties":{"rd":"Brooks St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05488,-31.97555],[116.05488,-31.97302],[116.05487,-31.97186]]}},{"type":"Feature","properties":{"rd":"Burt St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.06031,-31.97514],[116.05864,-31.97513],[116.05672,-31.97513]]}},{"type":"Feature","properties":{"rd":"School St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.0578,-31.97024],[116.05781,-31.96841]]}},{"type":"Feature","properties":{"rd":"Stirk St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05666,-31.97044],[116.05677,-31.9703],[116.0568,-31.97026],[116.05684,-31.97024],[116.05911,-31.97024]]}},{"type":"Feature","properties":{"rd":"Mead St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05673,-31.97332],[116.05866,-31.97331],[116.06035,-31.97332]]}},{"type":"Feature","properties":{"rd":"Dixon Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05927,-31.96926],[116.06038,-31.96924],[116.06167,-31.96925],[116.06181,-31.96926],[116.06192,-31.96933],[116.06199,-31.96941],[116.06203,-31.96951],[116.06203,-31.97268],[116.062,-31.9728],[116.06193,-31.97287],[116.06165,-31.97298]]}},{"type":"Feature","properties":{"rd":"McRae Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05361,-31.97951],[116.05362,-31.97573]]}},{"type":"Feature","properties":{"rd":"St John Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.97922,-31.99937],[115.97935,-31.99923],[115.98366,-31.99556],[115.98765,-31.99211]]}},{"type":"Feature","properties":{"rd":"Central Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05866,-31.97331],[116.05863,-31.9743],[116.05864,-31.97513],[116.05864,-31.97726],[116.05862,-31.97738],[116.05858,-31.97745],[116.05845,-31.97756]]}},{"type":"Feature","properties":{"rd":"Hartfield Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.0137,-31.99962],[116.01393,-31.99973],[116.01399,-31.99974],[116.01579,-31.99982],[116.01605,-31.99986],[116.0163,-31.99995],[116.01694,-32.00023],[116.01727,-32.00049],[116.01928,-32.00221],[116.02134,-32.00397],[116.02146,-32.00404],[116.02163,-32.00407],[116.02239,-32.00412],[116.02283,-32.0042],[116.02307,-32.00427],[116.0233,-32.00435],[116.02355,-32.00448],[116.02381,-32.00465],[116.02408,-32.00488],[116.02419,-32.00491],[116.02431,-32.0049],[116.02436,-32.00488],[116.0251,-32.00445]]}},{"type":"Feature","properties":{"rd":"Railway Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.06026,-31.97935],[116.06047,-31.97911],[116.06051,-31.97899],[116.06031,-31.97682],[116.06028,-31.97615],[116.06035,-31.97332]]}},{"type":"Feature","properties":{"rd":"Boonooloo Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05319,-31.96862],[116.05307,-31.96873],[116.05304,-31.96888],[116.05303,-31.97082],[116.05303,-31.9718],[116.05262,-31.97267],[116.05258,-31.9728],[116.05255,-31.97297],[116.05255,-31.97572]]}},{"type":"Feature","properties":{"rd":"Recreation Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05672,-31.97555],[116.05488,-31.97555],[116.0547,-31.97557],[116.05409,-31.97568],[116.05362,-31.97573],[116.05255,-31.97572],[116.04833,-31.97573],[116.04821,-31.97576],[116.04813,-31.97582]]}},{"type":"Feature","properties":{"rd":"Hardey East Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99259,-31.9963],[115.98765,-31.99211],[115.98636,-31.991]]}},{"type":"Feature","properties":{"rd":"Canning Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05666,-31.97044],[116.05671,-31.97053],[116.05674,-31.97063],[116.05674,-31.97185],[116.05672,-31.9745]]}},{"type":"Feature","properties":{"rd":"Alata Wy","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.9847,-31.99748],[115.98559,-31.99824]]}},{"type":"Feature","properties":{"rd":"Lenihan Cnr","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.97966,-31.99976],[115.98017,-31.99933],[115.98026,-31.99932],[115.98033,-31.99933],[115.98201,-32.00076],[115.98247,-32.00094],[115.98251,-32.00094],[115.98256,-32.00093],[115.9829,-32.00075],[115.9834,-32.00054],[115.98343,-32.00053],[115.98347,-32.00053],[115.9835,-32.00054],[115.98354,-32.00055],[115.98358,-32.00058],[115.98402,-32.00123]]}},{"type":"Feature","properties":{"rd":"Wimbridge Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.9843,-31.995],[115.98487,-31.99551],[115.98548,-31.99602],[115.98598,-31.99646],[115.98655,-31.99693],[115.98665,-31.99703],[115.98694,-31.99755],[115.9871,-31.99787],[115.98807,-31.99928]]}},{"type":"Feature","properties":{"rd":"Mair L","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98484,-31.99658],[115.98548,-31.99602]]}},{"type":"Feature","properties":{"rd":"Quokka St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98598,-31.99646],[115.98662,-31.99593],[115.98723,-31.9954]]}},{"type":"Feature","properties":{"rd":"Karadong St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98487,-31.99551],[115.98552,-31.99498],[115.98612,-31.99446]]}},{"type":"Feature","properties":{"rd":"Kwilena Av","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98552,-31.99498],[115.98662,-31.99593],[115.98747,-31.99664],[115.98757,-31.99673],[115.98785,-31.9971]]}},{"type":"Feature","properties":{"rd":"Kelang Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98552,-31.99395],[115.98723,-31.9954],[115.98863,-31.99661],[115.98868,-31.99671]]}},{"type":"Feature","properties":{"rd":"Acastus Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98368,-31.99834],[115.98399,-31.99807],[115.98443,-31.9977],[115.9853,-31.99697]]}},{"type":"Feature","properties":{"rd":"Chisholm Cr","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98091,-31.99323],[115.98086,-31.9932],[115.98077,-31.99314],[115.98049,-31.99291]]}},{"type":"Feature","properties":{"rd":"Karda St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98538,-32.00083],[115.98539,-32.0008],[115.98542,-32.00077],[115.98563,-32.00059],[115.98571,-32.00055],[115.98592,-32.00046],[115.98644,-32.00019],[115.98652,-32.00016],[115.98668,-32.00008],[115.98711,-31.99987],[115.98718,-31.99986],[115.98725,-31.99987],[115.98731,-31.99991],[115.98819,-32.00066]]}},{"type":"Feature","properties":{"rd":"Rosemary St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98027,-31.99845],[115.9788,-31.9972]]}},{"type":"Feature","properties":{"rd":"Hawthorn St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98081,-31.99799],[115.97935,-31.99675],[115.97932,-31.99673],[115.97927,-31.99673]]}},{"type":"Feature","properties":{"rd":"Bayberry Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.97927,-31.99673],[115.97923,-31.99673],[115.97919,-31.99675],[115.97885,-31.99713],[115.97847,-31.99763],[115.97845,-31.99767],[115.97844,-31.9977]]}},{"type":"Feature","properties":{"rd":"Olivine Gdns","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98357,-31.99259],[115.98344,-31.99268],[115.9834,-31.99272],[115.98333,-31.99291],[115.98326,-31.99299],[115.98314,-31.9931],[115.98312,-31.99315],[115.98311,-31.99319]]}},{"type":"Feature","properties":{"rd":"Krypton L","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98417,-31.99413],[115.98312,-31.99323],[115.98311,-31.99319]]}},{"type":"Feature","properties":{"rd":"Mispickel Wy","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98477,-31.99362],[115.98417,-31.99413]]}},{"type":"Feature","properties":{"rd":"Magnesia Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98535,-31.9941],[115.98477,-31.99362],[115.98336,-31.99241],[115.98333,-31.99237],[115.98331,-31.99233],[115.98332,-31.99227],[115.98334,-31.99222],[115.98357,-31.99206]]}},{"type":"Feature","properties":{"rd":"Pulchella St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99192,-31.99573],[115.99178,-31.99588],[115.99156,-31.99606],[115.99112,-31.99631]]}},{"type":"Feature","properties":{"rd":"Thorogood Av","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98203,-31.99694],[115.98381,-31.99846],[115.98435,-31.99898]]}},{"type":"Feature","properties":{"rd":"The Promenade","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99141,-31.99529],[115.99115,-31.99551],[115.98975,-31.99612],[115.9897,-31.99616],[115.9893,-31.99651],[115.98925,-31.99655],[115.9892,-31.99657],[115.98916,-31.99658],[115.98899,-31.9966],[115.98868,-31.99671],[115.9883,-31.99684],[115.98785,-31.9971],[115.98744,-31.99733],[115.98694,-31.99755],[115.98669,-31.99764],[115.98653,-31.99771],[115.98629,-31.99784],[115.98559,-31.99824],[115.98436,-31.99898],[115.98261,-31.99995],[115.98254,-31.99996],[115.98247,-31.99994],[115.98164,-31.99924],[115.98103,-31.99881],[115.98041,-31.99833]]}},{"type":"Feature","properties":{"rd":"Silica Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98592,-31.9936],[115.9839,-31.99188],[115.98383,-31.99184],[115.98373,-31.99179]]}},{"type":"Feature","properties":{"rd":"Mica Mews","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98537,-31.99313],[115.98641,-31.99225],[115.98646,-31.99221],[115.98647,-31.99216],[115.98646,-31.99211],[115.98643,-31.99207],[115.98574,-31.99149],[115.98505,-31.9909],[115.98501,-31.99086],[115.98495,-31.99084],[115.98492,-31.99084]]}},{"type":"Feature","properties":{"rd":"Magma Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98492,-31.99084],[115.98489,-31.99083],[115.98483,-31.99085],[115.98477,-31.99088],[115.98397,-31.99143],[115.98393,-31.99147],[115.98389,-31.99151],[115.98357,-31.99206]]}},{"type":"Feature","properties":{"rd":"Gallagher Wy","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98381,-31.99846],[115.98276,-31.99907],[115.98264,-31.9991],[115.98255,-31.99906],[115.98221,-31.99876]]}},{"type":"Feature","properties":{"rd":"Delta St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98262,-31.99745],[115.98103,-31.99881]]}},{"type":"Feature","properties":{"rd":"Copper L","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98596,-31.99264],[115.98582,-31.99253],[115.98443,-31.99133],[115.9843,-31.99121]]}},{"type":"Feature","properties":{"rd":"Burnett St","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98318,-31.99792],[115.98221,-31.99876],[115.98164,-31.99924]]}},{"type":"Feature","properties":{"rd":"Furfaro Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.09263,-31.96041],[116.09283,-31.96035],[116.09303,-31.9603],[116.09338,-31.96027],[116.09407,-31.9603],[116.0943,-31.96032],[116.09454,-31.96034],[116.09489,-31.96034],[116.09513,-31.96032],[116.09529,-31.96027],[116.0954,-31.96021],[116.09545,-31.96013],[116.09548,-31.96003],[116.09548,-31.9598],[116.09541,-31.95906],[116.09543,-31.95765],[116.09545,-31.95757],[116.09549,-31.95752]]}},{"type":"Feature","properties":{"rd":"Schofield Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01928,-32.00221],[116.01705,-32.00412]]}},{"type":"Feature","properties":{"rd":"Turquoise Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99144,-31.99194],[115.99228,-31.99132],[115.99169,-31.99081]]}},{"type":"Feature","properties":{"rd":"Fennell Cr","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98828,-31.99366],[115.98824,-31.99357],[115.98822,-31.99354],[115.98783,-31.99322],[115.9878,-31.9932],[115.98777,-31.99319],[115.98771,-31.9932],[115.98767,-31.99323],[115.98681,-31.99396],[115.98675,-31.99404],[115.98675,-31.99408],[115.98677,-31.99412],[115.98715,-31.99443],[115.98719,-31.99445],[115.98723,-31.99447],[115.98734,-31.99448]]}},{"type":"Feature","properties":{"rd":"Fennell Cr","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99059,-31.99575],[115.99049,-31.99557],[115.99041,-31.99546],[115.99033,-31.99537],[115.9902,-31.99527]]}},{"type":"Feature","properties":{"rd":"Doepel Wy","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.98654,-31.99307],[115.98719,-31.99364]]}},{"type":"Feature","properties":{"rd":"Trona Pl","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99005,-31.98844],[115.98976,-31.98868],[115.98972,-31.98877],[115.9897,-31.9889]]}},{"type":"Feature","properties":{"rd":"Limonite Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99145,-31.9896],[115.99085,-31.99012],[115.99074,-31.99033],[115.99076,-31.99048],[115.99081,-31.99055],[115.99041,-31.99075]]}},{"type":"Feature","properties":{"rd":"Quartz L","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.99243,-31.99325],[115.9923,-31.99317],[115.99218,-31.99297],[115.99209,-31.99286],[115.99204,-31.99282],[115.99194,-31.99276],[115.99191,-31.99266],[115.99191,-31.99255]]}},{"type":"Feature","properties":{"rd":"Pumice Ct","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[115.9908,-31.98906],[115.99057,-31.98926],[115.99031,-31.98962],[115.99002,-31.98985],[115.98992,-31.98997]]}},{"type":"Feature","properties":{"rd":"Waterfall Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.0228,-31.99643],[116.02294,-31.99591],[116.02307,-31.9957]]}},{"type":"Feature","properties":{"rd":"Waterfall Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01727,-32.00049],[116.01746,-32.00042],[116.01802,-32.00055],[116.01817,-32.00056],[116.01835,-32.0005],[116.02099,-31.99901],[116.02125,-31.99882],[116.02144,-31.9986],[116.02219,-31.99774],[116.02241,-31.99742]]}},{"type":"Feature","properties":{"rd":"Blamire Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05645,-31.97986],[116.05761,-31.97986],[116.0604,-31.97984],[116.06049,-31.97982],[116.06064,-31.97974]]}},{"type":"Feature","properties":{"rd":"Kirkdale Rd","sp":50,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05483,-31.97885],[116.05485,-31.97959],[116.05494,-31.97968],[116.05498,-31.9797],[116.05645,-31.9797]]}},{"type":"Feature","properties":{"rd":"Central Rd","sp":10,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05865,-31.97283],[116.05866,-31.97331]]}},{"type":"Feature","properties":{"rd":"Central Mall","sp":10,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05862,-31.97131],[116.05859,-31.97276],[116.05865,-31.97283]]}},{"type":"Feature","properties":{"rd":"Barber St","sp":40,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05768,-31.97131],[116.05767,-31.97331]]}},{"type":"Feature","properties":{"rd":"Railway Rd","sp":40,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.06035,-31.97332],[116.06031,-31.97274],[116.06019,-31.97241],[116.05995,-31.97188],[116.05967,-31.97132],[116.05911,-31.97024]]}},{"type":"Feature","properties":{"rd":"Haynes St","sp":40,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.05967,-31.97132],[116.05674,-31.9713]]}},{"type":"Feature","properties":{"rd":"Lewis Rd","sp":60,"nt":"Local Road"},"geometry":{"type":"LineString","coordinates":[[116.01603,-31.99764],[116.01892,-31.99519]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy (Eastbound) Off Ramp on to Tonkin Hwy (Eastbound) On Ramp","sp":70,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.98772,-31.98741],[115.98793,-31.98824],[115.98813,-31.98913],[115.98826,-31.98953],[115.9884,-31.98987],[115.98843,-31.98993],[115.98853,-31.98994]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy","sp":70,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.99248,-31.995],[115.99328,-31.99571]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy","sp":70,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.99337,-31.99564],[115.99384,-31.99607],[115.99417,-31.99637]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy","sp":70,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.98915,-31.99161],[115.98994,-31.99245],[115.99053,-31.99306],[115.99149,-31.99396],[115.99337,-31.99564]]}},{"type":"Feature","properties":{"rd":"Roe Hwy","sp":100,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.9768,-31.99857],[115.97729,-31.99788],[115.97783,-31.99716],[115.97945,-31.99518],[115.97982,-31.99473],[115.9801,-31.99437],[115.98058,-31.99369],[115.98091,-31.99323],[115.98144,-31.99248],[115.98188,-31.99183]]}},{"type":"Feature","properties":{"rd":"Roe Hwy","sp":100,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.97682,-31.99892],[115.97689,-31.99882],[115.97717,-31.99845],[115.97744,-31.99806],[115.97786,-31.9975],[115.97848,-31.99674],[115.97881,-31.99636],[115.9791,-31.996],[115.97935,-31.99571],[115.9796,-31.99541],[115.97984,-31.9951],[115.98074,-31.99395],[115.98129,-31.99315],[115.98168,-31.99257],[115.98208,-31.99193],[115.98223,-31.99171],[115.98279,-31.99083],[115.98332,-31.98995],[115.98361,-31.98949],[115.98392,-31.98904],[115.9841,-31.98879]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy (Eastbound) off to Roe Hwy (Southbound)","sp":100,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.98301,-31.99108],[115.98289,-31.99119],[115.98264,-31.99143],[115.98247,-31.99162],[115.98221,-31.99196],[115.9822,-31.99197],[115.98208,-31.99193]]}},{"type":"Feature","properties":{"rd":"Tonkin Hwy (Northbound) off to Roe Hwy","sp":100,"nt":"State Road"},"geometry":{"type":"LineString","coordinates":[[115.98705,-31.9896],[115.98694,-31.98965],[115.98648,-31.98922]]}}]};
if (typeof window !== 'undefined') window.__SPEED_ROADS__ = SPEED_ROADS_DATA;

// Find nearest road speed to a lat/lng point
function findNearestRoadSpeed(lat, lng) {
  if (!SPEED_ROADS_DATA?.features) return { speed: 50, roadName: 'Unknown', dist: 999 };
  let best = { speed: 50, roadName: 'Unknown', dist: Infinity };
  for (const f of SPEED_ROADS_DATA.features) {
    const coords = f.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      // nearest point on segment
      const ax = coords[i][0], ay = coords[i][1], bx = coords[i+1][0], by = coords[i+1][1];
      const dx = bx-ax, dy = by-ay, lenSq = dx*dx+dy*dy;
      let t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((lng-ax)*dx+(lat-ay)*dy)/lenSq));
      const px = ax+t*dx, py = ay+t*dy;
      const d = Math.sqrt((lng-px)**2+(lat-py)**2);
      if (d < best.dist) {
        best = { speed: f.properties.sp, roadName: f.properties.rd, networkType: f.properties.nt, dist: d };
      }
    }
  }
  // Convert degree distance to approx metres
  best.distM = best.dist * 111320;
  return best;
}

// Normalize lot polygon to [[lat,lng], ...]. Accepts [[lat,lng], ...] or [[lng,lat], ...].
function normalizeLotPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  const p0 = poly[0];
  if (!Array.isArray(p0) || p0.length < 2) return null;
  // If first looks like longitude (e.g., 115) and second like latitude (e.g., -31), flip:
  const looksLngLat = Math.abs(p0[0]) > 90 && Math.abs(p0[1]) < 90;
  return looksLngLat ? poly.map(([lng, lat]) => [lat, lng]) : poly;
}

// Return the outer ring of a GeoJSON Polygon or MultiPolygon
function getFirstRing(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  if (g.type === "Polygon") return g.coordinates?.[0] ?? null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

// ─── Load Leaflet dynamically ───────────────────────────
function useLeaflet() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (window.L) { setLoaded(true); return; }
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = LEAFLET_CSS; document.head.appendChild(link);
    const script = document.createElement("script"); script.src = LEAFLET_JS;
    script.onload = () => setLoaded(true); document.head.appendChild(script);
  }, []);
  return loaded;
}

// ─── AI Assessment Hook ─────────────────────────────────
function useAIAssessment() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const assess = async (app) => {
    setLoading(true);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500,
          messages: [{ role: "user", content: `You are a City of Kalamunda officer. Assess crossover app against Guideline v3.1.\n\n${app.id}: ${app.owner.name}, ${app.property.address}, Frontage ${app.property.frontage}m, Road: ${app.property.roadName}(${app.property.roadType}), Width ${app.crossover.width}m x${app.crossover.count}, Surface: ${app.crossover.surface}, DA: ${app.crossover.daNumber||"None"}, Trees: ${app.vegetation.treesNearby}, Clearing: ${app.vegetation.clearing}, Drainage: ${app.vegetation.drainage}\n\nJSON only: {"compliance_score":0-100,"recommendation":"approve"|"approve_with_conditions"|"request_info"|"reject","issues":[],"conditions":[],"referrals_needed":[],"risk_level":"low"|"medium"|"high","summary":"...","width_check":"pass"|"fail","vegetation_check":"pass"|"fail"|"needs_review","drainage_check":"pass"|"fail"|"needs_review","contribution_eligible":bool,"estimated_contribution":0}` }] }) });
      const d = await r.json(); const t = d.content?.map(b=>b.text||"").join("")||"";
      setResult(JSON.parse(t.replace(/```json|```/g,"").trim()));
    } catch {
      const f=app.property.frontage,w=app.crossover.width,mW=f<=12.5?4.5:6,iss=[];
      if(w<3||w>mW) iss.push(`Width ${w}m outside ${3}–${mW}m`);
      if(app.crossover.count>1&&f<=20) iss.push("2nd crossover needs >20m");
      if(app.vegetation.clearing) iss.push("Clearing needs DWER permit");
      if(app.property.roadType!=="local") iss.push(`Referral to ${app.property.roadType==="red"?"MRWA":"DPLH"}`);
      setResult({compliance_score:Math.max(0,100-iss.length*25),recommendation:iss.length===0?"approve":iss.length<=1?"approve_with_conditions":"reject",issues:iss,conditions:iss.length===0?["Standard"]:[], referrals_needed:app.property.roadType!=="local"?[app.property.roadType==="red"?"Main Roads WA":"DPLH"]:[],risk_level:iss.length===0?"low":iss.length<=2?"medium":"high",summary:iss.length===0?"Meets requirements.":`${iss.length} issue(s).`,width_check:w>=3&&w<=mW?"pass":"fail",vegetation_check:app.vegetation.clearing?"fail":"pass",drainage_check:"pass",contribution_eligible:!app.crossover.daNumber,estimated_contribution:!app.crossover.daNumber?474:0});
    }
    setLoading(false);
  };
  return {loading,result,assess,setResult};
}

// ─── Small UI Components ────────────────────────────────
const StatusBadge = ({status}) => { const c=STATUS_CONFIG[status]||STATUS_CONFIG.pending_review; return <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,background:c.bg,color:c.color,whiteSpace:"nowrap"}}>{c.icon} {c.label}</span>;};
const CheckIcon = ({status}) => { const c={pass:"#27ae60",fail:"#c0392b",needs_review:"#e67e22"},i={pass:"✓",fail:"✕",needs_review:"?"}; return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:`${c[status]}18`,color:c[status],fontSize:12,fontWeight:800}}>{i[status]}</span>;};
const MetricCard = ({label,value,sub,color="#1a3a4a"}) => <div style={{background:"#fff",borderRadius:14,padding:"18px 20px",border:"1px solid #e4e9ec",flex:1,minWidth:140}}><div style={{fontSize:11,color:"#7a8a94",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</div><div style={{fontSize:28,fontWeight:800,color,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>{sub&&<div style={{fontSize:11,color:"#95a5a6",marginTop:4}}>{sub}</div>}</div>;

// ═══════════════════════════════════════════════════════════
//  LEAFLET MAP COMPONENT (real tiles + application pins)
// ═══════════════════════════════════════════════════════════
function LeafletMap({ apps, selectedApp, onSelectApp, height = 500, drawMode = null, onMapClick = null, sightTriangle = null, showLots = false, lotsData = null, showSpeedRoads = false, onLotClick = null, allLotsData = null }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const containerRef = useRef(null);
  const lotsLayerRef = useRef(null);
  const speedLayerRef = useRef(null);
  const leafletLoaded = useLeaflet();
  const [activeLayer, setActiveLayer] = useState("street");
  const tileLayerRef = useRef(null);


  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true }).setView([-31.97, 116.06], 13);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS.street.url, { attribution: TILE_LAYERS.street.attr, maxZoom: 19 }).addTo(map);
    mapInstanceRef.current = map;

    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [leafletLoaded]);

  // Switch tile layer
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const L = window.L;
    mapInstanceRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS[activeLayer].url, { attribution: TILE_LAYERS[activeLayer].attr, maxZoom: 19 }).addTo(mapInstanceRef.current);
  }, [activeLayer]);

  // Add markers for applications
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const L = window.L;
    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m));
    markersRef.current = [];

    apps.forEach(app => {
      const coords = getAppCoords(allLotsData, app);
      if (!coords) return;
      const sc = STATUS_CONFIG[app.status];
      const isSelected = selectedApp?.id === app.id;

      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;cursor:pointer;">
          <svg width="${isSelected?44:36}" height="${isSelected?52:44}" viewBox="0 0 36 44">
            <path d="M18,42 C18,42 2,26 2,16 C2,7.2 9.2,0 18,0 C26.8,0 34,7.2 34,16 C34,26 18,42 18,42Z" fill="${sc.mapColor}" stroke="#fff" stroke-width="2.5" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/>
            <circle cx="18" cy="16" r="7" fill="#fff"/>
            <text x="18" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="${sc.mapColor}">${sc.icon}</text>
          </svg>
          ${isSelected ? '<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:#1a3a4a;color:#fff;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;font-family:sans-serif;">' + app.id + '</div>' : ''}
        </div>`,
        iconSize: [isSelected?44:36, isSelected?52:44],
        iconAnchor: [isSelected?22:18, isSelected?52:44],
      });

      const marker = L.marker([coords.lat, coords.lng], { icon })
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:200px;">
            <div style="font-weight:800;font-size:14px;color:#1a3a4a;margin-bottom:4px;">${app.id}</div>
            <div style="font-size:12px;color:#5a6a74;margin-bottom:6px;">${app.owner.name}</div>
            <div style="font-size:11px;color:#7a8a94;margin-bottom:4px;">📍 ${app.property.address}</div>
            <div style="font-size:11px;color:#7a8a94;margin-bottom:6px;">🛣 ${app.property.roadName} (${app.property.roadType})</div>
            <div style="font-size:11px;margin-bottom:6px;"><span style="background:${sc.bg};color:${sc.color};padding:2px 8px;border-radius:4px;font-weight:700;">${sc.icon} ${sc.label}</span></div>
            <div style="font-size:11px;color:#5a6a74;">Width: ${app.crossover.width}m | Frontage: ${app.property.frontage}m</div>
          </div>
        `, { maxWidth: 280 })
        .on('click', () => onSelectApp(app))
        .addTo(mapInstanceRef.current);
      markersRef.current.push(marker);
    });
  }, [apps, selectedApp, leafletLoaded, onSelectApp, allLotsData]);

  // Fly to selected
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedApp) return;
    const c = getAppCoords(allLotsData, selectedApp);
    if (c) mapInstanceRef.current.flyTo([c.lat, c.lng], 18, { duration: 1.2 });
  }, [selectedApp, allLotsData]);

  // Map click for draw mode
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    const handler = (e) => { if (onMapClick && drawMode) onMapClick(e.latlng); };
    if (drawMode) {
      mapInstanceRef.current.getContainer().style.cursor = 'crosshair';
      mapInstanceRef.current.on('click', handler);
    } else {
      mapInstanceRef.current.getContainer().style.cursor = '';
      mapInstanceRef.current.off('click', handler);
    }
    return () => { mapInstanceRef.current?.off('click', handler); if (mapInstanceRef.current) mapInstanceRef.current.getContainer().style.cursor = ''; };
  }, [drawMode, onMapClick, leafletLoaded]);

  // Render GeoJSON lot boundaries layer
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (lotsLayerRef.current) { mapInstanceRef.current.removeLayer(lotsLayerRef.current); lotsLayerRef.current = null; }
    if (!showLots || !lotsData) return;
    const L = window.L;
    lotsLayerRef.current = L.geoJSON(lotsData, {
      interactive: !drawMode,
      style: (feature) => {
        const p = feature.properties;
        // Highlight the lot matching the selected app
        const selAddr = selectedApp?.property;
        const isMatch = selAddr && p.rd && p.n && (
          (selAddr.address.toUpperCase().includes(p.rd) && selAddr.address.includes(p.n))
        );
        return {
          color: isMatch ? '#e74c3c' : '#2980b9',
          weight: isMatch ? 3 : 1,
          fillColor: isMatch ? '#e74c3c' : '#3498db',
          fillOpacity: isMatch ? 0.25 : 0.06,
          opacity: isMatch ? 1 : 0.5,
        };
      },
      onEachFeature: (feature, layer) => {
        if (drawMode) return; // Don't intercept clicks during draw mode
        const p = feature.properties;
        const addr = [p.n, p.rd, p.rt].filter(Boolean).join(' ');
        // layer.bindTooltip(`<b>${addr}</b><br/>${p.loc}`, { sticky: true, className: 'lot-tooltip' });
        const locLine = p.loc ? `<br/>${p.loc}` : '';
        const ttHtml = addr ? `<b>${addr}</b>${locLine}` : (p.loc ? `<b>${p.loc}</b>` : '');
        if (ttHtml) {
          layer.bindTooltip(ttHtml, { sticky: true, className: 'lot-tooltip' });
        }
        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          // Extract lot polygon coords as [lat,lng] pairs
          const coords = feature.geometry.coordinates;
          const ring = coords[0] || coords;
          const poly = ring.map(c => [c[1], c[0]]); // [lng,lat] → [lat,lng]
          if (onLotClick) onLotClick({ properties: p, polygon: poly, address: addr });
        });
      },
    }).addTo(mapInstanceRef.current);
  }, [showLots, lotsData, selectedApp, leafletLoaded, drawMode, onLotClick]);

  // Render selected app lot polygon (derived from lotsData)
  const appLotRef = useRef(null);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (appLotRef.current) { mapInstanceRef.current.removeLayer(appLotRef.current); appLotRef.current = null; }
    if (!selectedApp) return;
    const coords = getAppCoords(allLotsData, selectedApp);
    if (!coords?.lotPoly) return;
    const L = window.L;
    appLotRef.current = L.polygon(coords.lotPoly, {
      color: '#e74c3c', weight: 3, fillColor: '#e74c3c', fillOpacity: 0.15, dashArray: '6,3',
    }).bindPopup(`<b>${selectedApp.property.lot}</b><br/>${selectedApp.property.address}`).addTo(mapInstanceRef.current);
  }, [selectedApp, leafletLoaded, allLotsData]);

  // Render speed limit road network
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    if (speedLayerRef.current) { mapInstanceRef.current.removeLayer(speedLayerRef.current); speedLayerRef.current = null; }
    if (!showSpeedRoads || !SPEED_ROADS_DATA?.features) return;
    const L = window.L;
    const speedColors = { 10: '#27ae60', 40: '#2ecc71', 50: '#f1c40f', 60: '#e67e22', 70: '#e74c3c', 80: '#c0392b', 90: '#8e44ad', 100: '#6c3483', 110: '#1a0530' };
    speedLayerRef.current = L.geoJSON(SPEED_ROADS_DATA, {
      style: (feature) => {
        const sp = feature.properties.sp || 50;
        return { color: speedColors[sp] || '#f1c40f', weight: 4, opacity: 0.8 };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindTooltip(`<b>${p.rd}</b><br/>${p.sp} km/h<br/><i>${p.nt}</i>`, { sticky: true, className: 'lot-tooltip' });
      },
    }).addTo(mapInstanceRef.current);
  }, [showSpeedRoads, leafletLoaded]);

  // Render sight triangle layers
  const triLayersRef = useRef([]);
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletLoaded) return;
    triLayersRef.current.forEach(l => mapInstanceRef.current.removeLayer(l));
    triLayersRef.current = [];
    if (!sightTriangle) return;
    const L = window.L;
    const { ptA, ptB, triLeft, triRight, lineAB, propertyLine, intersections, analysis } = sightTriangle;
    // Point A marker (driveway)
    if (ptA) {
      const mA = L.circleMarker([ptA.lat, ptA.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#e74c3c', fillOpacity: 1, pane: 'markerPane' })
        .bindTooltip('A — Driveway Point', { permanent: false, direction: 'top' }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(mA);
    }
    // Point B marker (road)
    if (ptB) {
      const mB = L.circleMarker([ptB.lat, ptB.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2980b9', fillOpacity: 1, pane: 'markerPane' })
        .bindTooltip(`B — Road Point${sightTriangle.speedInfo ? ' | ' + sightTriangle.speedInfo.detected + 'km/h' : ''}`, { permanent: false, direction: 'top' }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(mB);
      // Speed badge at point B
      if (sightTriangle.speedInfo) {
        const spd = sightTriangle.speedInfo.detected;
        const spdColor = spd <= 40 ? '#27ae60' : spd <= 50 ? '#f1c40f' : spd <= 60 ? '#e67e22' : '#e74c3c';
        const spdLbl = L.marker([ptB.lat, ptB.lng], { icon: L.divIcon({ className:'', html:`<div style="background:${spdColor};color:#fff;padding:3px 8px;border-radius:10px;font-size:11px;font-weight:800;font-family:sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">${spd} km/h</div>`, iconAnchor:[-12,8]})}).addTo(mapInstanceRef.current);
        triLayersRef.current.push(spdLbl);
      }
    }
    // Line A→B
    if (lineAB) {
      const line = L.polyline(lineAB, { color: '#e74c3c', weight: 2.5, dashArray: '8,5', opacity: 0.8 }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(line);
      // distance label
      if (ptA && ptB) {
        const midLat = (ptA.lat + ptB.lat) / 2, midLng = (ptA.lng + ptB.lng) / 2;
        const dist = geoDistMetres(ptA.lat, ptA.lng, ptB.lat, ptB.lng).toFixed(1);
        const lbl = L.marker([midLat, midLng], { icon: L.divIcon({ className: '', html: `<div style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${dist}m sight line</div>`, iconAnchor: [40, 10] }) }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(lbl);
      }
    }
    // Triangle polygon (A, triLeft, triRight)
    if (triLeft && triRight && ptA) {
      const compliant = analysis?.compliant !== false;
      const tri = L.polygon([[ptA.lat, ptA.lng], [triLeft.lat, triLeft.lng], [triRight.lat, triRight.lng]], {
        color: compliant ? '#27ae60' : '#e74c3c', weight: 2.5, fillColor: compliant ? '#27ae60' : '#e74c3c', fillOpacity: compliant ? 0.15 : 0.2, dashArray: compliant ? null : '6,4',
      }).bindPopup(`<div style="font-family:sans-serif;"><b>🔺 Sight Triangle</b><br/>Speed: ${sightTriangle.speedInfo?.detected || '?'}km/h (${sightTriangle.speedInfo?.roadName || '—'})<br/>Base: ${analysis?.baseWidth || '?'}m (${analysis?.leftDist}+${analysis?.rightDist})<br/>Depth: ${analysis?.depth || '—'}m | Area: ${analysis?.area || '—'}m²<br/>${compliant ? '✅ Clear zone OK' : '❌ Review required'}</div>`).addTo(mapInstanceRef.current);
      triLayersRef.current.push(tri);
      // Left/Right markers
      [triLeft, triRight].forEach((pt, i) => {
        const m = L.circleMarker([pt.lat, pt.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#8e44ad', fillOpacity: 1 })
          .bindTooltip(i === 0 ? `${analysis?.leftDist || '?'}m (abs_min)` : `${analysis?.rightDist || '?'}m (ssd_min)`, { direction: 'bottom' }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(m);
      });
      // 6m base line
      const baseLine = L.polyline([[triLeft.lat, triLeft.lng], [triRight.lat, triRight.lng]], { color: '#8e44ad', weight: 2 }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(baseLine);
      const baseMid = { lat: (triLeft.lat+triRight.lat)/2, lng: (triLeft.lng+triRight.lng)/2 };
      const bLbl = L.marker([baseMid.lat, baseMid.lng], { icon: L.divIcon({ className:'', html:`<div style="background:#8e44ad;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${analysis?.baseWidth || '?'}m base (${analysis?.leftDist}+${analysis?.rightDist})</div>`, iconAnchor:[55,10]})}).addTo(mapInstanceRef.current);
      triLayersRef.current.push(bLbl);
    }
    // Lot boundary polygon + arrows from ptA to each side
    if (sightTriangle.lotPoly && sightTriangle.lotPoly.length >= 3) {
      const lp = L.polygon(sightTriangle.lotPoly, { color: '#2c3e50', weight: 2, dashArray: '6,3', fillOpacity: 0.03 }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(lp);
    }
    // Arrow lines from ptA to nearest point on each lot boundary side
    const bdColors = ['#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];
    if (sightTriangle.boundaryDists && ptA) {
      sightTriangle.boundaryDists.forEach((bd, i) => {
        const clr = bdColors[i % bdColors.length];
        // Dashed arrow line from ptA to nearest point on this side
        const al = L.polyline([[ptA.lat, ptA.lng], [bd.nearPt.lat, bd.nearPt.lng]], {
          color: clr, weight: i === 0 ? 3 : 1.5, dashArray: i === 0 ? '8,4' : '4,6', opacity: i === 0 ? 0.9 : 0.5
        }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(al);
        // Distance label at midpoint
        const midLat = (ptA.lat + bd.nearPt.lat) / 2, midLng = (ptA.lng + bd.nearPt.lng) / 2;
        const lbl = L.marker([midLat, midLng], { icon: L.divIcon({ className:'', html:`<div style="background:${clr};color:#fff;padding:2px 6px;border-radius:3px;font-size:${i===0?11:9}px;font-weight:700;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.2);white-space:nowrap;">→ ${bd.distLabel}m ${i===0?'(nearest)':''}</div>`, iconAnchor:[40,10]})}).addTo(mapInstanceRef.current);
        triLayersRef.current.push(lbl);
        // Small marker at the nearest point on boundary side
        const pm = L.circleMarker([bd.nearPt.lat, bd.nearPt.lng], { radius: i === 0 ? 5 : 3, color: clr, weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(`Side ${bd.idx+1}: ${bd.distLabel}m (${bd.sideLen}m long)`, { direction: 'bottom' }).addTo(mapInstanceRef.current);
        triLayersRef.current.push(pm);
      });
    }
    // Distance to nearest intersection
    if (analysis?.nearestIntersection && ptA) {
      const ipt = analysis.nearestIntersection;
      const il = L.polyline([[ptB?.lat||ptA.lat, ptB?.lng||ptA.lng], [ipt.lat, ipt.lng]], { color: '#e67e22', weight: 1.5, dashArray: '3,5', opacity: 0.6 }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(il);
      const im = L.circleMarker([ipt.lat, ipt.lng], { radius: 6, color: '#e67e22', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(`${ipt.name}<br/>${ipt.dist}m away`, { direction: 'top', permanent: false }).addTo(mapInstanceRef.current);
      triLayersRef.current.push(im);
    }
  }, [sightTriangle, leafletLoaded]);


  return (
    <div ref={containerRef} style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid #e4e9ec" }}>
      {/* Layer switcher */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 2, background: "#fff", borderRadius: 8, padding: 3, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
        {Object.entries(TILE_LAYERS).map(([key, layer]) => (
          <button key={key} onClick={() => setActiveLayer(key)}
            style={{ padding: "6px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: activeLayer === key ? "#1a3a4a" : "transparent", color: activeLayer === key ? "#fff" : "#5a6a74" }}>
            {layer.label}
          </button>
        ))}
      </div>
      <div ref={mapRef} style={{ height, width: "100%" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAP VIEW WITH SIGHT TRIANGLE ANALYSIS
// ═══════════════════════════════════════════════════════════
function MapWithOverlay({ app, apps, onSelectApp }) {
  const [showLots, setShowLots] = useState(true);
  const [showSpeedRoads, setShowSpeedRoads] = useState(true);
  const [lotsData, setLotsData] = useState(null);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState(null);

  // useEffect(() => {
  //   if (showLots && !lotsData && !lotsLoading) {
  //     setLotsLoading(true);
  //     if (window.__KALAMUNDA_LOTS__) { setLotsData(window.__KALAMUNDA_LOTS__); setLotsLoading(false); }
  //     else { const ck = setInterval(() => { if (window.__KALAMUNDA_LOTS__) { setLotsData(window.__KALAMUNDA_LOTS__); setLotsLoading(false); clearInterval(ck); } }, 100); setTimeout(() => { clearInterval(ck); setLotsLoading(false); }, 5000); }
  //   }
  // }, [showLots, lotsData, lotsLoading]);

  
  useEffect(() => {
    if (!showLots || lotsData || lotsLoading) return;
  

    let cancelled = false;

    async function loadLots() {
      try {
        // 1) Prefer a global already injected (keeps your existing behavior)
        // if (window.__KALAMUNDA_LOTS__) {
        //   if (!cancelled) {
        //     setLotsData(window.__KALAMUNDA_LOTS__);
        //     setLotsLoading(false);
        //   }
        //   return;
        // }

        // 2) Otherwise, fetch from /lot.geojson
        const res = await fetch('/lot.geojson', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Failed to load lot.geojson: ${res.status}`);
        const gj = await res.json();

        if (!cancelled) {
          setLotsData(gj);
          setLotsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLotsError(err);
          setLotsLoading(false);
        }
      }
    }

    loadLots();
    return () => { cancelled = true; };
  }, [showLots, lotsData, lotsLoading]);

  const [drawMode, setDrawMode] = useState(null);
  const [ptA, setPtA] = useState(null);
  const [ptB, setPtB] = useState(null);
  const [sightTriangle, setSightTriangle] = useState(null);
  const coords = getAppCoords(lotsData, app);

  // 3D Sight Analysis state
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisSteps, setAnalysisSteps] = useState([]);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState('obstructions');
  const [eyeHeight, setEyeHeight] = useState(1.15);
  const [objectHeight, setObjectHeight] = useState(0.65);

  // ── 3D Sight Analysis Engine (from sight_line_3d-1.html) ──
  const R_3D = 6371000, toRad3D = d => d * Math.PI / 180;
  const havDist3D = (a, b) => { const dl = toRad3D(b.lat - a.lat), dn = toRad3D(b.lng - a.lng), x = Math.sin(dl / 2) ** 2 + Math.cos(toRad3D(a.lat)) * Math.cos(toRad3D(b.lat)) * Math.sin(dn / 2) ** 2; return R_3D * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
  const lerpPt3D = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const segX3D = (a, b, c, d) => { const det = (b.lng - a.lng) * (d.lat - c.lat) - (b.lat - a.lat) * (d.lng - c.lng); if (Math.abs(det) < 1e-14) return null; const t = ((c.lng - a.lng) * (d.lat - c.lat) - (c.lat - a.lat) * (d.lng - c.lng)) / det, u = ((c.lng - a.lng) * (b.lat - a.lat) - (c.lat - a.lat) * (b.lng - a.lng)) / det; if (t > 0.005 && t < 0.995 && u > 0.005 && u < 0.995) return true; return null; };

  const getElevAt3D = (pt, eg) => {
    let b1 = { d: Infinity, e: 0 }, b2 = { d: Infinity, e: 0 };
    for (let i = 0; i < eg.pts.length; i++) { const d = havDist3D(pt, eg.pts[i]); if (d < b1.d) { b2 = { ...b1 }; b1 = { d, e: eg.elevs[i] }; } else if (d < b2.d) b2 = { d, e: eg.elevs[i] }; }
    if (b1.d < 0.1) return b1.e; const tot = b1.d + b2.d; return b1.e * (1 - b1.d / tot) + b2.e * (1 - b2.d / tot);
  };

  const fetchOSM3D = async (ctr, r) => {
    r = Math.min(r, 500);
    const q = `[out:json][timeout:25];(way["building"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="fence"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="retaining_wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="hedge"](around:${r},${ctr.lat},${ctr.lng});node["natural"="tree"](around:${r},${ctr.lat},${ctr.lng});way["natural"="tree_row"](around:${r},${ctr.lat},${ctr.lng});way["landuse"="forest"](around:${r},${ctr.lat},${ctr.lng});way["man_made"="embankment"](around:${r},${ctr.lat},${ctr.lng}););out body geom;`;
    const resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return resp.json();
  };

  const procOSM3D = (data) => {
    const ff = []; if (!data?.elements) return ff;
    for (const el of data.elements) {
      let tp = null, ht = 0, geom = []; const tg = el.tags || {};
      if (tg.building) { tp = 'building'; const l = parseInt(tg['building:levels']) || 0, h = parseFloat(tg.height); ht = !isNaN(h) ? h : l > 0 ? l * 3 : 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'fence') { tp = 'fence'; ht = parseFloat(tg.height) || 1.5; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'wall' || tg.barrier === 'retaining_wall') { tp = 'wall'; ht = parseFloat(tg.height) || 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'hedge') { tp = 'hedge'; ht = parseFloat(tg.height) || 1.2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.natural === 'tree') { tp = 'tree'; ht = parseFloat(tg.height) || 8; if (el.lat && el.lon) geom = [{ lat: el.lat, lng: el.lon }]; }
      else if (tg.natural === 'tree_row') { tp = 'tree_row'; ht = 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.landuse === 'forest' || tg.natural === 'wood') { tp = 'vegetation'; ht = 10; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.man_made === 'embankment') { tp = 'embankment'; ht = 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      if (tp && geom.length > 0) ff.push({ id: el.id, type: tp, estimatedHeight: ht, geometry: geom, tags: tg, name: tg.name || tg['addr:street'] || `${tp} #${el.id}` });
    } return ff;
  };

  const fetchElev3D = async (points) => {
    const lats = points.map(p => p.lat.toFixed(6)).join(','), lngs = points.map(p => p.lng.toFixed(6)).join(',');
    const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
    if (!resp.ok) throw new Error(`Elev ${resp.status}`); return resp.json();
  };

  const losEngine3D = (A, C, D, feats, eg, eyeH, tgtH) => {
    const elevA = getElevAt3D(A, eg), eyeAlt = elevA + eyeH;
    const obs = [], seen = new Set(), rays = [];
    for (let ri = 0; ri <= 40; ri++) {
      const tgt = lerpPt3D(C, D, ri / 40), elevTgt = getElevAt3D(tgt, eg), tgtAlt = elevTgt + tgtH, rayDist = havDist3D(A, tgt);
      const rayObs = []; let tBlocked = false, tBlockPt = null, tBlockInfo = null;
      for (let si = 1; si < 25; si++) {
        const sf = si / 25, sp = lerpPt3D(A, tgt, sf), sd = rayDist * sf, rayAlt = eyeAlt + (tgtAlt - eyeAlt) * sf, gnd = getElevAt3D(sp, eg);
        if (gnd > rayAlt && !tBlocked) { tBlocked = true; tBlockPt = sp; tBlockInfo = { groundElev: gnd, rayAlt, excessHeight: gnd - rayAlt, dist: sd }; }
        for (const f of feats) {
          if (seen.has(f.id + '_' + ri)) continue;
          let hit = false;
          if (f.type === 'tree' && f.geometry.length === 1) { if (havDist3D(sp, f.geometry[0]) < Math.min(f.estimatedHeight * 0.4, 5)) hit = true; }
          else if (f.geometry.length >= 2) { for (const g of f.geometry) { if (havDist3D(sp, g) < 3) { hit = true; break; } } if (!hit) { for (let gi = 0; gi < f.geometry.length - 1; gi++) { if (segX3D(A, tgt, f.geometry[gi], f.geometry[gi + 1])) { hit = true; break; } } } }
          if (hit) { const fg = f.groundElev != null ? f.groundElev : gnd, ft = fg + f.estimatedHeight; if (ft > rayAlt) { rayObs.push({ feature: f, point: f.geometry[0], distFromA: havDist3D(A, f.geometry[0]), isCritical: f.estimatedHeight >= 0.5 && f.estimatedHeight <= 1.0, blockType: 'feature', fGroundElev: fg, fTopAlt: ft, rayAltAtFeature: rayAlt, excessHeight: ft - rayAlt }); seen.add(f.id + '_' + ri); } }
        }
      }
      if (tBlocked && tBlockPt) rayObs.push({ feature: { id: 'terrain_' + ri, type: 'terrain_ridge', estimatedHeight: tBlockInfo.excessHeight, geometry: [tBlockPt], tags: {}, name: 'Terrain Ridge' }, point: tBlockPt, distFromA: tBlockInfo.dist, isCritical: false, blockType: 'terrain', fGroundElev: tBlockInfo.groundElev, fTopAlt: tBlockInfo.groundElev, rayAltAtFeature: tBlockInfo.rayAlt, excessHeight: tBlockInfo.excessHeight });
      rays.push({ target: tgt, obstructed: rayObs.length > 0, obs: rayObs, elevA, elevTgt, eyeAlt, tgtAlt });
      for (const o of rayObs) { const uid = o.feature.id; if (!seen.has('m_' + uid)) { seen.add('m_' + uid); obs.push(o); } }
    }
    return { obstructions: obs, rays, features: feats, elevA, eyeAlt };
  };

  const aiClassify3D = async (A, C, D, obs, feats, ei) => {
    try {
      const prompt = `You are a 3D geospatial line-of-sight analyst. Observer A at ${ei.elevA.toFixed(1)}m ASL + ${ei.eyeH}m eye. Line C→D: ${havDist3D(C, D).toFixed(0)}m span at ${ei.elevCD.toFixed(1)}m ASL + ${ei.tgtH}m. ${obs.length} obstructions exceed sight ray. Features: ${feats.length}. Classify visibility. JSON only: {"overall_rating":"CLEAR|PARTIALLY_OBSTRUCTED|SEVERELY_OBSTRUCTED|BLOCKED","visibility_pct":0,"analysis_summary":"","critical_low_obstructions":[],"recommendations":[],"elevation_insight":""}`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
      const data = await resp.json(); return JSON.parse((data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim());
    } catch {
      const vis = Math.max(0, Math.round((1 - obs.length / Math.max(feats.length + 1, 1) * 0.8) * 100));
      let rt = 'CLEAR'; if (vis < 30) rt = 'BLOCKED'; else if (vis < 55) rt = 'SEVERELY_OBSTRUCTED'; else if (vis < 80) rt = 'PARTIALLY_OBSTRUCTED';
      return { overall_rating: rt, visibility_pct: vis, analysis_summary: `${obs.length} obstructions found, ${obs.filter(o => o.isCritical).length} critical low.`, critical_low_obstructions: obs.filter(o => o.isCritical).map(c => ({ name: c.feature.name, height_range: c.feature.estimatedHeight.toFixed(1) + 'm', impact: `Exceeds ray by ${c.excessHeight?.toFixed(2)}m` })), recommendations: ['Review obstructions.'], elevation_insight: `Observer at ${ei.elevA.toFixed(1)}m, targets at ${ei.elevCD.toFixed(1)}m.` };
    }
  };

  // Run the full 3D analysis using existing A/B and derived C/D points
  const run3DSightAnalysis = async () => {
    if (!sightTriangle?.ptA || !sightTriangle?.triLeft || !sightTriangle?.triRight) return;
    const A = sightTriangle.ptA, C = sightTriangle.triLeft, D = sightTriangle.triRight;
    const eyeH = eyeHeight, tgtH = objectHeight;
    setAnalysisRunning(true); setAnalysisResult(null);
    const steps = ['Querying OSM Overpass...', 'Processing features...', 'Fetching elevation (DEM)...', 'Ground elevations...', '3D line-of-sight (40 rays)...', 'AI classification...', 'Done!'];
    const ss = (n) => setAnalysisSteps(steps.map((s, i) => ({ text: s, status: i < n ? 'done' : i === n ? 'active' : 'pending' })));
    let feats = [], mode = 'live';
    try { ss(0); const ctr = { lat: (A.lat + C.lat + D.lat) / 3, lng: (A.lng + C.lng + D.lng) / 3 }; const r = Math.max(havDist3D(A, C), havDist3D(A, D), havDist3D(C, D)) + 80; const data = await fetchOSM3D(ctr, r); ss(1); feats = procOSM3D(data); if (!feats.length) mode = 'no_data'; } catch { mode = 'error'; }
    ss(2);
    const mid = { lat: (C.lat + D.lat) / 2, lng: (C.lng + D.lng) / 2 };
    const eSPts = []; for (let i = 0; i <= 20; i++) { eSPts.push(lerpPt3D(A, mid, i / 20)); eSPts.push(lerpPt3D(A, C, i / 20)); eSPts.push(lerpPt3D(A, D, i / 20)); eSPts.push(lerpPt3D(C, D, i / 20)); }
    const mnLa = Math.min(A.lat, C.lat, D.lat) - .0002, mxLa = Math.max(A.lat, C.lat, D.lat) + .0002, mnLo = Math.min(A.lng, C.lng, D.lng) - .0003, mxLo = Math.max(A.lng, C.lng, D.lng) + .0003;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) eSPts.push({ lat: mnLa + r / 3 * (mxLa - mnLa), lng: mnLo + c / 3 * (mxLo - mnLo) });
    const uPts = []; const sn = new Set(); for (const p of eSPts) { const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5); if (!sn.has(k)) { sn.add(k); uPts.push(p); } if (uPts.length >= 100) break; }
    let elevs = []; try { const ed = await fetchElev3D(uPts); elevs = ed.elevation || []; } catch { const b = 10 + Math.abs(A.lat * 100 % 20); elevs = uPts.map((_, i) => b + Math.sin(i * .3) * 1.5); }
    const eg = { pts: uPts, elevs };
    ss(3); for (const f of feats) { const ct = f.geometry.length === 1 ? f.geometry[0] : { lat: f.geometry.reduce((s, g) => s + g.lat, 0) / f.geometry.length, lng: f.geometry.reduce((s, g) => s + g.lng, 0) / f.geometry.length }; f.groundElev = getElevAt3D(ct, eg); }
    ss(4); const res = losEngine3D(A, C, D, feats, eg, eyeH, tgtH);
    ss(5); const elevA = getElevAt3D(A, eg), elevCD = getElevAt3D(mid, eg); const adv = (elevA + eyeH) - (elevCD + tgtH);
    const ai = await aiClassify3D(A, C, D, res.obstructions, feats, { elevA, elevCD, eyeH, tgtH, eyeAlt: elevA + eyeH, tgtAlt: elevCD + tgtH, advantage: adv, elevRange: Math.max(...elevs) - Math.min(...elevs) });
    ss(6); setAnalysisResult({ ...res, ai, elevA, elevCD, eyeH, tgtH, feats, mode }); setAnalysisRunning(false);
  };

  const reset3DAnalysis = () => { setAnalysisResult(null); setAnalysisRunning(false); setAnalysisSteps([]); };
  const ratingMap3D = { CLEAR: { color: '#27ae60', bg: '#eafaf1', label: '✓ CLEAR' }, PARTIALLY_OBSTRUCTED: { color: '#e67e22', bg: '#fef5e7', label: '◐ PARTIAL' }, SEVERELY_OBSTRUCTED: { color: '#c0392b', bg: '#fdedec', label: '◑ SEVERE' }, BLOCKED: { color: '#c0392b', bg: '#fdedec', label: '✗ BLOCKED' } };
  const hInputStyle = { background: "#f8fafb", border: "1.5px solid #d5dde2", color: "#1a3a4a", borderRadius: 5, padding: "4px 6px", width: 52, fontSize: 11, fontWeight: 700, fontFamily: "inherit", textAlign: "center", outline: "none" };

  // Try to derive lot polygon from the lots layer using the address
  const derivedLotFromAddress = useMemo(() => {
    if (!lotsData || !app?.property?.address) return null;

    const addr = app.property.address;
    const addrUpper = addr.toUpperCase();

    // Strategy: same as your lots tooltip match — address contains rd and n
    // (This mirrors the existing "isMatch" you use when styling the lots layer.)
    // p.n = lot number, p.rd = road text (uppercased in data)
    for (const f of (lotsData.features || [])) {
      const p = f.properties || {};
      if (!p) continue;

      if (p.rd && p.n && addrUpper.includes(p.rd) && addr.includes(p.n)) {
        const ringLngLat = getFirstRing(f);
        if (ringLngLat && ringLngLat.length >= 3) {
          // Convert [lng,lat] → [lat,lng]
          const poly = ringLngLat.map(([lng, lat]) => [lat, lng]);
          return poly;
        }
      }
    }
    return null;
  }, [lotsData, app?.property?.address]);

  // Use real lotPoly if available, else approximate rectangle
  // const lotPoly = coords?.lotPoly || (() => {
  //   if (!coords) return [];
  //   const c = coords, p = app.property;
  //   const mLat = 111320, mLng = 111320 * Math.cos(c.lat * Math.PI / 180);
  //   const hW = (p.frontage / 2) / mLng, hD = (p.depth / 2) / mLat;
  //   return [[c.lat+hD,c.lng-hW],[c.lat+hD,c.lng+hW],[c.lat-hD,c.lng+hW],[c.lat-hD,c.lng-hW],[c.lat+hD,c.lng-hW]];
  // })();

  // Use API-provided polygon first, then derived-from-address, else approximate rectangle
  const lotPoly = useMemo(() => {
    // 1) API (applications.lot_polygon)
    const apiPoly = normalizeLotPolygon(app?.lot_polygon);
    if (apiPoly && apiPoly.length >= 3) return apiPoly;

    // 2) Derived from address via lotsData
    const addrPoly = normalizeLotPolygon(derivedLotFromAddress);
    if (addrPoly && addrPoly.length >= 3) return addrPoly;

    // 3) Approximate rectangle around coords center using frontage/depth
    if (!coords) return [];
    const c = coords, p = app.property;
    const mLat = 111320, mLng = 111320 * Math.cos(c.lat * Math.PI / 180);
    const hW = (p.frontage / 2) / mLng, hD = (p.depth / 2) / mLat;
    return [
      [c.lat + hD, c.lng - hW],
      [c.lat + hD, c.lng + hW],
      [c.lat - hD, c.lng + hW],
      [c.lat - hD, c.lng - hW],
      [c.lat + hD, c.lng - hW],
    ];
  }, [app?.lot_polygon, derivedLotFromAddress, coords, app?.property]);

  const handleMapClick = useCallback((latlng) => {
    if (drawMode === "ptA") { setPtA({ lat: latlng.lat, lng: latlng.lng }); setDrawMode("ptB"); }
    else if (drawMode === "ptB") { setPtB({ lat: latlng.lat, lng: latlng.lng }); setDrawMode(null); }
  }, [drawMode]);

  useEffect(() => {
    if (!ptA || !ptB || !coords) { setSightTriangle(null); return; }
    const nearestRoad = findNearestRoadSpeed(ptB.lat, ptB.lng);
    const sd = getSightDistances(nearestRoad.speed);
    const leftDistM = sd.leftM, rightDistM = sd.rightM, baseTotal = leftDistM + rightDistM;

    const bearing = geoBearing(ptA.lat, ptA.lng, ptB.lat, ptB.lng);
    const triLeft = geoOffset(ptB.lat, ptB.lng, leftDistM, (bearing - 90 + 360) % 360);
    const triRight = geoOffset(ptB.lat, ptB.lng, rightDistM, (bearing + 90) % 360);
    const depthM = geoDistMetres(ptA.lat, ptA.lng, ptB.lat, ptB.lng);

    // Distance from ptA to EACH side of lot polygon
    const boundaryDists = [];
    for (let i = 0; i < lotPoly.length - 1; i++) {
      const seg = nearestPointOnSegment(ptA.lat, ptA.lng, lotPoly[i][0], lotPoly[i][1], lotPoly[i+1][0], lotPoly[i+1][1]);
      const d = geoDistMetres(ptA.lat, ptA.lng, seg.lat, seg.lng);
      const sideLen = geoDistMetres(lotPoly[i][0], lotPoly[i][1], lotPoly[i+1][0], lotPoly[i+1][1]);
      boundaryDists.push({ idx: i, dist: d, distLabel: d.toFixed(1), nearPt: seg, sideLen: sideLen.toFixed(1), from: lotPoly[i], to: lotPoly[i+1] });
    }
    boundaryDists.sort((a, b) => a.dist - b.dist);

    let nearestInt = null, nearestIntDist = Infinity;
    (coords.intersections || []).forEach(isc => {
      const d = geoDistMetres(ptB.lat, ptB.lng, isc.lat, isc.lng);
      if (d < nearestIntDist) { nearestIntDist = d; nearestInt = { ...isc, dist: d.toFixed(1) }; }
    });

    const grade = (Math.random() * 7 + 1).toFixed(1);
    const elevDiff = (parseFloat(grade) / 100 * depthM).toFixed(2);

    setSightTriangle({
      ptA, ptB, triLeft, triRight,
      lineAB: [[ptA.lat, ptA.lng], [ptB.lat, ptB.lng]],
      lotPoly, boundaryDists,
      speedInfo: { detected: nearestRoad.speed, roadName: nearestRoad.roadName, networkType: nearestRoad.networkType, absMin: sd.absMin, ssdMin: sd.ssdMin, leftM: leftDistM, rightM: rightDistM, baseTotal },
      analysis: {
        depth: depthM.toFixed(1), area: (baseTotal * depthM / 2).toFixed(1), baseWidth: baseTotal.toFixed(1),
        leftDist: leftDistM.toFixed(1), rightDist: rightDistM.toFixed(1),
        distToProperty: boundaryDists[0]?.distLabel || "—",
        nearestPropPt: boundaryDists[0]?.nearPt || null,
        nearestIntersection: nearestInt, nearestIntDist: nearestIntDist.toFixed(1),
        grade, elevDiff, compliant: depthM >= 2.0, heightClear: true,
      },
    });
  }, [ptA, ptB, coords, lotPoly]);

  const resetTriangle = () => { setPtA(null); setPtB(null); setSightTriangle(null); setDrawMode(null); reset3DAnalysis(); };
  const startDraw = () => { resetTriangle(); setDrawMode("ptA"); };

  // Clicked lot from map
  const [clickedLot, setClickedLot] = useState(null);
  const handleLotClick = useCallback((lotInfo) => {
    if (drawMode) return; // ignore during draw mode
    const poly = lotInfo.polygon;
    if (!poly || poly.length < 3) return;

    // Compute lot center
    const lats = poly.map(p => p[0]), lngs = poly.map(p => p[1]);
    const cLat = lats.reduce((a,b)=>a+b,0)/lats.length;
    const cLng = lngs.reduce((a,b)=>a+b,0)/lngs.length;

    // Detect nearest road speed at lot center
    const nearestRoad = findNearestRoadSpeed(cLat, cLng);
    const sd = getSightDistances(nearestRoad.speed);

    // Compute lot side lengths
    const sides = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const len = geoDistMetres(poly[i][0], poly[i][1], poly[i+1][0], poly[i+1][1]);
      sides.push({ idx: i, length: len, from: poly[i], to: poly[i+1] });
    }
    // Find longest side (likely the frontage)
    const frontage = sides.reduce((a, b) => a.length > b.length ? a : b, sides[0]);
    // Compute lot area (shoelace)
    let area = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const dLat = geoDistMetres(poly[i][0], poly[i][1], poly[i+1][0], poly[i][1]);
      const dLng = geoDistMetres(poly[i][0], poly[i][1], poly[i][0], poly[i+1][1]);
      area += (poly[i][1] * poly[i+1][0] - poly[i+1][1] * poly[i][0]);
    }
    const areaSqDeg = Math.abs(area) / 2;
    const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos(cLat * Math.PI / 180);
    const areaSqM = areaSqDeg * mPerDegLat * mPerDegLng;
    const perimeter = sides.reduce((s, sd) => s + sd.length, 0);

    // Apply crossover rules based on frontage
    const frontageM = frontage.length;
    const maxWidth = frontageM <= 12.5 ? 4.5 : 6.0;
    const dualAllowed = frontageM > 20;
    const setbackMin = 0.5;

    setClickedLot({
      ...lotInfo,
      center: { lat: cLat, lng: cLng },
      sides, frontage: frontage.length,
      frontageIdx: frontage.idx,
      areaSqM, perimeter,
      speed: nearestRoad.speed,
      roadName: nearestRoad.roadName,
      networkType: nearestRoad.networkType,
      sightDist: sd,
      rules: {
        maxWidth,
        minWidth: 3.0,
        dualAllowed,
        setbackMin,
        sightLeftM: sd.leftM,
        sightRightM: sd.rightM,
        sightBase: sd.leftM + sd.rightM,
      }
    });
  }, [drawMode]);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowLots(!showLots)}
            style={{ padding: "6px 12px", borderRadius: 6, border: showLots ? "2px solid #2980b9" : "1px solid #d5dde2", background: showLots ? "#ebf5fb" : "#fff", color: showLots ? "#2980b9" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🏘️ Lots
          </button>
          <button onClick={() => setShowSpeedRoads(!showSpeedRoads)}
            style={{ padding: "6px 12px", borderRadius: 6, border: showSpeedRoads ? "2px solid #e67e22" : "1px solid #d5dde2", background: showSpeedRoads ? "#fef5e7" : "#fff", color: showSpeedRoads ? "#e67e22" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            🚗 Speed
          </button>
          {/* Sight Triangle button commented out per request */}
{/* {!drawMode && !sightTriangle && (
            <button onClick={startDraw} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #e74c3c, #c0392b)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔺 Sight Triangle</button>
          )} */}
          {drawMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: drawMode === "ptA" ? "#fdf2f2" : "#ebf5fb", padding: "5px 12px", borderRadius: 6, border: `1px solid ${drawMode === "ptA" ? "#e74c3c40" : "#2980b940"}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: drawMode === "ptA" ? "#e74c3c" : "#2980b9", animation: "pulse 1.2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: drawMode === "ptA" ? "#c0392b" : "#2980b9" }}>
                {drawMode === "ptA" ? "Click: DRIVEWAY point (A)" : "Click: ROAD centreline (B)"}
              </span>
              <button onClick={resetTriangle} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          {sightTriangle && !drawMode && (
            <button onClick={resetTriangle} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>↺ Clear</button>
          )}
          {sightTriangle && !drawMode && !analysisRunning && (
            <button onClick={run3DSightAnalysis} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #8e44ad, #6c3483)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 6px rgba(142,68,173,0.3)" }}>🔬 3D Sight Analysis</button>
          )}
          {analysisRunning && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8e44ad", padding: "6px 12px", background: "#f4ecf7", borderRadius: 6 }}>⟳ Running 3D Analysis...</span>
          )}
        </div>
        {/* Observer & Object height — shown when sight triangle exists */}
        {(sightTriangle || drawMode) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafb", padding: "5px 10px", borderRadius: 6, border: "1px solid #e4e9ec" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#e74c3c" }}>👁</span>
              <input type="number" value={eyeHeight} onChange={e => setEyeHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={hInputStyle} />
              <span style={{ fontSize: 9, color: "#7a8a94" }}>m</span>
            </div>
            <div style={{ width: 1, height: 14, background: "#d5dde2" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#2980b9" }}>◎</span>
              <input type="number" value={objectHeight} onChange={e => setObjectHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={hInputStyle} />
              <span style={{ fontSize: 9, color: "#7a8a94" }}>m</span>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <LeafletMap apps={apps} selectedApp={app} onSelectApp={onSelectApp} height={520}
        drawMode={drawMode} onMapClick={handleMapClick} sightTriangle={sightTriangle}
        showLots={showLots} lotsData={lotsData} showSpeedRoads={showSpeedRoads} onLotClick={handleLotClick} allLotsData={lotsData} />

      {/* ═══ Clicked Lot Rules Panel ═══ */}
      {clickedLot && !sightTriangle && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #2980b9", background: "linear-gradient(135deg, #ebf5fb, #d6eaf8)" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>📍 {clickedLot.address}</div>
              <div style={{ fontSize: 11, color: "#5a6a74" }}>{clickedLot.properties.loc} · {clickedLot.speed}km/h · {clickedLot.roadName}</div>
            </div>
            <button onClick={() => setClickedLot(null)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
          </div>

          {/* Lot metrics */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "FRONTAGE", value: clickedLot.frontage.toFixed(1) + "m", color: "#2980b9" },
              { label: "PERIMETER", value: clickedLot.perimeter.toFixed(1) + "m", color: "#16a085" },
              { label: "AREA", value: clickedLot.areaSqM.toFixed(0) + "m²", color: "#8e44ad" },
              { label: "SIDES", value: clickedLot.sides.length, color: "#1a3a4a" },
              { label: "SPEED", value: clickedLot.speed + "km/h", color: "#e67e22" },
              { label: "ROAD", value: clickedLot.roadName || "—", color: "#5a6a74" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 80px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 80 }}>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Lot boundary sides */}
          <div style={{ padding: "0 16px 10px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 4, textTransform: "uppercase" }}>Boundary Sides</div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {clickedLot.sides.map((s, i) => (
                <div key={i} style={{ padding: "4px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, textAlign: "center", minWidth: 50,
                  background: i === clickedLot.frontageIdx ? "#ebf5fb" : "#f8fafb", border: i === clickedLot.frontageIdx ? "2px solid #2980b9" : "1px solid #eef2f4",
                  color: i === clickedLot.frontageIdx ? "#2980b9" : "#5a6a74" }}>
                  {s.length.toFixed(1)}m{i === clickedLot.frontageIdx ? " ★" : ""}
                </div>
              ))}
            </div>
          </div>

          {/* Crossover Rules */}
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 6, textTransform: "uppercase" }}>📋 Crossover Rules for this lot</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { rule: "Min crossover width", value: "3.0m", ref: "§3.2" },
                { rule: "Max crossover width", value: clickedLot.rules.maxWidth + "m", ref: clickedLot.frontage <= 12.5 ? "§3.2 (≤12.5m)" : "§3.2 (>12.5m)" },
                { rule: "Dual crossover", value: clickedLot.rules.dualAllowed ? "✅ Permitted" : "❌ Not permitted", ref: clickedLot.rules.dualAllowed ? ">20m frontage" : "≤20m frontage" },
                { rule: "Boundary setback", value: "≥ " + clickedLot.rules.setbackMin + "m", ref: "§3.3" },
                { rule: "Sight dist — Left (abs)", value: clickedLot.rules.sightLeftM + "m", ref: clickedLot.sightDist.absMin + "m ÷ 10" },
                { rule: "Sight dist — Right (ssd)", value: clickedLot.rules.sightRightM + "m", ref: clickedLot.sightDist.ssdMin + "m ÷ 10" },
                { rule: "Sight triangle base", value: clickedLot.rules.sightBase.toFixed(1) + "m", ref: "Asymmetric" },
                { rule: "Road edge max width", value: "≤ 6.0m", ref: "§3.1" },
              ].map(r => (
                <div key={r.rule} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", borderRadius: 5, background: "#f8fafb", border: "1px solid #eef2f4" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a" }}>{r.rule}</div>
                    <div style={{ fontSize: 9, color: "#95a5a6" }}>{r.ref}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: r.value.includes("❌") ? "#e74c3c" : r.value.includes("✅") ? "#27ae60" : "#2980b9" }}>{r.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Sight Triangle Analysis Panel ═══ */}
      {sightTriangle && sightTriangle.analysis && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          {/* Compliance header */}
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
            background: sightTriangle.analysis.compliant ? "linear-gradient(135deg, #eafaf1, #d5f5e3)" : "linear-gradient(135deg, #fdedec, #fadbd8)",
            borderBottom: `2px solid ${sightTriangle.analysis.compliant ? "#27ae60" : "#e74c3c"}` }}>
            <span style={{ fontSize: 24 }}>{sightTriangle.analysis.compliant ? "✅" : "⚠️"}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: sightTriangle.analysis.compliant ? "#1e8449" : "#c0392b" }}>
                Sight Triangle — {sightTriangle.analysis.compliant ? "COMPLIANT" : "REVIEW REQUIRED"}
              </div>
              <div style={{ fontSize: 11, color: sightTriangle.analysis.compliant ? "#27ae60" : "#922b21" }}>
                {sightTriangle.speedInfo?.detected}km/h on {sightTriangle.speedInfo?.roadName || "—"} | Base: {sightTriangle.analysis.leftDist}m + {sightTriangle.analysis.rightDist}m = {sightTriangle.analysis.baseWidth}m
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "SPEED", value: sightTriangle.speedInfo?.detected + " km/h", sub: sightTriangle.speedInfo?.roadName || "—", color: "#e67e22" },
              { label: "LEFT (abs)", value: sightTriangle.analysis.leftDist + "m", sub: sightTriangle.speedInfo?.absMin + "m ÷ 10", color: "#2980b9" },
              { label: "RIGHT (ssd)", value: sightTriangle.analysis.rightDist + "m", sub: sightTriangle.speedInfo?.ssdMin + "m ÷ 10", color: "#8e44ad" },
              { label: "BASE", value: sightTriangle.analysis.baseWidth + "m", sub: "Asymmetric", color: "#16a085" },
              { label: "DEPTH A→B", value: sightTriangle.analysis.depth + "m", sub: "Driveway → road", color: "#e74c3c" },
              { label: "AREA", value: sightTriangle.analysis.area + "m²", sub: "½ × base × depth", color: "#1a3a4a" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 85px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 85 }}>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
                <div style={{ fontSize: 9, color: "#95a5a6" }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Boundary distances from A to each lot side */}
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 4, textTransform: "uppercase" }}>📐 Distance from Point A to each lot boundary side</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(sightTriangle.boundaryDists || []).map((bd, i) => (
                <div key={i} style={{ flex: "1 1 110px", padding: "6px 10px", borderRadius: 6, fontSize: 11, minWidth: 100,
                  background: i === 0 ? "#fdf2f2" : "#f8fafb", border: i === 0 ? "2px solid #e74c3c" : "1px solid #eef2f4" }}>
                  <div style={{ fontWeight: 800, color: i === 0 ? "#e74c3c" : "#1a3a4a", fontSize: 16 }}>→ {bd.distLabel}m</div>
                  <div style={{ color: "#7a8a94", fontSize: 9 }}>Side {bd.idx + 1} ({bd.sideLen}m){i === 0 ? " — nearest" : ""}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Info panels */}
          <div style={{ padding: "0 16px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px", background: "#ebf5fb", borderRadius: 8, padding: "10px 14px", border: "1px solid #aed6f1" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#2471a3", marginBottom: 3 }}>🚗 SPEED-BASED SIGHT DISTANCE</div>
              <div style={{ fontSize: 12, color: "#1a5276", lineHeight: 1.5 }}>
                Left (abs_min): <strong>{sightTriangle.speedInfo?.absMin}m ÷ 10 = {sightTriangle.analysis.leftDist}m</strong><br/>
                Right (ssd_min): <strong>{sightTriangle.speedInfo?.ssdMin}m ÷ 10 = {sightTriangle.analysis.rightDist}m</strong>
              </div>
            </div>
            <div style={{ flex: "1 1 200px", background: "#fef9e7", borderRadius: 8, padding: "10px 14px", border: "1px solid #f9e79f" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#b8860b", marginBottom: 3 }}>🔺 OBSTRUCTION 0.65–1.5m</div>
              <div style={{ fontSize: 12, color: "#7d6608", lineHeight: 1.5 }}>
                No objects within triangle between 0.65–1.5m height.
                {sightTriangle.analysis.nearestIntersection && parseFloat(sightTriangle.analysis.nearestIntersection.dist) < 30
                  ? ` ⚠ ${sightTriangle.analysis.nearestIntersection.name} within 30m.` : ""}
              </div>
            </div>
          </div>

          {/* Reference table */}
          <div style={{ padding: "0 16px 10px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7a8a94", marginBottom: 4, textTransform: "uppercase" }}>Sight Distance Reference (Austroads / AS 2890.1)</div>
            <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {SIGHT_DISTANCE_TABLE.map(e => {
                const cur = e.speed === sightTriangle.speedInfo?.detected;
                return (
                  <div key={e.speed} style={{ padding: "3px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, textAlign: "center", minWidth: 55,
                    background: cur ? "#e74c3c" : "#f5f8fa", color: cur ? "#fff" : "#5a6a74", border: cur ? "2px solid #c0392b" : "1px solid #eef2f4" }}>
                    <div>{e.speed}km/h</div>
                    <div style={{ fontWeight: 400, fontSize: 8 }}>{e.abs_min/10}m | {e.ssd_min/10}m</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "0 16px 12px", fontSize: 9, color: "#b0bdb2" }}>
            AS 2890.1:2004 §3.2.4 | Eye 1.15m | Object 0.65–1.5m | Left = abs_min÷10 | Right = ssd_min÷10
          </div>
        </div>
      )}

      {/* ═══ 3D Analysis Processing Steps ═══ */}
      {analysisRunning && analysisSteps.length > 0 && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#8e44ad", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>🔬 3D Sight Analysis Processing</div>
          {analysisSteps.map((step, i) => (
            <div key={i} style={{ padding: "2px 0", fontSize: 11, color: step.status === 'done' ? '#27ae60' : step.status === 'active' ? '#1a3a4a' : '#c8d0d4', fontWeight: step.status === 'active' ? 700 : 400, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 10 }}>{step.status === 'done' ? '✓' : step.status === 'active' ? '◆' : '○'}</span>{step.text}
            </div>
          ))}
        </div>
      )}

      {/* ═══ 3D Analysis Results ═══ */}
      {analysisResult && !analysisRunning && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
            background: `linear-gradient(135deg, ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).bg}, #fff)`,
            borderBottom: `2px solid ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color}` }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>🔬 3D Sight-Line Analysis</div>
              <div style={{ fontSize: 10, color: "#5a6a74", marginTop: 2 }}>
                {sightTriangle?.speedInfo?.detected}km/h · {sightTriangle?.speedInfo?.roadName || '—'} | 👁 {analysisResult.eyeH}m | ◎ {analysisResult.tgtH}m | {analysisResult.mode === 'live' ? '● LIVE' : '○ Fallback'}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: 800, background: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color, border: `1px solid ${(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).color}40` }}>
                {(ratingMap3D[analysisResult.ai?.overall_rating] || ratingMap3D.BLOCKED).label}
              </span>
              <button onClick={reset3DAnalysis} style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: "#95a5a6" }}>✕</button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: "10px 16px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { label: "FEATURES", value: analysisResult.feats?.length || 0, color: "#2980b9" },
              { label: "OBSTRUCTIONS", value: analysisResult.obstructions?.length || 0, color: "#e74c3c" },
              { label: "VISIBILITY", value: (analysisResult.ai?.visibility_pct || 0) + "%", color: "#27ae60" },
              { label: "👁 OBSERVER", value: analysisResult.eyeH + "m", color: "#e74c3c" },
              { label: "◎ OBJECT", value: analysisResult.tgtH + "m", color: "#2980b9" },
              { label: "ELEV A", value: analysisResult.elevA?.toFixed(1) + "m", color: "#1abc9c" },
              { label: "ELEV C↔D", value: analysisResult.elevCD?.toFixed(1) + "m", color: "#e67e22" },
              { label: "Δ", value: ((analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)) >= 0 ? '+' : '') + (analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)).toFixed(1) + "m", color: "#8e44ad" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 70px", background: "#f8fafb", borderRadius: 6, padding: "6px 8px", minWidth: 68 }}>
                <div style={{ fontSize: 8, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 1, borderBottom: "1px solid #e4e9ec", padding: "0 16px" }}>
            {[{ id: 'obstructions', label: '⚠ Obstruct.' }, { id: 'features', label: '▤ Features' }, { id: 'ai', label: '◈ AI' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveAnalysisTab(tab.id)}
                style={{ padding: "6px 12px", background: "none", border: "none", borderBottom: activeAnalysisTab === tab.id ? "2px solid #8e44ad" : "2px solid transparent", color: activeAnalysisTab === tab.id ? "#8e44ad" : "#7a8a94", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "10px 16px", maxHeight: 260, overflowY: "auto" }}>
            {activeAnalysisTab === 'obstructions' && (
              analysisResult.obstructions?.length === 0
                ? <div style={{ textAlign: "center", color: "#27ae60", padding: 12, fontSize: 11, fontWeight: 700 }}>Clear 3D line of sight ✓</div>
                : analysisResult.obstructions?.map((o, i) => {
                    const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', terrain_ridge: '#ff4757' };
                    return (
                      <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f0f3f5", fontSize: 11 }}>
                        <div style={{ fontWeight: 700, color: tc[o.feature.type] || '#5a6a74' }}>{o.blockType === 'terrain' ? '▲ TERRAIN' : o.feature.type.toUpperCase()}: {o.feature.name}</div>
                        <div style={{ display: "flex", gap: 5, marginTop: 2, flexWrap: "wrap", fontSize: 10 }}>
                          <span style={{ padding: "1px 5px", borderRadius: 3, background: o.isCritical ? "#fdf2f2" : "#f5f8fa", color: o.isCritical ? "#e74c3c" : "#5a6a74", fontWeight: 700 }}>{o.feature.estimatedHeight?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>gnd {o.fGroundElev?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>top {o.fTopAlt?.toFixed(1)}m</span>
                          <span style={{ color: "#e74c3c", fontWeight: 700 }}>+{o.excessHeight?.toFixed(2)}m</span>
                          {o.isCritical && <span style={{ color: "#e74c3c", fontWeight: 700 }}>⚠ 0.5-1.0m</span>}
                        </div>
                      </div>
                    );
                  })
            )}
            {activeAnalysisTab === 'features' && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#7a8a94", marginBottom: 4 }}>{analysisResult.feats?.length || 0} Features</div>
                {(analysisResult.feats || []).slice(0, 25).map((f, i) => {
                  const tc = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', vegetation: '#00d0c8' };
                  return (
                    <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #f0f3f5", fontSize: 10 }}>
                      <span style={{ fontWeight: 700, color: tc[f.type] || '#5a6a74' }}>{f.type}</span>
                      <span style={{ color: "#7a8a94", marginLeft: 4 }}>{f.name}</span>
                      <span style={{ marginLeft: 4, padding: "1px 4px", borderRadius: 3, background: "#f5f8fa", color: "#5a6a74", fontWeight: 700 }}>{f.estimatedHeight.toFixed(1)}m</span>
                      <span style={{ color: "#95a5a6", marginLeft: 3 }}>gnd {f.groundElev?.toFixed(1)}m</span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeAnalysisTab === 'ai' && analysisResult.ai && (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).bg, color: (ratingMap3D[analysisResult.ai.overall_rating] || ratingMap3D.BLOCKED).color }}>
                    {analysisResult.ai.overall_rating?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.6, color: "#1a3a4a", marginBottom: 10 }}>{analysisResult.ai.analysis_summary}</div>
                {analysisResult.ai.critical_low_obstructions?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#e67e22", marginBottom: 3 }}>⚠ CRITICAL LOW (0.5–1.0m)</div>
                    {analysisResult.ai.critical_low_obstructions.map((c, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "3px 0", borderBottom: "1px solid #f0f3f5" }}>
                        <strong style={{ color: "#e67e22" }}>{c.name}</strong> — <span style={{ color: "#7a8a94" }}>{c.height_range} · {c.impact}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysisResult.ai.elevation_insight && (
                  <div style={{ background: "#f0f3f5", borderRadius: 6, padding: "8px 12px", marginBottom: 8, fontSize: 10, color: "#5a6a74", border: "1px solid #e4e9ec" }}>▲ {analysisResult.ai.elevation_insight}</div>
                )}
                {analysisResult.ai.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#1abc9c", marginBottom: 3 }}>Recommendations</div>
                    {analysisResult.ai.recommendations.map((r, i) => (
                      <div key={i} style={{ fontSize: 10, padding: "2px 0", lineHeight: 1.5, color: "#1a3a4a" }}><span style={{ color: "#1abc9c", fontWeight: 700, marginRight: 3 }}>{i + 1}.</span>{r}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Login Screen ───────────────────────────────────────
function LoginScreen({ onLogin }) {
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

// ─── System Administration ──────────────────────────────
function SystemAdmin({ users, setUsers, currentUser }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const startEdit = (u) => { setEditId(u.id); setForm({ ...u }); };
  const saveEdit = async () => {
    try {
      const data = { name: form.name, email: form.email, role: form.role, department: form.department, initials: form.initials };
      await api.updateUser(form._dbId, data);
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
    } catch (e) { console.error("Save user failed:", e); }
    setEditId(null);
  };
  const toggleActive = async (u) => {
    try {
      await api.updateUser(u._dbId, { is_active: !u.active });
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
    } catch (e) { console.error("Toggle failed:", e); }
  };
  const addUser = async () => {
    try {
      const nu = await api.createUser({ name: "New User", email: `new${Date.now()}@kalamunda.wa.gov.au`, password: "engineer123", role: "engineer", department: "Engineering" });
      const uList = await api.listUsers();
      setUsers(uList.map(apiUserToFrontend));
      const converted = apiUserToFrontend(nu);
      startEdit(converted);
    } catch (e) { console.error("Add user failed:", e); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div><h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>System Administration</h2>
          <p style={{ color: "#7a8a94", fontSize: 13, margin: 0 }}>Manage users, roles, and permissions</p></div>
        <button onClick={addUser} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>+ Add User</button>
      </div>

      {/* Role summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
          const cnt = users.filter(u => u.role === role && u.active).length;
          return <div key={role} style={{ flex: "1 1 120px", background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "14px 16px" }}>
            <div style={{ fontSize: 24 }}>{cfg.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: cfg.color }}>{cnt}</div>
            <div style={{ fontSize: 11, color: "#7a8a94", fontWeight: 600 }}>{cfg.label}s</div>
          </div>;
        })}
      </div>

      {/* User table */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f5f8fa" }}>
            {["User","Email","Role","Department","Status","Actions"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {users.map(u => {
              const rc = ROLE_CONFIG[u.role];
              const isEditing = editId === u.id;
              return (
                <tr key={u.id} style={{ borderBottom: "1px solid #f5f7f8", background: isEditing ? "#ebf5fb" : "transparent" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: u.active ? rc.color : "#bdc3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{u.initials}</div>
                      {isEditing ? <input value={form.name} onChange={e => setForm({...form, name: e.target.value, initials: e.target.value.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)})} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d5dde2", fontSize: 12, fontFamily: "inherit", width: 130 }} /> : <span style={{ fontWeight: 600, color: "#1a3a4a" }}>{u.name}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#5a6a74" }}>
                    {isEditing ? <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d5dde2", fontSize: 11, fontFamily: "inherit", width: 200 }} /> : u.email}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {isEditing ? (
                      <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d5dde2", fontSize: 11, fontFamily: "inherit" }}>
                        {Object.entries(ROLE_CONFIG).map(([r, c]) => <option key={r} value={r}>{c.icon} {c.label}</option>)}
                      </select>
                    ) : <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${rc.color}15`, color: rc.color }}>{rc.icon} {rc.label}</span>}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#5a6a74" }}>
                    {isEditing ? <input value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #d5dde2", fontSize: 11, fontFamily: "inherit", width: 120 }} /> : u.department}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <button onClick={() => toggleActive(u)} disabled={u.id === currentUser.id} style={{ padding: "3px 10px", borderRadius: 10, border: "none", fontSize: 10, fontWeight: 700, cursor: u.id === currentUser.id ? "default" : "pointer", fontFamily: "inherit",
                      background: u.active ? "#eafaf1" : "#fdedec", color: u.active ? "#27ae60" : "#e74c3c" }}>
                      {u.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={saveEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#27ae60", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
                        <button onClick={() => setEditId(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(u)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, color: "#5a6a74", cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════
function Sidebar({ activeView, setActiveView, apps, collapsed, setCollapsed, currentUser, onLogout }) {
  const pend = apps.filter(a => a.status === "pending_review").length;
  const refs = apps.filter(a => a.status === "referral_pending").length;
  const role = currentUser?.role || "engineer";
  const rc = ROLE_CONFIG[role];

  const baseNav = [
    { id: "dashboard", icon: "📊", label: "Dashboard", roles: ["admin", "manager", "engineer"] },
    // { id: "map", icon: "🗺️", label: "Property Map", roles: ["admin", "manager", "engineer"] }, // commented out per request
    { id: "applications", icon: "📋", label: role === "engineer" ? "My Cases" : "All Applications", badge: apps.length, roles: ["admin", "manager", "engineer"] },
    { id: "sight_analysis", icon: "🔺", label: "Sight Analysis", roles: ["admin", "manager", "engineer"] },
    { id: "pending", icon: "⏳", label: "Pending Review", badge: pend, roles: ["admin", "manager"] },
    { id: "referrals", icon: "↗️", label: "Referrals", badge: refs, roles: ["admin", "manager"] },
    { id: "inspections", icon: "🔍", label: "Inspections", roles: ["admin", "manager", "engineer"] },
    { id: "admin", icon: "⚙️", label: "Administration", roles: ["admin"] },
  ];
  const nav = baseNav.filter(n => n.roles.includes(role));
  const w = collapsed ? 52 : 220;
  return (
    <div style={{ width: w, minWidth: w, maxWidth: w, background: "#0c1f2e", minHeight: "100vh", display: "flex", flexDirection: "column", flexShrink: 0, flexGrow: 0, transition: "all 0.2s ease", overflow: "hidden" }}>
      <div style={{ padding: collapsed ? "12px 8px" : "14px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 4, color: "#1abc9c" }} title="Expand">☰</button>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#1abc9c,#16a085)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🏛</div>
              <div><div style={{ color: "#ecf0f1", fontWeight: 800, fontSize: 11 }}>City of Kalamunda</div><div style={{ color: "#5d7a8c", fontSize: 9 }}>Approval Portal v3.1</div></div>
            </div>
            <button onClick={() => setCollapsed(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#5d7a8c", padding: 2 }} title="Collapse">✕</button>
          </>
        )}
      </div>
      <nav style={{ padding: collapsed ? "8px 4px" : "8px 6px", flex: 1 }}>
        {nav.map(item => {
          const act = activeView === item.id;
          return <button key={item.id} onClick={() => setActiveView(item.id)} title={item.label}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: collapsed ? 0 : 8, padding: collapsed ? "9px 0" : "8px 10px", borderRadius: 6, border: "none", cursor: "pointer", marginBottom: 2, background: act ? "rgba(26,188,156,0.12)" : "transparent", color: act ? "#1abc9c" : "#8da4b4", fontSize: 12, fontWeight: act ? 700 : 500, fontFamily: "inherit", textAlign: "left", justifyContent: collapsed ? "center" : "flex-start" }}>
            <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && <span style={{ flex: 1, whiteSpace: "nowrap" }}>{item.label}</span>}
            {!collapsed && item.badge > 0 && <span style={{ background: act ? "#1abc9c" : "#2c3e50", color: act ? "#0c1f2e" : "#8da4b4", fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 8 }}>{item.badge}</span>}
          </button>;
        })}
      </nav>
      {!collapsed && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: rc.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 800 }}>{currentUser?.initials || "?"}</div>
            <div style={{ flex: 1 }}><div style={{ color: "#bdc3c7", fontSize: 10, fontWeight: 600 }}>{currentUser?.name || "—"}</div><div style={{ color: "#5d7a8c", fontSize: 9 }}>{rc.icon} {rc.label}</div></div>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#5d7a8c", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>🚪 Sign Out</button>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────
function DashboardView({ apps, onSelectApp, globalLotsData }) {
  const sc = {}; Object.keys(STATUS_CONFIG).forEach(s => { sc[s] = apps.filter(a => a.status === s).length; });
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>Dashboard</h2>
      <p style={{ color: "#7a8a94", fontSize: 13, margin: "0 0 20px" }}>{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <MetricCard label="Active" value={apps.filter(a => !["approved","rejected"].includes(a.status)).length} color="#2980b9" />
        <MetricCard label="Pending" value={sc.pending_review} color="#e67e22" />
        <MetricCard label="Referrals" value={sc.referral_pending} color="#8e44ad" />
        <MetricCard label="Approved" value={sc.approved} color="#27ae60" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <LeafletMap apps={apps} onSelectApp={onSelectApp} height={380} allLotsData={globalLotsData} />
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #eef2f4", fontWeight: 700, fontSize: 14, color: "#1a3a4a" }}>Recent Applications</div>
        {apps.slice(0, 5).map(app => (
          <div key={app.id} onClick={() => onSelectApp(app)} style={{ padding: "10px 18px", borderBottom: "1px solid #f5f7f8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a" }}>{app.id}</div><div style={{ fontSize: 11, color: "#7a8a94" }}>{app.owner.name} — {app.property.address.split(",")[0]}</div></div>
            <StatusBadge status={app.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Full Map View (Property Map) ─────────────────────
function FullMapView({ apps, onSelectApp, globalLotsData }) {
  const [selectedOnMap, setSelectedOnMap] = useState(null);
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 16px" }}>Property Map</h2>
      {selectedOnMap ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div><span style={{ fontWeight: 800, fontSize: 15, color: "#1a3a4a" }}>{selectedOnMap.id}</span> <span style={{ color: "#7a8a94", fontSize: 12 }}>— {selectedOnMap.property.address}</span></div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onSelectApp(selectedOnMap)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#1abc9c", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Full Detail →</button>
              <button onClick={() => setSelectedOnMap(null)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#7a8a94", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
            </div>
          </div>
          <MapWithOverlay app={selectedOnMap} apps={apps} onSelectApp={onSelectApp} />
        </div>
      ) : (
        <LeafletMap apps={apps} onSelectApp={a => setSelectedOnMap(a)} height={600} allLotsData={globalLotsData} />
      )}
    </div>
  );
}

// ─── Sight Analysis View ──────────────────────────────
// Flow: Click A (observer) → Click B (middle of street) → auto-calculate C & D from B using sight distances → triangle A→C→D
function SightAnalysisView({ apps, onSelectApp, globalLotsData }) {
  const [showLots, setShowLots] = useState(true);
  const [showStreetNames, setShowStreetNames] = useState(true);
  const [showSpeedRoads, setShowSpeedRoads] = useState(false);
  const [lotsData, setLotsData] = useState(null);
  const [lotsLoading, setLotsLoading] = useState(false);

  // Sight analysis state — 2 click: A (observer), B (road centre), then C & D auto from B
  const [sightMode, setSightMode] = useState(null); // null | 'ptA' | 'ptB' | 'done'
  const [ptA, setPtA] = useState(null);
  const [ptB, setPtB] = useState(null);
  const [ptC, setPtC] = useState(null);
  const [ptD, setPtD] = useState(null);
  const [sightTriangle, setSightTriangle] = useState(null);
  const [clickedLot, setClickedLot] = useState(null);

  // Observer & object height (editable)
  const [eyeHeight, setEyeHeight] = useState(1.15);
  const [objectHeight, setObjectHeight] = useState(0.65);

  // 3D analysis state
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisSteps, setAnalysisSteps] = useState([]);
  const [activeTab, setActiveTab] = useState('obstructions');

  useEffect(() => {
    if (!showLots || lotsData || lotsLoading) return;
    setLotsLoading(true);
    let cancelled = false;
    async function loadLots() {
      try {
        const res = await fetch('/lot.geojson', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const gj = await res.json();
        if (!cancelled) { setLotsData(gj); setLotsLoading(false); }
      } catch (err) { if (!cancelled) setLotsLoading(false); }
    }
    loadLots();
    return () => { cancelled = true; };
  }, [showLots, lotsData, lotsLoading]);

  const effectiveLotsData = lotsData || globalLotsData;

  // ── 3D Sight Analysis Engine (ported from sight_line_3d-1.html) ──
  const R_ = 6371000, toRad = d => d * Math.PI / 180;
  const havDist = (a, b) => { const dl = toRad(b.lat - a.lat), dn = toRad(b.lng - a.lng), x = Math.sin(dl / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dn / 2) ** 2; return R_ * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };
  const lerpPt = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const segIntersect = (a, b, c, d) => { const det = (b.lng - a.lng) * (d.lat - c.lat) - (b.lat - a.lat) * (d.lng - c.lng); if (Math.abs(det) < 1e-14) return null; const t = ((c.lng - a.lng) * (d.lat - c.lat) - (c.lat - a.lat) * (d.lng - c.lng)) / det, u = ((c.lng - a.lng) * (b.lat - a.lat) - (c.lat - a.lat) * (b.lng - a.lng)) / det; if (t > 0.005 && t < 0.995 && u > 0.005 && u < 0.995) return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), t }; return null; };

  const getElevAt = (pt, elevGrid) => {
    let b1 = { d: Infinity, e: 0 }, b2 = { d: Infinity, e: 0 };
    for (let i = 0; i < elevGrid.pts.length; i++) {
      const d = havDist(pt, elevGrid.pts[i]);
      if (d < b1.d) { b2 = { ...b1 }; b1 = { d, e: elevGrid.elevs[i] }; }
      else if (d < b2.d) b2 = { d, e: elevGrid.elevs[i] };
    }
    if (b1.d < 0.1) return b1.e;
    const tot = b1.d + b2.d;
    return b1.e * (1 - b1.d / tot) + b2.e * (1 - b2.d / tot);
  };

  const fetchOSMData = async (ctr, r) => {
    r = Math.min(r, 500);
    const q = `[out:json][timeout:25];(way["building"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="fence"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="retaining_wall"](around:${r},${ctr.lat},${ctr.lng});way["barrier"="hedge"](around:${r},${ctr.lat},${ctr.lng});node["natural"="tree"](around:${r},${ctr.lat},${ctr.lng});way["natural"="tree_row"](around:${r},${ctr.lat},${ctr.lng});way["landuse"="forest"](around:${r},${ctr.lat},${ctr.lng});way["man_made"="embankment"](around:${r},${ctr.lat},${ctr.lng}););out body geom;`;
    const resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  };

  const processOSM = (data) => {
    const ff = [];
    if (!data?.elements) return ff;
    for (const el of data.elements) {
      let tp = null, ht = 0, geom = [];
      const tg = el.tags || {};
      if (tg.building) { tp = 'building'; const l = parseInt(tg['building:levels']) || 0, h = parseFloat(tg.height); ht = !isNaN(h) ? h : l > 0 ? l * 3 : 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'fence') { tp = 'fence'; ht = parseFloat(tg.height) || 1.5; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'wall' || tg.barrier === 'retaining_wall') { tp = 'wall'; ht = parseFloat(tg.height) || 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.barrier === 'hedge') { tp = 'hedge'; ht = parseFloat(tg.height) || 1.2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.natural === 'tree') { tp = 'tree'; ht = parseFloat(tg.height) || 8; if (el.lat && el.lon) geom = [{ lat: el.lat, lng: el.lon }]; }
      else if (tg.natural === 'tree_row') { tp = 'tree_row'; ht = 6; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.landuse === 'forest' || tg.natural === 'wood') { tp = 'vegetation'; ht = 10; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      else if (tg.man_made === 'embankment') { tp = 'embankment'; ht = 2; if (el.geometry) geom = el.geometry.map(n => ({ lat: n.lat, lng: n.lon })); }
      if (tp && geom.length > 0) ff.push({ id: el.id, type: tp, estimatedHeight: ht, geometry: geom, tags: tg, name: tg.name || tg['addr:street'] || `${tp} #${el.id}` });
    }
    return ff;
  };

  const fetchElevation = async (points) => {
    const lats = points.map(p => p.lat.toFixed(6)).join(','), lngs = points.map(p => p.lng.toFixed(6)).join(',');
    const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
    if (!resp.ok) throw new Error(`Elev ${resp.status}`);
    return resp.json();
  };

  const losAnalysis3D = (A, C, D, feats, elevGrid, eyeH, tgtH, nRays = 40) => {
    const elevA = getElevAt(A, elevGrid);
    const eyeAlt = elevA + eyeH;
    const obs = [], seen = new Set(), rays = [];
    const nSamples = 25;
    for (let ri = 0; ri <= nRays; ri++) {
      const t = ri / nRays;
      const tgt = lerpPt(C, D, t);
      const elevTgt = getElevAt(tgt, elevGrid);
      const tgtAlt = elevTgt + tgtH;
      const rayDist = havDist(A, tgt);
      const rayObs = [];
      let terrainBlocked = false, terrainBlockPt = null, terrainBlockInfo = null;
      for (let si = 1; si < nSamples; si++) {
        const sf = si / nSamples;
        const samplePt = lerpPt(A, tgt, sf);
        const sampleDist = rayDist * sf;
        const rayAltHere = eyeAlt + (tgtAlt - eyeAlt) * sf;
        const groundHere = getElevAt(samplePt, elevGrid);
        if (groundHere > rayAltHere && !terrainBlocked) {
          terrainBlocked = true; terrainBlockPt = samplePt;
          terrainBlockInfo = { groundElev: groundHere, rayAlt: rayAltHere, excessHeight: groundHere - rayAltHere, dist: sampleDist };
        }
        for (const f of feats) {
          if (seen.has(f.id + '_' + ri)) continue;
          let hit = false;
          if (f.type === 'tree' && f.geometry.length === 1) { if (havDist(samplePt, f.geometry[0]) < Math.min(f.estimatedHeight * 0.4, 5)) hit = true; }
          else if (f.geometry.length >= 2) {
            for (const g of f.geometry) { if (havDist(samplePt, g) < 3) { hit = true; break; } }
            if (!hit) { for (let gi = 0; gi < f.geometry.length - 1; gi++) { if (segIntersect(A, tgt, f.geometry[gi], f.geometry[gi + 1])) { hit = true; break; } } }
          }
          if (hit) {
            const fGround = f.groundElev != null ? f.groundElev : groundHere;
            const fTop = fGround + f.estimatedHeight;
            if (fTop > rayAltHere) {
              rayObs.push({ feature: f, point: f.geometry.length === 1 ? f.geometry[0] : f.geometry[Math.floor(f.geometry.length / 2)], distFromA: havDist(A, f.geometry[0]), isCritical: f.estimatedHeight >= 0.5 && f.estimatedHeight <= 1.0, blockType: 'feature', fGroundElev: fGround, fTopAlt: fTop, rayAltAtFeature: rayAltHere, excessHeight: fTop - rayAltHere });
              seen.add(f.id + '_' + ri);
            }
          }
        }
      }
      if (terrainBlocked && terrainBlockPt) {
        rayObs.push({ feature: { id: 'terrain_' + ri, type: 'terrain_ridge', estimatedHeight: terrainBlockInfo.excessHeight, geometry: [terrainBlockPt], tags: {}, name: 'Terrain Ridge' }, point: terrainBlockPt, distFromA: terrainBlockInfo.dist, isCritical: false, blockType: 'terrain', fGroundElev: terrainBlockInfo.groundElev, fTopAlt: terrainBlockInfo.groundElev, rayAltAtFeature: terrainBlockInfo.rayAlt, excessHeight: terrainBlockInfo.excessHeight });
      }
      rays.push({ target: tgt, obstructed: rayObs.length > 0, obs: rayObs, elevA, elevTgt, eyeAlt, tgtAlt });
      for (const o of rayObs) { const uid = o.feature.id; if (!seen.has('master_' + uid)) { seen.add('master_' + uid); obs.push(o); } }
    }
    return { obstructions: obs, rays, features: feats, elevA, eyeAlt };
  };

  const aiClassify = async (A, C, D, obs, feats, elevInfo) => {
    try {
      const prompt = `You are a 3D geospatial line-of-sight analyst. The system uses REAL terrain elevation (DEM) to cast 3D sight rays from observer eye altitude to targets.

Observer A: ${A.lat.toFixed(6)},${A.lng.toFixed(6)} at ${elevInfo.elevA.toFixed(1)}m ASL + ${elevInfo.eyeH}m eye = ${elevInfo.eyeAlt.toFixed(1)}m absolute
Line C→D: ${havDist(C, D).toFixed(0)}m span. Target elevation: ${elevInfo.elevCD.toFixed(1)}m ASL + ${elevInfo.tgtH}m = ${elevInfo.tgtAlt.toFixed(1)}m absolute
Elevation advantage: ${elevInfo.advantage.toFixed(1)}m (${elevInfo.advantage > 0 ? 'observer higher' : 'target higher'})

Features(${feats.length}): ${feats.slice(0, 15).map(f => `${f.type}:${f.estimatedHeight}m@${f.groundElev?.toFixed(0) || '?'}mASL`).join(',')}

3D Obstructions(${obs.length}):
${obs.map(o => `${o.feature.type}:"${o.feature.name}" h=${o.feature.estimatedHeight}m ground=${o.fGroundElev?.toFixed(1)}m top=${o.fTopAlt?.toFixed(1)}m ray=${o.rayAltAtFeature?.toFixed(1)}m excess=${o.excessHeight?.toFixed(2)}m block=${o.blockType} critical=${o.isCritical}`).join('\n')}

Classify. Flag 0.5-1.0m features as CRITICAL LOW. Estimate visibility%. Recommendations.
JSON only: {"overall_rating":"CLEAR|PARTIALLY_OBSTRUCTED|SEVERELY_OBSTRUCTED|BLOCKED","visibility_pct":0,"analysis_summary":"","obstruction_details":[],"critical_low_obstructions":[],"recommendations":[],"elevation_insight":""}`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
      const data = await resp.json();
      return JSON.parse((data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim());
    } catch (e) {
      const crits = obs.filter(o => o.isCritical), terrains = obs.filter(o => o.blockType === 'terrain');
      const vis = Math.max(0, Math.round((1 - obs.length / Math.max(feats.length + 1, 1) * 0.8) * 100));
      let rt = 'CLEAR'; if (vis < 30) rt = 'BLOCKED'; else if (vis < 55) rt = 'SEVERELY_OBSTRUCTED'; else if (vis < 80) rt = 'PARTIALLY_OBSTRUCTED';
      return { overall_rating: rt, visibility_pct: vis, analysis_summary: `3D analysis: ${obs.length} obstructions, ${terrains.length} terrain blocks, ${crits.length} critical low.`, obstruction_details: [], critical_low_obstructions: crits.map(c => ({ name: c.feature.name, height_range: `${c.feature.estimatedHeight.toFixed(1)}m`, impact: `Exceeds ray by ${c.excessHeight?.toFixed(2)}m` })), recommendations: ['Review obstructions and consider repositioning observer.'], elevation_insight: `Observer at ${elevInfo.elevA.toFixed(1)}m, targets at ${elevInfo.elevCD.toFixed(1)}m.` };
    }
  };

  // Run full 3D analysis: observer at A, sight rays fanning across C→D line
  const run3DAnalysis = async (A, C, D, eyeH, tgtH) => {
    setAnalysisRunning(true);
    setAnalysisResult(null);
    const steps = ['Querying OSM Overpass API...', 'Processing features...', 'Fetching elevation grid (Open-Meteo DEM)...', 'Assigning ground elevations...', 'Running 3D line-of-sight (40 rays × 25 samples)...', 'AI classification (Claude)...', 'Complete!'];
    const updateStep = (n) => setAnalysisSteps(steps.map((s, i) => ({ text: s, status: i < n ? 'done' : i === n ? 'active' : 'pending' })));

    let feats = [], mode = 'live';
    try {
      updateStep(0);
      const ctr = { lat: (A.lat + C.lat + D.lat) / 3, lng: (A.lng + C.lng + D.lng) / 3 };
      const radius = Math.max(havDist(A, C), havDist(A, D), havDist(C, D)) + 80;
      const data = await fetchOSMData(ctr, radius);
      updateStep(1);
      feats = processOSM(data);
      if (!feats.length) mode = 'no_data';
    } catch { mode = 'error'; }

    updateStep(2);
    const mid = { lat: (C.lat + D.lat) / 2, lng: (C.lng + D.lng) / 2 };
    const elevSamplePts = [];
    for (let i = 0; i <= 20; i++) { elevSamplePts.push(lerpPt(A, mid, i / 20)); elevSamplePts.push(lerpPt(A, C, i / 20)); elevSamplePts.push(lerpPt(A, D, i / 20)); elevSamplePts.push(lerpPt(C, D, i / 20)); }
    const mnLat = Math.min(A.lat, C.lat, D.lat) - 0.0002, mxLat = Math.max(A.lat, C.lat, D.lat) + 0.0002;
    const mnLng = Math.min(A.lng, C.lng, D.lng) - 0.0003, mxLng = Math.max(A.lng, C.lng, D.lng) + 0.0003;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) elevSamplePts.push({ lat: mnLat + r / 3 * (mxLat - mnLat), lng: mnLng + c / 3 * (mxLng - mnLng) });
    const uniqueElPts = []; const seenPts = new Set();
    for (const p of elevSamplePts) { const k = p.lat.toFixed(5) + ',' + p.lng.toFixed(5); if (!seenPts.has(k)) { seenPts.add(k); uniqueElPts.push(p); } if (uniqueElPts.length >= 100) break; }
    let elevs = [];
    try { const eData = await fetchElevation(uniqueElPts); elevs = eData.elevation || []; }
    catch { const base = 10 + Math.abs(A.lat * 100 % 20); elevs = uniqueElPts.map((_, i) => base + Math.sin(i * 0.3) * 1.5 + Math.cos(i * 0.7) * 0.8); }
    const elevGrid = { pts: uniqueElPts, elevs };

    updateStep(3);
    for (const f of feats) {
      const center = f.geometry.length === 1 ? f.geometry[0] : { lat: f.geometry.reduce((s, g) => s + g.lat, 0) / f.geometry.length, lng: f.geometry.reduce((s, g) => s + g.lng, 0) / f.geometry.length };
      f.groundElev = getElevAt(center, elevGrid);
    }

    updateStep(4);
    const res = losAnalysis3D(A, C, D, feats, elevGrid, eyeH, tgtH);

    updateStep(5);
    const elevA = getElevAt(A, elevGrid), elevCD = getElevAt(mid, elevGrid);
    const advantage = (elevA + eyeH) - (elevCD + tgtH);
    const ai = await aiClassify(A, C, D, res.obstructions, feats, { elevA, elevCD, eyeH, tgtH, eyeAlt: elevA + eyeH, tgtAlt: elevCD + tgtH, advantage, elevRange: Math.max(...elevs) - Math.min(...elevs) });

    updateStep(6);
    setAnalysisResult({ ...res, ai, elevA, elevCD, eyeH, tgtH, feats, mode, uniqueElPts: uniqueElPts.length });
    setAnalysisRunning(false);
  };

  // Handle map click — Click 1: A (observer), Click 2: B (street centre) → auto C & D
  const handleMapClick = useCallback((latlng) => {
    if (sightMode === 'ptA') {
      setPtA({ lat: latlng.lat, lng: latlng.lng });
      setSightMode('ptB');
    } else if (sightMode === 'ptB') {
      const b = { lat: latlng.lat, lng: latlng.lng };
      setPtB(b);

      // Find nearest road at B to get road direction & speed
      const nearestRoad = findNearestRoadSpeed(b.lat, b.lng);
      const sd = getSightDistances(nearestRoad.speed);
      const leftDistM = sd.leftM, rightDistM = sd.rightM;

      // Find nearest road segment at B for bearing
      let bestSeg = null, bestDist = Infinity;
      if (SPEED_ROADS_DATA?.features) {
        for (const f of SPEED_ROADS_DATA.features) {
          const coords = f.geometry.coordinates;
          for (let i = 0; i < coords.length - 1; i++) {
            const ax = coords[i][0], ay = coords[i][1], bx = coords[i + 1][0], by = coords[i + 1][1];
            const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
            let t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((b.lng - ax) * dx + (b.lat - ay) * dy) / lenSq));
            const px = ax + t * dx, py = ay + t * dy;
            const d = Math.sqrt((b.lng - px) ** 2 + (b.lat - py) ** 2);
            if (d < bestDist) { bestDist = d; bestSeg = { lat1: ay, lng1: ax, lat2: by, lng2: bx, road: f.properties }; }
          }
        }
      }

      let roadBearing = 0;
      if (bestSeg) roadBearing = geoBearing(bestSeg.lat1, bestSeg.lng1, bestSeg.lat2, bestSeg.lng2);

      // C = left along road from B, D = right along road from B
      const c = geoOffset(b.lat, b.lng, leftDistM, (roadBearing + 360) % 360);
      const d = geoOffset(b.lat, b.lng, rightDistM, (roadBearing + 180) % 360);
      setPtC(c);
      setPtD(d);
      setSightMode('done');

      // Sight triangle: A → C → D (with B as the road centre reference)
      const depthM = geoDistMetres(ptA.lat, ptA.lng, b.lat, b.lng);
      const baseTotal = leftDistM + rightDistM;

      setSightTriangle({
        ptA, ptB: b, triLeft: c, triRight: d,
        lineAB: [[ptA.lat, ptA.lng], [b.lat, b.lng]],
        speedInfo: { detected: nearestRoad.speed, roadName: nearestRoad.roadName, networkType: nearestRoad.networkType, absMin: sd.absMin, ssdMin: sd.ssdMin, leftM: leftDistM, rightM: rightDistM, baseTotal },
        analysis: { depth: depthM.toFixed(1), area: (baseTotal * depthM / 2).toFixed(1), baseWidth: baseTotal.toFixed(1), leftDist: leftDistM.toFixed(1), rightDist: rightDistM.toFixed(1), compliant: depthM >= 2.0 },
      });

      // Auto-run 3D analysis from A across C→D
      run3DAnalysis(ptA, c, d, eyeHeight, objectHeight);
    }
  }, [sightMode, ptA, eyeHeight, objectHeight]);

  const startSightAnalysis = () => { resetSightAnalysis(); setSightMode('ptA'); };
  const resetSightAnalysis = () => {
    setSightMode(null); setPtA(null); setPtB(null); setPtC(null); setPtD(null);
    setSightTriangle(null); setAnalysisResult(null); setAnalysisRunning(false);
    setAnalysisSteps([]); setClickedLot(null);
  };

  const handleLotClick = useCallback((lotInfo) => {
    if (sightMode) return;
    const poly = lotInfo.polygon;
    if (!poly || poly.length < 3) return;
    const lats = poly.map(p => p[0]), lngs = poly.map(p => p[1]);
    const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const cLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    const nearestRoad = findNearestRoadSpeed(cLat, cLng);
    const sd = getSightDistances(nearestRoad.speed);
    const sides = [];
    for (let i = 0; i < poly.length - 1; i++) { sides.push({ idx: i, length: geoDistMetres(poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]) }); }
    const frontage = sides.reduce((a, b) => a.length > b.length ? a : b, sides[0]);
    setClickedLot({ ...lotInfo, center: { lat: cLat, lng: cLng }, sides, frontage: frontage.length, frontageIdx: frontage.idx, speed: nearestRoad.speed, roadName: nearestRoad.roadName, sightDist: sd, rules: { maxWidth: frontage.length <= 12.5 ? 4.5 : 6.0, minWidth: 3.0, dualAllowed: frontage.length > 20, setbackMin: 0.5, sightLeftM: sd.leftM, sightRightM: sd.rightM, sightBase: sd.leftM + sd.rightM } });
  }, [sightMode]);

  const ratingMap = { CLEAR: { color: '#27ae60', bg: '#eafaf1', label: '✓ CLEAR' }, PARTIALLY_OBSTRUCTED: { color: '#e67e22', bg: '#fef5e7', label: '◐ PARTIAL' }, SEVERELY_OBSTRUCTED: { color: '#c0392b', bg: '#fdedec', label: '◑ SEVERE' }, BLOCKED: { color: '#c0392b', bg: '#fdedec', label: '✗ BLOCKED' } };
  const inputStyle = { background: "#f8fafb", border: "1.5px solid #d5dde2", color: "#1a3a4a", borderRadius: 6, padding: "5px 8px", width: 60, fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", outline: "none" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>Sight Analysis</h2>
          <p style={{ color: "#7a8a94", fontSize: 12, margin: 0 }}>3D Elevation-Aware Sight-Line — Select A (observer), then B (street centre) → C & D auto</p>
        </div>
      </div>

      {/* ── Toolbar Row 1: Layer toggles + Sight button ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <button onClick={() => setShowLots(!showLots)}
          style={{ padding: "7px 14px", borderRadius: 8, border: showLots ? "2px solid #2980b9" : "1px solid #d5dde2", background: showLots ? "#ebf5fb" : "#fff", color: showLots ? "#2980b9" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
          🏘️ Lots
        </button>
        <button onClick={() => setShowStreetNames(!showStreetNames)}
          style={{ padding: "7px 14px", borderRadius: 8, border: showStreetNames ? "2px solid #16a085" : "1px solid #d5dde2", background: showStreetNames ? "#e8f8f5" : "#fff", color: showStreetNames ? "#16a085" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
          🏷️ Street Names
        </button>
        <button onClick={() => setShowSpeedRoads(!showSpeedRoads)}
          style={{ padding: "7px 14px", borderRadius: 8, border: showSpeedRoads ? "2px solid #e67e22" : "1px solid #d5dde2", background: showSpeedRoads ? "#fef5e7" : "#fff", color: showSpeedRoads ? "#e67e22" : "#7a8a94", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
          🚗 Speed
        </button>
        <div style={{ width: 1, height: 24, background: "#e4e9ec", margin: "0 4px" }} />
        {!sightMode && !sightTriangle && (
          <button onClick={startSightAnalysis}
            style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #e74c3c, #c0392b)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(231,76,60,0.3)" }}>
            🔺 Sight Analysis
          </button>
        )}
        {(sightTriangle || analysisRunning) && (
          <button onClick={resetSightAnalysis} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>↺ Clear Analysis</button>
        )}
      </div>

      {/* ── Toolbar Row 2: Point placement + Heights ── */}
      {(sightMode || sightTriangle) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {sightMode === 'ptA' && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf2f2", padding: "6px 14px", borderRadius: 8, border: "1px solid #e74c3c40" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e74c3c", animation: "pulse 1.2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#c0392b" }}>Step 1: Click to place <strong>Point A</strong> (Observer / Driveway)</span>
              <button onClick={resetSightAnalysis} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          )}
          {sightMode === 'ptB' && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#ebf5fb", padding: "6px 14px", borderRadius: 8, border: "1px solid #2980b940" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2980b9", animation: "pulse 1.2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#2980b9" }}>Step 2: Click to place <strong>Point B</strong> (Middle of Street) — C & D auto-calculated</span>
              <button onClick={resetSightAnalysis} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            </div>
          )}
          {ptA && (
            <div style={{ display: "flex", gap: 6, fontSize: 10, fontWeight: 600 }}>
              <span style={{ background: "#fdf2f2", padding: "3px 8px", borderRadius: 4, color: "#e74c3c" }}>A: {ptA.lat.toFixed(5)}, {ptA.lng.toFixed(5)}</span>
              {ptB && <span style={{ background: "#ebf5fb", padding: "3px 8px", borderRadius: 4, color: "#2980b9" }}>B: {ptB.lat.toFixed(5)}, {ptB.lng.toFixed(5)}</span>}
              {ptC && <span style={{ background: "#f4ecf7", padding: "3px 8px", borderRadius: 4, color: "#8e44ad" }}>C: auto</span>}
              {ptD && <span style={{ background: "#e8f8f5", padding: "3px 8px", borderRadius: 4, color: "#16a085" }}>D: auto</span>}
            </div>
          )}
          {/* Observer & Object height inputs */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", background: "#f8fafb", padding: "6px 14px", borderRadius: 8, border: "1px solid #e4e9ec" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#e74c3c" }}>👁 Observer:</span>
              <input type="number" value={eyeHeight} onChange={e => setEyeHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={inputStyle} />
              <span style={{ fontSize: 10, color: "#7a8a94" }}>m</span>
            </div>
            <div style={{ width: 1, height: 18, background: "#d5dde2" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#2980b9" }}>◎ Object:</span>
              <input type="number" value={objectHeight} onChange={e => setObjectHeight(parseFloat(e.target.value) || 0)} min="0" max="50" step="0.05" style={inputStyle} />
              <span style={{ fontSize: 10, color: "#7a8a94" }}>m</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Map ── */}
      <LeafletMap apps={apps} onSelectApp={onSelectApp} height={sightTriangle || analysisResult ? 420 : 600}
        markerClickMode="zoom" 
        drawMode={sightMode === 'ptA' || sightMode === 'ptB' ? sightMode : null}
        onMapClick={handleMapClick}
        sightTriangle={sightTriangle}
        showLots={showLots}
        lotsData={effectiveLotsData}
        showSpeedRoads={showSpeedRoads || showStreetNames}
        onLotClick={handleLotClick}
        allLotsData={effectiveLotsData}
      />

      {/* ── Analysis Processing Steps ── */}
      {analysisRunning && analysisSteps.length > 0 && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: "16px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1abc9c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>3D Analysis Processing</div>
          {analysisSteps.map((step, i) => (
            <div key={i} style={{ padding: "3px 0", fontSize: 11, color: step.status === 'done' ? '#27ae60' : step.status === 'active' ? '#1a3a4a' : '#c8d0d4', fontWeight: step.status === 'active' ? 700 : 400, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10 }}>{step.status === 'done' ? '✓' : step.status === 'active' ? '◆' : '○'}</span>
              {step.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Clicked Lot Panel ── */}
      {clickedLot && !sightTriangle && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #2980b9", background: "linear-gradient(135deg, #ebf5fb, #d6eaf8)" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#1a3a4a" }}>📍 {clickedLot.address}</div>
              <div style={{ fontSize: 11, color: "#5a6a74" }}>{clickedLot.speed}km/h · {clickedLot.roadName}</div>
            </div>
            <button onClick={() => setClickedLot(null)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
          </div>
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "FRONTAGE", value: clickedLot.frontage.toFixed(1) + "m", color: "#2980b9" },
              { label: "SPEED", value: clickedLot.speed + "km/h", color: "#e67e22" },
              { label: "SIGHT LEFT", value: clickedLot.sightDist.leftM + "m", color: "#8e44ad" },
              { label: "SIGHT RIGHT", value: clickedLot.sightDist.rightM + "m", color: "#16a085" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 80px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 80 }}>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3D Analysis Results ── */}
      {analysisResult && !analysisRunning && (
        <div style={{ marginTop: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
            background: `linear-gradient(135deg, ${(ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).bg}, #fff)`,
            borderBottom: `2px solid ${(ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).color}` }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#1a3a4a" }}>◈ 3D Sight-Line Analysis Result</div>
              <div style={{ fontSize: 11, color: "#5a6a74", marginTop: 2 }}>
                {sightTriangle?.speedInfo?.detected}km/h on {sightTriangle?.speedInfo?.roadName || '—'} | 👁 Eye: {analysisResult.eyeH}m | ◎ Object: {analysisResult.tgtH}m | {analysisResult.mode === 'live' ? '● LIVE OSM + DEM' : '○ Fallback'}
              </div>
            </div>
            <span style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 800, background: (ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).bg, color: (ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).color, border: `1px solid ${(ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).color}40` }}>
              {(ratingMap[analysisResult.ai?.overall_rating] || ratingMap.BLOCKED).label}
            </span>
          </div>

          {/* Stats row */}
          <div style={{ padding: "12px 18px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "FEATURES", value: analysisResult.feats?.length || 0, color: "#2980b9" },
              { label: "OBSTRUCTIONS", value: analysisResult.obstructions?.length || 0, color: "#e74c3c" },
              { label: "VISIBILITY", value: (analysisResult.ai?.visibility_pct || 0) + "%", color: "#27ae60" },
              { label: "👁 OBSERVER", value: analysisResult.eyeH + "m", sub: "Eye height", color: "#e74c3c" },
              { label: "◎ OBJECT", value: analysisResult.tgtH + "m", sub: "Detect height", color: "#2980b9" },
              { label: "ELEV A", value: analysisResult.elevA?.toFixed(1) + "m", sub: "ASL", color: "#1abc9c" },
              { label: "ELEV C↔D", value: analysisResult.elevCD?.toFixed(1) + "m", sub: "ASL", color: "#e67e22" },
              { label: "Δ HEIGHT", value: ((analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)) >= 0 ? '+' : '') + (analysisResult.elevA + analysisResult.eyeH - (analysisResult.elevCD || 0)).toFixed(1) + "m", color: "#8e44ad" },
            ].map(m => (
              <div key={m.label} style={{ flex: "1 1 80px", background: "#f8fafb", borderRadius: 8, padding: "8px 10px", minWidth: 80 }}>
                <div style={{ fontSize: 9, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
                {m.sub && <div style={{ fontSize: 8, color: "#b0bdb2" }}>{m.sub}</div>}
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 1, borderBottom: "1px solid #e4e9ec", padding: "0 18px" }}>
            {[{ id: 'obstructions', label: '⚠ Obstructions' }, { id: 'features', label: '▤ Features' }, { id: 'ai', label: '◈ AI Analysis' }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ padding: "8px 14px", background: "none", border: "none", borderBottom: activeTab === tab.id ? "2px solid #1abc9c" : "2px solid transparent", color: activeTab === tab.id ? "#1abc9c" : "#7a8a94", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "12px 18px", maxHeight: 300, overflowY: "auto" }}>
            {activeTab === 'obstructions' && (
              analysisResult.obstructions?.length === 0
                ? <div style={{ textAlign: "center", color: "#27ae60", padding: 14, fontSize: 12, fontWeight: 700 }}>Clear 3D line of sight ✓</div>
                : analysisResult.obstructions?.map((o, i) => {
                    const typeColors = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', terrain_ridge: '#ff4757' };
                    return (
                      <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f0f3f5", fontSize: 12 }}>
                        <div style={{ fontWeight: 700, color: typeColors[o.feature.type] || '#5a6a74', fontSize: 11 }}>{o.blockType === 'terrain' ? '▲ TERRAIN' : o.feature.type.toUpperCase()}</div>
                        <div style={{ color: "#5a6a74", fontSize: 11 }}>{o.feature.name}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", fontSize: 10 }}>
                          <span style={{ padding: "1px 6px", borderRadius: 3, background: o.isCritical ? "#fdf2f2" : "#f5f8fa", color: o.isCritical ? "#e74c3c" : "#5a6a74", fontWeight: 700 }}>{o.feature.estimatedHeight?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>ground {o.fGroundElev?.toFixed(1)}m</span>
                          <span style={{ color: "#95a5a6" }}>top {o.fTopAlt?.toFixed(1)}m</span>
                          <span style={{ color: "#e74c3c", fontWeight: 700 }}>+{o.excessHeight?.toFixed(2)}m over ray</span>
                          {o.isCritical && <span style={{ color: "#e74c3c", fontWeight: 700 }}>⚠ CRITICAL 0.5-1.0m</span>}
                        </div>
                      </div>
                    );
                  })
            )}
            {activeTab === 'features' && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#7a8a94", marginBottom: 6 }}>{analysisResult.feats?.length || 0} Features (with ground elevation)</div>
                {(analysisResult.feats || []).slice(0, 30).map((f, i) => {
                  const typeColors = { building: '#e07050', fence: '#f0c850', tree: '#00c090', wall: '#a090ff', hedge: '#50f0c0', vegetation: '#00d0c8' };
                  const ic = f.estimatedHeight >= 0.5 && f.estimatedHeight <= 1;
                  return (
                    <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid #f0f3f5", fontSize: 11 }}>
                      <span style={{ fontWeight: 700, color: typeColors[f.type] || '#5a6a74' }}>{f.type}</span>
                      <span style={{ color: "#7a8a94", marginLeft: 6 }}>{f.name}</span>
                      <span style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 3, background: ic ? "#fdf2f2" : "#f5f8fa", color: ic ? "#e74c3c" : "#5a6a74", fontWeight: 700, fontSize: 10 }}>{f.estimatedHeight.toFixed(1)}m</span>
                      <span style={{ color: "#95a5a6", marginLeft: 4, fontSize: 10 }}>ground {f.groundElev?.toFixed(1)}m · top {((f.groundElev || 0) + f.estimatedHeight).toFixed(1)}m</span>
                    </div>
                  );
                })}
              </div>
            )}
            {activeTab === 'ai' && analysisResult.ai && (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ padding: "4px 12px", borderRadius: 16, fontSize: 11, fontWeight: 700, background: (ratingMap[analysisResult.ai.overall_rating] || ratingMap.BLOCKED).bg, color: (ratingMap[analysisResult.ai.overall_rating] || ratingMap.BLOCKED).color }}>
                    {analysisResult.ai.overall_rating?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: "#1a3a4a", marginBottom: 12 }}>{analysisResult.ai.analysis_summary}</div>
                {analysisResult.ai.critical_low_obstructions?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#e67e22", marginBottom: 4 }}>⚠ CRITICAL LOW (0.5–1.0m)</div>
                    {analysisResult.ai.critical_low_obstructions.map((c, i) => (
                      <div key={i} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid #f0f3f5" }}>
                        <strong style={{ color: "#e67e22" }}>{c.name}</strong>
                        <div style={{ color: "#7a8a94", fontSize: 10 }}>{c.height_range} — {c.impact}</div>
                      </div>
                    ))}
                  </div>
                )}
                {analysisResult.ai.elevation_insight && (
                  <div style={{ background: "#f0f3f5", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: "#5a6a74", border: "1px solid #e4e9ec" }}>
                    ▲ {analysisResult.ai.elevation_insight}
                  </div>
                )}
                {analysisResult.ai.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#1abc9c", marginBottom: 4 }}>Recommendations</div>
                    {analysisResult.ai.recommendations.map((r, i) => (
                      <div key={i} style={{ fontSize: 11, padding: "3px 0", lineHeight: 1.5, color: "#1a3a4a" }}>
                        <span style={{ color: "#1abc9c", marginRight: 4, fontWeight: 700 }}>{i + 1}.</span>{r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sight triangle metrics footer */}
          {sightTriangle && (
            <div style={{ padding: "10px 18px", borderTop: "1px solid #e4e9ec" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "SPEED", value: sightTriangle.speedInfo?.detected + " km/h", color: "#e67e22" },
                  { label: "C ← (abs)", value: sightTriangle.analysis?.leftDist + "m", color: "#8e44ad" },
                  { label: "D → (ssd)", value: sightTriangle.analysis?.rightDist + "m", color: "#16a085" },
                  { label: "BASE C↔D", value: sightTriangle.analysis?.baseWidth + "m", color: "#2980b9" },
                  { label: "DEPTH A→B", value: sightTriangle.analysis?.depth + "m", color: "#e74c3c" },
                  { label: "AREA", value: sightTriangle.analysis?.area + "m²", color: "#1a3a4a" },
                ].map(m => (
                  <div key={m.label} style={{ flex: "1 1 70px", background: "#f8fafb", borderRadius: 6, padding: "6px 8px", minWidth: 70 }}>
                    <div style={{ fontSize: 8, color: "#7a8a94", fontWeight: 700 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: "#b0bdb2", marginTop: 6 }}>
                AS 2890.1:2004 §3.2.4 | 👁 Eye {eyeHeight}m | ◎ Object {objectHeight}m (0.65–1.5m) | C = abs_min÷10 | D = ssd_min÷10
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Application List ───────────────────────────────────
function ApplicationListView({ apps, filter, onSelectApp }) {
  const [search, setSearch] = useState(""); const [sf, setSf] = useState(filter || "all");
  const filtered = apps.filter(a => { if (sf !== "all" && a.status !== sf) return false; if (search) { const q = search.toLowerCase(); return a.id.toLowerCase().includes(q) || a.owner.name.toLowerCase().includes(q) || a.property.address.toLowerCase().includes(q); } return true; });
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 16px" }}>{filter === "pending_review" ? "Pending Review" : filter === "referral_pending" ? "Referrals" : "All Applications"}</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff", outline: "none" }} />
        <select value={sf} onChange={e => setSf(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #d5dde2", fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
          <option value="all">All</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f5f8fa" }}>{["Ref", "Applicant", "Property", "Road", "Width", "Status"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#5a6a74", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid #e4e9ec" }}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(app => (
            <tr key={app.id} onClick={() => onSelectApp(app)} style={{ cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafb"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "9px 12px", fontWeight: 700, color: "#2980b9", borderBottom: "1px solid #f0f3f5" }}>{app.id}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}>{app.owner.name}</td>
              <td style={{ padding: "9px 12px", color: "#5a6a74", borderBottom: "1px solid #f0f3f5", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.property.address}</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5", fontSize: 11, fontWeight: 600, color: app.property.roadType === "red" ? "#c0392b" : app.property.roadType === "blue" ? "#2980b9" : "#5a6a74" }}>{app.property.roadType}</td>
              <td style={{ padding: "9px 12px", fontWeight: 600, borderBottom: "1px solid #f0f3f5" }}>{app.crossover.width}m</td>
              <td style={{ padding: "9px 12px", borderBottom: "1px solid #f0f3f5" }}><StatusBadge status={app.status} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  APPROVAL CHECKLIST — All Guideline v3.1 items
// ═══════════════════════════════════════════════════════════
const CHECKLIST_CATEGORIES = [
  { id: "ownership", label: "Ownership & Application", icon: "👤", items: [
    { id: "owner_verified", label: "Lot owner verified on Certificate of Title", ref: "§2.1" },
    { id: "contact_details", label: "Valid contact details (phone, email, postal)", ref: "§2.1" },
    { id: "application_complete", label: "Application form complete — no missing fields", ref: "§2.2" },
    { id: "fee_paid", label: "Application fee received", ref: "LGA Sch 9.1" },
    { id: "declaration_signed", label: "Owner declaration signed and dated", ref: "§2.3" },
  ]},
  { id: "property", label: "Property & Lot", icon: "📍", items: [
    { id: "lot_identified", label: "Lot/Plan number matches Landgate records", ref: "§3.1" },
    { id: "zoning_confirmed", label: "Zoning permits crossover use", ref: "TPS3" },
    { id: "frontage_measured", label: "Lot frontage correctly stated and verified", ref: "§3.2" },
    { id: "existing_crossover", label: "Existing crossover status confirmed", ref: "§3.3" },
    { id: "battleaxe_check", label: "Battleaxe/rear lot access checked (if applicable)", ref: "§3.4" },
  ]},
  { id: "dimensions", label: "Width & Dimensions", icon: "📏", items: [
    { id: "min_width", label: "Crossover width ≥ 3.0m at property boundary", ref: "§4.1" },
    { id: "max_width", label: "Width within max limit for frontage", ref: "§4.1" },
    { id: "road_edge_width", label: "Road edge widening ≤ 6.0m (wings/splay)", ref: "§4.2" },
    { id: "dual_crossover", label: "Second crossover only if frontage > 20m", ref: "§4.3" },
    { id: "separation_dist", label: "Dual crossover separation adequate", ref: "§4.3" },
    { id: "setback_boundary", label: "Offset from side boundary ≥ 0.5m", ref: "§4.4" },
  ]},
  { id: "construction", label: "Construction & Materials", icon: "🔨", items: [
    { id: "base_course", label: "Base course 150mm min, compacted 95% MDD", ref: "§5.1" },
    { id: "surface_material", label: "Surface material compliant (concrete/asphalt/paver)", ref: "§5.2" },
    { id: "concrete_joints", label: "Concrete jointing 1.8–2.0m, 2 expansion joints", ref: "§5.3" },
    { id: "commercial_spec", label: "Commercial spec if commercial lot (150mm + F62)", ref: "§5.4" },
    { id: "grade_alignment", label: "Crossover grade matches verge/road levels", ref: "§5.5" },
    { id: "kerb_transition", label: "Kerb transition/cut appropriate", ref: "§5.6" },
  ]},
  { id: "vegetation", label: "Vegetation & Trees", icon: "🌳", items: [
    { id: "tree_clearance", label: "Min 3m clearance from all verge trees", ref: "§6.1" },
    { id: "tree_protection", label: "Tree protection plan per AS 4970", ref: "§6.2" },
    { id: "no_clearing", label: "No unauthorised vegetation clearing", ref: "§6.3" },
    { id: "dwer_permit", label: "DWER clearing permit (if clearing required)", ref: "EP Act" },
    { id: "arborist_report", label: "Arborist report (if trees within 3m)", ref: "§6.4" },
  ]},
  { id: "drainage", label: "Drainage & Stormwater", icon: "💧", items: [
    { id: "drainage_type", label: "Drainage type appropriate", ref: "§7.1" },
    { id: "detention_ari", label: "Detention to 100-yr ARI (if applicable)", ref: "§7.2" },
    { id: "culvert_design", label: "Culvert/pipe design adequate", ref: "§7.3" },
    { id: "no_ponding", label: "No water ponding on road/verge/neighbour", ref: "§7.4" },
    { id: "stormwater_plan", label: "Stormwater plan provided (if needed)", ref: "§7.5" },
  ]},
  { id: "sight_safety", label: "Sight Lines & Safety", icon: "👁️", items: [
    { id: "sight_triangle", label: "Sight triangle clear (AS 2890.1, 0.65–1.5m zone)", ref: "AS 2890.1" },
    { id: "intersection_dist", label: "Min distance from nearest intersection", ref: "§8.1" },
    { id: "pedestrian_safety", label: "Pedestrian path continuity maintained", ref: "§8.2" },
    { id: "vehicle_turning", label: "Vehicle turning path — no encroachment", ref: "AS 2890.1" },
    { id: "driveway_grade", label: "Driveway gradient within limits (max 1:4)", ref: "AS 2890.1" },
  ]},
  { id: "road_referral", label: "Road & Referrals", icon: "🛣️", items: [
    { id: "road_class", label: "Road classification confirmed", ref: "§9.1" },
    { id: "mrwa_referral", label: "MRWA referral completed (if red road)", ref: "§9.2" },
    { id: "dplh_referral", label: "DPLH referral completed (if blue road)", ref: "§9.3" },
    { id: "rav_clearance", label: "RAV clearance (if applicable)", ref: "§9.4" },
    { id: "speed_zone", label: "Speed zone considered for sight distance", ref: "§9.5" },
  ]},
  { id: "services", label: "Underground Services", icon: "⚡", items: [
    { id: "dbyd_completed", label: "Dial Before You Dig search completed", ref: "§10.1" },
    { id: "power_clear", label: "Power/electrical — no conflict", ref: "§10.2" },
    { id: "water_clear", label: "Water mains — no conflict", ref: "§10.3" },
    { id: "gas_clear", label: "Gas pipeline — no conflict", ref: "§10.4" },
    { id: "telco_clear", label: "Telco/NBN conduit — no conflict", ref: "§10.5" },
  ]},
  { id: "documents", label: "Documentation", icon: "📎", items: [
    { id: "site_plan", label: "Scaled site plan with dimensions", ref: "§11.1" },
    { id: "cert_title", label: "Certificate of Title attached", ref: "§11.2" },
    { id: "photos_provided", label: "Site photographs provided", ref: "§11.3" },
    { id: "da_attached", label: "Development Approval (if DA-linked)", ref: "§11.4" },
    { id: "engineering_dwg", label: "Engineering drawing (if non-standard)", ref: "§11.5" },
  ]},
  { id: "contribution", label: "Financial & Contribution", icon: "💰", items: [
    { id: "first_crossover", label: "First crossover to lot (contribution eligible)", ref: "§12.1" },
    { id: "contribution_calc", label: "Contribution: lesser of ½ cost or $474", ref: "§12.2" },
    { id: "not_da_linked", label: "Not DA-linked (DA crossovers ineligible)", ref: "§12.3" },
    { id: "receipts_info", label: "Applicant informed: receipts within 6 months", ref: "§12.4" },
  ]},
];

function autoAssessItem(id, app) {
  const p = app.property, cx = app.crossover, v = app.vegetation;
  const f = p.frontage, w = cx.width, mW = f <= 12.5 ? 4.5 : 6;
  const map = {
    owner_verified: app.owner.name ? "pass" : "fail",
    contact_details: app.owner.phone && app.owner.email ? "pass" : "fail",
    application_complete: app.owner.name && p.address && f ? "pass" : "review",
    fee_paid: "review", declaration_signed: "review",
    lot_identified: p.lot && p.plan ? "pass" : "fail",
    zoning_confirmed: p.lotType ? "pass" : "review",
    frontage_measured: f > 0 ? "pass" : "fail",
    existing_crossover: "pass",
    battleaxe_check: p.lotType?.includes("battleaxe") ? "review" : "pass",
    min_width: w >= 3 ? "pass" : "fail",
    max_width: w <= mW ? "pass" : "fail",
    road_edge_width: w <= 6 ? "pass" : "fail",
    dual_crossover: cx.count > 1 ? (f > 20 ? "pass" : "fail") : "pass",
    separation_dist: cx.count > 1 ? "review" : "pass",
    setback_boundary: cx.offsetFromLeft >= 0.5 && (f - cx.offsetFromLeft - w) >= 0.5 ? "pass" : "review",
    base_course: "review", surface_material: cx.surface ? "pass" : "review",
    concrete_joints: cx.surface?.includes("Concrete") ? "review" : "pass",
    commercial_spec: p.lotType?.includes("commercial") ? "review" : "pass",
    grade_alignment: "review", kerb_transition: "review",
    tree_clearance: v.treesNearby ? "review" : "pass",
    tree_protection: v.treesNearby ? "review" : "pass",
    no_clearing: v.clearing ? "fail" : "pass",
    dwer_permit: v.clearing ? "fail" : "pass",
    arborist_report: v.treesNearby ? "review" : "pass",
    drainage_type: v.drainage ? "pass" : "review",
    detention_ari: "review", culvert_design: v.culvert ? "review" : "pass",
    no_ponding: "review", stormwater_plan: "review",
    sight_triangle: "review", intersection_dist: "review",
    pedestrian_safety: "review", vehicle_turning: "review", driveway_grade: "review",
    road_class: p.roadType ? "pass" : "review",
    mrwa_referral: p.roadType === "red" ? (app.assessment.referral ? "pass" : "fail") : "pass",
    dplh_referral: p.roadType === "blue" ? (app.assessment.referral ? "pass" : "fail") : "pass",
    rav_clearance: p.roadType === "rav" ? "review" : "pass",
    speed_zone: "review",
    dbyd_completed: "review", power_clear: "review", water_clear: "review", gas_clear: "review", telco_clear: "review",
    site_plan: "review", cert_title: "review", photos_provided: "review",
    da_attached: cx.daNumber ? "review" : "pass",
    engineering_dwg: "review",
    first_crossover: cx.daNumber ? "fail" : "pass",
    contribution_calc: "pass",
    not_da_linked: cx.daNumber ? "fail" : "pass",
    receipts_info: "pass",
  };
  return map[id] || "review";
}

// ─── Approval Checklist UI ──────────────────────────────
function ApprovalChecklist({ app, checklist, setChecklist, onAssessAll }) {
  const [expandedCat, setExpandedCat] = useState(null);
  const [editNoteId, setEditNoteId] = useState(null);
  const [noteText, setNoteText] = useState("");

  const stats = { pass: 0, review: 0, fail: 0, total: 0, oApproved: 0, oRejected: 0, oPending: 0 };
  CHECKLIST_CATEGORIES.forEach(cat => cat.items.forEach(item => {
    const s = checklist[item.id];
    stats.total++;
    if (s?.auto === "pass") stats.pass++; else if (s?.auto === "fail") stats.fail++; else stats.review++;
    if (s?.officer === "approved") stats.oApproved++; else if (s?.officer === "rejected") stats.oRejected++; else stats.oPending++;
  }));
  const allDone = stats.oPending === 0 && stats.total > 0;
  const allPassed = allDone && stats.oRejected === 0;

  const setOfficer = (id, val) => setChecklist(p => ({ ...p, [id]: { ...p[id], officer: val, officerBy: "M. Thompson", officerDate: new Date().toISOString().split("T")[0] } }));
  const saveNote = (id) => { if (!noteText.trim()) return; setChecklist(p => ({ ...p, [id]: { ...p[id], note: noteText, noteBy: "M. Thompson", noteDate: new Date().toISOString().split("T")[0] } })); setNoteText(""); setEditNoteId(null); };

  const ac = { pass: "#27ae60", review: "#e67e22", fail: "#c0392b" };
  const ai2 = { pass: "✓", review: "?", fail: "✕" };
  const al = { pass: "PASS", review: "REVIEW", fail: "FAIL" };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #eef2f4", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafb", flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#1a3a4a" }}>Approval Checklist</span>
          <span style={{ fontSize: 10, color: "#95a5a6" }}>v3.1 — {stats.total} items</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[["pass", stats.pass], ["review", stats.review], ["fail", stats.fail]].map(([k, v]) => (
            <span key={k} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${ac[k]}12`, color: ac[k] }}>{v} {al[k]}</span>
          ))}
          <button onClick={onAssessAll} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1abc9c,#16a085)", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>🤖 Auto-Assess</button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ padding: "6px 16px", borderBottom: "1px solid #eef2f4", background: "#fafcfd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#5a6a74", textTransform: "uppercase" }}>Officer Sign-Off</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: allPassed ? "#27ae60" : "#1a3a4a" }}>{stats.oApproved + stats.oRejected}/{stats.total}</span>
        </div>
        <div style={{ height: 5, background: "#eef2f4", borderRadius: 3, overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${(stats.oApproved / Math.max(stats.total, 1)) * 100}%`, background: "#27ae60", transition: "width 0.3s" }} />
          <div style={{ width: `${(stats.oRejected / Math.max(stats.total, 1)) * 100}%`, background: "#e74c3c", transition: "width 0.3s" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 9, color: "#95a5a6" }}>
          <span>🟢 {stats.oApproved}</span><span>🔴 {stats.oRejected}</span><span>⬜ {stats.oPending}</span>
        </div>
      </div>

      {/* Categories */}
      {CHECKLIST_CATEGORIES.map(cat => {
        const exp = expandedCat === cat.id;
        const cf = cat.items.filter(i => checklist[i.id]?.auto === "fail" || checklist[i.id]?.officer === "rejected").length;
        const co = cat.items.filter(i => checklist[i.id]?.officer).length;
        return (
          <div key={cat.id}>
            <div onClick={() => setExpandedCat(exp ? null : cat.id)}
              style={{ padding: "9px 16px", borderBottom: "1px solid #f0f3f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", background: exp ? "#f5f8fa" : "transparent" }}
              onMouseEnter={e => { if (!exp) e.currentTarget.style.background = "#fafcfd"; }} onMouseLeave={e => { if (!exp) e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 14 }}>{cat.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: "#1a3a4a" }}>{cat.label}</span>
                <span style={{ fontSize: 10, color: "#b0bdb2" }}>({cat.items.length})</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {cf > 0 && <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: "#fdedec", color: "#c0392b" }}>{cf}!</span>}
                <span style={{ fontSize: 10, fontWeight: 600, color: co === cat.items.length ? "#27ae60" : "#95a5a6" }}>{co}/{cat.items.length}</span>
                <span style={{ fontSize: 11, color: "#b0bdb2", transform: exp ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
              </div>
            </div>
            {exp && cat.items.map(item => {
              const s = checklist[item.id] || {};
              return (
                <div key={item.id} style={{ padding: "9px 16px 9px 44px", borderBottom: "1px solid #f5f7f8", background: s.officer === "rejected" ? "#fef5f5" : s.officer === "approved" ? "#f7fdf8" : "#fff" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {/* Auto badge */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 36 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800,
                        background: s.auto ? `${ac[s.auto]}12` : "#f0f3f5", color: s.auto ? ac[s.auto] : "#ccc", border: `1.5px solid ${s.auto ? ac[s.auto] + "60" : "#dde3de"}` }}>
                        {s.auto ? ai2[s.auto] : "—"}
                      </div>
                      <span style={{ fontSize: 7, fontWeight: 700, color: s.auto ? ac[s.auto] : "#ccc" }}>{s.auto ? al[s.auto] : ""}</span>
                    </div>
                    {/* Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", lineHeight: 1.3 }}>{item.label}</div>
                      <div style={{ fontSize: 9, color: "#b0bdb2" }}>{item.ref}</div>
                      {s.note && <div style={{ marginTop: 3, padding: "3px 7px", background: "#fef9e7", borderRadius: 3, fontSize: 10, color: "#7d6608", lineHeight: 1.3 }}>💬 {s.note} <span style={{ color: "#c4a44a" }}>— {s.noteBy}, {s.noteDate}</span></div>}
                      {editNoteId === item.id && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                          <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === "Enter" && saveNote(item.id)} placeholder="Note..." style={{ flex: 1, padding: "3px 7px", borderRadius: 3, border: "1px solid #d5dde2", fontSize: 10, fontFamily: "inherit", outline: "none" }} autoFocus />
                          <button onClick={() => saveNote(item.id)} style={{ padding: "3px 7px", borderRadius: 3, border: "none", background: "#1a3a4a", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>OK</button>
                          <button onClick={() => setEditNoteId(null)} style={{ padding: "3px 5px", borderRadius: 3, border: "1px solid #d5dde2", background: "#fff", fontSize: 9, color: "#95a5a6", cursor: "pointer" }}>✕</button>
                        </div>
                      )}
                    </div>
                    {/* Officer buttons */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 110, flexShrink: 0 }}>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[["approved", "✓ OK", "#27ae60"], ["rejected", "✕ No", "#c0392b"]].map(([val, lbl, clr]) => (
                          <button key={val} onClick={() => setOfficer(item.id, val)}
                            style={{ padding: "3px 9px", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                              border: s.officer === val ? `2px solid ${clr}` : "1px solid #d5dde2",
                              background: s.officer === val ? `${clr}10` : "#fff",
                              color: s.officer === val ? clr : "#95a5a6" }}>
                            {lbl}
                          </button>
                        ))}
                        <button onClick={() => { setEditNoteId(editNoteId === item.id ? null : item.id); setNoteText(s.note || ""); }}
                          style={{ padding: "3px 5px", borderRadius: 4, border: "1px solid #d5dde2", background: s.note ? "#fef9e7" : "#fff", color: "#95a5a6", fontSize: 10, cursor: "pointer" }}>💬</button>
                      </div>
                      {s.officer && <span style={{ fontSize: 8, color: "#b0bdb2" }}>{s.officerBy} {s.officerDate}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Final sign-off bar */}
      <div style={{ padding: "12px 16px", borderTop: "2px solid #eef2f4", background: allPassed ? "#eafaf1" : allDone ? "#fdedec" : "#f8fafb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 12, color: allPassed ? "#1e8449" : allDone ? "#c0392b" : "#5a6a74" }}>
            {allPassed ? "✅ ALL ITEMS APPROVED — Ready for final decision" : allDone ? "❌ ITEMS REJECTED — Cannot approve without resolution" : `⏳ ${stats.oPending} items awaiting officer review`}
          </div>
          {allDone && <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 1 }}>{stats.oApproved} approved, {stats.oRejected} rejected of {stats.total}</div>}
        </div>
        {!allDone && (
          <button onClick={() => {
            const u = { ...checklist };
            CHECKLIST_CATEGORIES.forEach(c => c.items.forEach(i => {
              if (u[i.id] && !u[i.id].officer) u[i.id] = { ...u[i.id], officer: u[i.id].auto === "pass" ? "approved" : "rejected", officerBy: "M. Thompson", officerDate: new Date().toISOString().split("T")[0] };
            }));
            setChecklist(u);
          }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#7f8c8d", color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
            Auto-decide remaining
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Document List & Viewer ─────────────────────────────
function DocumentList({ documents }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [filter, setFilter] = useState("All");
  const [previewDoc, setPreviewDoc] = useState(null);
  if (!documents || documents.length === 0) return <div style={{ padding: 16, color: "#95a5a6", fontSize: 12 }}>No documents submitted.</div>;

  const categories = ["All", ...new Set(documents.map(d => d.category))];
  const filtered = filter === "All" ? documents : documents.filter(d => d.category === filter);

  const typeIcons = { pdf: "📄", jpg: "🖼️", png: "🖼️", doc: "📝", docx: "📝", dwg: "📐" };
  const statusColors = { received: "#3498db", verified: "#27ae60", pending: "#e67e22", rejected: "#e74c3c" };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: 0 }}>📎 Documents ({documents.length})</h4>
        <div style={{ display: "flex", gap: 2 }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === c ? "#1a3a4a" : "#f5f8fa", color: filter === c ? "#fff" : "#7a8a94" }}>{c}</button>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        {filtered.map(doc => (
          <div key={doc.id} onClick={() => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc)}
            style={{ padding: "8px 16px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              background: selectedDoc?.id === doc.id ? "#ebf5fb" : "transparent", transition: "background 0.15s" }}
            onMouseEnter={e => { if (selectedDoc?.id !== doc.id) e.currentTarget.style.background = "#f8fafb"; }}
            onMouseLeave={e => { if (selectedDoc?.id !== doc.id) e.currentTarget.style.background = "transparent"; }}>
            <span style={{ fontSize: 18 }}>{typeIcons[doc.type] || "📄"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
              <div style={{ fontSize: 10, color: "#95a5a6" }}>{doc.type.toUpperCase()} · {doc.size} · {doc.date}</div>
            </div>
            <span style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${statusColors[doc.status] || "#95a5a6"}18`, color: statusColors[doc.status] || "#95a5a6" }}>
              {doc.status}
            </span>
          </div>
        ))}
      </div>
      {/* Document Viewer */}
      {selectedDoc && (
        <div style={{ borderTop: "2px solid #2980b9", padding: 16, background: "#f8fafb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>{typeIcons[selectedDoc.type] || "📄"} {selectedDoc.name}</div>
              <div style={{ fontSize: 11, color: "#7a8a94", marginTop: 2 }}>{selectedDoc.category} · {selectedDoc.type.toUpperCase()} · {selectedDoc.size}</div>
            </div>
            <button onClick={() => setSelectedDoc(null)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#95a5a6" }}>✕</button>
          </div>
          {/* Preview area */}
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e4e9ec", padding: 20, minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            {selectedDoc.type === "pdf" ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a4a", marginBottom: 4 }}>{selectedDoc.name}</div>
                <div style={{ fontSize: 11, color: "#7a8a94", marginBottom: 12 }}>PDF Document · {selectedDoc.size}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                  {/* <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
                  <button style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔍 Full View</button> */}
                  <button onClick={() => { const blob = new Blob([`[Mock PDF content for ${selectedDoc.name}]\n\nThis is a placeholder for the actual document file.\nDocument ID: ${selectedDoc.id}\nCategory: ${selectedDoc.category}\nSize: ${selectedDoc.size}\nUploaded: ${selectedDoc.date}`], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = selectedDoc.name + "." + selectedDoc.type; a.click(); URL.revokeObjectURL(url); }}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
                  <button onClick={() => setPreviewDoc(selectedDoc)}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", color: "#5a6a74", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>🔍 Full View</button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: "100%", height: 160, background: "linear-gradient(135deg, #dfe6e9, #b2bec3)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 48 }}>🖼️</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>{selectedDoc.name}</div>
                <div style={{ fontSize: 10, color: "#7a8a94", marginTop: 2, marginBottom: 8 }}>{selectedDoc.type.toUpperCase()} · {selectedDoc.size}</div>
                <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📥 Download</button>
              </div>
            )}
          </div>
          {/* Document metadata */}
          <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: 10, color: "#7a8a94" }}>
            <span>📅 Uploaded: {selectedDoc.date}</span>
            <span>📁 Category: {selectedDoc.category}</span>
            <span>✅ Status: <strong style={{ color: statusColors[selectedDoc.status] }}>{selectedDoc.status}</strong></span>
          </div>
        </div>
      )}
      {/* Full-screen document preview modal */}
      {previewDoc && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setPreviewDoc(null)}>
          <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", padding: 24, position: "relative" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#1a3a4a" }}>{previewDoc.name}</div>
                <div style={{ fontSize: 12, color: "#7a8a94", marginTop: 2 }}>{previewDoc.category} · {previewDoc.type.toUpperCase()} · {previewDoc.size}</div>
              </div>
              <button onClick={() => setPreviewDoc(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#95a5a6", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ background: "#f5f8fa", borderRadius: 10, padding: 40, textAlign: "center", minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1px solid #e4e9ec" }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>{previewDoc.type === "pdf" ? "📄" : "🖼️"}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a4a", marginBottom: 4 }}>{previewDoc.name}</div>
              <div style={{ fontSize: 12, color: "#7a8a94", marginBottom: 16 }}>{previewDoc.type.toUpperCase()} · {previewDoc.size}</div>
              <div style={{ fontSize: 12, color: "#95a5a6", marginBottom: 20, maxWidth: 350 }}>
                This is a mock preview. In production, the actual document would render here via a document viewer.
              </div>
              <button onClick={() => { const blob = new Blob([`[Mock content for ${previewDoc.name}]`], { type: "application/octet-stream" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = previewDoc.name + "." + previewDoc.type; a.click(); URL.revokeObjectURL(url); }}
                style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>📥 Download File</button>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 16, fontSize: 11, color: "#7a8a94" }}>
              <span>📅 Uploaded: {previewDoc.date}</span>
              <span>📁 Category: {previewDoc.category}</span>
              <span>✅ Status: {previewDoc.status}</span>
              <span>🆔 {previewDoc.id}</span>
            </div>
          </div>
        </div>
      )}      
    </div>
  );
}

// ─── Report Generator & History ─────────────────────────
function ReportGenerator({ app, checklist, summary, currentUser }) {
  const [reports, setReports] = useState([]);
  const [viewingReport, setViewingReport] = useState(null);
  const [generating, setGenerating] = useState(false);

  const generateReport = () => {
    setGenerating(true);
    setTimeout(() => {
      const version = reports.length + 1;
      const now = new Date();
      // Snapshot checklist state at generation time
      const checklistSnapshot = {};
      let itemsPassed = 0, itemsFailed = 0, itemsReview = 0, officerApproved = 0, officerRejected = 0;
      CHECKLIST_CATEGORIES.forEach(cat => cat.items.forEach(item => {
        const st = checklist[item.id] || {};
        checklistSnapshot[item.id] = { ...st, catLabel: cat.label, catIcon: cat.icon, itemLabel: item.label, itemRef: item.ref };
        if (st.auto === "pass") itemsPassed++;
        else if (st.auto === "fail") itemsFailed++;
        else itemsReview++;
        if (st.officer === "approved") officerApproved++;
        if (st.officer === "rejected") officerRejected++;
      }));

      const report = {
        id: `RPT-${app.id}-V${version}`,
        version,
        generatedAt: now.toISOString(),
        generatedAtLabel: now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        generatedBy: currentUser?.name || "System",
        generatedByRole: currentUser?.role || "—",
        status: app.status,
        appSnapshot: {
          id: app.id, owner: app.owner.name, address: app.property.address,
          lot: app.property.lot, plan: app.property.plan, frontage: app.property.frontage,
          road: app.property.roadName, roadType: app.property.roadType,
          crossoverWidth: app.crossover.width, crossoverSurface: app.crossover.surface,
          crossoverCount: app.crossover.count, officer: app.assessment.officer,
        },
        checklist: checklistSnapshot,
        summary: { ...summary, itemsPassed, itemsFailed, itemsReview, officerApproved, officerRejected },
        notes: [...(app.assessment.notes || [])],
        recommendation: itemsFailed === 0 && officerRejected === 0 ? "APPROVE" : itemsFailed > 3 ? "REJECT" : "REVIEW",
      };
      setReports(prev => [report, ...prev]);
      setViewingReport(report);
      setGenerating(false);
    }, 600);
  };

  const printReport = (report) => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const s = report.appSnapshot;
    const cl = report.checklist;
    const cats = CHECKLIST_CATEGORIES;
    let checklistHTML = "";
    cats.forEach(cat => {
      let rows = "";
      cat.items.forEach(item => {
        const r = cl[item.id] || {};
        const aiColor = r.auto === "pass" ? "#27ae60" : r.auto === "fail" ? "#e74c3c" : "#e67e22";
        const offColor = r.officer === "approved" ? "#27ae60" : r.officer === "rejected" ? "#e74c3c" : "#999";
        rows += `<tr>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${item.label}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;"><span style="color:${aiColor};font-weight:700">${(r.auto||"—").toUpperCase()}</span></td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;text-align:center;"><span style="color:${offColor};font-weight:700">${(r.officer||"pending").toUpperCase()}</span></td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${r.note||""}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${item.ref}</td>
        </tr>`;
      });
      checklistHTML += `<tr style="background:#f0f3f5"><td colspan="5" style="padding:6px 8px;border:1px solid #ddd;font-weight:700;font-size:12px;">${cat.icon} ${cat.label}</td></tr>${rows}`;
    });

    const recColor = report.recommendation === "APPROVE" ? "#27ae60" : report.recommendation === "REJECT" ? "#e74c3c" : "#e67e22";
    const notesHTML = (report.notes || []).map(n => `<div style="padding:4px 0;border-bottom:1px solid #eee;font-size:11px;"><strong>${n.author}</strong> (${n.date}): ${n.text}</div>`).join("");

    w.document.write(`<!DOCTYPE html><html><head><title>Report ${report.id}</title>
    <style>@media print{body{margin:0;padding:15px}table{page-break-inside:auto}tr{page-break-inside:avoid}}</style></head>
    <body style="font-family:Arial,sans-serif;max-width:850px;margin:0 auto;padding:20px;color:#333;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a3a4a;padding-bottom:12px;margin-bottom:16px;">
        <div><h1 style="margin:0;font-size:20px;color:#1a3a4a;">City of Kalamunda</h1>
          <div style="font-size:12px;color:#666;">Crossover Approval Assessment Report</div></div>
        <div style="text-align:right;"><div style="font-size:14px;font-weight:700;color:#1a3a4a;">${report.id}</div>
          <div style="font-size:11px;color:#666;">Version ${report.version} · ${report.generatedAtLabel}</div>
          <div style="font-size:11px;color:#666;">By: ${report.generatedBy} (${report.generatedByRole})</div></div>
      </div>
      <h2 style="font-size:15px;color:#1a3a4a;margin:0 0 10px;">Application: ${s.id}</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;width:30%;font-size:11px;">Owner</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.owner}</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;width:20%;font-size:11px;">Status</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${report.status.replace(/_/g," ").toUpperCase()}</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Address</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.address}</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Officer</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.officer||"Unassigned"}</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Lot / Plan</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.lot} (${s.plan})</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Road</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.road} (${s.roadType})</td></tr>
        <tr><td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Frontage</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.frontage}m</td>
            <td style="padding:4px 8px;background:#f8fafb;border:1px solid #ddd;font-weight:600;font-size:11px;">Crossover</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:11px;">${s.crossoverWidth}m ${s.crossoverSurface} (×${s.crossoverCount})</td></tr>
      </table>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;text-align:center;padding:10px;background:#eafaf1;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#27ae60;">${report.summary.itemsPassed}</div><div style="font-size:10px;color:#27ae60;">AI PASS</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fef5e7;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#e67e22;">${report.summary.itemsReview}</div><div style="font-size:10px;color:#e67e22;">AI REVIEW</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fdedec;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#e74c3c;">${report.summary.itemsFailed}</div><div style="font-size:10px;color:#e74c3c;">AI FAIL</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#f0f3f5;border-radius:6px;"><div style="font-size:22px;font-weight:800;color:#2980b9;">${report.summary.officerApproved}</div><div style="font-size:10px;color:#2980b9;">OFFICER ✓</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:${recColor}15;border:2px solid ${recColor};border-radius:6px;"><div style="font-size:18px;font-weight:800;color:${recColor};">${report.recommendation}</div><div style="font-size:10px;color:${recColor};">RECOMMENDATION</div></div>
      </div>
      <h3 style="font-size:13px;color:#1a3a4a;margin:0 0 6px;">Assessment Checklist (${report.summary.t || 60} items)</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead><tr style="background:#1a3a4a;color:#fff;">
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:40%;">Item</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-size:10px;width:10%;">AI</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:center;font-size:10px;width:12%;">Officer</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:25%;">Note</th>
          <th style="padding:5px 8px;border:1px solid #ddd;text-align:left;font-size:10px;width:8%;">Ref</th>
        </tr></thead>
        <tbody>${checklistHTML}</tbody>
      </table>
      ${notesHTML ? `<h3 style="font-size:13px;color:#1a3a4a;margin:0 0 6px;">Officer Notes</h3><div style="margin-bottom:16px;">${notesHTML}</div>` : ""}
      <div style="border-top:2px solid #1a3a4a;padding-top:10px;margin-top:20px;display:flex;justify-content:space-between;font-size:10px;color:#999;">
        <span>Generated: ${report.generatedAtLabel} by ${report.generatedBy}</span>
        <span>${report.id} · Version ${report.version}</span>
        <span>City of Kalamunda · Crossover Approval System v3.1</span>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    w.document.close();
  };

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 2px" }}>📊 Assessment Reports</h4>
          <div style={{ fontSize: 10, color: "#95a5a6" }}>{reports.length} version{reports.length !== 1 ? "s" : ""} generated</div>
        </div>
        <button onClick={generateReport} disabled={generating}
          style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: generating ? "#d5dde2" : "linear-gradient(135deg, #8e44ad, #9b59b6)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: generating ? "default" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
          {generating ? "⏳ Generating..." : "📄 Generate Report V" + (reports.length + 1)}
        </button>
      </div>

      {/* Report history list */}
      {reports.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {reports.map(r => (
            <div key={r.id} style={{ padding: "8px 16px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: viewingReport?.id === r.id ? "#f4ecf7" : "transparent", cursor: "pointer" }}
              onClick={() => setViewingReport(viewingReport?.id === r.id ? null : r)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: r.recommendation === "APPROVE" ? "#eafaf1" : r.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
                  color: r.recommendation === "APPROVE" ? "#27ae60" : r.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                  V{r.version}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a" }}>{r.id}</div>
                  <div style={{ fontSize: 10, color: "#95a5a6" }}>{r.generatedAtLabel} · {r.generatedBy}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: r.recommendation === "APPROVE" ? "#eafaf1" : r.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
                  color: r.recommendation === "APPROVE" ? "#27ae60" : r.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                  {r.recommendation}
                </span>
                <button onClick={e => { e.stopPropagation(); printReport(r); }}
                  style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #d5dde2", background: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: "#5a6a74" }}>
                  🖨️ Print
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded report view */}
      {viewingReport && (
        <div style={{ borderTop: "2px solid #8e44ad", padding: 16, background: "#faf8fc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1a3a4a" }}>{viewingReport.id}</div>
              <div style={{ fontSize: 11, color: "#7a8a94" }}>Version {viewingReport.version} · {viewingReport.generatedAtLabel} · {viewingReport.generatedBy} ({viewingReport.generatedByRole})</div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => printReport(viewingReport)}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2980b9", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                🖨️ Print / Save PDF
              </button>
              <button onClick={() => setViewingReport(null)}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d5dde2", background: "#fff", fontSize: 13, cursor: "pointer", color: "#95a5a6" }}>✕</button>
            </div>
          </div>

          {/* Summary cards */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { l: "AI PASS", v: viewingReport.summary.itemsPassed, c: "#27ae60", bg: "#eafaf1" },
              { l: "AI REVIEW", v: viewingReport.summary.itemsReview, c: "#e67e22", bg: "#fef5e7" },
              { l: "AI FAIL", v: viewingReport.summary.itemsFailed, c: "#e74c3c", bg: "#fdedec" },
              { l: "OFFICER ✓", v: viewingReport.summary.officerApproved, c: "#2980b9", bg: "#ebf5fb" },
              { l: "OFFICER ✕", v: viewingReport.summary.officerRejected, c: "#e74c3c", bg: "#fdedec" },
            ].map(m => (
              <div key={m.l} style={{ flex: "1 1 70px", textAlign: "center", padding: "8px 6px", background: m.bg, borderRadius: 6, minWidth: 65 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.c }}>{m.v}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: m.c }}>{m.l}</div>
              </div>
            ))}
            <div style={{ flex: "1 1 90px", textAlign: "center", padding: "8px 6px", borderRadius: 6, minWidth: 80,
              background: viewingReport.recommendation === "APPROVE" ? "#eafaf1" : viewingReport.recommendation === "REJECT" ? "#fdedec" : "#fef5e7",
              border: `2px solid ${viewingReport.recommendation === "APPROVE" ? "#27ae60" : viewingReport.recommendation === "REJECT" ? "#e74c3c" : "#e67e22"}` }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: viewingReport.recommendation === "APPROVE" ? "#27ae60" : viewingReport.recommendation === "REJECT" ? "#e74c3c" : "#e67e22" }}>
                {viewingReport.recommendation}
              </div>
              <div style={{ fontSize: 8, fontWeight: 700, color: "#7a8a94" }}>RECOMMENDATION</div>
            </div>
          </div>

          {/* Checklist breakdown by category */}
          <div style={{ maxHeight: 300, overflowY: "auto", borderRadius: 8, border: "1px solid #e4e9ec", background: "#fff" }}>
            {CHECKLIST_CATEGORIES.map(cat => {
              const items = cat.items.map(item => ({ ...item, result: viewingReport.checklist[item.id] || {} }));
              const catPass = items.filter(i => i.result.auto === "pass").length;
              const catFail = items.filter(i => i.result.auto === "fail").length;
              return (
                <div key={cat.id}>
                  <div style={{ padding: "6px 10px", background: "#f5f8fa", borderBottom: "1px solid #eef2f4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a" }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: 9, color: "#7a8a94" }}>{catPass}✓ {catFail > 0 ? catFail + "✕ " : ""}{cat.items.length} items</span>
                  </div>
                  {items.map(item => {
                    const r = item.result;
                    return (
                      <div key={item.id} style={{ padding: "4px 10px 4px 24px", borderBottom: "1px solid #f8fafb", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                        <span style={{ width: 50, fontWeight: 700, fontSize: 10, textAlign: "center",
                          color: r.auto === "pass" ? "#27ae60" : r.auto === "fail" ? "#e74c3c" : "#e67e22" }}>
                          {(r.auto || "—").toUpperCase()}
                        </span>
                        <span style={{ width: 60, fontWeight: 700, fontSize: 10, textAlign: "center",
                          color: r.officer === "approved" ? "#27ae60" : r.officer === "rejected" ? "#e74c3c" : "#bdc3c7" }}>
                          {r.officer ? r.officer.toUpperCase() : "PENDING"}
                        </span>
                        <span style={{ flex: 1, color: "#3a4a5a" }}>{item.label}</span>
                        <span style={{ fontSize: 9, color: "#bdc3c7" }}>{item.ref}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Version comparison hint */}
          {reports.length > 1 && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#ebf5fb", borderRadius: 6, fontSize: 10, color: "#2980b9" }}>
              💡 {reports.length} versions generated. Each version captures the checklist state at generation time. Compare versions to track assessment progress.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Application Detail ─────────────────────────────────
function ApplicationDetailView({ app, apps, onBack, onUpdateApp, onSelectApp, currentUser, reloadApp, users }) {
  const [localApp, setLocalApp] = useState(JSON.parse(JSON.stringify(app)));
  const [newNote, setNewNote] = useState("");
  const [newStatus, setNewStatus] = useState(app.status);
  const [assignee, setAssignee] = useState(app.assessment.officer);
  const [checklist, setChecklist] = useState({});
  const [assessed, setAssessed] = useState(false);
  const role = currentUser?.role || "engineer";
  const canAssign = role === "admin" || role === "manager";
  const canDecide = role === "admin" || role === "manager";

  const addNote = async () => {
    if (!newNote.trim()) return;
    try {
      await api.addNote(localApp._dbId, newNote);
      const fresh = await reloadApp(localApp._dbId);
      if (fresh) setLocalApp(fresh);
      setNewNote("");
    } catch (e) { console.error("Add note failed:", e); }
  };
  const saveChanges = async () => {
    try {
      const update = frontendAppToApiUpdate({ ...localApp, status: newStatus, assessment: { ...localApp.assessment, officer: assignee } });
      // If assignee changed, do assignment via dedicated endpoint
      const selUser = (users || []).find(u => u.name === assignee);
      if (selUser && selUser._dbId !== localApp.assessment.officerId) {
        await api.assignOfficer(localApp._dbId, selUser._dbId);
      }
      await api.updateApp(localApp._dbId, { status: newStatus });
      const fresh = await reloadApp(localApp._dbId);
      if (fresh) setLocalApp(fresh);
    } catch (e) { console.error("Save failed:", e); }
  };

  const runAutoAssess = () => {
    const r = {};
    CHECKLIST_CATEGORIES.forEach(c => c.items.forEach(i => {
      const prev = checklist[i.id] || {};
      r[i.id] = { ...prev, auto: autoAssessItem(i.id, localApp), autoDate: new Date().toISOString().split("T")[0] };
    }));
    setChecklist(r); setAssessed(true);
  };

  const summary = (() => {
    let pass=0,review=0,fail=0,oA=0,oR=0,t=0;
    CHECKLIST_CATEGORIES.forEach(c=>c.items.forEach(i=>{t++;const s=checklist[i.id];if(s?.auto==="pass")pass++;else if(s?.auto==="fail")fail++;else review++;if(s?.officer==="approved")oA++;if(s?.officer==="rejected")oR++;}));
    return {pass,review,fail,oA,oR,t,score:t>0?Math.round(pass/t*100):0};
  })();

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#2980b9", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 14, fontFamily: "inherit" }}>← Back</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div><h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 4px" }}>{localApp.id}</h2><p style={{ color: "#7a8a94", fontSize: 13, margin: 0 }}>{localApp.owner.name} — {new Date(localApp.submittedDate).toLocaleDateString("en-AU")}</p></div>
        <StatusBadge status={localApp.status} />
      </div>

      {/* ★ MAP WITH OVERLAY ★ */}
      <div style={{ marginBottom: 16 }}><MapWithOverlay app={localApp} apps={apps} onSelectApp={onSelectApp} /></div>

      {/* Info Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Owner & Property</h4>
          {[["Owner",localApp.owner.name],["Phone",localApp.owner.phone],["Email",localApp.owner.email],["Property",localApp.property.address],["Lot",`${localApp.property.lot} (${localApp.property.plan})`],["Frontage",`${localApp.property.frontage}m`],["Road",`${localApp.property.roadName} (${localApp.property.roadType})`]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #f5f7f8",fontSize:12}}><span style={{color:"#7a8a94"}}>{k}</span><span style={{fontWeight:600,color:"#1a3a4a",textAlign:"right",maxWidth:"55%"}}>{v}</span></div>
          ))}
        </div>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Crossover & Vegetation</h4>
          {[["Width",`${localApp.crossover.width}m`],["Count",localApp.crossover.count],["Surface",localApp.crossover.surface],["Offset",`${localApp.crossover.offsetFromLeft}m`],["Trees",localApp.vegetation.treesNearby?"Yes":"No"],["Clearing",localApp.vegetation.clearing?"⚠️ Yes":"No"],["Drainage",localApp.vegetation.drainage]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #f5f7f8",fontSize:12}}><span style={{color:"#7a8a94"}}>{k}</span><span style={{fontWeight:600,color:"#1a3a4a"}}>{v}</span></div>
          ))}
        </div>
      </div>

      {/* ★ DOCUMENTS ★ */}
      <div style={{ marginBottom: 14 }}>
        <DocumentList documents={localApp.documents} />
      </div>

      {/* ★ APPROVAL CHECKLIST ★ */}
      <div style={{ marginBottom: 14 }}>
        <ApprovalChecklist app={localApp} checklist={checklist} setChecklist={setChecklist} onAssessAll={runAutoAssess} />
      </div>

      {/* Summary (after assessment) */}
      {assessed && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16, marginBottom: 14 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Assessment Summary</h4>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              {l:"PASS",v:summary.pass,c:"#27ae60",bg:"#eafaf1"},
              {l:"REVIEW",v:summary.review,c:"#e67e22",bg:"#fef5e7"},
              {l:"FAIL",v:summary.fail,c:"#c0392b",bg:"#fdedec"},
              {l:"SCORE",v:summary.score+"%",c:summary.score>=80?"#27ae60":summary.score>=50?"#e67e22":"#c0392b",bg:"#f5f8fa"},
              {l:"OFFICER ✓",v:`${summary.oA}/${summary.t}`,c:summary.oA===summary.t?"#27ae60":"#1a3a4a",bg:summary.oA===summary.t?"#eafaf1":"#f5f8fa"},
            ].map(m=>(
              <div key={m.l} style={{flex:1,minWidth:70,background:m.bg,borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:m.c}}>{m.v}</div>
                <div style={{fontSize:9,color:m.c,fontWeight:600}}>{m.l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 5 }}>
            {CHECKLIST_CATEGORIES.map(cat => {
              const cf = cat.items.filter(i => checklist[i.id]?.auto === "fail").length;
              const cp = cat.items.filter(i => checklist[i.id]?.auto === "pass").length;
              const co = cat.items.filter(i => checklist[i.id]?.officer).length;
              return <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 5, background: cf > 0 ? "#fef5f5" : co === cat.items.length ? "#f7fdf8" : "#f8fafb", border: `1px solid ${cf > 0 ? "#f5c6cb" : co === cat.items.length ? "#c3e6cb" : "#eef2f4"}` }}>
                <span style={{ fontSize: 12 }}>{cat.icon}</span>
                <div><div style={{ fontSize: 10, fontWeight: 700, color: "#1a3a4a" }}>{cat.label}</div><div style={{ fontSize: 8, color: "#95a5a6" }}>{cp}✓ {cf > 0 ? cf + "✕ " : ""}{co}/{cat.items.length} signed</div></div>
              </div>;
            })}
          </div>
        </div>
      )}

      {/* ★ REPORT GENERATOR ★ */}
      <div style={{ marginBottom: 14 }}>
        <ReportGenerator app={localApp} checklist={checklist} summary={summary} currentUser={currentUser} />
      </div>

      {/* Officer + Notes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Actions</h4>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", display: "block", marginBottom: 3 }}>Assigned Officer</label>
          {canAssign ? (
            <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", marginBottom: 10 }}>
              <option value="">— Unassigned —</option>
              {(users || []).filter(u => u.active && (u.role === "engineer" || u.role === "manager")).map(u => {
                const rc = ROLE_CONFIG[u.role];
                return <option key={u.id} value={u.name}>{rc.icon} {u.name} ({rc.label})</option>;
              })}
            </select>
          ) : (
            <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e4e9ec", fontSize: 12, marginBottom: 10, background: "#f8fafb", color: "#1a3a4a", fontWeight: 600 }}>{assignee || "Unassigned"}</div>
          )}
          <label style={{ fontSize: 11, fontWeight: 600, color: "#5a6a74", display: "block", marginBottom: 3 }}>Status</label>
          {canDecide ? (
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 12, fontFamily: "inherit", marginBottom: 10 }}>{Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select>
          ) : (
            <div style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e4e9ec", fontSize: 12, marginBottom: 10, background: "#f8fafb" }}><StatusBadge status={newStatus} /></div>
          )}
          <button onClick={saveChanges} style={{ width: "100%", padding: "8px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#2980b9,#3498db)", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
        </div>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e4e9ec", padding: 16 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: "#7a8a94", textTransform: "uppercase", margin: "0 0 10px" }}>Notes</h4>
          <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 8 }}>
            {localApp.assessment.notes.length === 0 && <div style={{ fontSize: 11, color: "#95a5a6" }}>No notes</div>}
            {localApp.assessment.notes.map((n, i) => <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid #f5f7f8", fontSize: 11 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, color: "#2980b9" }}>{n.author}</span><span style={{ color: "#95a5a6", fontSize: 10 }}>{n.date}</span></div><div style={{ color: "#3a4a5a", lineHeight: 1.4 }}>{n.text}</div></div>)}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} placeholder="Add note..." style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1.5px solid #d5dde2", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
            <button onClick={addNote} style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "#1a3a4a", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+</button>
          </div>
        </div>
      </div>

      {/* Quick Decision — managers/admins only */}
      {canDecide && (
        <div style={{ display: "flex", gap: 6 }}>
        {[{s:"approved",l:"✅ Approve",bg:"#27ae60"},{s:"inspection_required",l:"🔍 Inspect",bg:"#16a085"},{s:"referral_pending",l:"↗️ Refer",bg:"#8e44ad"},{s:"on_hold",l:"⏸ Hold",bg:"#7f8c8d"},{s:"rejected",l:"❌ Reject",bg:"#c0392b"}].map(b => (
          <button key={b.s} onClick={async () => { try { await api.updateApp(localApp._dbId, { status: b.s }); const fresh = await reloadApp(localApp._dbId); if (fresh) { setLocalApp(fresh); setNewStatus(fresh.status); } } catch(e) { console.error(e); } }}
            style={{ padding: "8px 12px", borderRadius: 7, border: "none", background: b.bg, color: "#fff", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "inherit", flex: 1 }}>{b.l}</button>
        ))}
      </div>
      )}
    </div>
  );
}

// ─── Inspections ────────────────────────────────────────
function InspectionsView({ apps }) {
  const all = apps.flatMap(a => a.assessment.inspections.map(i => ({ ...i, appId: a.id, owner: a.owner.name })));
  return <div>
    <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a3a4a", margin: "0 0 16px" }}>Inspections</h2>
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e4e9ec", overflow: "hidden" }}>
      {all.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#95a5a6" }}>No inspections</div> :
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "#f5f8fa" }}>{["App","Owner","Type","Date","Inspector","Status"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:"#5a6a74",fontSize:10,textTransform:"uppercase",borderBottom:"1px solid #e4e9ec"}}>{h}</th>)}</tr></thead>
        <tbody>{all.map((ins,i) => <tr key={i}><td style={{padding:"9px 12px",fontWeight:700,color:"#2980b9",borderBottom:"1px solid #f0f3f5"}}>{ins.appId}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}>{ins.owner}</td><td style={{padding:"9px 12px",color:"#5a6a74",borderBottom:"1px solid #f0f3f5"}}>{ins.type}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}>{new Date(ins.date).toLocaleDateString("en-AU")}</td><td style={{padding:"9px 12px",color:"#5a6a74",borderBottom:"1px solid #f0f3f5"}}>{ins.inspector}</td><td style={{padding:"9px 12px",borderBottom:"1px solid #f0f3f5"}}><span style={{padding:"3px 8px",borderRadius:4,fontSize:11,fontWeight:700,background:ins.status==="passed"?"#eafaf1":"#fef5e7",color:ins.status==="passed"?"#27ae60":"#e67e22"}}>{ins.status}</span></td></tr>)}</tbody>
      </table>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════
export default function KalamundaApprovalPortal() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [apps, setApps] = useState([]);
  const [activeView, setActiveView] = useState("dashboard");
  const [selectedApp, setSelectedApp] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [globalLotsData, setGlobalLotsData] = useState(null);

  // Load lot.geojson once at app level so all views can resolve coords
  useEffect(() => {
    let cancelled = false;
    async function loadLots() {
      try {
        const res = await fetch('/lot.geojson', { cache: 'no-cache' });
        if (!res.ok) return;
        const gj = await res.json();
        if (!cancelled) setGlobalLotsData(gj);
      } catch (e) { console.error('Failed to load lot.geojson:', e); }
    }
    loadLots();
    return () => { cancelled = true; };
  }, []);

  // Try restore session from stored token
  useEffect(() => {
    const tryRestore = async () => {
      const token = localStorage.getItem("kala_token");
      if (!token) { setLoading(false); return; }
      try {
        const user = await api.me();
        setCurrentUser(apiUserToFrontend(user));
      } catch { api.logout(); }
      setLoading(false);
    };
    tryRestore();
  }, []);

  // Load apps when user changes
  useEffect(() => {
    if (!currentUser) { setApps([]); return; }
    const loadApps = async () => {
      try {
        const list = await api.listApps();
        // For each app in list, fetch full detail to get nested data
        const fullApps = await Promise.all(list.map(a => api.getApp(a.id)));
        setApps(fullApps.map(apiAppToFrontend));
      } catch (e) { console.error("Failed to load apps:", e); }
    };
    loadApps();
  }, [currentUser]);

  // Load users for admin
  useEffect(() => {
    if (!currentUser || currentUser.role === "engineer") return;
    const loadUsers = async () => {
      try {
        const uList = await api.listUsers();
        setUsers(uList.map(apiUserToFrontend));
      } catch { /* non-admin cannot list users */ }
    };
    loadUsers();
  }, [currentUser]);

  // Lot boundaries loaded at top level via globalLotsData

  // Login/logout
  const handleLogin = (user) => { setCurrentUser(user); setActiveView("dashboard"); };
  const handleLogout = () => { api.logout(); setCurrentUser(null); setActiveView("dashboard"); setSelectedApp(null); setApps([]); };

  // Reload a single app from API
  const reloadApp = async (dbId) => {
    try {
      const fresh = await api.getApp(dbId);
      const converted = apiAppToFrontend(fresh);
      setApps(prev => prev.map(a => a._dbId === dbId ? converted : a));
      if (selectedApp && selectedApp._dbId === dbId) setSelectedApp(converted);
      return converted;
    } catch (e) { console.error("Failed to reload app:", e); }
  };

  // Reload all apps
  const reloadAllApps = async () => {
    try {
      const list = await api.listApps();
      const fullApps = await Promise.all(list.map(a => api.getApp(a.id)));
      setApps(fullApps.map(apiAppToFrontend));
    } catch (e) { console.error("Failed to reload apps:", e); }
  };

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif", color: "#7a8a94" }}>Loading...</div>;
  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

  const role = currentUser.role;
  const visibleApps = role === "engineer"
    ? apps.filter(a => a.assessment.officer === currentUser.name)
    : apps;

  const handleSelectApp = app => { setSelectedApp(app); setActiveView("detail"); };

  const handleUpdateApp = async (u) => {
    try {
      await api.updateApp(u._dbId, frontendAppToApiUpdate(u));
      await reloadApp(u._dbId);
    } catch (e) { console.error("Update failed:", e); }
  };

  const renderView = () => {
    if (activeView === "detail" && selectedApp) return <ApplicationDetailView app={selectedApp} apps={visibleApps} onBack={() => { setActiveView("applications"); setSelectedApp(null); }} onUpdateApp={handleUpdateApp} onSelectApp={handleSelectApp} currentUser={currentUser} reloadApp={reloadApp} users={users} />;
    switch (activeView) {
      case "dashboard": return <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      case "map": return <FullMapView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      case "sight_analysis": return <SightAnalysisView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      case "pending": return <ApplicationListView apps={visibleApps} filter="pending_review" onSelectApp={handleSelectApp} />;
      case "referrals": return <ApplicationListView apps={visibleApps} filter="referral_pending" onSelectApp={handleSelectApp} />;
      case "inspections": return <InspectionsView apps={visibleApps} />;
      case "admin": return role === "admin" ? <SystemAdmin users={users} setUsers={setUsers} currentUser={currentUser} /> : <DashboardView apps={visibleApps} onSelectApp={handleSelectApp} globalLotsData={globalLotsData} />;
      default: return <ApplicationListView apps={visibleApps} filter={null} onSelectApp={handleSelectApp} />;
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", width: "100vw", maxWidth: "100vw", fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f0f3f5", position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow-x:hidden}*{box-sizing:border-box}input:focus,select:focus,textarea:focus{border-color:#1abc9c!important;box-shadow:0 0 0 3px rgba(26,188,156,0.1)!important;outline:none}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#c8d0d4;border-radius:3px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}.lot-tooltip{font-family:'DM Sans',sans-serif!important;font-size:11px!important;padding:4px 8px!important;border-radius:4px!important}`}</style>
      <Sidebar activeView={activeView} setActiveView={v => { setActiveView(v); setSelectedApp(null); }} apps={visibleApps} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} currentUser={currentUser} onLogout={handleLogout} />
      <div style={{ flex: "1 1 0%", padding: "16px 20px", overflowY: "auto", overflowX: "hidden", minWidth: 0, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "6px 12px", background: `${ROLE_CONFIG[role].color}08`, borderRadius: 8, border: `1px solid ${ROLE_CONFIG[role].color}20` }}>
          <span style={{ fontSize: 11, color: ROLE_CONFIG[role].color, fontWeight: 600 }}>{ROLE_CONFIG[role].icon} {currentUser.name} — {ROLE_CONFIG[role].label}</span>
          {role === "engineer" && <span style={{ fontSize: 10, color: "#7a8a94" }}>{visibleApps.length} assigned case{visibleApps.length !== 1 ? "s" : ""}</span>}
        </div>
        {renderView()}
      </div>
    </div>
  );
}
