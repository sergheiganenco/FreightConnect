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
  },
});

theme = responsiveFontSizes(theme);
export default theme;
