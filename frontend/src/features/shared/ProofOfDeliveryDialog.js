// Proof of delivery: upload the POD (photo/PDF), receiver name and optional signature, then mark the load delivered.
import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField,
  Typography, Alert, CircularProgress,
} from '@mui/material';
import api from '../../services/api';
import SignaturePad from '../../components/SignaturePad';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];

export default function ProofOfDeliveryDialog({ open, load, onClose, onDelivered }) {
  const [file, setFile] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState(null); // PNG data URL
  const [padOpen, setPadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hasPod = !!load?.documents?.pod;

  useEffect(() => {
    if (open) { setFile(null); setSignerName(''); setSignature(null); setError(''); setBusy(false); }
  }, [open]);

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!ALLOWED.includes(f.type)) { setError('Choose a JPG, PNG or PDF file.'); return; }
    if (f.size > MAX_BYTES) { setError('The file is larger than 10 MB.'); return; }
    setError('');
    setFile(f);
  };

  const name = signerName.trim();
  const canSubmit = !busy && (hasPod || (file && name && name.length <= 120));

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (!hasPod) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('signerName', name);
        if (signature) fd.append('signatureData', signature);
        await api.post(`/documents/pod/${load._id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      await api.put(`/loads/${load._id}/status`, { status: 'delivered' });
      onDelivered?.(load._id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark this load delivered.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>Proof of delivery</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {hasPod ? (
            <Typography variant="body2">
              Proof of delivery is already on file for this load. Confirm to mark it delivered.
            </Typography>
          ) : (
            <>
              <Typography variant="body2">
                A delivery cannot be completed without proof. Upload a photo of the signed receipt or a PDF.
              </Typography>
              <Button component="label" variant="outlined" disabled={busy}>
                {file ? `Selected: ${file.name}` : 'Choose photo or PDF'}
                <input type="file" hidden accept="image/jpeg,image/png,application/pdf" onChange={pickFile} />
              </Button>
              <TextField
                label="Receiver's name" size="small" fullWidth required
                value={signerName} onChange={(e) => setSignerName(e.target.value)}
                inputProps={{ maxLength: 120 }} disabled={busy}
              />
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Button variant="outlined" size="small" onClick={() => setPadOpen(true)} disabled={busy}>
                  {signature ? 'Re-sign' : 'Add signature (optional)'}
                </Button>
                {signature && <Typography variant="caption">Signature captured</Typography>}
              </Stack>
            </>
          )}
          {busy && <Typography variant="caption">{hasPod ? 'Marking delivered…' : 'Uploading proof and marking delivered…'}</Typography>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {busy ? <CircularProgress size={18} /> : 'Mark delivered'}
        </Button>
      </DialogActions>
      <SignaturePad
        open={padOpen}
        title="Receiver signature"
        subtitle="The receiver signs to confirm the freight was delivered."
        onClose={() => setPadOpen(false)}
        onSave={({ dataUrl, signerName: n }) => {
          setSignature(dataUrl);
          if (!signerName.trim() && n) setSignerName(n);
          setPadOpen(false);
        }}
      />
    </Dialog>
  );
}
