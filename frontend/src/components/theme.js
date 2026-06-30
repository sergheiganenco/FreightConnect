// ── src/components/theme.js ─────────────────────────────────────
// MUI theme — all colours come from the centralized design tokens.
// To change any colour, edit  src/theme/tokens.js  (one file, whole app).
// ─────────────────────────────────────────────────────────────────
import { createTheme, responsiveFontSizes } from '@mui/material/styles';
import { brand, status, surface, text as T, semantic, severity, exceptionStatus, bidStatus } from '../theme/tokens';

let theme = createTheme({
  palette: {
    primary:   { main: brand.primary },
    secondary: { main: brand.secondary },

    /* accent strip colours for load statuses */
    accent: {
      open:      status.open,
      accepted:  status.accepted,
      inTransit: status.inTransit,
      delivered: status.delivered,
      cancelled: status.cancelled,
      disputed:  status.disputed,
    },

    /* semantic colours (usable as theme.palette.success.main etc.) */
    success: { main: semantic.success },
    warning: { main: semantic.warning },
    error:   { main: semantic.error },
    info:    { main: semantic.info },

    /* extended token maps — accessible via useTheme() */
    brand,
    status,
    bidStatus,
    severity,
    exceptionStatus,
    surface,

    /* one-stop RGBA tint for glass cards */
    glass: surface.glass,

    background: {
      default: surface.background,
      paper:   surface.glass,
    },
    text: {
      primary:   T.primary,
      secondary: T.secondary,
    },
  },

  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeightMedium: 600,
    allVariants: { color: T.primary },
  },

  components: {
    /* transparent NavBar everywhere */
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'transparent',
          boxShadow: 'none',
        },
      },
      defaultProps: { color: 'inherit' },
    },
    /* rounded, glass-effect Paper for cards & dialogs */
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 24,
          backdropFilter: 'blur(24px)',
          background: surface.glass,
        },
      },
    },
    /* pill buttons */
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
          textTransform: 'none',
        },
      },
    },
    /* Dividers visible on dark backgrounds */
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: surface.glassBorder,
        },
      },
    },
    /* ── Chip — glass-style chips ── */
    MuiChip: {
      styleOverrides: {
        root: {
          backdropFilter: 'blur(8px)',
          fontWeight: 500,
        },
        outlined: {
          borderColor: surface.glassBorder,
          backgroundColor: surface.glassSubtle,
        },
      },
    },
    /* ── Dialog — glass panels ── */
    MuiDialog: {
      styleOverrides: {
        paper: {
          background: surface.cardBg,
          backdropFilter: 'blur(24px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 16,
        },
      },
    },
    /* ── Tooltip — dark glass ── */
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          background: 'rgba(15,10,40,0.95)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 8,
          fontSize: '0.8125rem',
        },
      },
    },
    /* ── TextField — consistent dark input ── */
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiInputBase-root': {
            color: T.primary,
            backgroundColor: surface.glass,
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: surface.glassBorder,
          },
          '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.3)',
          },
          '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: brand.primary,
          },
          '& .MuiInputLabel-root': {
            color: T.secondary,
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: brand.primary,
          },
        },
      },
    },
    /* ── Alert — glass alert ── */
    MuiAlert: {
      styleOverrides: {
        root: {
          backdropFilter: 'blur(12px)',
          borderRadius: 12,
        },
      },
    },
    /* ── Card — default glass card ── */
    MuiCard: {
      styleOverrides: {
        root: {
          background: surface.glass,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 16,
        },
      },
    },
    /* ── Tab — styled for dark theme ── */
    MuiTab: {
      styleOverrides: {
        root: {
          color: T.secondary,
          textTransform: 'none',
          fontWeight: 500,
          '&.Mui-selected': {
            color: T.primary,
          },
        },
      },
    },
    /* ── TableCell — dark theme table ── */
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: surface.glassBorder,
          color: T.primary,
        },
        head: {
          color: T.secondary,
          fontWeight: 600,
        },
      },
    },
  },
});

theme = responsiveFontSizes(theme);
export default theme;
