/**
 * CarrierAutopilot — "Plan my next loads"
 *
 * Proposes the most profitable FEASIBLE chain (up to 3 open loads) for one truck and books the chain
 * one load at a time through the normal accept endpoint, so every existing booking gate still applies.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Paper, Button, CircularProgress, Alert, Divider, TextField,
  MenuItem, FormControlLabel, Switch, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Grid,
} from '@mui/material';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const money = (cents) => (cents == null ? '—' : (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const perMile = (cents) => `${money(cents)}/mi`;
const fmtTime = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const miles = (n) => `${Math.round(n)} mi`;

const START_WORDS = {
  booked_load: 'the destination of the load already booked on this truck, at the end of its delivery window',
  truck_location: "the truck's last reported location",
  home_base: 'your home base (the truck has no recent location)',
  request: 'the location you supplied',
};

const EXCLUDED_WORDS = [
  ['tooFar', 'too far from the starting point'],
  ['wrongEquipment', 'wrong equipment type'],
  ['windowCantBeMet', "pickup or delivery window can't be met"],
  ['noWindow', 'no pickup window set, so it can\'t be planned'],
  ['belowMinRate', 'below your minimum $/mile'],
  ['hos', 'would break hours-of-service limits'],
  ['noCoordinates', 'missing coordinates'],
  ['noRate', 'no rate'],
  ['overweight', 'over your weight limit'],
  ['hazmat', 'hazmat (not allowed)'],
  ['ineligible', 'you or the driver are missing a required endorsement or credential'],
  ['unprofitable', 'would lose money at your cost per mile'],
  ['homeBy', "can't get you home by your deadline"],
];

function Totals({ t }) {
  return (
    <Grid container spacing={1} sx={{ mt: 1 }}>
      {[
        ['Revenue', money(t.revenueCents)],
        ['Total miles', miles(t.totalMiles)],
        ['Empty miles', `${miles(t.deadheadMiles)} (${t.deadheadPct}%)`],
        ['All-in rate', perMile(t.ratePerMileCents)],
        ['Est. net', t.netCents == null ? null : money(t.netCents)],
      ].map(([label, value]) => (
        <Grid item xs={6} sm={4} md key={label}>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>{label}</Typography>
          {value == null ? (
            <Typography variant="body2" sx={{ color: '#fbbf24' }}>Set your cost per mile in Profile to see net</Typography>
          ) : (
            <Typography fontWeight={800} sx={{ color: '#fff' }}>{value}</Typography>
          )}
        </Grid>
      ))}
    </Grid>
  );
}

function PlanCard({ plan, index, onBook }) {
  return (
    <Paper sx={{ p: 3, borderRadius: 3, bgcolor: 'rgba(124,140,248,0.08)' }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Typography fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Plan {index + 1}: {plan.legs.length} load{plan.legs.length > 1 ? 's' : ''}
        </Typography>
        <Button variant="contained" onClick={() => onBook(plan)}
          sx={{ bgcolor: '#6a1fcf', fontWeight: 800, borderRadius: 99, '&:hover': { bgcolor: '#5518a8' } }}>
          Book this plan
        </Button>
      </Stack>

      <Box sx={{ borderLeft: '2px solid #6a1fcf', pl: 2, ml: 1 }}>
        {plan.legs.map((leg) => (
          <Box key={leg.loadId} sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>
              Drive {miles(leg.deadheadMiles)} empty{leg.milesAreEstimated ? ' (estimated)' : ''}
            </Typography>
            <Typography sx={{ color: '#fff' }}>
              Pickup <b>{leg.load.origin}</b> — {fmtTime(leg.arrivePickupAt)}
            </Typography>
            <Typography variant="body2" sx={{ color: '#a78bfa' }}>
              {leg.load.title} · {miles(leg.loadedMiles)} loaded · {money(leg.rateCents)} · {leg.load.equipmentType}
              {leg.load.postedBy ? ` · ${leg.load.postedBy.companyName || leg.load.postedBy.name}` : ''}
            </Typography>
            <Typography sx={{ color: '#fff' }}>
              Delivery <b>{leg.load.destination}</b> — {fmtTime(leg.arriveDeliveryAt)}
            </Typography>
            {leg.restStops.length > 0 && (
              <Typography variant="caption" sx={{ color: '#fbbf24' }}>
                Rest stops: {leg.restStops.map((s) => `${s.type === 'reset' ? '10-hour reset' : '30-min break'} (${fmtTime(s.at)})`).join(', ')}
              </Typography>
            )}
          </Box>
        ))}
        {plan.returnHome && (
          <Typography variant="body2" sx={{ color: '#94a3b8' }}>
            Then {miles(plan.returnHome.miles)} home, arriving {fmtTime(plan.returnHome.arriveAt)}
          </Typography>
        )}
      </Box>

      <Totals t={plan.totals} />
      {plan.warnings.length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Alert>
      )}
    </Paper>
  );
}

const STATE_LABEL = { pending: 'Waiting', booking: 'Booking…', booked: 'Booked', failed: 'Not booked', skipped: 'Not attempted' };
const STATE_COLOR = { pending: '#94a3b8', booking: '#fbbf24', booked: '#34d399', failed: '#f87171', skipped: '#94a3b8' };

function BookDialog({ plan, truckId, onClose }) {
  const navigate = useNavigate();
  const [steps, setSteps] = useState([]);
  const [phase, setPhase] = useState('confirm'); // confirm | running | done

  useEffect(() => {
    setSteps(plan ? plan.legs.map((l) => ({ id: l.loadId, title: l.load.title, state: 'pending', message: '' })) : []);
    setPhase('confirm');
  }, [plan]);

  if (!plan) return null;

  const patch = (i, next) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...next } : s)));

  // One at a time, in order; stop at the first failure and never retry (every existing accept gate still applies).
  const run = async () => {
    setPhase('running');
    for (let i = 0; i < plan.legs.length; i += 1) {
      const leg = plan.legs[i];
      patch(i, { state: 'booking' });
      try {
        await api.put(`/loads/${leg.loadId}/accept`, { termsVersion: leg.load.termsVersion ?? 1, truckId });
        patch(i, { state: 'booked' });
      } catch (err) {
        const data = err.response?.data;
        const message = data?.code === 'TERMS_CHANGED'
          ? 'The shipper changed this load after it was planned. Plan again to see the new terms.'
          : (data?.error || 'Could not book this load.');
        patch(i, { state: 'failed', message });
        setSteps((prev) => prev.map((s, j) => (j > i ? { ...s, state: 'skipped' } : s)));
        break;
      }
    }
    setPhase('done');
  };

  const booked = steps.filter((s) => s.state === 'booked');
  const failed = steps.find((s) => s.state === 'failed');

  return (
    <Dialog open onClose={phase === 'running' ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{phase === 'confirm' ? 'Book this plan?' : 'Booking'}</DialogTitle>
      <DialogContent>
        {phase === 'confirm' && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            These loads will be booked one after another, in this order. If one fails, the rest are not booked.
          </Typography>
        )}
        <List dense>
          {plan.legs.map((leg, i) => (
            <ListItem key={leg.loadId} disableGutters>
              <ListItemText
                primary={`${i + 1}. ${leg.load.title} — ${money(leg.rateCents)}`}
                secondary={steps[i]?.state !== 'pending' && steps[i] ? `${STATE_LABEL[steps[i].state]}${steps[i].message ? `: ${steps[i].message}` : ''}`
                  : `${leg.load.origin} → ${leg.load.destination}`}
                secondaryTypographyProps={{ sx: { color: STATE_COLOR[steps[i]?.state || 'pending'] } }}
              />
            </ListItem>
          ))}
        </List>
        {phase === 'done' && (
          <Alert severity={failed ? 'warning' : 'success'} sx={{ mt: 1 }}>
            {failed
              ? `${booked.length} booked, ${steps.length - booked.length} not booked. Booked: ${booked.map((s) => s.title).join(', ') || 'none'}. Not booked: ${steps.filter((s) => s.state !== 'booked').map((s) => s.title).join(', ')}.`
              : `All ${booked.length} loads are booked.`}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'confirm' && <Button onClick={onClose}>Cancel</Button>}
        {phase === 'confirm' && <Button variant="contained" onClick={run}>Book {plan.legs.length} load{plan.legs.length > 1 ? 's' : ''}</Button>}
        {phase === 'running' && <CircularProgress size={22} />}
        {phase === 'done' && booked.length > 0 && (
          <Button variant="contained" onClick={() => navigate('/dashboard/carrier/my-loads')}>Go to My Loads</Button>
        )}
        {phase === 'done' && <Button onClick={onClose}>Close</Button>}
      </DialogActions>
    </Dialog>
  );
}

export default function CarrierAutopilot() {
  const [fleet, setFleet] = useState([]);
  const [truckId, setTruckId] = useState('');
  const [minRate, setMinRate] = useState('');       // dollars per mile
  const [maxDeadhead, setMaxDeadhead] = useState('');
  const [homeBy, setHomeBy] = useState('');         // datetime-local
  const [allowHazmat, setAllowHazmat] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [result, setResult] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/users/fleet');
        const trucks = data.fleet || [];
        setFleet(trucks);
        if (trucks.length) setTruckId(trucks[0].truckId);
      } catch { setError('Could not load your fleet.'); }
      try { // owner/dispatcher only; drivers just use the defaults on the server
        const { data } = await api.get('/autopilot/rules');
        const r = data.data;
        if (r.minRatePerMileCents != null) setMinRate(String(r.minRatePerMileCents / 100));
        if (r.maxDeadheadMiles != null) setMaxDeadhead(String(r.maxDeadheadMiles));
        if (r.homeBy && new Date(r.homeBy) > new Date()) setHomeBy(new Date(r.homeBy).toISOString().slice(0, 16));
        setAllowHazmat(!!r.allowHazmat);
      } catch { /* no saved rules to show */ }
    })();
  }, []);

  const ruleParams = () => {
    const p = {};
    if (minRate !== '' && Number.isFinite(parseFloat(minRate))) p.minRatePerMileCents = Math.round(parseFloat(minRate) * 100);
    if (maxDeadhead !== '') p.maxDeadheadMiles = parseInt(maxDeadhead, 10);
    if (homeBy) p.homeBy = new Date(homeBy).toISOString();
    return p;
  };

  const plan = useCallback(async () => {
    setLoading(true); setError(''); setSaved(''); setResult(null);
    try {
      const { data } = await api.get('/autopilot/plan', { params: { truckId, ...ruleParams() } });
      setResult(data.data);
    } catch (err) {
      const d = err.response?.data;
      setError(d?.error || d?.errors?.[0]?.msg || 'Could not plan loads.');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId, minRate, maxDeadhead, homeBy]);

  const saveDefaults = async () => {
    setError(''); setSaved('');
    const p = ruleParams();
    try {
      await api.put('/autopilot/rules', {
        minRatePerMileCents: p.minRatePerMileCents ?? null,
        maxDeadheadMiles: p.maxDeadheadMiles ?? null,
        homeBy: p.homeBy ?? null,
        allowHazmat,
      });
      setSaved('Saved as your default.');
    } catch (err) {
      const d = err.response?.data;
      setError(d?.error || d?.errors?.[0]?.msg || 'Could not save defaults.');
    }
  };

  const noPlans = result && result.plans.length === 0;
  const reasons = result ? EXCLUDED_WORDS.filter(([k]) => result.excluded[k] > 0) : [];

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
        <AutoModeIcon sx={{ color: '#a78bfa' }} />
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff' }}>Autopilot</Typography>
      </Stack>
      <Typography sx={{ color: '#94a3b8', mb: 3 }}>
        Finds the best chain of up to 3 open loads this truck can run on time and within hours-of-service. Distances are estimates; nothing is booked until you confirm.
      </Typography>

      <Paper sx={{ p: 3, borderRadius: 3, bgcolor: 'rgba(124,140,248,0.08)', mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField select fullWidth size="small" label="Truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              {fleet.map((t) => <MenuItem key={t.truckId} value={t.truckId}>{t.truckId}{t.driverName ? ` — ${t.driverName}` : ''}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <TextField fullWidth size="small" type="number" label="Min $/mile (all-in)" value={minRate}
              onChange={(e) => setMinRate(e.target.value)} inputProps={{ min: 0, max: 50, step: 0.05 }} />
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <TextField fullWidth size="small" type="number" label="Max empty mi / leg" value={maxDeadhead}
              onChange={(e) => setMaxDeadhead(e.target.value)} inputProps={{ min: 1, max: 500, step: 1 }} />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField fullWidth size="small" type="datetime-local" label="Be home by" value={homeBy}
              onChange={(e) => setHomeBy(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControlLabel control={<Switch checked={allowHazmat} onChange={(e) => setAllowHazmat(e.target.checked)} />}
              label="Hazmat" />
          </Grid>
        </Grid>
        <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mt: 1 }}>
          Hazmat applies when saved as default, and only if the assigned driver has a current hazmat endorsement.
        </Typography>
        <Stack direction="row" spacing={2} mt={2}>
          <Button variant="contained" disabled={!truckId || loading} onClick={plan}
            sx={{ bgcolor: '#6a1fcf', fontWeight: 800, borderRadius: 99, '&:hover': { bgcolor: '#5518a8' } }}>
            Plan my next loads
          </Button>
          <Button variant="outlined" onClick={saveDefaults}>Save as default</Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 2 }}>{saved}</Alert>}
      {loading && <Box display="flex" justifyContent="center" pt={4}><CircularProgress /></Box>}

      {result && !loading && (
        <Stack spacing={2}>
          <Typography variant="body2" sx={{ color: '#94a3b8' }}>
            Starting from {START_WORDS[result.startSource]}, free {fmtTime(result.start.availableAt)}.
            {' '}{result.considered} open load{result.considered === 1 ? '' : 's'} nearby considered.
          </Typography>
          {result.notes.map((n) => <Alert key={n} severity="info">{n}</Alert>)}

          {result.plans.map((p, i) => <PlanCard key={p.loadIds.join('-')} plan={p} index={i} onBook={setBooking} />)}

          {noPlans && (
            <Paper sx={{ p: 4, borderRadius: 3, bgcolor: 'rgba(124,140,248,0.08)' }}>
              <Typography fontWeight={800} sx={{ color: '#fff' }}>No feasible loads right now</Typography>
              <Divider sx={{ my: 1.5 }} />
              {reasons.length === 0 ? (
                <Typography sx={{ color: '#94a3b8' }}>No open loads were found near the starting point.</Typography>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1' }}>
                  {reasons.map(([k, label]) => <li key={k}>{result.excluded[k]} {label}</li>)}
                </ul>
              )}
            </Paper>
          )}
        </Stack>
      )}

      <BookDialog plan={booking} truckId={result?.truck?.truckId} onClose={() => setBooking(null)} />
    </Box>
  );
}
