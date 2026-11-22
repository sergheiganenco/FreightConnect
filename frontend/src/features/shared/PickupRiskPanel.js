/**
 * PickupRiskPanel — pickup no-show prediction (backend: jobs/pickupRiskMonitor,
 * POST /loads/:id/pickup-confirm, POST /loads/:id/release-to-standby).
 *
 *  shipper/admin: risk chip (hidden when on track) with the plain-language reason, the numbers and
 *                 "estimate" wording; "Release to standby carriers" when the backend would allow it.
 *  carrier:       "Are you on the way?" banner with On my way / I can't make it.
 *
 * Every figure is an ESTIMATE (straight-line distance x road factor at an assumed speed); the text says so.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../services/api';
import { semantic, text as T, tint } from '../../theme/tokens';
import { darkAlert } from './PickupWindowPanel';

const errMsg = (e, fallback) => e?.response?.data?.error || fallback;
const when = (d) => (d ? new Date(d).toLocaleString() : null);

export function riskView(risk) {
  const level = risk?.level;
  const d = risk?.detail || {};
  if (!['at_risk', 'late_certain', 'no_show'].includes(level)) return null;
  const label = level === 'at_risk' ? 'At risk'
    : level === 'late_certain' ? `Running late${d.minutesLateEstimate ? ` (est. ${d.minutesLateEstimate} min)` : ''}` : 'No-show';
  const lines = [];
  if (risk.reason === 'carrier_declined') lines.push("The carrier said it can't make this pickup.");
  else if (risk.reason === 'no_gps') lines.push("We are not receiving the carrier's location and pickup is close. This is not a confirmed problem.");
  else if (level === 'no_show') lines.push(`No arrival at pickup was recorded and the pickup window plus ${d.graceMinutes ?? 30} min grace has passed.`);
  else if (d.distanceMilesStraight != null) {
    lines.push(`Last known position is about ${d.distanceMilesStraight} straight-line miles from pickup (${d.distanceBasis}).`);
    lines.push(`Estimated ${d.driveMinutesEstimate} min of driving at an assumed ${d.assumedMph} mph, with ${d.minutesRemaining} min left until the latest arrival${level === 'at_risk' ? ` minus a ${d.marginMinutes} min margin` : ''}.`);
    if (level === 'late_certain') lines.push(`Even at ${d.fastestMph} mph it would be at least ${d.minutesLateAtLeast} min late.`);
  }
  if (d.latestArrivalAt) lines.push(`Latest arrival used: ${when(d.latestArrivalAt)} (${d.latestArrivalBasis}).`);
  if (risk.carrierConfirmation?.status) lines.push(`Carrier answered "${risk.carrierConfirmation.status === 'on_my_way' ? 'on my way' : "can't make it"}" at ${when(risk.carrierConfirmation.at)}.`);
  lines.push('These are estimates, not measurements.' + (risk.evaluatedAt ? ` Last checked ${when(risk.evaluatedAt)}.` : ''));
  return { level, label, lines, color: level === 'at_risk' ? semantic.warning : semantic.error };
}

/** Compact chip for list cards. Renders nothing unless the load is booked and at risk. */
export function PickupRiskChip({ load }) {
  const v = load?.status === 'accepted' ? riskView(load.pickupRisk) : null;
  if (!v) return null;
  return (
    <Tooltip title={<Box>{v.lines.map((l) => <Typography key={l} variant="caption" display="block" sx={{ mb: 0.5 }}>{l}</Typography>)}</Box>}>
      <Chip label={v.label} size="small" sx={{ mb: 0.5, mr: 0.5, bgcolor: tint(v.color, 0.3), color: T.primary, fontWeight: 700, fontSize: '0.75rem', border: `1px solid ${v.color}` }} />
    </Tooltip>
  );
}

