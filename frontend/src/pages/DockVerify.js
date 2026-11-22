// src/pages/DockVerify.js — public, no-account pickup check for dock staff.
// Reached via the link the shipper sends (/dock/:token). Mobile-first.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, TextField, Typography } from '@mui/material';
import api from '../services/api';

const fmt = (d) => (d ? new Date(d).toLocaleString() : null);

export default function DockVerify() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, carrier, message, locked, attemptsRemaining }

  useEffect(() => {
    api.get(`/dock/${token}`)
      .then(({ data }) => setInfo(data))
      .catch((e) => {
        const st = e?.response?.status;
        setLoadError(st === 404 || st === 410 || !e?.response
          ? 'This dock link is invalid or has expired. Ask the shipper for a new dock link. Do not release freight based on this page.'
          : (e.response.data?.error || 'Could not load this page. Try again shortly. Do not release freight until the pickup is verified.'));
      });
  }, [token]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/dock/${token}/verify`, { code });
      setResult({ ok: true, carrier: data.carrier });
    } catch (e) {
      const d = e?.response?.data || {};
      setResult({ ok: false, message: d.error || 'Verification failed', locked: !!d.locked, attemptsRemaining: d.attemptsRemaining });
    } finally {
      setBusy(false);
    }
  };

  const carrier = result?.carrier || info?.carrier;
  const verified = result?.ok || info?.state === 'verified';
  const locked = result?.locked || info?.state === 'locked';

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', p: 2, pt: 3 }}>
      <Box sx={{ width: '100%', maxWidth: 480 }}>
      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5, px: 0.5 }}>FreightConnect</Typography>
      <Paper sx={{ width: '100%', p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" fontWeight={800} sx={{ mb: 2, lineHeight: 1.3 }}>Pickup check</Typography>
        {!info && !loadError && <CircularProgress />}
        {loadError && <Alert severity="error">{loadError}</Alert>}

        {info && info.state === 'not_booked' && (
          <Alert severity="warning">This load is not currently booked to a carrier. Do not release freight.</Alert>
        )}

        {info && info.state !== 'not_booked' && (
          <>
            <Typography variant="body1" fontWeight={700}>{info.loadTitle}</Typography>
            <Typography variant="body2">{[info.facility, info.address || info.origin].filter(Boolean).join(' — ')}</Typography>
            {info.reference && <Typography variant="body2">Ref: {info.reference}</Typography>}
            {info.pickupWindow?.start && <Typography variant="body2">Window: {fmt(info.pickupWindow.start)}{info.pickupWindow.end ? ` – ${fmt(info.pickupWindow.end)}` : ''}</Typography>}

            <Box my={2} p={1.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="caption">Booked carrier — must match the truck and driver in front of you</Typography>
              <Typography variant="h6">{carrier?.companyName}</Typography>
              <Typography variant="body2">MC {carrier?.mcNumber || 'not confirmed'} · DOT {carrier?.dotNumber || 'not confirmed'}{carrier?.authorityOnFile && (carrier.mcNumber || carrier.dotNumber) ? ' (from FMCSA record)' : ''}</Typography>
              {carrier?.identityVerified === true && (
                <Alert severity="success" sx={{ mt: 1 }}>Identity confirmed. This carrier's account is verified as controlling this FMCSA-registered company.</Alert>
              )}
              {carrier && carrier.identityVerified !== true && carrier.authorityOnFile && (
                <Alert severity="warning" sx={{ mt: 1 }}>A company named {carrier.companyName} (DOT {carrier.dotNumber || 'not confirmed'}) has operating authority, but we have not confirmed this account belongs to that company. Check the name on the truck door and the driver's ID.</Alert>
              )}
              {carrier && !carrier.identityVerified && !carrier.authorityOnFile && (
                <Alert severity="warning" sx={{ mt: 1 }}>This carrier typed in its own name and numbers, and they are not confirmed with FMCSA. Check the name on the truck door and the driver's ID carefully.</Alert>
              )}
              {(info.driverName || info.truckId) && (
                <Typography variant="body2">{[info.driverName && `Driver: ${info.driverName}`, info.truckId && `Truck: ${info.truckId}`].filter(Boolean).join(' · ')}</Typography>
              )}
            </Box>

            {verified && (
              <Alert severity="success" sx={{ fontSize: 18 }}>
                Verified — {carrier?.companyName}, MC {carrier?.mcNumber || 'n/a'}
              </Alert>
            )}
            {locked && !verified && (
              <Alert severity="error">
                Locked after too many wrong codes. Do NOT release the freight — contact the shipper.
              </Alert>
            )}
            {!verified && !locked && (
              <>
                <Typography variant="body2" gutterBottom>Ask the driver to show the 6-digit code on their app, then enter it:</Typography>
                <TextField
                  fullWidth autoFocus value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, style: { fontSize: 36, letterSpacing: 8, textAlign: 'center' } }}
                />
                <Button fullWidth size="large" variant="contained" sx={{ mt: 2, py: 1.5 }} onClick={submit} disabled={busy || code.length !== 6}>
                  {busy ? <CircularProgress size={22} /> : 'Verify'}
                </Button>
                {result && !result.ok && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {result.message}{result.attemptsRemaining != null && !result.locked ? ` — ${result.attemptsRemaining} attempt(s) remaining` : ''}
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      The code is shown in the driver's FreightConnect app, on the pickup screen for this load. The driver should not read it out over the phone to anyone else.
                    </Typography>
                  </Alert>
                )}
              </>
            )}
          </>
        )}
      </Paper>
      </Box>
    </Box>
  );
}
