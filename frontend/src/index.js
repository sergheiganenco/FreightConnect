// ── src/index.js ───────────────────────────────────────────────
import React from 'react';
import ReactDOM from 'react-dom/client';

import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './components/theme';
import App from './App';

// ① React-Query
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './index.css';

// People who signed in before the user id was stored: read it from their session token once, at start-up.
try {
  const token = localStorage.getItem('token');
  if (token) {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.userId) localStorage.setItem('userId', String(claims.userId));
  }
} catch (_) { /* unreadable token: the next sign-in sets it */ }

const root = ReactDOM.createRoot(document.getElementById('root'));

// ② create a single client for the whole app
const queryClient = new QueryClient();

root.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
