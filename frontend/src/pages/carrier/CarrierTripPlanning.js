/**
 * CarrierTripPlanning — Multi-Load Route Planning
 *
 * Carriers can create trips by grouping accepted loads, plan the route,
 * track waypoints, log fuel stops, and record odometer readings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, Drawer, Grid, IconButton, Alert, Divider,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemIcon, ListItemText, Checkbox, MenuItem,
  LinearProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import RouteIcon from '@mui/icons-material/Route';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import api from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { label: 'All',       value: '' },
  { label: 'Planned',   value: 'planned' },
  { label: 'Active',    value: 'active' },
  { label: 'Completed', value: 'completed' },
];

const STATUS_COLOR = {
  planned:   '#60a5fa',
  active:    '#34d399',
  completed: '#a78bfa',
  cancelled: '#94a3b8',
};

const WP_STATUS_COLOR = {
  pending:   '#94a3b8',
  arrived:   '#fbbf24',
  completed: '#34d399',
  skipped:   '#f87171',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Create Trip Dialog ────────────────────────────────────────────────────────
function CreateTripDialog({ open, onClose, onCreated }) {
  const [loads, setLoads]         = useState([]);
  const [selected, setSelected]   = useState([]);
  const [form, setForm]           = useState({ name: '', truck: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '' });
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected([]); setErr('');
    setForm({ name: '', truck: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '' });
    api.get('/loads?status=accepted').then(r => {
      const data = r.data;
      setLoads(Array.isArray(data) ? data : (data.loads || []));
    }).catch(() => setLoads([]));
  }, [open]);

  const toggleLoad = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async () => {
    if (!form.name) { setErr('Trip name is required.'); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/trips', { ...form, loadIds: selected });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to create trip.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Plan New Trip</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="Trip Name" name="name" value={form.name} onChange={handle} sx={{ mb: 2, mt: 1 }} />
        <TextField fullWidth label="Truck ID (optional)" name="truck" value={form.truck} onChange={handle} sx={{ mb: 2 }} />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6}>
            <TextField fullWidth label="Planned Departure" name="plannedDepartureAt" type="datetime-local"
              value={form.plannedDepartureAt} onChange={handle} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Planned Arrival" name="plannedArrivalAt" type="datetime-local"
              value={form.plannedArrivalAt} onChange={handle} InputLabelProps={{ shrink: true }} />
          </Grid>
        </Grid>

        <Typography variant="subtitle2" fontWeight={700} mb={1} sx={{ color: '#a78bfa' }}>
          Select Loads to Include
        </Typography>
        {loads.length === 0
          ? <Typography sx={{ color: '#aaa', mb: 2 }}>No accepted loads available.</Typography>
          : (
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2, mb: 2, maxHeight: 220, overflowY: 'auto' }}>
              <List dense>
                {loads.map(l => (
                  <ListItem key={l._id} button onClick={() => toggleLoad(l._id)}>
                    <ListItemIcon>
                      <Checkbox edge="start" checked={selected.includes(l._id)} sx={{ color: '#a78bfa' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={l.title}
                      secondary={`${l.origin} → ${l.destination} · $${l.rate}`}
                      primaryTypographyProps={{ color: '#fff', fontWeight: 600 }}
                      secondaryTypographyProps={{ color: '#94a3b8' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )
        }

        <TextField fullWidth label="Notes" name="notes" value={form.notes} onChange={handle}
          multiline rows={2} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}>
          {saving ? 'Creating…' : 'Create Trip'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Fuel Stop Dialog ──────────────────────────────────────────────────────────
function FuelDialog({ open, onClose, tripId, onLogged }) {
  const [form, setForm]   = useState({ location: '', gallons: '', pricePerGallon: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => { if (open) { setForm({ location: '', gallons: '', pricePerGallon: '' }); setErr(''); } }, [open]);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async () => {
    if (!form.gallons || !form.pricePerGallon) { setErr('Gallons and price are required.'); return; }
    setSaving(true); setErr('');
    try {
      await api.post(`/trips/${tripId}/fuel`, form);
      onLogged();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to log fuel stop.');
    }
    setSaving(false);
  };

  const total = form.gallons && form.pricePerGallon
    ? `$${(parseFloat(form.gallons) * parseFloat(form.pricePerGallon)).toFixed(2)}`
    : null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Log Fuel Stop</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="Location" name="location" value={form.location} onChange={handle} sx={{ mb: 2, mt: 1 }} />
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={6}><TextField fullWidth label="Gallons" name="gallons" type="number" value={form.gallons} onChange={handle} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="$/Gallon" name="pricePerGallon" type="number" value={form.pricePerGallon} onChange={handle} /></Grid>
        </Grid>
        {total && <Typography sx={{ color: '#34d399', fontWeight: 700 }}>Total: {total}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}>
          {saving ? 'Logging…' : 'Log Stop'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Trip Detail Drawer ────────────────────────────────────────────────────────
function TripDetail({ tripId, open, onClose, onRefresh }) {
  const [trip, setTrip]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [fuelOpen, setFuelOpen] = useState(false);
  const [odometerInput, setOdometerInput] = useState('');

  const loadTrip = useCallback(async () => {
    if (!tripId) return;
    setLoading(true); setErr('');
    try {
      const res = await api.get(`/trips/${tripId}`);
      setTrip(res.data);
    } catch { setTrip(null); }
    setLoading(false);
  }, [tripId]);

  useEffect(() => { if (open) loadTrip(); }, [open, loadTrip]);

  const refresh = () => { loadTrip(); onRefresh(); };

  const startTrip = async () => {
    setErr('');
    try {
      await api.post(`/trips/${tripId}/start`, { startOdometer: odometerInput || undefined });
      refresh();
    } catch (e) { setErr(e?.response?.data?.error || 'Failed to start trip.'); }
  };

  const completeTrip = async () => {
    setErr('');
    try {
      await api.post(`/trips/${tripId}/complete`, { endOdometer: odometerInput || undefined });
      refresh();
    } catch (e) { setErr(e?.response?.data?.error || 'Failed to complete trip.'); }
  };

  const cancelTrip = async () => {
    if (!window.confirm('Cancel this trip?')) return;
    setErr('');
    try {
      await api.delete(`/trips/${tripId}`);
      onClose(); onRefresh();
    } catch (e) { setErr(e?.response?.data?.error || 'Failed to cancel.'); }
  };

  const updateWaypoint = async (wpId, status) => {
    setErr('');
    try {
      await api.patch(`/trips/${tripId}/waypoints/${wpId}`, { status });
      loadTrip();
    } catch (e) { setErr(e?.response?.data?.error || 'Failed to update waypoint.'); }
  };

  const fetchRoute = async () => {
    setErr('');
    try {
      await api.get(`/trips/${tripId}/route`);
      loadTrip();
    } catch (e) { setErr(e?.response?.data?.error || 'Route fetch failed.'); }
  };

  const wpCompleted = trip ? trip.waypoints.filter(w => w.status === 'completed').length : 0;
  const wpTotal     = trip ? trip.waypoints.filter(w => w.status !== 'skipped').length : 0;
  const progress    = wpTotal > 0 ? Math.round((wpCompleted / wpTotal) * 100) : 0;

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose}
        PaperProps={{ sx: { width: { xs: '100%', md: 600 }, p: 3, bgcolor: '#1a1230', color: '#fff', overflowY: 'auto' } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" fontWeight={800}>Trip Detail</Typography>
          <IconButton onClick={onClose} sx={{ color: '#fff' }}><CloseIcon /></IconButton>
        </Stack>

        {loading ? (
          <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
        ) : !trip ? (
          <Typography sx={{ color: '#aaa' }}>Failed to load trip.</Typography>
        ) : (
          <Box>
            {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

            {/* Header */}
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
              <Box>
                <Typography fontWeight={800} fontSize="1.1rem">{trip.name}</Typography>
                {trip.truck && <Typography variant="caption" sx={{ color: '#94a3b8' }}>Truck: {trip.truck}</Typography>}
              </Box>
              <Chip label={trip.status} size="small" sx={{
                bgcolor: (STATUS_COLOR[trip.status] || '#888') + '33',
                color: STATUS_COLOR[trip.status] || '#888', fontWeight: 700,
              }} />
            </Stack>

            {/* Route metrics */}
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>ROUTE METRICS</Typography>
                <Button size="small" onClick={fetchRoute} sx={{ color: '#60a5fa', textTransform: 'none', fontSize: '0.75rem' }}>
                  Refresh Route
                </Button>
              </Stack>
              <Grid container spacing={2}>
                {[
                  ['Distance', trip.route?.totalDistanceMiles ? `${trip.route.totalDistanceMiles} mi` : '—'],
                  ['Duration', trip.route?.estimatedDurationHours ? `${trip.route.estimatedDurationHours}h` : '—'],
                  ['Est. Fuel', trip.route?.estimatedFuelGallons ? `${trip.route.estimatedFuelGallons} gal` : '—'],
                  ['Fuel Cost', trip.totalFuelCostCents > 0 ? `$${(trip.totalFuelCostCents / 100).toFixed(2)}` : '—'],
                  ['Loads', trip.loads?.length || 0],
                  ['Progress', `${wpCompleted}/${wpTotal} stops`],
                ].map(([label, val]) => (
                  <Grid item xs={4} key={label}>
                    <Typography variant="caption" sx={{ color: '#94a3b8' }}>{label}</Typography>
                    <Typography fontWeight={700} color="#c4b5fd">{val}</Typography>
                  </Grid>
                ))}
              </Grid>
              {wpTotal > 0 && (
                <Box mt={1.5}>
                  <LinearProgress variant="determinate" value={progress}
                    sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { bgcolor: '#34d399' } }} />
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>{progress}% complete</Typography>
                </Box>
              )}
            </Paper>

            {/* Dates */}
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>DEPARTURE</Typography>
                  <Typography variant="body2" color="#fff">{fmtDateTime(trip.actualDepartureAt || trip.plannedDepartureAt)}</Typography>
                  {trip.actualDepartureAt && <Chip label="Actual" size="small" sx={{ bgcolor: '#34d39933', color: '#34d399', fontSize: '0.65rem' }} />}
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>ARRIVAL</Typography>
                  <Typography variant="body2" color="#fff">{fmtDateTime(trip.actualArrivalAt || trip.plannedArrivalAt)}</Typography>
                  {trip.actualArrivalAt && <Chip label="Actual" size="small" sx={{ bgcolor: '#34d39933', color: '#34d399', fontSize: '0.65rem' }} />}
                </Grid>
                {trip.startOdometer && (
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8' }}>START ODO</Typography>
                    <Typography variant="body2" color="#fff">{trip.startOdometer.toLocaleString()} mi</Typography>
                  </Grid>
                )}
                {trip.endOdometer && (
                  <Grid item xs={6}>
                    <Typography variant="caption" sx={{ color: '#94a3b8' }}>END ODO</Typography>
                    <Typography variant="body2" color="#fff">{trip.endOdometer.toLocaleString()} mi</Typography>
                  </Grid>
                )}
              </Grid>
            </Paper>

            {/* Waypoints */}
            <Typography variant="subtitle2" fontWeight={700} mb={1}>Waypoints</Typography>
            {trip.waypoints.length === 0
              ? <Typography sx={{ color: '#aaa', mb: 2 }}>No waypoints.</Typography>
              : trip.waypoints.map((wp, i) => (
                <Paper key={wp._id || i} sx={{
                  bgcolor: 'rgba(255,255,255,0.05)', p: 1.5, borderRadius: 2, mb: 1,
                  borderLeft: `3px solid ${WP_STATUS_COLOR[wp.status] || '#94a3b8'}`,
                }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <LocationOnIcon sx={{ fontSize: 16, color: wp.type === 'origin' ? '#a78bfa' : wp.type === 'delivery' ? '#34d399' : '#60a5fa' }} />
                      <Box>
                        <Typography variant="body2" fontWeight={600} color="#fff">{wp.name || wp.address}</Typography>
                        <Typography variant="caption" sx={{ color: '#94a3b8', textTransform: 'capitalize' }}>{wp.type}</Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                      {trip.status === 'active' && wp.status === 'pending' && (
                        <Button size="small" onClick={() => updateWaypoint(wp._id, 'arrived')}
                          sx={{ color: '#fbbf24', textTransform: 'none', fontSize: '0.72rem' }}>
                          Arrived
                        </Button>
                      )}
                      {trip.status === 'active' && wp.status === 'arrived' && (
                        <Button size="small" onClick={() => updateWaypoint(wp._id, 'completed')}
                          sx={{ color: '#34d399', textTransform: 'none', fontSize: '0.72rem' }}>
                          Done
                        </Button>
                      )}
                      <Chip label={wp.status} size="small" sx={{
                        bgcolor: (WP_STATUS_COLOR[wp.status] || '#888') + '33',
                        color: WP_STATUS_COLOR[wp.status] || '#888', fontWeight: 700, fontSize: '0.7rem',
                      }} />
                    </Stack>
                  </Stack>
                  {wp.completedAt && (
                    <Typography variant="caption" sx={{ color: '#34d399', display: 'block', mt: 0.5 }}>
                      Completed {fmtDateTime(wp.completedAt)}
                    </Typography>
                  )}
                </Paper>
              ))
            }

            {/* Fuel stops */}
            {trip.fuelStops?.length > 0 && (
              <>
                <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />
                <Typography variant="subtitle2" fontWeight={700} mb={1}>Fuel Stops</Typography>
                {trip.fuelStops.map((fs, i) => (
                  <Paper key={i} sx={{ bgcolor: 'rgba(255,255,255,0.04)', p: 1.5, borderRadius: 2, mb: 1 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Box>
                        <Typography variant="body2" color="#fff">{fs.location || 'Unnamed stop'}</Typography>
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                          {fs.gallons} gal @ ${fs.pricePerGallon}/gal
                        </Typography>
                      </Box>
                      <Typography fontWeight={700} color="#34d399">${fs.totalCost?.toFixed(2)}</Typography>
                    </Stack>
                  </Paper>
                ))}
              </>
            )}

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />

            {/* Actions */}
            {trip.status === 'planned' && (
              <Stack spacing={1.5}>
                <TextField fullWidth size="small" label="Start Odometer (optional)" type="number"
                  value={odometerInput} onChange={e => setOdometerInput(e.target.value)}
                  sx={{ '& input': { color: '#fff' } }} />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={startTrip}
                    sx={{ bgcolor: '#34d399', color: '#000', '&:hover': { bgcolor: '#059669' }, fontWeight: 700 }}>
                    Start Trip
                  </Button>
                  <Button variant="outlined" startIcon={<CancelIcon />} onClick={cancelTrip}
                    sx={{ color: '#ef4444', borderColor: '#ef4444' }}>
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            )}

            {trip.status === 'active' && (
              <Stack spacing={1.5}>
                <TextField fullWidth size="small" label="End Odometer (optional)" type="number"
                  value={odometerInput} onChange={e => setOdometerInput(e.target.value)}
                  sx={{ '& input': { color: '#fff' } }} />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" startIcon={<CheckCircleIcon />} onClick={completeTrip}
                    sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' }, fontWeight: 700 }}>
                    Complete Trip
                  </Button>
                  <Button variant="outlined" startIcon={<LocalGasStationIcon />}
                    onClick={() => setFuelOpen(true)}
                    sx={{ color: '#fbbf24', borderColor: '#fbbf24' }}>
                    Log Fuel
                  </Button>
                </Stack>
              </Stack>
            )}
          </Box>
        )}
      </Drawer>

      <FuelDialog
        open={fuelOpen}
        onClose={() => setFuelOpen(false)}
        tripId={tripId}
        onLogged={() => loadTrip()}
      />
    </>
  );
}

