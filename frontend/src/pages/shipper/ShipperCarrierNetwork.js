/**
 * ShipperCarrierNetwork — "My Carriers"
 *
 * The shipper's private carrier list. Carriers here can be offered a load first, one at a time,
 * before anyone else sees it (see "Offer to my carriers one at a time" on Post Load).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Paper, Button, CircularProgress, Alert, TextField, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Chip,
} from '@mui/material';
import api from '../../services/api';

const TIERS = [['gold', 'Gold (offered first)'], ['silver', 'Silver'], ['standard', 'Standard']];
const errMsg = (err, fallback) => err.response?.data?.error || fallback;

const carrierName = (c) => c?.verification?.fmcsaData?.legalName || c?.companyName || c?.name || 'Carrier';
const dotOf = (c) => c?.verification?.fmcsaData?.dotNumber;
const onTime = (c) => (c?.trustScore?.onTimeRate == null ? '—' : `${Math.round(c.trustScore.onTimeRate * (c.trustScore.onTimeRate <= 1 ? 100 : 1))}%`);

function CarrierInfo({ carrier }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography fontWeight={800} sx={{ color: '#fff' }} noWrap>{carrierName(carrier)}</Typography>
      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
        {dotOf(carrier) ? `DOT ${dotOf(carrier)} · ` : ''}
        Trust score {carrier?.trustScore?.score ?? '—'} · On time {onTime(carrier)}
        {carrier?.trustScore?.totalLoadsCompleted != null ? ` · ${carrier.trustScore.totalLoadsCompleted} loads` : ''}
      </Typography>
    </Box>
  );
}

export default function ShipperCarrierNetwork() {
  const [network, setNetwork] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dot, setDot] = useState('');
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const [n, c] = await Promise.all([api.get('/preferred-carriers'), api.get('/preferred-carriers/candidates')]);
      setNetwork(Array.isArray(n.data) ? n.data : []);
      setCandidates(Array.isArray(c.data) ? c.data : []);
      setError('');
    } catch (err) {
      setError(errMsg(err, 'Could not load your carriers. Please try again.'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One wrapper for every write: show the server's message as-is, then reload.
  const run = async (fn, okMsg) => {
    setBusy(true); setNotice(''); setError('');
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
      await load();
      return true;
    } catch (err) {
      setError(errMsg(err, 'That did not work. Please try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addByDot = async () => {
    const dotNumber = dot.trim();
    if (!/^\d{1,8}$/.test(dotNumber)) { setError('Enter the carrier\'s DOT number (digits only).'); return; }
    if (await run(() => api.post('/preferred-carriers', { dotNumber }), 'Carrier added.')) setDot('');
  };

  if (!network && !error) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: { xs: 1, md: 3 } }}>
      <Typography variant="h4" fontWeight={900} sx={{ color: '#fff' }} mb={1}>My Carriers</Typography>
      <Typography sx={{ color: '#cbd5e1' }} mb={3}>
        Carriers in this list can be offered your loads first, one at a time, before anyone else sees them.
        Gold carriers are asked first, then silver, then standard. Pause a carrier to skip them without removing them.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Paper sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Typography fontWeight={800} sx={{ color: '#fff' }} mb={1}>Add by DOT number</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField size="small" label="DOT number" value={dot} onChange={(e) => setDot(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addByDot(); }} sx={{ flex: 1 }} inputProps={{ inputMode: 'numeric' }} />
          <Button variant="contained" disabled={busy || !dot.trim()} onClick={addByDot}>Add carrier</Button>
        </Stack>
      </Paper>

      <Typography variant="h6" fontWeight={800} sx={{ color: '#fff' }} mb={1}>Your network</Typography>
      {network && network.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No carriers yet. Add one by DOT number above{candidates?.length ? ', or pick from the carriers who have hauled for you below' : ''}.
        </Alert>
      )}
      <Stack spacing={1.5} mb={4}>
        {(network || []).map((e) => (
          <Paper key={e._id} sx={{ p: 2, borderRadius: 3, opacity: e.isActive ? 1 : 0.65 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
              <CarrierInfo carrier={e.carrier} />
              {!e.isActive && <Chip size="small" label="Paused" />}
              <TextField select size="small" label="Tier" value={e.tier || 'standard'} disabled={busy} sx={{ minWidth: 180 }}
                onChange={(ev) => run(() => api.put(`/preferred-carriers/${e._id}`, { tier: ev.target.value }))}>
                {TIERS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <Button color="inherit" variant="outlined" size="small" disabled={busy} onClick={() => run(() => api.put(`/preferred-carriers/${e._id}`, { isActive: !e.isActive }))}>
                {e.isActive ? 'Pause' : 'Resume'}
              </Button>
              <Button color="error" variant="outlined" size="small" disabled={busy} onClick={() => setRemoving(e)}>Remove</Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Typography variant="h6" fontWeight={800} sx={{ color: '#fff' }} mb={1}>Carriers who hauled for you</Typography>
      {candidates && candidates.length === 0 && (
        <Typography sx={{ color: '#94a3b8' }}>No one new yet. Carriers who deliver your loads will show up here.</Typography>
      )}
      <Stack spacing={1.5}>
        {(candidates || []).map((c) => (
          <Paper key={c._id} sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CarrierInfo carrier={c} />
              <Button variant="outlined" disabled={busy}
                onClick={() => run(() => api.post('/preferred-carriers', { carrierId: c._id }), 'Carrier added.')}>Add</Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)}>
        <DialogTitle>Remove carrier?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {removing ? carrierName(removing.carrier) : ''} will no longer be offered your loads first. You can add them again later.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>Keep</Button>
          <Button color="error" onClick={() => { const r = removing; setRemoving(null); run(() => api.delete(`/preferred-carriers/${r._id}`), 'Carrier removed.'); }}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
