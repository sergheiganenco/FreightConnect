// ── src/components/theme.js ─────────────────────────────────────
import { createTheme, responsiveFontSizes } from '@mui/material/styles';

let theme = createTheme({
  palette: {
    /* master colours (no more blue) */
    primary:   { main: '#6a1fcf' },       // vibrant purple  (buttons, links)
    secondary: { main: '#e1129a' },       // pink accent     (delete / warning)
     /* accent strip colours for load statuses */
     accent: {
       open:      '#22d3ee',   // sky-blue
       accepted:  '#a78bfa',   // violet
       inTransit: '#fbbf24',   // amber
       delivered: '#34d399',   // green
     },
 /* one-stop RGBA tint for glass cards */
    glass: 'rgba(255,255,255,0.06)',
    background: {
      default: '#0d0d35',                 // fallback behind gradient
      paper:   'rgba(255,255,255,0.06)',  // glassy panels
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255,255,255,0.8)',
    },
  },

  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeightMedium: 600,
    allVariants: { color: '#ffffff' },
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
    /* rounded, glass‑effect Paper for cards & dialogs */
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 24,
          backdropFilter: 'blur(24px)',
          background: 'rgba(255,255,255,0.06)',
        },
      },
    },
    /* purple buttons */
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
          textTransform: 'none',
        },
      },
    },
  },
});

theme = responsiveFontSizes(theme);
export default theme;
