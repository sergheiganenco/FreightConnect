// src/pages/ResetPassword.js

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
} from '@mui/material';
import api from '../services/api';
import {
  surface,
  text,
  gradient,
  darkFieldSx,
  shadow,
  semantic,
} from '../theme/tokens';

// 8+ chars, at least one upper, one lower, one digit, one special char
const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  const passwordValue = watch('password', '');

  const onSubmit = async ({ password }) => {
    if (!token || !email) {
      setError('api', {
        type: 'manual',
        message: 'Invalid or expired reset link.',
      });
      return;
    }

    try {
      const res = await api.post('/users/reset-password', {
        email,
        token,
        password,
      });
      if (res.data?.success) {
        setDone(true);
      } else {
        setError('api', {
          type: 'manual',
          message: res.data?.message || 'Could not reset password.',
        });
      }
    } catch (err) {
      setError('api', {
        type: 'manual',
        message:
          err.response?.data?.message ||
          err.response?.data?.error ||
          'Could not reset password. The link may have expired.',
      });
    }
  };

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
        }}
      >
        {done ? (
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
                textAlign: 'center',
              }}
            >
              <CheckCircle2 size={56} color={semantic.success} />
              <Typography
                variant="h5"
                component="h1"
                sx={{ color: text.primary, fontWeight: 700 }}
              >
                Password Reset
              </Typography>
              <Typography sx={{ color: text.secondary }}>
                Your password has been updated. You can now log in with your new
                password.
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
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Typography
                variant="h4"
                component="h1"
                sx={{
                  color: text.primary,
                  fontWeight: 700,
                  textAlign: 'center',
                  mb: 1,
                }}
              >
                Reset Password
              </Typography>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
            >
              <Typography
                variant="body1"
                sx={{ color: text.secondary, textAlign: 'center', mb: 3 }}
              >
                Choose a new password for your account.
              </Typography>
            </motion.div>

            <Box
              component="form"
              onSubmit={handleSubmit(onSubmit)}
              sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {errors.api && (
                <Typography
                  role="alert"
                  sx={{
                    color: semantic.error,
                    textAlign: 'center',
                    fontSize: '0.875rem',
                  }}
                >
                  {errors.api.message}
                </Typography>
              )}

              {(!token || !email) && (
                <Typography
                  role="alert"
                  sx={{
                    color: semantic.error,
                    textAlign: 'center',
                    fontSize: '0.875rem',
                  }}
                >
                  Invalid or expired reset link.
                </Typography>
              )}

              <TextField
                type={showPassword ? 'text' : 'password'}
                label="New Password"
                placeholder="New Password"
                autoComplete="new-password"
                aria-label="New password"
                fullWidth
                error={!!errors.password}
                helperText={errors.password?.message}
                FormHelperTextProps={{ role: 'alert' }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock size={18} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword((p) => !p)}
                        edge="end"
                        aria-label={
                          showPassword ? 'Hide password' : 'Show password'
                        }
                        sx={{ color: text.secondary }}
                      >
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{ ...darkFieldSx }}
                {...register('password', {
                  required: 'Password is required',
                  pattern: {
                    value: PASSWORD_PATTERN,
                    message:
                      'Min 8 chars with upper, lower, number, and special character',
                  },
                  setValueAs: (v) => v.trim(),
                })}
              />

              <TextField
                type={showConfirm ? 'text' : 'password'}
                label="Confirm Password"
                placeholder="Confirm Password"
                autoComplete="new-password"
                aria-label="Confirm password"
                fullWidth
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword?.message}
                FormHelperTextProps={{ role: 'alert' }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock size={18} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirm((p) => !p)}
                        edge="end"
                        aria-label={
                          showConfirm ? 'Hide password' : 'Show password'
                        }
                        sx={{ color: text.secondary }}
                      >
                        {showConfirm ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{ ...darkFieldSx }}
                {...register('confirmPassword', {
                  required: 'Please confirm your password',
                  validate: (value) =>
                    value === passwordValue || 'Passwords do not match',
                  setValueAs: (v) => v.trim(),
                })}
              />

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={isSubmitting || !token || !email}
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
                  '&.Mui-disabled': {
                    background: surface.glass,
                    color: text.muted,
                  },
                }}
              >
                {isSubmitting ? 'Resetting…' : 'Reset Password'}
              </Button>

              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                <Typography
                  component={Link}
                  to="/login"
                  variant="body2"
                  sx={{
                    color: text.secondary,
                    textDecoration: 'none',
                    '&:hover': { color: text.primary },
                  }}
                >
                  Back to Login
                </Typography>
              </Box>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
