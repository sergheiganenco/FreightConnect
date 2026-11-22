/**
 * PickupWindowPanel — changing the pickup / delivery time of a load
 * (backend: PUT /loads/:id/pickup-window, PUT /loads/:id/delivery-window, POST /loads/:id/pickup-window-response).
 *
 *  shipper/admin (open or accepted load): "Change pickup time" and "Extend delivery time" dialogs. On a booked load a
 *                 pickup window that is earlier than the agreed one is only a PROPOSAL the carrier must accept;
 *                 a pending proposal is shown with "Withdraw proposal".
 *  carrier:       banner when the shipper proposed a new pickup time: "Accept new time" / "Keep agreed time".
 *
 * The agreed window on a booked load is load.bookedWindow (the backend keeps pickupTimeWindow equal to it).
 * Server messages are shown verbatim. Times are shown and entered in the viewer's local time zone.
 */
import React, { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import api from '../../services/api';
import { semantic, text as T, tint } from '../../theme/tokens';

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // same as the backend: a proposal lapses 24h after it was proposed
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const BTN = { minHeight: 44 };

/** Dark-glass alert styling (readable on the dark theme): tinted background, coloured border, light text. */
export const darkAlert = (color) => ({
  bgcolor: tint(color, 0.14), color: T.primary, border: `1px solid ${color}`,
  '& .MuiAlert-icon': { color }, '& .MuiAlert-message': { color: T.primary },
});

// dateStyle/timeStyle cannot be combined with timeZoneName (toLocaleString throws), so spell the parts out.
export const fmt = (d) => new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export const fmtWin = (w) => (w?.end ? `${fmt(w.start)} to ${fmt(w.end)}` : fmt(w.start));
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => {
  const x = d ? new Date(d) : null;
  if (!x || Number.isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
// Untouched field -> the stored instant exactly (the input only has minute precision); edited -> local time as an instant.
const instant = (value, orig) => {
  if (!value) return NaN;
  return value === toLocalInput(orig) ? new Date(orig).getTime() : new Date(value).getTime();
};
const errText = (e, fallback) => e?.response?.data?.error || e?.response?.data?.errors?.[0]?.msg || fallback;

export default function PickupWindowPanel({ load, userRole, onChanged }) {
  const [dlg, setDlg] = useState(null); // 'pickup' | 'delivery'
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState('');
  const [msg, setMsg] = useState(null);
  const fullScreen = useMediaQuery((t) => t.breakpoints.down('sm'));

  const id = load?._id;
  if (!id) return null;
  const booked = load.status === 'accepted' && !!load.acceptedBy;
  const ch = booked && load.pickupWindowChange?.status === 'pending' ? load.pickupWindowChange : null;
  const agreed = (booked && load.bookedWindow?.start ? load.bookedWindow : load.pickupTimeWindow) || {};
  const proposedWin = ch && { start: ch.proposedStart, end: ch.proposedEnd };
  const expiresAt = ch ? new Date(new Date(ch.proposedAt).getTime() + PROPOSAL_TTL_MS) : null;
  const expired = !!ch && expiresAt.getTime() < Date.now();
  const isCarrier = userRole === 'carrier';
  const canEdit = ['shipper', 'admin'].includes(userRole) && ['open', 'accepted'].includes(load.status);
  const orig = dlg === 'delivery' ? load.deliveryTimeWindow || {} : agreed;

  const refresh = async () => {
    try { const { data } = await api.get(`/loads/${id}`); if (onChanged) onChanged(data); } catch { /* the next load shows it */ }
  };
  const openDlg = (kind) => {
    const w = kind === 'delivery' ? load.deliveryTimeWindow || {} : agreed;
    setStart(toLocalInput(w.start)); setEnd(toLocalInput(w.end || w.start)); setDlgErr(''); setDlg(kind);
  };

  // Which case applies, shown BEFORE the shipper submits.
  const ns = instant(start, orig.start);
  const ne = instant(end, orig.end || orig.start);
  let advice = null;
  if (booked && Number.isFinite(ns) && Number.isFinite(ne)) {
    const as = new Date(orig.start).getTime();
    const ae = orig.end ? new Date(orig.end).getTime() : NaN;
    const same = ns === as && ne === ae;
    const notEarlier = ns >= as && ne >= ae; // an unknown agreed end cannot be shown "not earlier": fail closed
    if (dlg === 'pickup') {
      if (same) advice = { severity: 'info', text: 'This is the agreed time. Saving it withdraws any pending proposal.' };
      else if (notEarlier) advice = { severity: 'info', text: 'This applies immediately and the carrier is notified.' };
      else advice = { severity: 'warning', text: 'The carrier must accept this change. Until they do, the agreed time stays in force.' };
    } else if (dlg === 'delivery' && !notEarlier) {
      advice = { severity: 'warning', text: 'A carrier is booked, so the delivery time can only be made later. An earlier start or end is refused.' };
    }
  }

  const put = async (kind, s, e) => {
    const { data } = await api.put(`/loads/${id}/${kind === 'delivery' ? 'delivery-window' : 'pickup-window'}`,
      { start: new Date(s).toISOString(), end: new Date(e).toISOString() });
    return data;
  };
  const submit = async () => {
    if (!Number.isFinite(ns) || !Number.isFinite(ne)) { setDlgErr('Enter both a start and an end time.'); return; }
    setBusy(true); setDlgErr(''); setMsg(null);
    try {
      const data = await put(dlg, ns, ne);
      setMsg({ severity: 'success', text: data?.message || (dlg === 'pickup' ? 'Pickup time updated.' : 'Delivery time updated.') });
      setDlg(null);
      await refresh();
    } catch (e) { setDlgErr(errText(e, 'Request failed')); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    setBusy(true); setMsg(null);
    try {
      await put('pickup', new Date(agreed.start).getTime(), new Date(agreed.end).getTime()); // re-sending the agreed window withdraws it
      setMsg({ severity: 'success', text: 'Proposal withdrawn. The agreed pickup time stays in force.' });
      await refresh();
    } catch (e) { setMsg({ severity: 'error', text: errText(e, 'Could not withdraw the proposal') }); } finally { setBusy(false); }
  };
  const respond = async (accept) => {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/loads/${id}/pickup-window-response`, { accept });
      setMsg({ severity: 'success', text: accept ? 'You accepted the new pickup time.' : 'You kept the agreed pickup time.' });
    } catch (e) { setMsg({ severity: 'error', text: errText(e, 'Could not send your answer') }); } finally { setBusy(false); }
    await refresh();
  };

  if (!msg && !canEdit && !(isCarrier && ch)) return null;
  return (
    <Box sx={{ mb: 2 }} onClick={(e) => e.stopPropagation()}>
      {isCarrier && ch && (
        <Alert severity="warning" icon={false} sx={darkAlert(semantic.warning)}>
          <Typography fontWeight={700}>
            The shipper asks to change pickup to {fmtWin(proposedWin)} (currently {fmtWin(agreed)}).
          </Typography>
          <Typography variant="body2" sx={{ my: 0.5 }}>
            If you don't answer, the agreed time stays in force.{' '}
            {expired ? 'This request has expired.' : `The request expires ${fmt(expiresAt)}, 24 hours after it was proposed.`}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            {!expired && <Button variant="contained" sx={BTN} disabled={busy} onClick={() => respond(true)}>Accept new time</Button>}
            <Button variant="outlined" sx={{ ...BTN, color: T.primary, borderColor: T.secondary }} disabled={busy} onClick={() => respond(false)}>Keep agreed time</Button>
          </Stack>
        </Alert>
      )}

      {canEdit && ch && (
        <Alert severity="info" sx={{ mb: 1, ...darkAlert(semantic.info) }}>
          <Typography fontWeight={700}>Proposed: {fmtWin(proposedWin)}. Waiting for the carrier.</Typography>
          <Typography variant="body2">
            Proposed {fmt(ch.proposedAt)}. {expired ? 'It has expired.' : `It expires ${fmt(expiresAt)}, 24 hours after it was proposed.`}{' '}
            Until the carrier accepts, the agreed time ({fmtWin(agreed)}) stays in force.
          </Typography>
          {agreed.end && <Button size="small" sx={{ ...BTN, mt: 0.5, color: semantic.info }} disabled={busy} onClick={withdraw}>Withdraw proposal</Button>}
        </Alert>
      )}

      {canEdit && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="outlined" sx={BTN} onClick={() => openDlg('pickup')}>Change pickup time</Button>
          <Button variant="outlined" sx={BTN} onClick={() => openDlg('delivery')}>{booked ? 'Extend delivery time' : 'Change delivery time'}</Button>
        </Stack>
      )}
      {msg && <Alert severity={msg.severity} sx={{ mt: 1 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Dialog open={!!dlg} onClose={() => !busy && setDlg(null)} fullWidth maxWidth="xs" fullScreen={fullScreen}>
        <DialogTitle>{dlg === 'delivery' ? (booked ? 'Extend delivery time' : 'Change delivery time') : 'Change pickup time'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>Times are in your local time zone ({TZ}).</Typography>
          <Stack spacing={2}>
            <TextField label="Start" type="datetime-local" fullWidth InputLabelProps={{ shrink: true }} value={start} onChange={(e) => setStart(e.target.value)} />
            <TextField label="End" type="datetime-local" fullWidth InputLabelProps={{ shrink: true }} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Stack>
          {dlg === 'delivery' && booked && !advice && (
            <Alert severity="info" sx={{ mt: 2 }}>A carrier is booked, so the delivery time can only be made later.</Alert>
          )}
          {advice && <Alert severity={advice.severity} sx={{ mt: 2 }}>{advice.text}</Alert>}
          {dlgErr && <Alert severity="error" sx={{ mt: 2 }}>{dlgErr}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button sx={BTN} disabled={busy} onClick={() => setDlg(null)}>Cancel</Button>
          <Button variant="contained" sx={BTN} disabled={busy} onClick={submit}>{busy ? <CircularProgress size={18} /> : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
