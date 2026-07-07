/**
 * VerificationBanner — Shows at top of dashboard when verification incomplete.
 *
 * For CARRIERS:
 *   - Must complete: MC/DOT verification, Insurance COI upload, W-9
 *   - Until complete: cannot accept loads (backend enforces too)
 *
 * For SHIPPERS:
 *   - Must complete: Payment method on file
 *   - Should complete: EIN, business docs (higher trust tier)
 *   - Until payment method: cannot post loads (backend enforces too)
 *
 * This banner sits at the top of the Outlet area and is dismissible
 * only once all mandatory steps are done.
 */
import React, { useState, useEffect } from 'react';
import {
  Typography, Stack, Button, Alert, AlertTitle,
  LinearProgress, Chip,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ShieldIcon from '@mui/icons-material/Shield';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function VerificationBanner({ role }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchStatus() {
      try {
        if (role === 'carrier') {
          const { data } = await api.get('/verification/carrier/status');
          setStatus({ role: 'carrier', ...data });
        } else if (role === 'shipper') {
          const { data } = await api.get('/verification/shipper/status');
          setStatus({ role: 'shipper', ...data });
        }
      } catch { /* non-critical */ }
      setLoading(false);
    }
    fetchStatus();
  }, [role]);

  if (loading || !status) return null;

  // ── Carrier checks ──────────────────────────────────────────────
  if (role === 'carrier') {
    const verificationStatus = status.status || 'unverified';
    if (verificationStatus === 'verified') {
      // Check insurance separately
      const insStatus = status.insurance?.status;
      if (insStatus === 'lapsed') {
        return (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}
            icon={<WarningAmberIcon />}
            action={
              <Button size="small" color="inherit" onClick={() => navigate('/dashboard/carrier/verification')}>
                Update Insurance
              </Button>
            }
          >
            <AlertTitle>Insurance Lapsed</AlertTitle>
            Your insurance has expired. You cannot accept new loads until you upload a current Certificate of Insurance.
          </Alert>
        );
      }
      if (insStatus === 'expiring') {
        return (
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}
            action={
              <Button size="small" color="inherit" onClick={() => navigate('/dashboard/carrier/verification')}>
                Update
              </Button>
            }
          >
            Your insurance expires soon. Update your COI to avoid service interruption.
          </Alert>
        );
      }
      return null; // Fully verified, no banner needed
    }

    // Not verified — show mandatory steps
    const steps = [
      { key: 'fmcsa', label: 'MC/DOT Verification', done: !!status.fmcsaData?.operatingStatus },
      { key: 'insurance', label: 'Insurance COI Upload', done: status.documentsOnFile?.some(d => d.docType === 'coi') },
      { key: 'w9', label: 'W-9 Tax Form', done: status.documentsOnFile?.some(d => d.docType === 'w9') },
    ];
    const completedCount = steps.filter(s => s.done).length;
    const progress = Math.round((completedCount / steps.length) * 100);

    if (dismissed && completedCount === steps.length) return null;

    return (
      <Alert
        severity={completedCount === steps.length ? 'info' : 'warning'}
        sx={{ mb: 2, borderRadius: 2 }}
        icon={<ShieldIcon />}
        action={
          <Button
            size="small"
            color="inherit"
            endIcon={<ArrowForwardIcon />}
            onClick={() => navigate('/dashboard/carrier/verification')}
          >
            Complete Verification
          </Button>
        }
      >
        <AlertTitle>
          {verificationStatus === 'pending' ? 'Verification In Progress' : 'Verification Required'}
        </AlertTitle>
        <Typography variant="body2" mb={1}>
          {completedCount < steps.length
            ? 'Complete these steps to accept loads:'
            : 'All documents submitted — pending admin review.'
          }
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {steps.map(s => (
            <Chip
              key={s.key}
              size="small"
              icon={s.done ? <CheckCircleIcon sx={{ fontSize: 14 }} /> : undefined}
              label={s.label}
              sx={{
                bgcolor: s.done ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                color: s.done ? '#34d399' : '#fbbf24',
                fontWeight: 600,
                fontSize: '0.72rem',
              }}
            />
          ))}
        </Stack>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ mt: 1, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.1)' }}
        />
      </Alert>
    );
  }

  // ── Shipper checks ──────────────────────────────────────────────
  if (role === 'shipper') {
    const level = status.level || 0;
    const sv = status.shipperVerification || {};

    if (sv.status === 'verified') return null; // Fully verified
    if (sv.status === 'suspended') {
      return (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          <AlertTitle>Account Suspended</AlertTitle>
          Your shipper account has been suspended. Contact support for assistance.
        </Alert>
      );
    }

    if (level >= 2 && dismissed) return null; // Has payment, optional steps remaining

    const mandatoryDone = !!sv.paymentMethodVerified;

    return (
      <Alert
        severity={mandatoryDone ? 'info' : 'warning'}
        sx={{ mb: 2, borderRadius: 2 }}
        icon={<ShieldIcon />}
        action={
          <Stack direction="row" spacing={1}>
            {mandatoryDone && (
              <Button size="small" color="inherit" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            )}
            <Button
              size="small"
              color="inherit"
              endIcon={<ArrowForwardIcon />}
              onClick={() => navigate('/dashboard/shipper/verification')}
            >
              {mandatoryDone ? 'Increase Trust' : 'Complete Setup'}
            </Button>
          </Stack>
        }
      >
        <AlertTitle>
          {mandatoryDone ? 'Increase Your Trust Level' : 'Setup Required — Cannot Post Loads Yet'}
        </AlertTitle>
        {!mandatoryDone ? (
          <Typography variant="body2">
            Add a payment method (credit card or bank account) to start posting loads. Carriers need to know you can pay.
          </Typography>
        ) : (
          <Typography variant="body2">
            Level {level}/4 — Submit your EIN and business documents to unlock higher limits and preferred carrier access.
          </Typography>
        )}
        <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label="Payment Method"
            icon={sv.paymentMethodVerified ? <CheckCircleIcon sx={{ fontSize: 14 }} /> : undefined}
            sx={{ bgcolor: sv.paymentMethodVerified ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)', color: sv.paymentMethodVerified ? '#34d399' : '#ef4444', fontWeight: 600, fontSize: '0.72rem' }} />
          <Chip size="small" label="EIN Verified"
            icon={sv.einVerified ? <CheckCircleIcon sx={{ fontSize: 14 }} /> : undefined}
            sx={{ bgcolor: sv.einVerified ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)', color: sv.einVerified ? '#34d399' : 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.72rem' }} />
          <Chip size="small" label="Email Check"
            icon={sv.emailDomain ? <CheckCircleIcon sx={{ fontSize: 14 }} /> : undefined}
            sx={{ bgcolor: sv.emailDomain ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)', color: sv.emailDomain ? '#34d399' : 'rgba(255,255,255,0.4)', fontWeight: 600, fontSize: '0.72rem' }} />
        </Stack>
      </Alert>
    );
  }

  return null;
}
