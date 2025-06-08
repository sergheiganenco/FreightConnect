// ── src/index.js ───────────────────────────────────────────────
import React from 'react';
import ReactDOM from 'react-dom/client';

import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './components/theme';
import App from './App';

// ① React-Query
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './styles/marketing.css';
import './styles/Navbar.css';
import './index.css';
import './styles/Login.css';
import './styles/Dashboard.css';

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
