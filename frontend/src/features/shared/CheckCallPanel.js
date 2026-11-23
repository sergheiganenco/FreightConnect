/**
 * CheckCallPanel — automatic check calls (backend: jobs/checkCallMonitor, GET/POST /loads/:id/check-call[s]).
 *
 *  both roles: timeline (newest first) with the time, the message, a position chip and the ETA when the system computed one.
 *  shipper/admin: read-only, with a one-line header for the latest state.
 *  carrier: one-tap answer row (On schedule / Delayed / At facility / Stopped), highlighted when the system is asking.
 *
 * Position chip: "Confirmed position" = fresh + authenticated GPS; "Driver-reported" = the driver's own statement
 * (never upgrades the position or the ETA); "Unconfirmed" = anything else.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { semantic, text as T, tint } from '../../theme/tokens';
import { darkAlert, fmt } from './PickupWindowPanel';

const REASONS = [['traffic', 'Traffic'], ['weather', 'Weather'], ['breakdown', 'Breakdown'], ['facility_delay', 'Facility delay'], ['hos_rest', 'Required rest break'], ['other', 'Other']];
const errMsg = (e, fallback) => e?.response?.data?.error || fallback;

export function chipFor(c) {
  if (c.source === 'driver') return { label: 'Driver-reported', color: semantic.info };
  if (c.positionConfirmed) return { label: 'Confirmed position', color: semantic.success };
  return { label: 'Unconfirmed', color: semantic.warning };
}

export default function CheckCallPanel({ load, userRole }) {
  const [data, setData] = useState({ checkCalls: [], pendingAsk: false });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [delayed, setDelayed] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const id = load?._id;
  const booked = ['accepted', 'in-transit'].includes(load?.status);
  const isCarrier = userRole === 'carrier';

  const refetch = useCallback(async () => {
    if (!id) return;
    try { setData((await api.get(`/loads/${id}/check-calls`)).data); } catch { /* panel stays as it was */ } finally { setLoaded(true); }
  }, [id]);

  useEffect(() => { if (id && (booked || load?.status === 'delivered')) refetch(); }, [id, booked, load?.status, refetch]);

  // The existing socket connection: refresh when a check-call notification for this load arrives.
  useEffect(() => {
    const s = getSocket();
    if (!s || !id) return undefined;
    const handler = (n) => { if (String(n?.type || '').startsWith('load:check_call') && n?.metadata?.loadId === String(id)) refetch(); };
    s.on('notification:new', handler);
    return () => s.off('notification:new', handler);
  }, [id, refetch]);

  if (!id || !['accepted', 'in-transit', 'delivered'].includes(load.status)) return null;
  const items = data.checkCalls || [];
  if (!isCarrier && loaded && !items.length) return null; // nothing to show the shipper yet
  if (!loaded) return null;

  const send = async (body) => {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/loads/${id}/check-call`, body);
      setMsg({ severity: 'success', text: 'Sent. The shipper can see your update.' });
      setDelayed(false); setMinutes(''); setReason(''); setNote('');
      await refetch();
    } catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Could not send your update') }); } finally { setBusy(false); }
  };
  const minutesOk = Number.isInteger(Number(minutes)) && Number(minutes) >= 5 && Number(minutes) <= 2880;
  const sendDelayed = () => send({ status: 'delayed', delayMinutes: Number(minutes), ...(reason ? { reason } : {}), ...(note.trim() ? { note: note.trim() } : {}) });

  const latest = items[0];
  return (
    <Box sx={{ mb: 2 }} onClick={(e) => e.stopPropagation()}>
      <Typography variant="subtitle2" sx={{ color: T.primary, fontWeight: 700, mb: 0.5 }}>Check calls</Typography>
      {!isCarrier && latest && (
        <Typography variant="body2" sx={{ color: T.secondary, mb: 1 }}>
          Latest ({fmt(latest.at)}): {latest.message}
        </Typography>
      )}

      {isCarrier && booked && (
        <Alert severity={data.pendingAsk ? 'warning' : 'info'} icon={false} sx={{ mb: 1, ...darkAlert(data.pendingAsk ? semantic.warning : semantic.info) }}>
          <Typography fontWeight={700}>{data.pendingAsk ? 'The shipper is waiting for a status update' : 'Give the shipper a quick status'}</Typography>
          {data.pendingAsk && <Typography variant="body2" sx={{ my: 0.5 }}>We cannot see a current position for this load. One tap lets the shipper know how it is going.</Typography>}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            <Button size="small" variant="contained" disabled={busy} sx={{ minHeight: 44 }} onClick={() => send({ status: 'on_schedule' })}>On schedule</Button>
            <Button size="small" variant="outlined" disabled={busy} sx={{ minHeight: 44, color: T.primary }} onClick={() => setDelayed((d) => !d)}>Delayed…</Button>
            <Button size="small" variant="outlined" disabled={busy} sx={{ minHeight: 44, color: T.primary }} onClick={() => send({ status: 'at_facility' })}>At facility</Button>
            <Button size="small" variant="outlined" disabled={busy} sx={{ minHeight: 44, color: T.primary }} onClick={() => send({ status: 'stopped' })}>Stopped</Button>
          </Stack>
          {delayed && (
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              <TextField size="small" label="Delay (minutes, 5 to 2880)" type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)}
                error={minutes !== '' && !minutesOk} inputProps={{ min: 5, max: 2880 }} />
              <TextField size="small" select label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)}>
                <MenuItem value="">None</MenuItem>
                {REASONS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} multiline maxRows={3} helperText={`${note.length}/300`} />
              <Box><Button size="small" variant="contained" disabled={busy || !minutesOk} onClick={sendDelayed}>{busy ? <CircularProgress size={18} /> : 'Send delay'}</Button></Box>
            </Stack>
          )}
        </Alert>
      )}
      {msg && <Alert severity={msg.severity} sx={{ mb: 1, ...darkAlert(semantic[msg.severity] || semantic.info) }}>{msg.text}</Alert>}

      {items.length > 0 && (
        <Stack spacing={0.75}>
          {items.slice(0, 12).map((c, i) => {
            const chip = chipFor(c);
            return (
              <Box key={`${c.at}-${i}`} sx={{ p: 1, borderRadius: 1, border: `1px solid ${tint(chip.color, 0.5)}`, bgcolor: tint(chip.color, 0.08) }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="caption" sx={{ color: T.secondary }}>{fmt(c.at)}</Typography>
                  <Chip label={chip.label} size="small" sx={{ fontWeight: 700, bgcolor: tint(chip.color, 0.3), color: T.primary, border: `1px solid ${chip.color}` }} />
                  {c.etaAt && <Chip label={`ETA ${fmt(c.etaAt)} (estimate)`} size="small" variant="outlined" sx={{ color: T.primary }} />}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5, color: T.primary }}>{c.message}</Typography>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
