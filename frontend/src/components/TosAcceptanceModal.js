import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  FormControlLabel,
  Typography,
  Box,
  CircularProgress,
  Chip,
} from '@mui/material';
import { Gavel } from 'lucide-react';
import api from '../services/api';

export default function TosAcceptanceModal({ open, onAccepted }) {
  const [tosText, setTosText] = useState('');
  const [tosVersion, setTosVersion] = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/tos/current')
      .then(res => {
        setTosText(res.data.text);
        setTosVersion(res.data.version);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load Terms of Service. Please try again.');
        setLoading(false);
      });
  }, [open]);

  const handleAccept = useCallback(async () => {
    setSubmitting(true);
    setError('');
    try {
      await api.post('/tos/accept');
      if (onAccepted) onAccepted();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept Terms of Service.');
    } finally {
      setSubmitting(false);
    }
  }, [onAccepted]);

  return (
    <Dialog
      open={open}
      maxWidth="md"
      fullWidth
      disableEscapeKeyDown
      PaperProps={{
        sx: {
          bgcolor: 'rgba(15, 15, 35, 0.97)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          color: '#fff',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          pb: 2,
        }}
      >
        <Gavel size={24} />
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          Terms of Service
        </Typography>
        {tosVersion && (
          <Chip
            label={`v${tosVersion}`}
            size="small"
            sx={{
              bgcolor: 'rgba(99,102,241,0.2)',
              color: '#a5b4fc',
              fontWeight: 600,
            }}
          />
        )}
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ color: '#a5b4fc' }} />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                maxHeight: 400,
                overflow: 'auto',
                bgcolor: 'rgba(255,255,255,0.04)',
                borderRadius: 2,
                p: 3,
                mb: 3,
                border: '1px solid rgba(255,255,255,0.06)',
                whiteSpace: 'pre-wrap',
                fontFamily: '"Inter", sans-serif',
                fontSize: '0.875rem',
                lineHeight: 1.7,
                color: 'rgba(255,255,255,0.85)',
                '&::-webkit-scrollbar': { width: 6 },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: 'rgba(255,255,255,0.15)',
                  borderRadius: 3,
                },
              }}
            >
              {tosText}
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  sx={{
                    color: 'rgba(255,255,255,0.4)',
                    '&.Mui-checked': { color: '#818cf8' },
                  }}
                />
              }
              label={
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                  I have read and agree to the Terms of Service and Privacy Policy
                </Typography>
              }
            />

            {error && (
              <Typography variant="body2" sx={{ color: '#ef4444', mt: 1 }}>
                {error}
              </Typography>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, borderTop: '1px solid rgba(255,255,255,0.08)', pt: 2 }}>
        <Button
          variant="contained"
          disabled={!checked || submitting || loading}
          onClick={handleAccept}
          sx={{
            px: 4,
            py: 1.2,
            fontWeight: 700,
            bgcolor: '#6366f1',
            '&:hover': { bgcolor: '#4f46e5' },
            '&.Mui-disabled': {
              bgcolor: 'rgba(99,102,241,0.3)',
              color: 'rgba(255,255,255,0.3)',
            },
          }}
        >
          {submitting ? 'Accepting...' : 'Accept Terms of Service'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
