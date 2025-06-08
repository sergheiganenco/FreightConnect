// src/pages/Signup.js
import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Snackbar,
  Alert
} from '@mui/material';
import { User, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import '../styles/Login.css'; // reuses your gradient + glass styles

export default function Signup() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm({ defaultValues: { role: 'carrier' } });

  const [role, setRole] = useState('carrier');
  const [showPassword, setShowPassword] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '' });

  // keep RHF in sync with our toggle
  useEffect(() => {
    setValue('role', role, { shouldValidate: true });
  }, [role, setValue]);

  const onSubmit = async (data) => {
    try {
      await api.post('/users/signup', data);
      setSnack({
        open: true,
        message: `Registered ${data.name} (${data.role}) successfully!`
      });
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      console.error('Signup failed:', err.response?.data || err.message);
      setSnack({
        open: true,
        message:
          err.response?.data?.error ||
          'Signup failed. Please try again later.'
      });
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background:
            'linear-gradient(135deg,#1f2dff 0%,#6a1fcf 40%,#e1129a 100%)',
          p: 2
        }}
      >
        <Card
          sx={{
            width: 400,
            borderRadius: 3,
            backdropFilter: 'blur(24px)',
            background: 'rgba(255,255,255,0.05)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)'
          }}
        >
          <CardContent>
            <motion.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="login-title"
            >
              Create Your Account
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="login-subtitle"
            >
              Join FreightConnect and optimize your freight operations.
            </motion.p>

            <form onSubmit={handleSubmit(onSubmit)} className="login-form">
              {/* Role toggle */}
              <ToggleButtonGroup
                value={role}
                exclusive
                onChange={(_, v) => v && setRole(v)}
                fullWidth
                sx={{ mb: 2 }}
              >
                <ToggleButton value="carrier">Carrier</ToggleButton>
                <ToggleButton value="shipper">Shipper</ToggleButton>
              </ToggleButtonGroup>
              <input
                type="hidden"
                {...register('role', { required: 'Role is required' })}
              />
              {errors.role && (
                <p className="error">{errors.role.message}</p>
              )}

              {/* Name */}
              <div className="input-group">
                <User className="input-icon" />
                <input
                  type="text"
                  placeholder="Full Name"
                  {...register('name', { required: 'Name is required' })}
                />
              </div>
              {errors.name && <p className="error">{errors.name.message}</p>}

              {/* Email */}
              <div className="input-group">
                <Mail className="input-icon" />
                <input
                  type="email"
                  placeholder="Email"
                  {...register('email', {
                    required: 'Email is required',
                    pattern: {
                      value: /\S+@\S+\.\S+/,
                      message: 'Enter a valid email'
                    }
                  })}
                />
              </div>
              {errors.email && <p className="error">{errors.email.message}</p>}

              {/* Password */}
              <div className="input-group">
                <Lock className="input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password (min 6 chars)"
                  {...register('password', {
                    required: 'Password is required',
                    minLength: {
                      value: 6,
                      message: 'Password must be at least 6 characters'
                    }
                  })}
                />
                {showPassword ? (
                  <EyeOff
                    className="toggle-icon"
                    onClick={() => setShowPassword(false)}
                  />
                ) : (
                  <Eye
                    className="toggle-icon"
                    onClick={() => setShowPassword(true)}
                  />
                )}
              </div>
              {errors.password && (
                <p className="error">{errors.password.message}</p>
              )}

              <Button
                variant="contained"
                fullWidth
                type="submit"
                disabled={isSubmitting}
                sx={{
                  mt: 1,
                  py: 1.5,
                  fontWeight: 'bold',
                  bgcolor: '#c52c89',
                  '&:hover': { bgcolor: '#d2419a' }
                }}
              >
                {isSubmitting ? 'Signing up…' : 'Sign Up'}
              </Button>

              <Box display="flex" justifyContent="center" mt={2}>
                <Typography
                  variant="body2"
                  component={Link}
                  to="/login"
                  sx={{
                    color: '#fff',
                    textDecoration: 'underline',
                    cursor: 'pointer'
                  }}
                >
                  Already have an account? Log in
                </Typography>
              </Box>
            </form>
          </CardContent>
        </Card>
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
          severity={snack.message.startsWith('Registered') ? 'success' : 'error'}
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </>
  );
}
