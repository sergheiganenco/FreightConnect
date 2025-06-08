// src/pages/Login.js

import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { motion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

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
    // Defensive trim
    email = email.trim();
    password = password.trim();

    try {
      const res = await api.post('/users/login', { email, password });
      const { token, user } = res.data;

      localStorage.setItem('token', token);
      localStorage.setItem('role', user.role);

      if (user.role === 'carrier') {
        navigate('/dashboard/carrier');
      } else {
        navigate('/dashboard/shipper');
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
    <section className="page-marketing">
      <div className="glass-box login-wrapper">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="auth-title"
        >
          Welcome Back!
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="auth-subtitle"
        >
          Streamlining your freight operations with ease.
        </motion.p>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
          {errors.api && (
            <p className="error" style={{ textAlign: 'center' }}>
              {errors.api.message}
            </p>
          )}

          <div className="input-group">
            <Mail className="input-icon" />
            <input
              type="email"
              placeholder="Email"
              autoComplete="username"
              {...register('email', {
                required: 'Email is required',
                pattern: {
                  value: /\S+@\S+\.\S+/,
                  message: 'Enter a valid email address',
                },
                setValueAs: v => v.trim(), // always trim
              })}
            />
          </div>
          {errors.email && <p className="error">{errors.email.message}</p>}

          <div className="input-group">
            <Lock className="input-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              autoComplete="current-password"
              {...register('password', {
                required: 'Password is required',
                minLength: { value: 6, message: 'Min length is 6' },
                setValueAs: v => v.trim(), // always trim
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

          <button
            type="submit"
            className="btn-pink auth-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Logging in…' : 'Login'}
          </button>

          <div className="auth-links">
            <Link to="/forgot-password">Forgot Password?</Link>
            <Link to="/signup">Sign Up</Link>
          </div>
        </form>
      </div>
    </section>
  );
}
