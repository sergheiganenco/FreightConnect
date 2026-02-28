/**
 * ShipperAppointments — Manage pickup & delivery appointments
 *
 * Shows all appointment requests from carriers, allows shipper to
 * confirm, request reschedule, or mark missed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, Drawer, Grid, IconButton, Alert, Divider,
  TextField, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ScheduleIcon from '@mui/icons-material/Schedule';
import api from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { label: 'All',        value: '' },
  { label: 'Pending',    value: 'pending' },
  { label: 'Confirmed',  value: 'confirmed' },
  { label: 'Rescheduled',value: 'rescheduled' },
];

const SLOT_COLOR = {
  pending:     '#fbbf24',
  confirmed:   '#34d399',
  rescheduled: '#60a5fa',
  missed:      '#f87171',
  cancelled:   '#94a3b8',
};

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Reschedule Dialog ─────────────────────────────────────────────────────────
function RescheduleDialog({ open, onClose, apptId, apptType, onDone }) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState('');

  useEffect(() => { if (open) { setScheduledAt(''); setNotes(''); setErr(''); } }, [open]);

  const save = async () => {
    if (!scheduledAt) { setErr('Please select a date and time.'); return; }
    setSaving(true); setErr('');
    try {
      await api.patch(`/appointments/${apptId}/reschedule`, { apptType, scheduledAt, notes });
      onDone();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to reschedule.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Propose New {apptType === 'pickup' ? 'Pickup' : 'Delivery'} Time</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="New Date & Time" type="datetime-local"
          value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
          InputLabelProps={{ shrink: true }} sx={{ mb: 2, mt: 1 }} />
        <TextField fullWidth label="Notes (optional)" value={notes}
          onChange={e => setNotes(e.target.value)} multiline rows={2} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#f04ca7', '&:hover': { bgcolor: '#d12e8b' } }}>
          {saving ? 'Proposing…' : 'Propose'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Slot Card ─────────────────────────────────────────────────────────────────
function SlotCard({ type, slot, apptId, onRefresh }) {
  const [reschedOpen, setReschedOpen] = useState(false);
  const [acting, setActing]           = useState(false);

  const confirm = async () => {
    setActing(true);
    try {
      await api.patch(`/appointments/${apptId}/confirm`, { apptType: type });
      onRefresh();
    } catch { /* swallow */ }
    setActing(false);
  };

  const markMissed = async () => {
    setActing(true);
    try {
      await api.patch(`/appointments/${apptId}/missed`, { apptType: type });
      onRefresh();
    } catch { /* swallow */ }
    setActing(false);
  };

  if (!slot?.scheduledAt && !slot?.status) return null;

  return (
    <Paper sx={{ bgcolor: 'rgba(255,255,255,0.05)', p: 2, borderRadius: 2, mb: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {type === 'pickup' ? <AccessTimeIcon sx={{ color: '#a78bfa', fontSize: 18 }} /> : <EventIcon sx={{ color: '#60a5fa', fontSize: 18 }} />}
          <Typography fontWeight={700} sx={{ textTransform: 'capitalize' }}>{type}</Typography>
        </Stack>
        <Chip label={slot.status || 'pending'} size="small" sx={{
          bgcolor: (SLOT_COLOR[slot.status] || '#888') + '33',
          color:   SLOT_COLOR[slot.status] || '#888',
          fontWeight: 700, textTransform: 'capitalize',
        }} />
      </Stack>

      <Grid container spacing={1.5}>
        <Grid item xs={6}>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Scheduled</Typography>
          <Typography variant="body2" color="#fff">{fmtDateTime(slot.scheduledAt)}</Typography>
        </Grid>
        {slot.facilityName && (
          <Grid item xs={6}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>Facility</Typography>
            <Typography variant="body2" color="#fff">{slot.facilityName}</Typography>
          </Grid>
        )}
        {slot.contactName && (
          <Grid item xs={6}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>Contact</Typography>
            <Typography variant="body2" color="#fff">{slot.contactName} {slot.contactPhone && `· ${slot.contactPhone}`}</Typography>
          </Grid>
        )}
        {slot.notes && (
          <Grid item xs={12}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>Notes</Typography>
            <Typography variant="body2" color="#c4b5fd">{slot.notes}</Typography>
          </Grid>
        )}
      </Grid>

      {slot.status === 'pending' && (
        <Stack direction="row" spacing={1} mt={1.5}>
          <Button size="small" variant="contained" startIcon={<CheckCircleIcon />}
            onClick={confirm} disabled={acting}
            sx={{ bgcolor: '#34d399', color: '#000', '&:hover': { bgcolor: '#059669' }, fontWeight: 700 }}>
            Confirm
          </Button>
          <Button size="small" variant="outlined" startIcon={<ScheduleIcon />}
            onClick={() => setReschedOpen(true)}
            sx={{ color: '#60a5fa', borderColor: '#60a5fa' }}>
            Reschedule
          </Button>
        </Stack>
      )}

      {slot.status === 'confirmed' && (
        <Button size="small" variant="outlined" sx={{ mt: 1.5, color: '#f87171', borderColor: '#f87171' }}
          onClick={markMissed} disabled={acting}>
          Mark Missed
        </Button>
      )}

      <RescheduleDialog
        open={reschedOpen}
        onClose={() => setReschedOpen(false)}
        apptId={apptId} apptType={type}
        onDone={onRefresh}
      />
    </Paper>
  );
}

// ── Appointment Detail Drawer ─────────────────────────────────────────────────
function ApptDetail({ apptId, open, onClose, onRefresh }) {
  const [appt, setAppt]   = useState(null);
  const [loading, setLoading] = useState(false);

  const loadAppt = useCallback(async () => {
    if (!apptId) return;
    setLoading(true);
    try {
      const res = await api.get(`/appointments/${apptId}`);
      setAppt(res.data);
    } catch { setAppt(null); }
    setLoading(false);
  }, [apptId]);

  useEffect(() => { if (open) loadAppt(); }, [open, loadAppt]);

  const refresh = () => { loadAppt(); onRefresh(); };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: 520 }, p: 3, bgcolor: '#1a1230', color: '#fff' } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6" fontWeight={800}>Appointment Detail</Typography>
        <IconButton onClick={onClose} sx={{ color: '#fff' }}><CloseIcon /></IconButton>
      </Stack>

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : !appt ? (
        <Typography sx={{ color: '#aaa' }}>Failed to load.</Typography>
      ) : (
        <Box>
          {/* Load info */}
          <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>LOAD</Typography>
            <Typography fontWeight={700}>{appt.load?.title}</Typography>
            <Typography variant="body2" sx={{ color: '#c4b5fd' }}>
              {appt.load?.origin} → {appt.load?.destination}
            </Typography>
          </Paper>

          {/* Carrier */}
          <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>CARRIER</Typography>
            <Typography fontWeight={600}>{appt.carrier?.companyName || appt.carrier?.name}</Typography>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>{appt.carrier?.email}</Typography>
          </Paper>

          {/* Time windows from load */}
          {(appt.load?.pickupTimeWindow?.start || appt.load?.deliveryTimeWindow?.start) && (
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.04)', p: 2, borderRadius: 2, mb: 2 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>AGREED TIME WINDOWS</Typography>
              {appt.load?.pickupTimeWindow?.start && (
                <Typography variant="body2" color="#fff">
                  Pickup: {fmtDateTime(appt.load.pickupTimeWindow.start)} — {fmtDateTime(appt.load.pickupTimeWindow.end)}
                </Typography>
              )}
              {appt.load?.deliveryTimeWindow?.start && (
                <Typography variant="body2" color="#fff">
                  Delivery: {fmtDateTime(appt.load.deliveryTimeWindow.start)} — {fmtDateTime(appt.load.deliveryTimeWindow.end)}
                </Typography>
              )}
            </Paper>
          )}

          <SlotCard type="pickup"   slot={appt.pickup}   apptId={apptId} onRefresh={refresh} />
          <SlotCard type="delivery" slot={appt.delivery} apptId={apptId} onRefresh={refresh} />

          {/* History */}
          {appt.history?.length > 0 && (
            <>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />
              <Typography variant="subtitle2" fontWeight={700} mb={1}>History</Typography>
              {[...appt.history].reverse().map((h, i) => (
                <Box key={i} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                    {fmtDateTime(h.timestamp)} — <span style={{ color: '#c4b5fd', textTransform: 'capitalize' }}>{h.action} {h.type !== 'general' ? `(${h.type})` : ''}</span>
                  </Typography>
                  {h.notes && <Typography variant="caption" sx={{ color: '#fff', display: 'block' }}>{h.notes}</Typography>}
                </Box>
              ))}
            </>
          )}
        </Box>
      )}
    </Drawer>
  );
}

