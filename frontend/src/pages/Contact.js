import React, { useState } from 'react';
import { Box, Paper, Button, TextField, Typography, Alert } from '@mui/material';
import PublicPage from '../components/PublicPage';
import api from '../services/api';
import { glassCard, buttonVariants, darkFieldSx, radius } from '../theme/tokens';

const MAX_MSG = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldSx = {
  ...darkFieldSx,
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.75)' },
  '& .MuiFormHelperText-root': { color: 'rgba(255,255,255,0.7)' },
  '& .MuiFormHelperText-root.Mui-error': { color: '#fca5a5' },
};

function validate({ name, email, message }) {
  const e = {};
  if (!name.trim()) e.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email.trim()) || email.length > 200) e.email = 'Please enter a valid email address.';
  if (message.trim().length < 10) e.message = 'Please write at least 10 characters.';
  return e;
}

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [serverError, setServerError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setStatus('sending');
    setServerError('');
    try {
      await api.post('/contact', {
        name: form.name.trim(),
        email: form.email.trim(),
        message: form.message.trim(),
        website: form.website,
      });
      setStatus('sent');
      setForm({ name: '', email: '', message: '', website: '' });
    } catch (err) {
      setServerError(
        err.response?.status === 429
          ? 'Too many messages — please try again later.'
          : err.response?.data?.error || 'Something went wrong sending your message. Please try again.'
      );
      setStatus('error');
    }
  };

  return (
    <PublicPage
      maxWidth="md"
      title="Contact us"
      intro="Questions, feedback, or a request about your data? Send us a message and we will reply by email."
    >
      <Paper elevation={0} sx={{ ...glassCard.elevated, borderRadius: `${radius.lg}px`, p: { xs: 3, md: 4 }, maxWidth: 640 }}>
        {status === 'sent' ? (
          <Alert severity="success" role="status">
            Thanks — we got your message and will reply by email.
          </Alert>
        ) : (
          <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {status === 'error' && <Alert severity="error" role="alert">{serverError}</Alert>}

            <TextField
              id="contact-name" name="name" label="Your name" required fullWidth autoComplete="name"
              value={form.name} onChange={set('name')} inputProps={{ maxLength: 100 }}
              error={!!errors.name} helperText={errors.name} sx={fieldSx}
            />
            <TextField
              id="contact-email" name="email" label="Your email" type="email" required fullWidth autoComplete="email"
              value={form.email} onChange={set('email')} inputProps={{ maxLength: 200 }}
              error={!!errors.email} helperText={errors.email} sx={fieldSx}
            />
            <TextField
              id="contact-message" name="message" label="Your message" required fullWidth multiline minRows={5}
              value={form.message} onChange={set('message')} inputProps={{ maxLength: MAX_MSG }}
              error={!!errors.message}
              helperText={errors.message || `${form.message.length} / ${MAX_MSG}`}
              sx={fieldSx}
            />

            {/* Honeypot: hidden from people, bots tend to fill it in. */}
            <Box aria-hidden="true" sx={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="contact-website">Leave this field empty</label>
              <input
                id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off"
                value={form.website} onChange={set('website')}
              />
            </Box>

            <Button
              type="submit"
              disabled={status === 'sending'}
              sx={{
                ...buttonVariants.gradient, alignSelf: 'flex-start', minHeight: 48, px: 4,
                borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 700,
                '&:focus-visible': { outline: '2px solid #818cf8', outlineOffset: '2px' },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.7)', opacity: 0.7 },
              }}
            >
              {status === 'sending' ? 'Sending…' : 'Send message'}
            </Button>
          </Box>
        )}
      </Paper>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', mt: 2, maxWidth: 640 }}>
        We use your details only to reply to you.
      </Typography>
    </PublicPage>
  );
}
