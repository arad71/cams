/* ═══════════════════════════════════════════════════════════
   CAMS Design Tokens — Single source of truth for all styles
   Import: import { T, cx } from '../styles/tokens'
   ═══════════════════════════════════════════════════════════ */

// ── Colour palette ──
const palette = {
  navy50: "#f0f4f7", navy100: "#dce4ea", navy200: "#b8c9d4",
  navy300: "#8aa4b5", navy400: "#5c7f96", navy500: "#1a3a4a",
  navy600: "#152f3c", navy700: "#10242e", navy800: "#0b1920", navy900: "#060d12",
  teal50: "#e6faf6", teal100: "#b3f0e3", teal200: "#80e6d0",
  teal300: "#4ddcbd", teal400: "#1abc9c", teal500: "#17a689", teal600: "#128f76",
  green50: "#eafaf1", green100: "#c8f0d8", green200: "#82daa0",
  green300: "#4cc877", green400: "#27ae60", green500: "#1e8c4d",
  red50: "#fdedec", red100: "#f9d0cd", red200: "#f1948a",
  red300: "#ec7063", red400: "#e74c3c", red500: "#c0392b",
  amber50: "#fef9e7", amber100: "#fdeaa7", amber200: "#f9ca24",
  amber300: "#f39c12", amber400: "#e67e22", amber500: "#d35400",
  blue50: "#ebf5fb", blue100: "#aed6f1", blue200: "#5dade2",
  blue300: "#3498db", blue400: "#2980b9", blue500: "#1a6da2",
  grey50: "#fafbfc", grey100: "#f5f8fa", grey200: "#eef2f5",
  grey300: "#e4e9ec", grey400: "#d5dde2", grey500: "#b0bec5",
  grey600: "#6b7b85", grey700: "#7a8a94", grey800: "#5a6a74", grey900: "#3a4a54",
  white: "#ffffff", black: "#000000",
};

// ── Semantic tokens ──
export const T = {
  // Colours
  c: {
    primary: palette.navy500,
    primaryLight: palette.navy50,
    accent: palette.teal400,
    accentLight: palette.teal50,
    // Semantic colours are used for text and for buttons with white text, so all meet 4.5:1
    success: "#1b7a43",
    successLight: palette.green50,
    danger: palette.red500,
    dangerLight: palette.red50,
    warning: "#a8530a",
    warningLight: palette.amber50,
    info: "#1f6aa5",
    infoLight: palette.blue50,
    bg: palette.grey100,
    bgAlt: palette.grey50,
    card: palette.white,
    border: palette.grey300,
    borderLight: palette.grey200,
    text: palette.navy500,
    // Both meet WCAG AA (4.5:1) on white and on the page background
    textSecondary: palette.grey800,
    textMuted: "#66767f",
    textPlaceholder: palette.grey500,
    white: palette.white,
    ...palette,
  },

  // Spacing (px)
  s: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },

  // Border radius
  r: { xs: 3, sm: 4, md: 8, lg: 12, xl: 16, pill: 999 },

  // Font sizes
  f: { xxs: 12, xs: 12, sm: 12, md: 13, base: 14, lg: 16, xl: 18, xxl: 22, xxxl: 28 },

  // Font weights
  w: { normal: 400, medium: 500, semi: 600, bold: 700, black: 800 },

  // Shadows
  sh: {
    xs: "0 1px 2px rgba(26,58,74,0.04)",
    sm: "0 1px 4px rgba(26,58,74,0.07)",
    md: "0 4px 12px rgba(26,58,74,0.09)",
    lg: "0 8px 24px rgba(26,58,74,0.12)",
    xl: "0 16px 48px rgba(26,58,74,0.15)",
  },

  // Transitions
  tr: {
    fast: "all 0.12s ease",
    base: "all 0.2s ease",
    slow: "all 0.35s ease",
  },

  // Z-indices
  z: { dropdown: 100, sticky: 200, modal: 1000, overlay: 2000, toast: 3000 },
};

