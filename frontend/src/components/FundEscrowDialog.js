// src/components/FundEscrowDialog.js
//
// Shipper "Fund Escrow" flow — authorizes a manual-capture Stripe PaymentIntent
// so funds are held (not captured) until delivery. Gracefully degrades when the
// Stripe library or publishable key is unavailable (e.g. dev environments with
// no Stripe keys configured).
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Stack, Alert, CircularProgress,
  Checkbox, FormControlLabel,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../services/api';
import { brand, surface, text as T, semantic, tint } from '../theme/tokens';

// Stripe imports are guarded — if the package isn't installed the whole module
// would otherwise fail to resolve. We import lazily/defensively below.
let loadStripe = null;
let Elements = null;
let PaymentElement = null;
let useStripe = null;
let useElements = null;
try {
  // eslint-disable-next-line global-require
  ({ loadStripe } = require('@stripe/stripe-js'));
  // eslint-disable-next-line global-require
  ({ Elements, PaymentElement, useStripe, useElements } = require('@stripe/react-stripe-js'));
} catch (_) {
  // Stripe libraries not installed — component degrades gracefully.
}

const dialogPaperSx = {
  bgcolor: surface.modal,
  color: T.primary,
  border: `1.5px solid ${surface.indigoGlow}`,
  borderRadius: 3,
  backdropFilter: 'blur(24px)',
};

// ── Inner form (only rendered when Stripe + clientSecret are available) ──────
// NOTE: CheckoutForm is only ever rendered inside <Elements> when the Stripe
// library is loaded, so the hooks below are always defined and called in a
// stable order.
function CheckoutForm({ onAuthorized, onCancel, mandateAccepted }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');
    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (confirmError) {
        setError(confirmError.message || 'Authorization failed. Please try again.');
      } else {
        // For a manual-capture intent this authorizes (holds) the funds.
        setDone(true);
        onAuthorized?.();
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong authorizing the hold.');
    }
    setSubmitting(false);
  };

  if (done) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <CheckCircleIcon sx={{ fontSize: 48, color: semantic.success, mb: 1 }} />
        <Typography fontWeight={700} sx={{ color: semantic.success }}>
          Escrow authorized — funds held. Carrier can roll.
        </Typography>
        <Button onClick={onCancel} sx={{ mt: 2, borderRadius: 9999 }} variant="outlined">
          Close
        </Button>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Box sx={{ p: 2, borderRadius: 2, bgcolor: surface.glassLight, border: `1px solid ${surface.glassBorder}`, mb: 2 }}>
        <PaymentElement />
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button onClick={onCancel} sx={{ borderRadius: 9999, color: T.secondary }}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={!stripe || submitting || !mandateAccepted}
          startIcon={submitting ? <CircularProgress size={16} /> : <LockIcon />}
          sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}
        >
          {submitting ? 'Authorizing…' : 'Authorize Escrow Hold'}
        </Button>
      </Stack>
    </Box>
  );
}

export default function FundEscrowDialog({ open, onClose, loadId, onFunded }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [publishableKey, setPublishableKey] = useState(null);
  const [alreadyFunded, setAlreadyFunded] = useState(false);
  const [stripePromise, setStripePromise] = useState(null);
  const [mandateAccepted, setMandateAccepted] = useState(false);

  const reset = () => {
    setLoading(false);
    setError('');
    setClientSecret('');
    setPublishableKey(null);
    setAlreadyFunded(false);
    setStripePromise(null);
    setMandateAccepted(false);
  };

  // Record the shipper's authorization to charge their saved card later for
  // approved accessorials (detention/lumper) — the Path B off-session mandate.
  const handleMandateToggle = async (checked) => {
    setMandateAccepted(checked);
    if (checked && loadId) {
      try {
        await api.post(`/payments/fund-escrow/${loadId}`, { mandateAccepted: true, mandateVersion: 'v1' });
      } catch (_) {
        // Non-fatal: the hold already exists; the mandate can be re-recorded.
      }
    }
  };

  const init = useCallback(async () => {
    if (!loadId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/payments/fund-escrow/${loadId}`);
      setClientSecret(data.clientSecret || '');
      setPublishableKey(data.publishableKey || null);
      setAlreadyFunded(data.alreadyFunded === true);

      // Initialize Stripe.js only if the library + key are both present.
      if (!data.alreadyFunded && data.publishableKey && loadStripe) {
        try {
          setStripePromise(loadStripe(data.publishableKey));
        } catch (_) {
          // Stripe failed to load — fall through to graceful message.
          setStripePromise(null);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to start escrow funding. Please try again.');
    }
    setLoading(false);
  }, [loadId]);

  useEffect(() => {
    if (open) {
      reset();
      init();
    }
  }, [open, init]);

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const handleAuthorized = () => {
    onFunded?.();
  };

  const stripeReady = Boolean(
    !alreadyFunded && clientSecret && publishableKey && stripePromise && Elements && PaymentElement
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth PaperProps={{ sx: dialogPaperSx }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <LockIcon sx={{ color: brand.indigo }} /> Fund Escrow
      </DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" sx={{ color: T.secondary, mt: 1.5 }}>
              Preparing secure escrow hold…
            </Typography>
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && alreadyFunded && (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleIcon sx={{ fontSize: 48, color: semantic.success, mb: 1 }} />
            <Typography fontWeight={700} sx={{ color: semantic.success }}>
              Escrow already funded ✓
            </Typography>
            <Typography variant="body2" sx={{ color: T.secondary, mt: 0.5 }}>
              Funds are held and will release to the carrier on delivery.
            </Typography>
          </Box>
        )}

        {!loading && !error && !alreadyFunded && !publishableKey && (
          <Alert severity="info" sx={{ bgcolor: tint(semantic.info, 0.1) }}>
            Payment isn't configured on this environment yet. Escrow funding will be
            available once Stripe keys are set up.
          </Alert>
        )}

        {!loading && !error && stripeReady && (
          <>
            <Typography variant="body2" sx={{ color: T.secondary, mb: 2 }}>
              Authorize the escrow hold below. Funds are held — not charged — and
              release to the carrier automatically once delivery is confirmed.
            </Typography>
            <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: surface.glassSubtle, border: `1px solid ${surface.glassBorder}` }}>
              <FormControlLabel
                control={<Checkbox checked={mandateAccepted} onChange={(e) => handleMandateToggle(e.target.checked)} sx={{ color: brand.indigo, '&.Mui-checked': { color: brand.indigo } }} />}
                label={
                  <Typography variant="caption" sx={{ color: T.secondary }}>
                    I authorize FreightConnect to charge this card for accessorial
                    charges I approve on this load (e.g. detention, lumper, layover),
                    each shown to me with evidence before I approve it.
                  </Typography>
                }
              />
            </Box>
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CheckoutForm onAuthorized={handleAuthorized} onCancel={handleClose} mandateAccepted={mandateAccepted} />
            </Elements>
          </>
        )}

        {/* Fallback: key present but Stripe lib couldn't render */}
        {!loading && !error && !alreadyFunded && publishableKey && !stripeReady && (
          <Alert severity="warning">
            The payment form couldn't be loaded. Please refresh and try again.
          </Alert>
        )}
      </DialogContent>
      {(!stripeReady || alreadyFunded) && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} sx={{ borderRadius: 9999, color: T.secondary }}>
            Close
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
