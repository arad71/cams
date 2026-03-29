// ═══════════════════════════════════════════════════════════
//  COUNCIL — CROSSOVER APPROVAL SYSTEM v3
//  Static UI configuration constants
//  NOTE: Assessment categories/items now come from the API
//  NOTE: Speed roads data now loaded from /speed_roads.geojson
// ═══════════════════════════════════════════════════════════

export const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
export const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

export const TILE_LAYERS = {
  street: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '&copy; OpenStreetMap', label: "Street" },
  satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: '&copy; Esri', label: "Satellite" },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: '&copy; OpenTopoMap', label: "Topo" },
  detail: { url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", attr: '&copy; Google', label: "Detail" },
};

export const STATUS_CONFIG = {
  pending_review: { label: "Pending Review", color: "#e67e22", bg: "#fef5e7", icon: "⏳", mapColor: "#e67e22" },
  under_assessment: { label: "Under Assessment", color: "#2980b9", bg: "#ebf5fb", icon: "📋", mapColor: "#2980b9" },
  referral_pending: { label: "Referral Pending", color: "#8e44ad", bg: "#f4ecf7", icon: "↗️", mapColor: "#8e44ad" },
  inspection_required: { label: "Inspection Required", color: "#16a085", bg: "#e8f8f5", icon: "🔍", mapColor: "#16a085" },
  approved: { label: "Approved", color: "#27ae60", bg: "#eafaf1", icon: "✅", mapColor: "#27ae60" },
  rejected: { label: "Rejected", color: "#c0392b", bg: "#fdedec", icon: "❌", mapColor: "#c0392b" },
  on_hold: { label: "On Hold", color: "#7f8c8d", bg: "#f2f3f4", icon: "⏸", mapColor: "#7f8c8d" },
};

export const ROLE_CONFIG = {
  admin: { label: "Administrator", icon: "🛡️", color: "#e74c3c", permissions: ["all"] },
  manager: { label: "Manager", icon: "👔", color: "#2980b9", permissions: ["view_all", "assign", "approve", "refer", "reject"] },
  engineer: { label: "Engineer", icon: "🔧", color: "#27ae60", permissions: ["view_assigned", "assess", "note", "inspect"] },
  viewer: { label: "Viewer", icon: "👁", color: "#7f8c8d", permissions: ["view_all"] },
};

// ─── Sight Distance Table (AS 2890.1 / Austroads) ──────
export const SIGHT_DISTANCE_TABLE = [
  { speed: 40, abs_min: 30, ssd_min: 55 },
  { speed: 50, abs_min: 40, ssd_min: 69 },
  { speed: 60, abs_min: 55, ssd_min: 83 },
  { speed: 70, abs_min: 70, ssd_min: 97 },
  { speed: 80, abs_min: 95, ssd_min: 111 },
  { speed: 90, abs_min: 125, ssd_min: 130 },
  { speed: 100, abs_min: 139, ssd_min: 160 },
  { speed: 110, abs_min: 153, ssd_min: 190 },
];