export default function PickupRiskPanel({ load, userRole, onChanged }) {
  const [risk, setRisk] = useState(load?.pickupRisk || null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [standby, setStandby] = useState(null);
  const [open, setOpen] = useState(false);
  const id = load?._id;
  const isCarrier = userRole === 'carrier';

  useEffect(() => { setRisk(load?.pickupRisk || null); }, [id, load?.pickupRisk]);

  if (!id || load.status !== 'accepted') return null;
  const v = riskView(risk);
  const declined = risk?.carrierConfirmation?.status === 'cannot_make_it';
  if (!v && !(isCarrier && risk?.carrierConfirmation)) return null;

  const refresh = async (note) => {
    const { data } = await api.get(`/loads/${id}`);
    setRisk(data.pickupRisk || null);
    if (onChanged) onChanged(data, note);
  };
  const answer = async (status) => {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/loads/${id}/pickup-confirm`, { status });
      setDeclineOpen(false);
      setMsg({ severity: 'success', text: status === 'on_my_way' ? 'Thanks. The shipper can see you are on the way.' : 'The shipper was told. The booking stays in place until they act, or you cancel it.' });
      // Show the acknowledged state now; the refresh below replaces it with the server's copy and tells the parent.
      setRisk((r) => ({ ...(r || {}), carrierConfirmation: { status, at: new Date().toISOString() } }));
      await refresh().catch(() => {});
    } catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Request failed') }); } finally { setBusy(false); }
  };

  const releaseReason = v?.level === 'no_show' ? 'no_show' : v?.level === 'late_certain' ? 'late_certain' : declined ? 'carrier_declined' : null;
  const openRelease = async () => {
    setReleaseOpen(true); setStandby(null);
    try { setStandby((await api.get(`/loads/${id}/standby`)).data.count); } catch { setStandby(null); }
  };
  const release = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post(`/loads/${id}/release-to-standby`, { reason: releaseReason });
      setReleaseOpen(false);
      const text = `Load released and re-posted. ${data.standbyNotified} standby carrier(s) notified.`;
      setMsg({ severity: 'success', text });
      // Tell the parent the load is open again (modal state + the list behind it) with the server's copy when we can get it;
      // the panel unmounts once the load is open, so the parent keeps the result message.
      await refresh(text).catch(() => { if (onChanged) onChanged({ ...load, status: 'open', acceptedBy: null, pickupRisk: null }, text); });
    } catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Release failed') }); } finally { setBusy(false); }
  };

  const d = risk?.detail || {};
  return (
    <Box sx={{ mb: 2 }} onClick={(e) => e.stopPropagation()}>
      {isCarrier ? (v && v.level !== 'no_show' && !risk?.carrierConfirmation?.status && (
        <Alert severity="warning" action={null} sx={darkAlert(semantic.warning)}>
          <Typography fontWeight={700}>Are you on the way to {load.pickupFacilityName || load.pickupAddress || load.origin}?</Typography>
          <Typography variant="body2" sx={{ my: 0.5 }}>
            {d.distanceMilesStraight != null
              ? `GPS shows you about ${d.distanceMilesStraight} miles away (estimate, straight-line). `
              : <>We're not receiving your location. <RouterLink to="/dashboard/carrier/live-map" style={{ color: semantic.warning, fontWeight: 700 }}>Start tracking</RouterLink>. </>}
            Pickup is due {when(load.pickupTimeWindow?.start)}.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" disabled={busy} onClick={() => answer('on_my_way')}>On my way</Button>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => setDeclineOpen(true)} sx={{ color: T.primary, borderColor: semantic.error }}>I can't make it</Button>
          </Stack>
        </Alert>
      )) : (v && (
        <Alert severity={v.level === 'at_risk' ? 'warning' : 'error'} sx={darkAlert(v.color)}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip label={v.label} size="small" sx={{ fontWeight: 700, bgcolor: tint(v.color, 0.3), color: T.primary, border: `1px solid ${v.color}` }} />
            <Button size="small" sx={{ color: T.primary }} onClick={() => setOpen((o) => !o)}>{open ? 'Hide details' : 'Why?'}</Button>
            {releaseReason && <Button size="small" variant="contained" color="error" disabled={busy} onClick={openRelease}>Release to standby carriers</Button>}
          </Stack>
          <Collapse in={open}>{v.lines.map((l) => <Typography key={l} variant="body2" sx={{ mt: 0.5 }}>{l}</Typography>)}</Collapse>
        </Alert>
      ))}
      {isCarrier && risk?.carrierConfirmation?.status && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          You told the shipper: {risk.carrierConfirmation.status === 'on_my_way' ? 'on my way' : "can't make it"}.
        </Typography>
      )}
      {msg && <Alert severity={msg.severity} sx={{ mt: 1, ...darkAlert(semantic[msg.severity] || semantic.info) }}>{msg.text}</Alert>}

      <Dialog open={declineOpen} onClose={() => setDeclineOpen(false)}>
        <DialogTitle>Tell the shipper you can't make this pickup?</DialogTitle>
        <DialogContent><DialogContentText>The shipper will be notified and may release the load to other carriers. Your booking is not cancelled by this. To cancel it yourself, use Cancel on the load.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeclineOpen(false)}>Back</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => answer('cannot_make_it')}>{busy ? <CircularProgress size={18} /> : "I can't make it"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={releaseOpen} onClose={() => setReleaseOpen(false)}>
        <DialogTitle>Release this load to standby carriers?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <p>This cancels the current carrier's booking and re-posts the load.{' '}
              {standby == null ? 'Standby carriers will be notified.' : `${standby} standby carrier(s) will be notified; they still have to book it themselves.`}</p>
            <p>The carrier is notified that the load was released and why, and how to respond. {releaseReason === 'no_show'
              ? 'A suspected no-show is sent to FreightConnect staff for review.'
              : ''} Any escrow hold is released. No trust-score penalty is applied automatically.</p>
            <p>{v?.lines[0]}</p>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReleaseOpen(false)}>Keep booking</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={release}>{busy ? <CircularProgress size={18} /> : 'Release load'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
