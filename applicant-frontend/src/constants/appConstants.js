// Steps shown in the UI wizard
export const STEPS = [
  { id: 0, label: "Welcome", icon: "🏠" },
  { id: 1, label: "Owner Details", icon: "👤" },
  { id: 2, label: "Property Info", icon: "📍" },
  { id: 3, label: "Crossover Design", icon: "📐" },
  { id: 4, label: "Vegetation & Drainage", icon: "🌳" },
  { id: 5, label: "Documents", icon: "📎" },
  { id: 6, label: "AI Review", icon: "🤖" },
  { id: 7, label: "Submit", icon: "✅" },
];

// File upload constraints
export const ACCEPTED_EXT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.dwg,.dxf";
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// Status dictionary used for badges, etc.
export const STATUS_LABELS = {
  draft:          { label: "Draft",          color: "#95a5a6", icon: "📝" },
  submitted:      { label: "Submitted",      color: "#2980b9", icon: "📤" },
  acknowledged:   { label: "Acknowledged",   color: "#8e44ad", icon: "📬" },
  under_review:   { label: "Under Review",   color: "#e67e22", icon: "🔍" },
  info_requested: { label: "Info Requested", color: "#f39c12", icon: "❓" },
  approved:       { label: "Approved",       color: "#27ae60", icon: "✅" },
  rejected:       { label: "Rejected",       color: "#e74c3c", icon: "❌" },
  withdrawn:      { label: "Withdrawn",      color: "#7f8c8d", icon: "🚫" },
};