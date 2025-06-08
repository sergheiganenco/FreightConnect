// src/pages/ForgotPassword.js
import React from 'react';
import { useForm } from 'react-hook-form';
import { Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();

  const onSubmit = async ({ email }) => {
    try {
      // TODO: call your password-reset API
      // await axios.post('/api/auth/forgot-password', { email });
      alert('Password reset link sent!');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <section className="page-marketing">
      <div className="glass-box forgot-wrapper">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="auth-title"
        >
          Forgot Password?
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="auth-subtitle"
        >
          Enter your email and we’ll send you a reset link.
        </motion.p>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
          <div className="input-group">
            <Mail className="input-icon" />
            <input
              type="email"
              placeholder="Email"
              {...register('email', {
                required: 'Email is required',
                pattern: {
                  value: /\S+@\S+\.\S+/,
                  message: 'Enter a valid email',
                },
              })}
            />
          </div>
          {errors.email && <p className="error">{errors.email.message}</p>}

          <button
            type="submit"
            className="btn-pink auth-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : 'Send Reset Link'}
          </button>

          <div className="auth-links">
            <Link to="/login">Back to Login</Link>
            <Link to="/signup">Sign Up</Link>
          </div>
        </form>
      </div>
    </section>
  );
}
