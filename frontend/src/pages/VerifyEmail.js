// src/pages/VerifyEmail.js

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  Box,
  Paper,
  Button,
  Typography,
  CircularProgress,
} from '@mui/material';
import api from '../services/api';
import {
  surface,
  text,
  gradient,
  shadow,
  semantic,
} from '../theme/tokens';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get('token');
  const email = searchParams.get('email');

  // status: 'loading' | 'success' | 'error'
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!token || !email) {
        if (!cancelled) {
          setStatus('error');
          setMessage('Invalid or expired link.');
        }
        return;
      }

      try {
        const res = await api.get('/users/verify-email', {
          params: { token, email },
        });
        if (cancelled) return;
        if (res.data?.success) {
          setStatus('success');
          setMessage(res.data.message || 'Email verified! You can now log in.');
        } else {
          setStatus('error');
          setMessage(res.data?.message || 'Invalid or expired link.');
        }
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMessage(
          err.response?.data?.message ||
            err.response?.data?.error ||
            'Invalid or expired link.'
        );
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [token, email]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: gradient.dashboardBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          background: surface.cardBg,
          backdropFilter: 'blur(24px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: '24px',
          p: 5,
          width: '100%',
          maxWidth: 440,
          boxShadow: shadow.modal,
          textAlign: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Typography
            variant="h4"
            component="h1"
            sx={{ color: text.primary, fontWeight: 700, mb: 3 }}
          >
            Email Verification
          </Typography>
        </motion.div>

        {status === 'loading' && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              py: 2,
            }}
          >
            <CircularProgress sx={{ color: text.primary }} />
            <Typography sx={{ color: text.secondary }}>
              Verifying your email&hellip;
            </Typography>
          </Box>
        )}

        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <CheckCircle2 size={56} color={semantic.success} />
              <Typography sx={{ color: text.primary, fontSize: '1.1rem' }}>
                {message || 'Email verified! You can now log in.'}
              </Typography>
              <Button
                onClick={() => navigate('/login')}
                variant="contained"
                fullWidth
                sx={{
                  mt: 1,
                  py: 1.5,
                  fontWeight: 700,
                  fontSize: '1rem',
                  background: gradient.primary,
                  borderRadius: '12px',
                  textTransform: 'none',
                  '&:hover': {
                    background: gradient.primary,
                    filter: 'brightness(1.1)',
                  },
                }}
              >
                Go to Login
              </Button>
            </Box>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <XCircle size={56} color={semantic.error} />
              <Typography sx={{ color: text.primary, fontSize: '1.1rem' }}>
                {message || 'Invalid or expired link.'}
              </Typography>
              <Typography sx={{ color: text.secondary, fontSize: '0.875rem' }}>
                Your verification link may have expired. Try logging in to
                request a new verification email.
              </Typography>
              <Button
                onClick={() => navigate('/login')}
                variant="contained"
                fullWidth
                sx={{
                  mt: 1,
                  py: 1.5,
                  fontWeight: 700,
                  fontSize: '1rem',
                  background: gradient.primary,
                  borderRadius: '12px',
                  textTransform: 'none',
                  '&:hover': {
                    background: gradient.primary,
                    filter: 'brightness(1.1)',
                  },
                }}
              >
                Go to Login
              </Button>
            </Box>
          </motion.div>
        )}
      </Paper>
    </Box>
  );
}
