import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Chip, Stack, Alert } from '@mui/material';
import TimerIcon from '@mui/icons-material/Timer';
import api from '../../services/api';

/**
 * The waiting clock at a pickup or delivery: when the truck arrived, when free time ends, and what
 * detention has built up. Arrival and departure are normally recorded from GPS; the carrier can also
 * record them by hand here (a hand-entered time is flagged and is never collected automatically).
 */
const money = (cents) => `$${(Math.max(0, cents) / 100).toFixed(2)}`;
const clock = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const time = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function DetentionClock({ load, userRole }) {
  const [events, setEvents] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const loadId = load?._id;

  const fetchEvents = useCallback(async () => {
    try {
      const { data } = await api.get(`/detention/load/${loadId}`);
      setEvents((Array.isArray(data) ? data : []).filter((e) => e.closedReason !== 'cancelled'));
    } catch { setEvents([]); }
  }, [loadId]);
  useEffect(() => { if (loadId) fetchEvents(); }, [loadId, fetchEvents]);

  const waiting = (events || []).some((e) => e.arrivedAt && !e.departedAt);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [waiting]);

  if (!loadId || !events) return null;
  const isCarrier = userRole === 'carrier';
  const stopType = load.status === 'accepted' ? 'pickup' : load.status === 'in-transit' ? 'delivery' : null;
  const here = stopType && events.find((e) => e.stopType === stopType && (e.stopIndex || 0) === 0);
  if (!events.length && !(isCarrier && stopType)) return null;

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); await fetchEvents(); setNow(Date.now()); }
    catch (e) { setErr(e?.response?.data?.error || 'That did not work. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <Box sx={{ my: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <TimerIcon fontSize="small" />
        <Typography fontWeight={700}>Waiting time</Typography>
      </Stack>
      {err && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setErr('')}>{err}</Alert>}

      <Stack spacing={1}>
        {events.map((e) => {
          const end = e.departedAt ? new Date(e.departedAt).getTime() : now;
          const elapsed = end - new Date(e.arrivedAt).getTime();
          const freeMs = (e.freeMinutes ?? 120) * 60000;
          const overMs = Math.max(0, elapsed - freeMs);
          const rate = e.detentionRateCents ?? 7500;
          const owed = Math.round((overMs / 3600000) * rate);
          const byHand = e.arrivalAuthenticated === false || e.departureAuthenticated === false;
          return (
            <Box key={e._id} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {e.stopType === 'pickup' ? 'Pickup' : 'Delivery'}{e.facilityName ? `: ${e.facilityName}` : ''}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Arrived {time(e.arrivedAt)}{e.departedAt ? ` · left ${time(e.departedAt)}` : ''}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {e.departedAt ? `On site ${clock(elapsed)}.` : `On site ${clock(elapsed)} so far.`}{' '}
                    {overMs > 0
                      ? `Free time (${clock(freeMs)}) ended ${time(new Date(e.arrivedAt).getTime() + freeMs)}.`
                      : `Free time ends ${time(new Date(e.arrivedAt).getTime() + freeMs)}.`}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                  {overMs > 0
                    ? <Chip color="warning" label={`Detention ${clock(overMs)} · ${money(owed)}`} />
                    : <Chip variant="outlined" label={e.departedAt ? 'No detention' : `${clock(freeMs - elapsed)} free time left`} />}
                  {byHand && <Chip size="small" variant="outlined" label="Time entered by hand" />}
                </Stack>
              </Stack>
              {isCarrier && !e.departedAt && (
                <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={busy}
                  onClick={() => act(() => api.patch(`/detention/depart/${e._id}`, {}))}>
                  I have left this facility
                </Button>
              )}
            </Box>
          );
        })}
      </Stack>

      {isCarrier && stopType && !here && (
        <Box mt={events.length ? 1 : 0}>
          <Button size="small" variant="outlined" disabled={busy}
            onClick={() => act(() => api.post(`/detention/check-in/${loadId}`, { stopType }))}>
            I have arrived at the {stopType} facility
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            Starts the waiting clock. Arrival is recorded automatically when location tracking is on; use this if it was not.
            Detention is ${((events[0]?.detentionRateCents ?? 7500) / 100).toFixed(0)} per hour after the free time, and a time entered by hand needs the shipper's approval.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
