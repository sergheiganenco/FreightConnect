// ═══════════════════════════════════════════════════════════════════
// Design Tokens — Single source of truth for all colors & styles
// Change a value HERE and it updates across the entire app.
// ═══════════════════════════════════════════════════════════════════

// ── Brand ───────────────────────────────────────────────────────
export const brand = {
  primary:   '#6a1fcf',   // vibrant purple  (main buttons, links, gradients)
  secondary: '#e1129a',   // pink accent     (CTAs, highlights)
  indigo:    '#6366f1',   // indigo          (actions, bid UI, borders)
  indigoLight: '#818cf8', // lighter indigo  (rate display, subtle accents)
  pink:      '#f04ca7',   // admin accent chip
  lavender:  '#e6e6fa',   // nav label inactive
  softIndigo:'#bdbfff',   // nav icon inactive
};

// ── Load Status ─────────────────────────────────────────────────
export const status = {
  open:       '#22d3ee',   // cyan
  accepted:   '#a78bfa',   // violet
  inTransit:  '#fbbf24',   // amber
  delivered:  '#34d399',   // green
  cancelled:  '#94a3b8',   // slate
  disputed:   '#f87171',   // red
};

// ── Bid Status ──────────────────────────────────────────────────
export const bidStatus = {
  pending:    '#6366f1',   // indigo
  accepted:   '#34d399',   // green
  rejected:   '#ef4444',   // red
  countered:  '#fbbf24',   // amber
  withdrawn:  '#94a3b8',   // slate
};

// ── Severity ────────────────────────────────────────────────────
export const severity = {
  low:      '#94a3b8',
  medium:   '#fbbf24',
  high:     '#f97316',
  critical: '#ef4444',
};

// ── Exception Status ────────────────────────────────────────────
export const exceptionStatus = {
  open:          '#6366f1',
  investigating: '#fbbf24',
  resolved:      '#34d399',
  dismissed:     '#94a3b8',
};

// ── Semantic ────────────────────────────────────────────────────
export const semantic = {
  success:  '#34d399',
  warning:  '#fbbf24',
  error:    '#ef4444',
  info:     '#22d3ee',
  orange:   '#f97316',
  muted:    '#94a3b8',
};

// ── Surfaces ────────────────────────────────────────────────────
export const surface = {
  background:   '#0d0d35',                   // page background
  modal:        'rgba(20, 14, 50, 0.98)',    // modal overlay
  appBar:       'rgba(34, 25, 84, 0.92)',    // AppBar / Drawer glass
  glass:        'rgba(255,255,255,0.06)',     // standard glass card
  glassSubtle:  'rgba(255,255,255,0.03)',     // very subtle panels
  glassLight:   'rgba(255,255,255,0.04)',     // slightly elevated
  glassHover:   'rgba(255,255,255,0.08)',     // hover states
  glassMid:     'rgba(255,255,255,0.09)',     // mid-hover / focus
  glassActive:  'rgba(255,255,255,0.11)',     // active nav item bg
  glassBadge:   'rgba(255,255,255,0.12)',     // badge / role chip bg
  glassBorder:  'rgba(255,255,255,0.1)',      // borders, dividers
  cardBg:       'rgba(35,13,71,0.88)',        // glass card on gradient bg
  indigoTint:   'rgba(99,102,241,0.08)',      // indigo-tinted panels
  indigoTintLight: 'rgba(99,102,241,0.06)',   // lighter indigo tint
  indigoBorder: 'rgba(99,102,241,0.25)',      // indigo borders
  indigoBorderLight: 'rgba(99,102,241,0.2)',  // lighter indigo border
  indigoGlow:   'rgba(99,102,241,0.3)',       // indigo glow border
  pinkTint:     'rgba(240,76,167,0.12)',      // admin accent bg
};

// ── Text ────────────────────────────────────────────────────────
export const text = {
  primary:   '#ffffff',
  secondary: 'rgba(255,255,255,0.5)',
  muted:     'rgba(255,255,255,0.4)',
  hint:      'rgba(255,255,255,0.3)',
  strong:    'rgba(255,255,255,0.7)',     // <strong> tag override
  navInactive: '#d1d5db',                // nav label text (not selected)
  chartLabel: '#eaeaf6',                 // chart axis labels
  chartSub:   '#c5b4fa',                 // chart secondary text
  dark:      '#0f172a',                   // dark text on light chips
  darkAlt:   '#18181b',                   // dark text alt
};

// ── Shadows ─────────────────────────────────────────────────────
export const shadow = {
  card:    '0 8px 24px rgba(0,0,0,0.25)',
  modal:   '0 12px 48px rgba(106,31,207,0.4)',
  chip:    '0 2px 8px rgba(0,0,0,0.07)',
};

// ── Chart Colors ──────────────────────────────────────────────
export const chart = {
  pie:  ['#3EC17C', '#4D96FF', '#FFD86B', '#EB4D4B', '#ad88f8'],
  line: ['#a082e0', '#3ec17c', '#ffd86b', '#EB4D4B', '#ad88f8'],
  green: '#3EC17C',
  blue:  '#4D96FF',
  gold:  '#FFD86B',
  red:   '#EB4D4B',
  purple:'#ad88f8',
  orange:'#ffaf75',
  cyan:  '#96ffed',
  skyBlue:'#a8d2ff',
};

// ── Gradient ────────────────────────────────────────────────────
export const gradient = {
  primary: 'linear-gradient(90deg, #6a1fcf, #e1129a)',
  background: 'linear-gradient(135deg, #0d0d35 0%, #1a0a3e 50%, #2d1059 100%)',
  dashboardBg: 'linear-gradient(135deg, #1f2dff 0%, #6a1fcf 40%, #e1129a 100%)',
  analyticsBg: 'linear-gradient(135deg, #48228b 0%, #8e42ec 60%, #f357a8 100%)',
};

// ── Dark-theme field styles (for TextFields/Selects on dark bg) ─
export const darkFieldSx = {
  '& .MuiInputBase-root':  { color: text.primary, bgcolor: surface.glass },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.4)' },
  '& .MuiInputLabel-root':      { color: text.secondary },
  '& .MuiInputAdornment-root':  { color: text.secondary },
};

// ── Convenience helpers ─────────────────────────────────────────

/** Semi-transparent background from any hex color: tint('#34d399', 0.08) → 'rgba(52,211,153,0.08)' */
export function tint(hex, alpha = 0.08) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Status color lookup — handles all string forms: "in-transit", "in_transit", "In Transit" */
export function statusColor(raw) {
  const key = (raw || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const map = {
    open: status.open,
    accepted: status.accepted,
    intransit: status.inTransit,
    delivered: status.delivered,
    cancelled: status.cancelled,
    disputed: status.disputed,
  };
  return map[key] || status.open;
}

/** Bid status color lookup */
export function bidStatusColor(raw) {
  return bidStatus[(raw || '').trim().toLowerCase()] || bidStatus.pending;
}
