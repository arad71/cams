// src/components/shared/ui.js

import React from "react";

/** ─── Styles (exported tokens) ───────────────────────────────────────── */
export const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1.5px solid #c8d5cb",
  fontSize: 14,
  fontFamily: "inherit",
  background: "#fafcfa",
  color: "#2c3e2f",
  outline: "none",
  boxSizing: "border-box",
};

export const selectStyle = {
  ...inputStyle,
  appearance: "none",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7c6f' stroke-width='1.5' fill='none'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
  paddingRight: 36,
};

export const btnPrimary = {
  padding: "10px 28px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg, #1a5632, #2d8a4e)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 2px 12px rgba(26,86,50,0.2)",
};

export const btnSecondary = {
  padding: "10px 24px",
  borderRadius: 10,
  border: "1.5px solid #c8d5cb",
  background: "#fff",
  color: "#2c3e2f",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

/** ─── Components ─────────────────────────────────────────────────────── */
export function FormField({ label, error, required, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: "#3a4a3d",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label} {required && <span style={{ color: "#c0392b" }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 4 }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

export function InfoCard({ title, children, color = "#1a5632" }) {
  return (
    <div
      style={{
        background: color + "08",
        border: `1px solid ${color}25`,
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 13,
          color,
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#3a4a3d" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * StatusBadge needs STATUS_LABELS passed in (so this module stays decoupled).
 * If status key isn't known, it falls back gracefully.
 */
export function StatusBadge({ status, statusMap }) {
  const s =
    (statusMap && statusMap[status]) || {
      label: String(status ?? "Unknown"),
      color: "#95a5a6",
      icon: "•",
    };
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        background: s.color + "18",
        color: s.color,
      }}
    >
      {s.icon} {s.label}
    </span>
  );
}

export function ProgressBar({ steps, currentStep }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{ flex: 1, textAlign: "center" }}>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background:
                i <= currentStep
                  ? "linear-gradient(90deg, #1a5632, #2d8a4e)"
                  : "#e2e8e3",
              marginBottom: 4,
              transition: "background 0.3s",
            }}
          />
          <div
            style={{
              fontSize: 9,
              fontWeight: i === currentStep ? 800 : 500,
              color: i <= currentStep ? "#1a5632" : "#b0bdb2",
            }}
          >
            {s.icon} {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid #e2e8e3",
        borderTop: "2px solid #1a5632",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}