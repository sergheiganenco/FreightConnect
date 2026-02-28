import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

/**
 * ErrorBoundary — catches unhandled React render errors and shows a fallback UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production you'd send this to an error tracking service (e.g. Sentry)
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1f2dff 0%, #6a1fcf 40%, #e1129a 100%)',
          p: 2,
        }}
      >
        <Paper
          sx={{
            p: 5,
            maxWidth: 480,
            width: '100%',
            borderRadius: 4,
            textAlign: 'center',
            backdropFilter: 'blur(20px)',
            background: 'rgba(255,255,255,0.97)',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 64, color: '#ef4444', mb: 2 }} />
          <Typography variant="h5" fontWeight={800} mb={1} color="#1e1e2e">
            Something went wrong
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            An unexpected error occurred. Please try refreshing the page.
          </Typography>
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <Box
              component="pre"
              sx={{
                textAlign: 'left',
                p: 1.5,
                mb: 3,
                borderRadius: 2,
                bgcolor: '#fef2f2',
                border: '1px solid #fecaca',
                fontSize: '0.72rem',
                color: '#991b1b',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.toString()}
            </Box>
          )}
          <Button
            variant="contained"
            onClick={this.handleReset}
            sx={{
              bgcolor: '#6366f1',
              fontWeight: 700,
              borderRadius: 9999,
              px: 4,
              '&:hover': { bgcolor: '#4f46e5' },
            }}
          >
            Go to Home
          </Button>
        </Paper>
      </Box>
    );
  }
}
