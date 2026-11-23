/**
 * TenderProgress — shipper's "Offer progress" list for a load offered to their carriers one at a time.
 * Fetches itself; renders nothing when the load has no tender.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Stack, Alert } from '@mui/material';
import api from '../../services/api';

const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function stateText(q, tender) {
  switch (q.state) {
    case 'offered': return `Offered now${tender.expiresAt ? ` — answer due ${hhmm(tender.expiresAt)}` : ''}`;
    case 'waiting': return 'Waiting';
    case 'declined': return `Declined${q.reason ? ` ("${q.reason}")` : ''}`;
    case 'expired': return 'No answer';
    case 'skipped': return 'Skipped — not eligible';
    case 'cancelled': return 'Gave the load back';
    case 'accepted': return 'Accepted';
    default: return 'Not reached';
  }
}

function endText(t) {
  if (t.result === 'accepted') return 'A carrier accepted this load.';
  if (t.result === 'stopped') return 'You stopped the offer early.';
  const after = t.fallback === 'private' ? 'it goes to all your carriers at once' : 'it goes to the public load board';
  return t.result === 'exhausted'
    ? `Nobody accepted, so ${after.replace('it goes', 'it went')}.`
    : `If nobody accepts, ${after}.`;
}

export default function TenderProgress({ loadId }) {
  const [tender, setTender] = useState(null);
  const [error, setError] = useState('');

  const fetchTender = useCallback(async () => {
    try {
      const { data } = await api.get(`/loads/${loadId}/tender`);
      setTender(data?.tender || null);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load offer progress.');
    }
  }, [loadId]);

  useEffect(() => {
    fetchTender();
    const t = setInterval(fetchTender, 30000); // the offer moves on its own while the modal is open
    return () => clearInterval(t);
  }, [fetchTender]);

  if (error) return <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>;
  if (!tender) return null;

  return (
    <Box mb={2}>
      <Typography variant="subtitle1" fontWeight={700} mb={1}>Offer progress</Typography>
      <Stack spacing={0.5}>
        {(tender.queue || []).map((q, i) => (
          <Stack key={`${q.carrierId}-${i}`} direction="row" spacing={1} justifyContent="space-between"
            sx={{ fontWeight: q.state === 'offered' ? 700 : 400 }}>
            <Typography variant="body2">{i + 1}. {q.name || 'Carrier'}</Typography>
            <Typography variant="body2" sx={{ opacity: 0.85, textAlign: 'right' }}>{stateText(q, tender)}</Typography>
          </Stack>
        ))}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>{endText(tender)}</Typography>
    </Box>
  );
}
