// src/pages/Login.js

import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
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
} from '../theme/tokens';

export default function Login() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();

  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async ({ email, password }) => {
    email = email.trim();
    password = password.trim();

    try {
      const res = await api.post('/users/login', { email, password });
      const { token, user } = res.data;

      localStorage.setItem('token', token);
      localStorage.setItem('role', user.role);
      // Company sub-account role drives nav gating (owner-only tabs are hidden
      // from dispatcher/driver logins). Defaults to owner for solo accounts.
      localStorage.setItem('companyRole', user.companyRole || 'owner');

      if (user.role === 'admin') {
        navigate('/dashboard/admin');
      } else if (user.role === 'carrier') {
        navigate('/dashboard/carrier');
      } else if (user.role === 'shipper') {
        navigate('/dashboard/shipper');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError('api', {
        type: 'manual',
        message:
          err.response?.data?.error ||
          'Login failed. Please check your credentials.',
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
            Welcome Back!
          </Typography>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
        >
          <Typography
            variant="body1"
            sx={{
              color: text.secondary,
              textAlign: 'center',
              mb: 3,
            }}
          >
            Streamlining your freight operations with ease.
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
                color: '#ef4444',
                textAlign: 'center',
                fontSize: '0.875rem',
              }}
            >
              {errors.api.message}
            </Typography>
          )}

          <TextField
            type="email"
            label="Email"
            placeholder="Email"
            autoComplete="username"
            aria-label="Email address"
            fullWidth
            error={!!errors.email}
            helperText={errors.email?.message}
            FormHelperTextProps={{ role: 'alert' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Mail size={18} />
                </InputAdornment>
              ),
            }}
            sx={{ ...darkFieldSx }}
            {...register('email', {
              required: 'Email is required',
              pattern: {
                value: /\S+@\S+\.\S+/,
                message: 'Enter a valid email address',
              },
              setValueAs: (v) => v.trim(),
            })}
          />

          <TextField
            type={showPassword ? 'text' : 'password'}
            label="Password"
            placeholder="Password"
            autoComplete="current-password"
            aria-label="Password"
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
                    onClick={() => setShowPassword((prev) => !prev)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    sx={{ color: text.secondary }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ ...darkFieldSx }}
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 6, message: 'Min length is 6' },
              setValueAs: (v) => v.trim(),
            })}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={isSubmitting}
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
            {isSubmitting ? 'Logging in\u2026' : 'Login'}
          </Button>

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              mt: 1,
            }}
          >
            <Typography
              component={Link}
              to="/forgot-password"
              variant="body2"
              sx={{
                color: text.secondary,
                textDecoration: 'none',
                '&:hover': { color: text.primary },
              }}
            >
              Forgot Password?
            </Typography>
            <Typography
              component={Link}
              to="/signup"
              variant="body2"
              sx={{
                color: text.secondary,
                textDecoration: 'none',
                '&:hover': { color: text.primary },
              }}
            >
              Sign Up
            </Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
