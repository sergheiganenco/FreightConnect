// src/pages/Signup.js
import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Snackbar,
  Alert,
  InputAdornment,
  IconButton,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { User, Mail, Lock, Eye, EyeOff, Info } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import {
  brand,
  surface,
  text,
  gradient,
  darkFieldSx,
  shadow,
} from '../theme/tokens';

export default function Signup() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { role: 'carrier' } });

  const [role, setRole] = useState('carrier');
  const [showPassword, setShowPassword] = useState(false);
  const [tosAgreed, setTosAgreed] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '' });

  // Keep RHF in sync with toggle
  useEffect(() => {
    setValue('role', role, { shouldValidate: true });
  }, [role, setValue]);

  const onSubmit = async (data) => {
    try {
      await api.post('/users/signup', { ...data, tosAccepted: true });
      setSnack({
        open: true,
        message: `Registered ${data.name} (${data.role}) successfully!`,
      });
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setSnack({
        open: true,
        message:
          err.response?.data?.error || 'Signup failed. Please try again later.',
      });
    }
  };

  return (
    <>
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
              Create Your Account
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
              Join FreightConnect and optimize your freight operations.
            </Typography>
          </motion.div>

          <Box
            component="form"
            onSubmit={handleSubmit(onSubmit)}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {/* Role toggle */}
            <ToggleButtonGroup
              value={role}
              exclusive
              onChange={(_, v) => v && setRole(v)}
              fullWidth
              sx={{
                mb: 1,
                '& .MuiToggleButton-root': {
                  color: text.secondary,
                  borderColor: surface.glassBorder,
                  '&.Mui-selected': {
                    color: text.primary,
                    background: surface.glassActive,
                    borderColor: brand.indigo,
                  },
                },
              }}
            >
              <ToggleButton value="carrier">Carrier</ToggleButton>
              <ToggleButton value="shipper">Shipper</ToggleButton>
            </ToggleButtonGroup>
            <input
              type="hidden"
              {...register('role', { required: 'Role is required' })}
            />
            {errors.role && (
              <Typography role="alert" sx={{ color: '#ef4444', fontSize: '0.875rem' }}>
                {errors.role.message}
              </Typography>
            )}

            {/* Name */}
            <TextField
              type="text"
              label="Full Name"
              placeholder="Full Name"
              autoComplete="name"
              aria-label="Full name"
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
              FormHelperTextProps={{ role: 'alert' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <User size={18} />
                  </InputAdornment>
                ),
              }}
              sx={{ ...darkFieldSx }}
              {...register('name', { required: 'Name is required' })}
            />

            {/* Email */}
            <TextField
              type="email"
              label="Email"
              placeholder="Email"
              autoComplete="email"
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
                  message: 'Enter a valid email',
                },
              })}
            />

            {/* Company Name */}
            {['shipper', 'carrier'].includes(role) && (
              <>
                <TextField
                  type="text"
                  label="Company Name"
                  placeholder="Company Name"
                  autoComplete="organization"
                  aria-label="Company name"
                  fullWidth
                  error={!!errors.companyName}
                  helperText={errors.companyName?.message}
                  FormHelperTextProps={{ role: 'alert' }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <User size={18} />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ ...darkFieldSx }}
                  {...register('companyName', {
                    required: 'Company Name is required',
                  })}
                />
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    color: text.secondary,
                    fontSize: '0.85rem',
                    mt: -1,
                  }}
                >
                  <Info size={16} style={{ marginRight: 5, flexShrink: 0 }} />
                  If your company is already in our system, enter the same name
                  to join. If not, a new company will be created.
                </Box>
              </>
            )}

            {/* Password */}
            <TextField
              type={showPassword ? 'text' : 'password'}
              label="Password"
              placeholder="Password (min 6 chars)"
              autoComplete="new-password"
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
                minLength: {
                  value: 6,
                  message: 'Password must be at least 6 characters',
                },
              })}
            />

            {/* ToS Agreement */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={tosAgreed}
                  onChange={(e) => setTosAgreed(e.target.checked)}
                  sx={{
                    color: text.secondary,
                    '&.Mui-checked': { color: brand.secondary },
                  }}
                />
              }
              label={
                <Typography variant="body2" sx={{ color: text.secondary }}>
                  I agree to the{' '}
                  <Box
                    component="a"
                    href="/terms-of-service"
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: brand.lavender,
                      textDecoration: 'underline',
                    }}
                  >
                    Terms of Service
                  </Box>{' '}
                  and{' '}
                  <Box
                    component="a"
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: brand.lavender,
                      textDecoration: 'underline',
                    }}
                  >
                    Privacy Policy
                  </Box>
                </Typography>
              }
              sx={{ mt: 0.5, mb: 0.5 }}
            />

            <Button
              variant="contained"
              fullWidth
              type="submit"
              disabled={isSubmitting || !tosAgreed}
              sx={{
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
              {isSubmitting ? 'Signing up\u2026' : 'Sign Up'}
            </Button>

            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
              <Typography
                variant="body2"
                component={Link}
                to="/login"
                sx={{
                  color: text.secondary,
                  textDecoration: 'none',
                  '&:hover': { color: text.primary },
                }}
              >
                Already have an account? Log in
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Success/Error Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack({ ...snack, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack({ ...snack, open: false })}
          severity={
            snack.message.startsWith('Registered') ? 'success' : 'error'
          }
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </>
  );
}
