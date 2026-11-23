import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import api from '../../services/api';

/** Shows the QR code the receiver scans to read and sign the delivery documents on its own device. */
export default function DeliveryPassDialog({ load, onClose }) {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const loadId = load?._id;

  useEffect(() => {
    if (!loadId) return;
    setPass(null); setError(null); setCopied(false);
    api.post(`/loads/${loadId}/delivery-pass`)
      .then(({ data }) => setPass(data))
      .catch((e) => setError(e?.response?.data?.error || 'The delivery link could not be created.'));
  }, [loadId]);

  const url = pass && (pass.url || window.location.origin + pass.path);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the link is shown below to copy by hand */ }
  };

  return (
    <Dialog open={!!load} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Present documents</DialogTitle>
      <DialogContent sx={{ textAlign: 'center' }}>
        {!pass && !error && <CircularProgress />}
        {error && <Alert severity="error">{error}</Alert>}
        {pass && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Ask the receiver to scan this code with their phone. They can read the bill of lading and sign for the delivery on their own device. Nothing to print.
            </Typography>
            {pass.qr && (
              <Box component="img" src={pass.qr} alt="QR code for the delivery documents" sx={{ width: '100%', maxWidth: 260, borderRadius: 1, background: '#fff', p: 1 }} />
            )}
            <Typography variant="caption" sx={{ display: 'block', mt: 1.5, overflowWrap: 'anywhere' }}>{url}</Typography>
            {copied && <Alert severity="success" sx={{ mt: 1 }}>Link copied.</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {pass && <Button onClick={copy}>Copy link</Button>}
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