// ── Appointment Card ──────────────────────────────────────────────────────────
function ApptCard({ appt, onClick }) {
  const pickupStatus   = appt.pickup?.status;
  const deliveryStatus = appt.delivery?.status;
  const hasPending = pickupStatus === 'pending' || deliveryStatus === 'pending';

  return (
    <Paper onClick={onClick} sx={{
      p: 2.5, borderRadius: 3, mb: 2, cursor: 'pointer',
      bgcolor: 'rgba(124,140,248,0.10)',
      border: hasPending
        ? '1px solid rgba(251,191,36,0.45)'
        : '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.18s',
      '&:hover': { bgcolor: 'rgba(124,140,248,0.18)', borderColor: 'rgba(167,139,250,0.35)' },
    }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1}>
        <Box>
          <Typography fontWeight={700} color="#fff">{appt.load?.title}</Typography>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>
            {appt.load?.origin} → {appt.load?.destination}
          </Typography>
        </Box>
        {hasPending && <Chip label="Action Needed" size="small" sx={{ bgcolor: '#fbbf2433', color: '#fbbf24', fontWeight: 700 }} />}
      </Stack>

      <Typography variant="body2" sx={{ color: '#94a3b8', mb: 1 }}>
        Carrier: <span style={{ color: '#c4b5fd' }}>{appt.carrier?.companyName || appt.carrier?.name}</span>
      </Typography>

      <Stack direction="row" spacing={3}>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Pickup</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip label={pickupStatus || '—'} size="small" sx={{
              bgcolor: (SLOT_COLOR[pickupStatus] || '#888') + '33',
              color: SLOT_COLOR[pickupStatus] || '#888', fontWeight: 700,
            }} />
            <Typography variant="caption" sx={{ color: '#aaa' }}>{fmtDate(appt.pickup?.scheduledAt)}</Typography>
          </Stack>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Delivery</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip label={deliveryStatus || '—'} size="small" sx={{
              bgcolor: (SLOT_COLOR[deliveryStatus] || '#888') + '33',
              color: SLOT_COLOR[deliveryStatus] || '#888', fontWeight: 700,
            }} />
            <Typography variant="caption" sx={{ color: '#aaa' }}>{fmtDate(appt.delivery?.scheduledAt)}</Typography>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ShipperAppointments() {
  const [tabIdx, setTabIdx]           = useState(0);
  const [appointments, setAppts]      = useState([]);
  const [loading, setLoading]         = useState(false);
  const [detailId, setDetailId]       = useState(null);
  const [detailOpen, setDetailOpen]   = useState(false);

  const currentStatus = STATUS_TABS[tabIdx].value;

  const fetchAppts = useCallback(async () => {
    setLoading(true);
    try {
      const params = currentStatus ? `?status=${currentStatus}` : '';
      const res = await api.get(`/appointments${params}`);
      setAppts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setAppts([]);
    }
    setLoading(false);
  }, [currentStatus]);

  useEffect(() => { fetchAppts(); }, [fetchAppts]);

  const pendingCount = appointments.filter(a =>
    a.pickup?.status === 'pending' || a.delivery?.status === 'pending'
  ).length;

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Appointments
        </Typography>
        {pendingCount > 0 && (
          <Chip label={`${pendingCount} Pending`} sx={{ bgcolor: '#fbbf2433', color: '#fbbf24', fontWeight: 700 }} />
        )}
      </Stack>

      <Tabs
        value={tabIdx} onChange={(_, v) => setTabIdx(v)}
        sx={{ mb: 3, '& .MuiTab-root': { color: '#a78bfa', fontWeight: 600 }, '& .Mui-selected': { color: '#fff' } }}>
        {STATUS_TABS.map(t => <Tab key={t.value} label={t.label} />)}
      </Tabs>

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : appointments.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', bgcolor: 'rgba(124,140,248,0.08)', borderRadius: 3 }}>
          <EventIcon sx={{ fontSize: 48, color: '#a78bfa', mb: 2 }} />
          <Typography color="#fff" fontWeight={700}>No appointments yet</Typography>
          <Typography sx={{ color: '#94a3b8', mt: 1 }}>
            When carriers submit pickup/delivery appointment requests, they'll appear here.
          </Typography>
        </Paper>
      ) : (
        appointments.map(a => (
          <ApptCard key={a._id} appt={a} onClick={() => { setDetailId(a._id); setDetailOpen(true); }} />
        ))
      )}

      <ApptDetail
        apptId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={fetchAppts}
      />
    </Box>
  );
}
