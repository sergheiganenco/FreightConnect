import React, { useState } from 'react';
import {
  Box, Typography, Stepper, Step, StepLabel, Button, TextField,
  Paper, Stack, Chip, CircularProgress, Alert, Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VerifiedIcon from '@mui/icons-material/Verified';
import api from '../../services/api';

const STEPS = ['MC / DOT Lookup', 'Upload Documents', 'Confirmation'];

const DOC_TYPES = [
  { key: 'coi', label: 'Certificate of Insurance (COI)', required: true },
  { key: 'authority_letter', label: 'Operating Authority Letter', required: true },
  { key: 'w9', label: 'W-9 Form', required: false },
  { key: 'equipment_list', label: 'Equipment List', required: false },
];

export default function CarrierVerification({ onComplete }) {
  const [step, setStep] = useState(0);
  const [mcNumber, setMcNumber] = useState('');
  const [dotNumber, setDotNumber] = useState('');
  const [lookupStatus, setLookupStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [lookupMsg, setLookupMsg] = useState('');
  const [uploads, setUploads] = useState({}); // { docType: 'done' | 'uploading' | 'error' }
  const [uploadError, setUploadError] = useState('');

  // Step 1 — FMCSA lookup
  const handleLookup = async () => {
    if (!mcNumber && !dotNumber) return;
    setLookupStatus('loading');
    setLookupMsg('');
    try {
      const { data } = await api.post('/verification/carrier/start', { mcNumber, dotNumber });
      setLookupStatus('success');
      setLookupMsg(data.message);
    } catch (err) {
      setLookupStatus('error');
      setLookupMsg(err.response?.data?.error || 'Verification failed. Please try again.');
    }
  };

  // Step 2 — document upload
  const handleUpload = async (docType, file) => {
    if (!file) return;
    setUploads((prev) => ({ ...prev, [docType]: 'uploading' }));
    setUploadError('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    try {
      await api.post('/verification/carrier/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploads((prev) => ({ ...prev, [docType]: 'done' }));
    } catch (err) {
      setUploads((prev) => ({ ...prev, [docType]: 'error' }));
      setUploadError(err.response?.data?.error || 'Upload failed');
    }
  };

  const requiredDone = DOC_TYPES.filter((d) => d.required).every(
    (d) => uploads[d.key] === 'done'
  );

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Stepper activeStep={step} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel
              sx={{
                '& .MuiStepLabel-label': { color: 'rgba(255,255,255,0.7)' },
                '& .MuiStepLabel-label.Mui-active': { color: '#fff', fontWeight: 700 },
                '& .MuiStepLabel-label.Mui-completed': { color: '#34d399' },
              }}
            >
              {label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── Step 0: MC / DOT Lookup ── */}
      {step === 0 && (
        <Paper sx={{ p: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
          <Typography variant="h6" fontWeight={700} mb={1}>Enter Your MC or DOT Number</Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 3 }}>
            We'll verify your operating authority with the FMCSA database.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="MC Number"
              value={mcNumber}
              onChange={(e) => setMcNumber(e.target.value)}
              placeholder="e.g. 123456"
              fullWidth
              sx={{ '& .MuiInputBase-input': { color: '#fff' }, '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' } }}
            />
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>— OR —</Typography>
            <TextField
              label="DOT Number"
              value={dotNumber}
              onChange={(e) => setDotNumber(e.target.value)}
              placeholder="e.g. 1234567"
              fullWidth
              sx={{ '& .MuiInputBase-input': { color: '#fff' }, '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' } }}
            />
          </Stack>

          {lookupMsg && (
            <Alert severity={lookupStatus === 'success' ? 'success' : 'error'} sx={{ mt: 2 }}>
              {lookupMsg}
            </Alert>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, gap: 2 }}>
            <Button
              variant="contained"
              onClick={handleLookup}
              disabled={lookupStatus === 'loading' || (!mcNumber && !dotNumber)}
              sx={{ background: 'linear-gradient(135deg, #6a1fcf, #e1129a)', borderRadius: 9999 }}
            >
              {lookupStatus === 'loading' ? <CircularProgress size={20} color="inherit" /> : 'Verify with FMCSA'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => setStep(1)}
              disabled={lookupStatus !== 'success'}
              sx={{ borderRadius: 9999, color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            >
              Next
            </Button>
          </Box>
        </Paper>
      )}

      {/* ── Step 1: Document Upload ── */}
      {step === 1 && (
        <Paper sx={{ p: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
          <Typography variant="h6" fontWeight={700} mb={1}>Upload Documents</Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 3 }}>
            Required documents are marked with *. Accepted formats: PDF, JPG, PNG (max 10 MB).
          </Typography>

          {uploadError && <Alert severity="error" sx={{ mb: 2 }}>{uploadError}</Alert>}

          <Stack spacing={2}>
            {DOC_TYPES.map((doc) => {
              const status = uploads[doc.key];
              return (
                <Box
                  key={doc.key}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1.5,
                    borderRadius: 2,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: status === 'done' ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.03)',
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {doc.label} {doc.required && <span style={{ color: '#ef4444' }}>*</span>}
                    </Typography>
                    {status === 'done' && (
                      <Chip size="small" label="Uploaded" icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                        sx={{ background: 'rgba(52,211,153,0.2)', color: '#34d399', mt: 0.5, fontSize: '0.7rem' }} />
                    )}
                    {status === 'error' && (
                      <Typography variant="caption" sx={{ color: '#ef4444' }}>Upload failed</Typography>
                    )}
                  </Box>
                  <Button
                    component="label"
                    size="small"
                    variant={status === 'done' ? 'outlined' : 'contained'}
                    startIcon={status === 'uploading' ? <CircularProgress size={14} color="inherit" /> : <CloudUploadIcon />}
                    disabled={status === 'uploading'}
                    sx={{
                      borderRadius: 9999,
                      fontSize: '0.75rem',
                      background: status === 'done' ? 'transparent' : 'rgba(106,31,207,0.7)',
                      borderColor: status === 'done' ? 'rgba(255,255,255,0.2)' : 'transparent',
                    }}
                  >
                    {status === 'done' ? 'Replace' : 'Upload'}
                    <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => handleUpload(doc.key, e.target.files[0])} />
                  </Button>
                </Box>
              );
            })}
          </Stack>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button onClick={() => setStep(0)} sx={{ color: 'rgba(255,255,255,0.5)' }}>Back</Button>
            <Button
              variant="contained"
              onClick={() => setStep(2)}
              disabled={!requiredDone}
              sx={{ background: 'linear-gradient(135deg, #6a1fcf, #e1129a)', borderRadius: 9999 }}
            >
              Continue
            </Button>
          </Box>
        </Paper>
      )}

      {/* ── Step 2: Confirmation ── */}
      {step === 2 && (
        <Paper sx={{ p: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 3, textAlign: 'center' }}>
          <VerifiedIcon sx={{ fontSize: 64, color: '#34d399', mb: 2 }} />
          <Typography variant="h5" fontWeight={800} mb={1}>Verification Submitted</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', mb: 3 }}>
            Your FMCSA verification and documents have been submitted. Your status will update within a few minutes.
            An admin may review your documents if additional confirmation is needed.
          </Typography>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 3 }} />
          <Stack spacing={1} sx={{ textAlign: 'left', mb: 3 }}>
            {DOC_TYPES.map((doc) => (
              <Box key={doc.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleIcon sx={{ fontSize: 16, color: uploads[doc.key] === 'done' ? '#34d399' : 'rgba(255,255,255,0.2)' }} />
                <Typography variant="body2" sx={{ color: uploads[doc.key] === 'done' ? '#fff' : 'rgba(255,255,255,0.35)' }}>
                  {doc.label}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Button
            variant="contained"
            onClick={onComplete}
            sx={{ background: 'linear-gradient(135deg, #6a1fcf, #e1129a)', borderRadius: 9999, px: 4 }}
          >
            Go to Dashboard
          </Button>
        </Paper>
      )}
    </Box>
  );
}