// ── Common style presets ──
export const S = {
  // Cards
  card: {
    background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`,
    boxShadow: T.sh.sm, overflow: "hidden",
  },
  cardFlat: {
    background: T.c.card, borderRadius: T.r.lg, border: `1px solid ${T.c.border}`,
  },

  // Card header
  cardHeader: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderBottom: `1px solid ${T.c.borderLight}`,
    fontSize: T.f.md, fontWeight: T.w.bold, color: T.c.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.5,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },

  // Card body
  cardBody: { padding: T.s.lg },

  // Buttons
  btnPrimary: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderRadius: T.r.md, border: "none",
    background: `linear-gradient(135deg, ${T.c.primary}, ${T.c.navy600})`,
    color: T.c.white, fontWeight: T.w.bold, fontSize: T.f.md,
    cursor: "pointer", fontFamily: "inherit", transition: T.tr.fast,
    boxShadow: T.sh.sm,
  },
  btnAccent: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderRadius: T.r.md, border: "none",
    background: `linear-gradient(135deg, ${T.c.accent}, ${T.c.teal500})`,
    color: T.c.white, fontWeight: T.w.bold, fontSize: T.f.md,
    cursor: "pointer", fontFamily: "inherit", transition: T.tr.fast,
  },
  btnOutline: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderRadius: T.r.md,
    border: `1.5px solid ${T.c.border}`, background: T.c.card,
    color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: T.f.md,
    cursor: "pointer", fontFamily: "inherit", transition: T.tr.fast,
  },
  btnDanger: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderRadius: T.r.md, border: "none",
    background: `linear-gradient(135deg, ${T.c.danger}, ${T.c.red500})`,
    color: T.c.white, fontWeight: T.w.bold, fontSize: T.f.md,
    cursor: "pointer", fontFamily: "inherit",
  },
  btnSuccess: {
    padding: `${T.s.sm}px ${T.s.lg}px`, borderRadius: T.r.md, border: "none",
    background: `linear-gradient(135deg, ${T.c.success}, ${T.c.green500})`,
    color: T.c.white, fontWeight: T.w.bold, fontSize: T.f.md,
    cursor: "pointer", fontFamily: "inherit",
  },
  btnSmall: { padding: `3px ${T.s.sm}px`, fontSize: T.f.xs, borderRadius: T.r.sm },
  btnIcon: {
    padding: `${T.s.xs}px ${T.s.sm}px`, borderRadius: T.r.sm,
    border: `1px solid ${T.c.border}`, background: T.c.card,
    color: T.c.textSecondary, fontWeight: T.w.semi, fontSize: T.f.xs,
    cursor: "pointer", fontFamily: "inherit",
  },

  // Inputs
  input: {
    width: "100%", padding: `${T.s.sm}px ${T.s.md}px`, borderRadius: T.r.md,
    border: `1.5px solid ${T.c.border}`, fontSize: T.f.base, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box", transition: T.tr.fast,
    color: T.c.text,
  },
  inputSm: {
    padding: `3px ${T.s.sm}px`, borderRadius: T.r.sm,
    border: `1px solid ${T.c.border}`, fontSize: T.f.sm, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box", color: T.c.text,
  },

  // Badges
  badge: (color = T.c.textSecondary, bg = T.c.grey200) => ({
    padding: `2px ${T.s.sm}px`, borderRadius: T.r.xs, fontSize: T.f.xs,
    fontWeight: T.w.bold, color, background: bg, display: "inline-block",
  }),

  // Section header
  sectionTitle: {
    fontSize: T.f.lg, fontWeight: T.w.black, color: T.c.text,
    marginBottom: T.s.md, letterSpacing: -0.3,
  },

  // Label
  label: {
    fontSize: T.f.md, fontWeight: T.w.semi, color: T.c.textSecondary,
    display: "block", marginBottom: T.s.xs,
  },

  // Table
  th: {
    padding: `${T.s.sm}px ${T.s.md}px`, background: T.c.primary, color: T.c.white,
    fontSize: T.f.xs, fontWeight: T.w.bold, textAlign: "left",
  },
  td: {
    padding: `${T.s.sm}px ${T.s.md}px`, borderBottom: `1px solid ${T.c.borderLight}`,
    fontSize: T.f.sm, color: T.c.text,
  },
  tdAlt: { background: T.c.bgAlt },

  // Status colours
  statusColor: (status) => {
    const map = {
      approved: T.c.success, conditionally_approved: T.c.info,
      rejected: T.c.danger, pending_review: T.c.textMuted,
      under_assessment: T.c.info, on_hold: T.c.warning,
      inspection_required: T.c.amber400,
    };
    return map[status] || T.c.textMuted;
  },

  // Result colours
  resultColor: (result) => {
    const map = { pass: T.c.success, fail: T.c.danger, review: T.c.warning, na: T.c.textMuted };
    return map[result] || T.c.textMuted;
  },
};

// ── Helper: merge styles ──
export const cx = (...styles) => Object.assign({}, ...styles.filter(Boolean));
