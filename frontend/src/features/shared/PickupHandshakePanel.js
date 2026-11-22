/**
 * PickupHandshakePanel — anti-impersonation pickup check (see backend
 * routes/pickupVerificationRoutes.js).
 *
 *  carrier: shows the 6-digit code the driver shows at the dock.
 *  shipper: shows verification status, "Copy dock link", a field for the driver's
 *           code, "Unlock" after a lockout and a "Require" switch.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import api from '../../services/api';
import { semantic, surface, text as T } from '../../theme/tokens';

const errMsg = (e, fallback) => e?.response?.data?.error || fallback;

export default function PickupHandshakePanel({ load, userRole }) {
  const [pv, setPv] = useState(load?.pickupVerification || {});
  const [code, setCode] = useState(null);       // carrier: the code to show
  const [input, setInput] = useState('');       // shipper: the code the driver showed
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);         // { severity, text }
  const [dockLink, setDockLink] = useState(null); // shipper: { url, expiresAt }

  const id = load?._id;
  const booked = load?.status === 'accepted' || load?.status === 'in-transit';
  const verified = !!pv.verifiedAt;
  const locked = !!pv.lockedAt && !verified;
  const isCarrier = userRole === 'carrier';
  const isShipper = userRole === 'shipper' || userRole === 'admin';

  useEffect(() => { setPv(load?.pickupVerification || {}); }, [id, load?.pickupVerification]);

  useEffect(() => {
    if (!isCarrier || !id || load?.status !== 'accepted' || verified) return undefined;
    let cancelled = false;
    api.get(`/loads/${id}/pickup-code`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.verified) setPv((p) => ({ ...p, verifiedAt: data.verifiedAt }));
        else setCode(data.code);
      })
      .catch((e) => !cancelled && setMsg({ severity: 'warning', text: errMsg(e, 'Pickup code unavailable') }));
    return () => { cancelled = true; };
  }, [isCarrier, id, load?.status, verified]);

  if (!id || !booked) return null;

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Request failed') }); } finally { setBusy(false); }
  };

  const copyLink = () => run(async () => {
    const { data } = await api.post(`/loads/${id}/dock-link`);
    const url = `${window.location.origin}${data.path}`;
    setDockLink({ url, expiresAt: data.expiresAt });
    try {
      await navigator.clipboard.writeText(url);
      setMsg({ severity: 'success', text: 'Dock link copied. Send it to the facility — they enter the code the driver shows.' });
    } catch { setMsg({ severity: 'info', text: 'Could not copy automatically. Copy the link below and send it to the facility.' }); }
  });
  const copyShown = async () => {
    try { await navigator.clipboard.writeText(dockLink.url); setMsg({ severity: 'success', text: 'Dock link copied.' }); }
    catch { setMsg({ severity: 'info', text: 'Copy blocked by the browser. Select the link above and copy it manually.' }); }
  };
  const verify = () => run(async () => {
    try {
      const { data } = await api.post(`/loads/${id}/pickup-verify`, { code: input });
      setPv((p) => ({ ...p, verifiedAt: data.verifiedAt })); setInput('');
    } catch (e) {
      const d = e?.response?.data;
      if (d?.locked) setPv((p) => ({ ...p, lockedAt: new Date().toISOString() }));
      throw e;
    }
  });
  const unlock = () => run(async () => {
    await api.post(`/loads/${id}/pickup-unlock`);
    setPv((p) => ({ ...p, lockedAt: null, failedAttempts: 0 }));
  });
  const require_ = () => run(async () => {
    await api.put(`/loads/${id}/pickup-required`, { required: true });
    setPv((p) => ({ ...p, required: true }));
  });

  const status = verified ? { color: semantic.success, label: `Verified at ${new Date(pv.verifiedAt).toLocaleString()}` }
    : locked ? { color: semantic.error, label: 'Locked — too many wrong codes' }
    : pv.required ? { color: semantic.warning, label: isCarrier ? 'Required: the dock must verify this code before you can start the load.' : 'Waiting for dock verification (required before pickup)' }
    : { color: semantic.muted, label: isCarrier ? 'Pickup code (optional for this load). If the dock asks for it, show this code.' : 'Not required — waiting for dock verification' };

  return (
    <Box mb={2} p={2} sx={{ borderRadius: 2, border: `1px solid ${surface.glassBorder}`, bgcolor: surface.glassLight }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>Pickup verification</Typography>
      <Typography variant="body2" sx={{ color: status.color, fontWeight: 600 }}>{status.label}</Typography>

      {isCarrier && !verified && code && (
        <Box textAlign="center" my={1.5}>
          <Typography sx={{ fontSize: 44, fontWeight: 800, letterSpacing: 8, fontFamily: 'monospace' }}>{code}</Typography>
          <Typography variant="caption" sx={{ color: T.secondary }}>
            Show this code to the dock. Never share it by phone, text or email.
          </Typography>
        </Box>
      )}

      {isShipper && !verified && (
        <Stack spacing={1} mt={1.5}>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={copyLink} disabled={busy}>Copy dock link</Button>
            {!pv.required && <Button size="small" variant="text" onClick={require_} disabled={busy}>Require before pickup</Button>}
            {locked && <Button size="small" color="error" variant="contained" onClick={unlock} disabled={busy}>Unlock</Button>}
          </Stack>
          {dockLink && (
            <Box>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small" fullWidth value={dockLink.url} label="Dock link"
                  inputProps={{ readOnly: true, 'aria-label': 'Dock link' }}
                  onFocus={(e) => e.target.select()}
                />
                <Button size="small" variant="outlined" onClick={copyShown}>Copy</Button>
              </Stack>
              <Typography variant="caption" sx={{ color: T.secondary }}>
                Expires {new Date(dockLink.expiresAt).toLocaleDateString()} (14 days). Anyone with this link can see the booked carrier's name for this load (not the rate, not the code).
              </Typography>
            </Box>
          )}
          {!locked && (
            <Stack direction="row" spacing={1}>
              <TextField
                size="small" label="Driver's 6-digit code" value={input}
                onChange={(e) => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputProps={{ inputMode: 'numeric', maxLength: 6 }}
              />
              <Button variant="contained" onClick={verify} disabled={busy || input.length !== 6}>
                {busy ? <CircularProgress size={18} /> : 'Verify'}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
      {msg && <Alert severity={msg.severity} sx={{ mt: 1 }}>{msg.text}</Alert>}
    </Box>
  );
}
