// src/pages/ChangePassword.js
//
// Forced password change for admin-created accounts (temporary password → the
// user sets their own on first login), also usable as a self-service change.
// Reached via /change-password; RoleRoute redirects here while
// localStorage.mustChangePassword === '1'.

import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  Alert,
} from '@mui/material';
import api from '../services/api';
import { surface, text, gradient, darkFieldSx, shadow } from '../theme/tokens';

const dashboardFor = (role) =>
  role === 'admin' ? '/dashboard/admin'
    : role === 'shipper' ? '/dashboard/shipper'
      : role === 'carrier' ? '/dashboard/carrier'
        : '/';

export default function ChangePassword() {
  const navigate = useNavigate();
  const forced = localStorage.getItem('mustChangePassword') === '1';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/users/change-password', { currentPassword, newPassword });
      localStorage.removeItem('mustChangePassword');
      navigate(dashboardFor(localStorage.getItem('role')), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password.');
    }
    setSaving(false);
  };

  const eyeAdornment = (
    <InputAdornment position="end">
      <IconButton onClick={() => setShow((s) => !s)} edge="end" aria-label="Toggle password visibility">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </IconButton>
    </InputAdornment>
  );

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
        component="form"
        onSubmit={submit}
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          background: surface.cardBg,
          border: `1px solid ${surface.glassBorder}`,
          boxShadow: shadow.modal,
        }}
      >
        <Typography variant="h5" fontWeight={900} sx={{ color: text.primary, mb: 0.5 }}>
          {forced ? 'Set a new password' : 'Change password'}
        </Typography>
        <Typography sx={{ color: text.secondary, mb: 3, fontSize: '0.95em' }}>
          {forced
            ? 'Your account was created with a temporary password. Choose your own password to continue.'
            : 'Enter your current password and a new one.'}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          fullWidth
          type={show ? 'text' : 'password'}
          label={forced ? 'Temporary password' : 'Current password'}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          sx={{ ...darkFieldSx, mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><Lock size={18} /></InputAdornment>
              ),
              endAdornment: eyeAdornment,
            },
          }}
        />
        <TextField
          fullWidth
          type={show ? 'text' : 'password'}
          label="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          helperText="At least 8 characters"
          sx={{ ...darkFieldSx, mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><Lock size={18} /></InputAdornment>
              ),
            },
          }}
        />
        <TextField
          fullWidth
          type={show ? 'text' : 'password'}
          label="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          sx={{ ...darkFieldSx, mb: 3 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><Lock size={18} /></InputAdornment>
              ),
            },
          }}
        />

        <Button
          type="submit"
          fullWidth
          variant="contained"
          disabled={saving}
          sx={{ py: 1.25, fontWeight: 800, borderRadius: 99, background: gradient.primary }}
        >
          {saving ? 'Saving…' : 'Save new password'}
        </Button>
      </Paper>
    </Box>
  );
}
