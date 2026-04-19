import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Paper, Button, Chip, Stack, Divider,
  CircularProgress, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Stepper, Step, StepLabel, StepContent, Collapse,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import EmailIcon from '@mui/icons-material/Email';
import PaymentIcon from '@mui/icons-material/Payment';
import BusinessIcon from '@mui/icons-material/Business';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ShieldIcon from '@mui/icons-material/Shield';
import api from '../../services/api';

const STATUS_COLORS = {
  unverified: '#94a3b8',
  pending: '#fbbf24',
  verified: '#34d399',
  suspended: '#ef4444',
  rejected: '#ef4444',
};

const BUSINESS_TYPES = [
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' },
];

export default function ShipperVerification() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // EIN form
  const [einForm, setEinForm] = useState({
    ein: '', businessName: '', stateOfIncorporation: '', businessType: 'llc',
  });

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/verification/shipper/status');
      setStatus(data);
    } catch { /* non-critical */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleEmailCheck = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const { data } = await api.post('/verification/shipper/email-check');
      setSuccess(data.message);
      fetchStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
    setSaving(false);
  };

  const handleEINSubmit = async () => {
    if (!einForm.ein) { setError('EIN is required'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const { data } = await api.post('/verification/shipper/ein', einForm);
      setSuccess(data.message);
      fetchStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
    setSaving(false);
  };

  const handleDocUpload = async (e, docType) => {
    const file = e.target.files[0];
    if (!file) return;
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      await api.post('/verification/shipper/documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccess(`${docType.replace('_', ' ')} uploaded.`);
      fetchStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    }
    setSaving(false);
  };

  if (loading) return <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress /></Box>;

  const sv = status?.shipperVerification || {};
  const level = status?.level || 0;
  const steps = status?.steps || {};
  const permissions = status?.permissions || {};

  const activeStep = steps.adminApproved ? 4
    : steps.businessIdentity ? 3
    : steps.paymentMethod ? 2
    : steps.emailVerified ? 1
    : 0;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <ShieldIcon sx={{ color: STATUS_COLORS[sv.status || 'unverified'], fontSize: 32 }} />
        <Box>
          <Typography variant="h4" fontWeight={800} color="#fff">Shipper Verification</Typography>
          <Typography variant="body2" color="rgba(255,255,255,0.5)">
            Complete verification to post loads and access all features.
          </Typography>
        </Box>
      </Stack>

      {/* Status Banner */}
      <Paper sx={{
        p: 2.5, mb: 3, borderRadius: 3,
        bgcolor: `${STATUS_COLORS[sv.status || 'unverified']}10`,
        border: `1.5px solid ${STATUS_COLORS[sv.status || 'unverified']}44`,
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            {sv.status === 'verified'
              ? <CheckCircleIcon sx={{ color: '#34d399' }} />
              : <WarningAmberIcon sx={{ color: STATUS_COLORS[sv.status || 'unverified'] }} />
            }
            <Box>
              <Typography fontWeight={700} color="#fff">
                Status: {(sv.status || 'unverified').toUpperCase()} — Level {level}/4
              </Typography>
              <Typography variant="caption" color="rgba(255,255,255,0.6)">
                {permissions.canPostLoads
                  ? `You can post up to ${permissions.maxActiveLoads} active loads.${permissions.escrowRequired ? ' Escrow required.' : ''}`
                  : 'Complete Steps 1-2 to start posting loads.'
                }
              </Typography>
            </Box>
          </Stack>
          <Chip
            label={`Level ${level}`}
            sx={{ fontWeight: 700, bgcolor: `${STATUS_COLORS[sv.status || 'unverified']}22`, color: STATUS_COLORS[sv.status || 'unverified'] }}
          />
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>{success}</Alert>}

      {/* Verification Steps */}
      <Stepper activeStep={activeStep} orientation="vertical" sx={{
        '& .MuiStepLabel-label': { color: '#fff', fontWeight: 600 },
        '& .MuiStepContent-root': { borderColor: 'rgba(255,255,255,0.1)' },
      }}>
        {/* Step 1: Email Domain */}
        <Step completed={steps.emailVerified}>
          <StepLabel icon={<EmailIcon sx={{ color: steps.emailVerified ? '#34d399' : '#6366f1' }} />}>
            Email Domain Check
          </StepLabel>
          <StepContent>
            <Typography variant="body2" color="rgba(255,255,255,0.6)" mb={2}>
              We check if your email is from a business domain. Free email (Gmail, Yahoo) is allowed but carriers see it as a trust signal.
            </Typography>
            {sv.emailDomainVerified ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleIcon sx={{ color: '#34d399', fontSize: 18 }} />
                <Typography color="#34d399" fontWeight={600}>
                  Domain: {sv.emailDomain} {sv.isFreeEmail ? '(free email — consider using a business email)' : '(business email ✓)'}
                </Typography>
              </Stack>
            ) : (
              <Button variant="contained" onClick={handleEmailCheck} disabled={saving}
                sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
                {saving ? <CircularProgress size={18} /> : 'Check My Email'}
              </Button>
            )}
          </StepContent>
        </Step>

        {/* Step 2: Payment Method */}
        <Step completed={steps.paymentMethod}>
          <StepLabel icon={<PaymentIcon sx={{ color: steps.paymentMethod ? '#34d399' : '#6366f1' }} />}>
            Payment Method on File
          </StepLabel>
          <StepContent>
            <Typography variant="body2" color="rgba(255,255,255,0.6)" mb={2}>
              Add a credit card or bank account. Required before you can post loads — ensures carriers get paid.
            </Typography>
            {sv.paymentMethodVerified ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleIcon sx={{ color: '#34d399', fontSize: 18 }} />
                <Typography color="#34d399" fontWeight={600}>
                  {sv.paymentMethodType === 'bank_account' ? 'Bank account' : 'Card'} ending in {sv.paymentMethodLast4} ✓
                </Typography>
              </Stack>
            ) : (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                Go to <strong>Payments</strong> to set up Stripe and add a payment method. Once added, this step completes automatically.
              </Alert>
            )}
          </StepContent>
        </Step>

        {/* Step 3: Business Identity (EIN) */}
        <Step completed={steps.businessIdentity}>
          <StepLabel icon={<BusinessIcon sx={{ color: steps.businessIdentity ? '#34d399' : '#6366f1' }} />}>
            Business Identity (EIN)
          </StepLabel>
          <StepContent>
            <Typography variant="body2" color="rgba(255,255,255,0.6)" mb={2}>
              Your Employer Identification Number verifies your business is real. We validate the format and store only a masked version.
            </Typography>
            {sv.einVerified ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleIcon sx={{ color: '#34d399', fontSize: 18 }} />
                <Typography color="#34d399" fontWeight={600}>
                  EIN: {sv.ein} — {sv.businessName} ✓
                </Typography>
              </Stack>
            ) : (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField label="EIN (XX-XXXXXXX) *" fullWidth size="small" placeholder="12-3456789"
                    value={einForm.ein} onChange={e => setEinForm(p => ({ ...p, ein: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Business Name" fullWidth size="small"
                    value={einForm.businessName} onChange={e => setEinForm(p => ({ ...p, businessName: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="State of Incorporation" fullWidth size="small"
                    value={einForm.stateOfIncorporation} onChange={e => setEinForm(p => ({ ...p, stateOfIncorporation: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Business Type</InputLabel>
                    <Select value={einForm.businessType} label="Business Type"
                      onChange={e => setEinForm(p => ({ ...p, businessType: e.target.value }))}>
                      {BUSINESS_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <Button variant="contained" onClick={handleEINSubmit} disabled={saving}
                    sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
                    {saving ? <CircularProgress size={18} /> : 'Verify EIN'}
                  </Button>
                </Grid>
              </Grid>
            )}
          </StepContent>
        </Step>

        {/* Step 4: Documents (optional) */}
        <Step>
          <StepLabel icon={<UploadFileIcon sx={{ color: sv.documentsOnFile?.length > 0 ? '#34d399' : '#6366f1' }} />}>
            Supporting Documents (Optional)
          </StepLabel>
          <StepContent>
            <Typography variant="body2" color="rgba(255,255,255,0.6)" mb={2}>
              Upload business license, tax certificate, or insurance COI to increase your trust level and get faster admin approval.
            </Typography>
            <Stack spacing={1}>
              {['business_license', 'tax_certificate', 'insurance_coi'].map(docType => {
                const existing = sv.documentsOnFile?.find(d => d.docType === docType);
                return (
                  <Stack key={docType} direction="row" alignItems="center" spacing={1}>
                    {existing ? (
                      <>
                        <CheckCircleIcon sx={{ color: existing.verified ? '#34d399' : '#fbbf24', fontSize: 18 }} />
                        <Typography color="rgba(255,255,255,0.7)" fontSize="0.85rem">
                          {docType.replace(/_/g, ' ')} — {existing.verified ? 'verified' : 'pending review'}
                        </Typography>
                      </>
                    ) : (
                      <Button component="label" size="small" startIcon={<UploadFileIcon />}
                        sx={{ color: '#6366f1', fontSize: '0.8rem', textTransform: 'none' }}>
                        Upload {docType.replace(/_/g, ' ')}
                        <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png"
                          onChange={e => handleDocUpload(e, docType)} />
                      </Button>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </StepContent>
        </Step>

        {/* Step 5: Admin Review */}
        <Step completed={sv.status === 'verified'}>
          <StepLabel icon={<VerifiedIcon sx={{ color: sv.status === 'verified' ? '#34d399' : '#6366f1' }} />}>
            Admin Review
          </StepLabel>
          <StepContent>
            {sv.status === 'verified' ? (
              <Alert severity="success" sx={{ borderRadius: 2 }}>
                Your account is fully verified. You have full platform access.
              </Alert>
            ) : sv.status === 'rejected' ? (
              <Alert severity="error" sx={{ borderRadius: 2 }}>
                Verification rejected: {sv.rejectionNote || 'Contact support.'}
              </Alert>
            ) : (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                Complete the steps above to submit for admin review. Once reviewed, you'll receive full platform access.
              </Alert>
            )}
          </StepContent>
        </Step>
      </Stepper>

      {/* Permissions Summary */}
      <Paper sx={{ p: 2.5, mt: 3, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
        <Typography fontWeight={700} color="#fff" mb={1.5}>Your Permissions</Typography>
        <Grid container spacing={1}>
          {[
            ['Browse loads', true],
            ['Post loads', permissions.canPostLoads],
            ['Use preferred carriers', permissions.canUsePreferredCarriers],
            ['Create contracts', permissions.canUseContracts],
          ].map(([label, allowed]) => (
            <Grid item xs={6} key={label}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                {allowed
                  ? <CheckCircleIcon sx={{ color: '#34d399', fontSize: 16 }} />
                  : <WarningAmberIcon sx={{ color: '#94a3b8', fontSize: 16 }} />
                }
                <Typography variant="body2" color={allowed ? '#34d399' : 'rgba(255,255,255,0.4)'}>
                  {label}
                </Typography>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Paper>
    </Box>
  );
}
