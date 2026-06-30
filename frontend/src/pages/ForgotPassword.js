// src/pages/ForgotPassword.js
import React, { useState } from 'react';
import { Box, Container, Paper, Typography, Button, TextField } from '@mui/material';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { gradient, text, glassCard, buttonVariants, darkFieldSx, semantic } from '../theme/tokens';

// Neutral message shown regardless of whether the account exists (prevents enumeration)
const NEUTRAL_MESSAGE =
  'If an account exists, a reset link has been sent to your email.';

export default function ForgotPassword() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async ({ email }) => {
    try {
      await api.post('/users/forgot-password', { email: email.trim() });
    } catch (err) {
      // Intentionally swallow errors — always show the neutral message
      // to avoid leaking whether an account exists.
    } finally {
      setSubmitted(true);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', background: gradient.dashboardBg, backgroundAttachment: 'fixed', color: text.primary, pt: 12, pb: 8 }}>
      <Container maxWidth="sm" sx={{ px: { xs: 2, md: 4 } }}>
        <Paper sx={{ ...glassCard.elevated, p: { xs: 3, md: 5 } }}>
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Typography variant="h4" fontWeight={700} gutterBottom textAlign="center">
              Forgot Password?
            </Typography>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            <Typography variant="body1" sx={{ color: text.secondary, mb: 3, textAlign: 'center' }}>
              Enter your email and we'll send you a reset link.
            </Typography>
          </motion.div>

          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center' }}>
                <CheckCircle2 size={48} color={semantic.success} />
                <Typography sx={{ color: text.primary }} role="status">
                  {NEUTRAL_MESSAGE}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mt: 1 }}>
                  <Link to="/login" style={{ color: text.secondary }}>Back to Login</Link>
                  <Link to="/signup" style={{ color: text.secondary }}>Sign Up</Link>
                </Box>
              </Box>
            </motion.div>
          ) : (
            <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                type="email"
                label="Email"
                fullWidth
                error={!!errors.email}
                helperText={errors.email?.message}
                sx={{ ...darkFieldSx }}
                {...register('email', {
                  required: 'Email is required',
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: 'Enter a valid email',
                  },
                })}
              />

              <Button
                type="submit"
                variant="contained"
                disabled={isSubmitting}
                sx={{ ...buttonVariants.gradient, px: 4, py: 1.5 }}
              >
                {isSubmitting ? 'Sending...' : 'Send Reset Link'}
              </Button>

              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 3, mt: 1 }}>
                <Link to="/login" style={{ color: text.secondary }}>Back to Login</Link>
                <Link to="/signup" style={{ color: text.secondary }}>Sign Up</Link>
              </Box>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