// ── Trip Card ─────────────────────────────────────────────────────────────────
function TripCard({ trip, onClick }) {
  const wpDone  = trip.waypoints?.filter(w => w.status === 'completed').length || 0;
  const wpTotal = trip.waypoints?.filter(w => w.status !== 'skipped').length || 0;
  const progress = wpTotal > 0 ? Math.round((wpDone / wpTotal) * 100) : 0;

  return (
    <Paper onClick={onClick} sx={{
      p: 2.5, borderRadius: 3, mb: 2, cursor: 'pointer',
      bgcolor: 'rgba(124,140,248,0.10)',
      border: '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.18s',
      '&:hover': { bgcolor: 'rgba(124,140,248,0.18)', borderColor: 'rgba(167,139,250,0.35)' },
    }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1}>
        <Box>
          <Typography fontWeight={700} color="#fff">{trip.name}</Typography>
          {trip.truck && <Typography variant="caption" sx={{ color: '#94a3b8' }}>Truck: {trip.truck}</Typography>}
        </Box>
        <Chip label={trip.status} size="small" sx={{
          bgcolor: (STATUS_COLOR[trip.status] || '#888') + '33',
          color:   STATUS_COLOR[trip.status] || '#888',
          fontWeight: 700,
        }} />
      </Stack>

      <Stack direction="row" spacing={3} mb={1.5} flexWrap="wrap">
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Departure</Typography>
          <Typography variant="body2" color="#fff">{fmtDate(trip.actualDepartureAt || trip.plannedDepartureAt)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Loads</Typography>
          <Typography variant="body2" color="#fff">{trip.loads?.length || 0}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Distance</Typography>
          <Typography variant="body2" color="#fff">
            {trip.route?.totalDistanceMiles ? `${trip.route.totalDistanceMiles} mi` : '—'}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Waypoints</Typography>
          <Typography variant="body2" color="#fff">{wpDone}/{wpTotal}</Typography>
        </Box>
      </Stack>

      {wpTotal > 0 && (
        <LinearProgress variant="determinate" value={progress}
          sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { bgcolor: '#34d399' } }} />
      )}
    </Paper>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CarrierTripPlanning() {
  const [tabIdx, setTabIdx]         = useState(0);
  const [trips, setTrips]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId]     = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const currentStatus = STATUS_TABS[tabIdx].value;

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const params = currentStatus ? `?status=${currentStatus}` : '';
      const res = await api.get(`/trips${params}`);
      setTrips(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTrips([]);
    }
    setLoading(false);
  }, [currentStatus]);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Trip Planning
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: '#6a1fcf', fontWeight: 800, borderRadius: 99, '&:hover': { bgcolor: '#5518a8' } }}>
          Plan Trip
        </Button>
      </Stack>

      <Tabs
        value={tabIdx} onChange={(_, v) => setTabIdx(v)}
        sx={{ mb: 3, '& .MuiTab-root': { color: '#a78bfa', fontWeight: 600 }, '& .Mui-selected': { color: '#fff' } }}>
        {STATUS_TABS.map(t => <Tab key={t.value} label={t.label} />)}
      </Tabs>

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : trips.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', bgcolor: 'rgba(124,140,248,0.08)', borderRadius: 3 }}>
          <RouteIcon sx={{ fontSize: 48, color: '#a78bfa', mb: 2 }} />
          <Typography color="#fff" fontWeight={700}>No trips planned yet</Typography>
          <Typography sx={{ color: '#94a3b8', mt: 1 }}>
            Plan a trip to group loads, optimize your route, and track waypoints.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} sx={{ mt: 3, bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}
            onClick={() => setCreateOpen(true)}>
            Plan First Trip
          </Button>
        </Paper>
      ) : (
        trips.map(t => (
          <TripCard key={t._id} trip={t} onClick={() => { setDetailId(t._id); setDetailOpen(true); }} />
        ))
      )}

      <CreateTripDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchTrips}
      />

      <TripDetail
        tripId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={fetchTrips}
      />
    </Box>
  );
}
