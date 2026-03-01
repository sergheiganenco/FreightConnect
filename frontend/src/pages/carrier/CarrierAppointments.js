/**
 * CarrierAppointments — Schedule & manage pickup/delivery appointments
 *
 * Carriers can create appointment records for accepted loads,
 * request specific pickup/delivery times, and track confirmations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, Drawer, Grid, IconButton, Alert, Divider,
  TextField, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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

// ── Create Appointment Dialog (for a load that doesn't have one yet) ──────────
function CreateApptDialog({ open, onClose, onCreated }) {
  const [loads, setLoads]       = useState([]);
  const [form, setForm]         = useState({
    loadId: '',
    pickupScheduledAt: '', pickupFacility: '', pickupContact: '', pickupPhone: '',
    deliveryScheduledAt: '', deliveryFacility: '', deliveryContact: '', deliveryPhone: '',
    notes: '',
  });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  useEffect(() => {
    if (!open) return;
    setErr(''); setForm(f => ({ ...f, loadId: '' }));
    // Load accepted/in-transit loads
    api.get('/loads?status=accepted').then(r => {
      const data = r.data;
      setLoads(Array.isArray(data) ? data : (data.loads || []));
    }).catch(() => setLoads([]));
  }, [open]);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async () => {
    if (!form.loadId) { setErr('Select a load.'); return; }
    if (!form.pickupScheduledAt && !form.deliveryScheduledAt) {
      setErr('Enter at least one scheduled time.'); return;
    }
    setSaving(true); setErr('');
    try {
      const payload = {
        loadId: form.loadId,
        pickup: form.pickupScheduledAt ? {
          scheduledAt:  form.pickupScheduledAt,
          facilityName: form.pickupFacility,
          contactName:  form.pickupContact,
          contactPhone: form.pickupPhone,
        } : undefined,
        delivery: form.deliveryScheduledAt ? {
          scheduledAt:  form.deliveryScheduledAt,
          facilityName: form.deliveryFacility,
          contactName:  form.deliveryContact,
          contactPhone: form.deliveryPhone,
        } : undefined,
      };
      await api.post('/appointments', payload);
      onCreated();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to create appointment.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Schedule Appointment</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth select label="Load" name="loadId" value={form.loadId}
          onChange={handle} sx={{ mb: 3, mt: 1 }}>
          {loads.length === 0
            ? <MenuItem disabled>No accepted loads</MenuItem>
            : loads.map(l => <MenuItem key={l._id} value={l._id}>{l.title} — {l.origin} → {l.destination}</MenuItem>)
          }
        </TextField>

        <Typography variant="subtitle2" fontWeight={700} mb={1} sx={{ color: '#a78bfa' }}>
          Pickup Appointment
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12}><TextField fullWidth label="Pickup Date & Time" name="pickupScheduledAt" type="datetime-local" value={form.pickupScheduledAt} onChange={handle} InputLabelProps={{ shrink: true }} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Facility Name" name="pickupFacility" value={form.pickupFacility} onChange={handle} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Contact Name" name="pickupContact" value={form.pickupContact} onChange={handle} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Phone" name="pickupPhone" value={form.pickupPhone} onChange={handle} /></Grid>
        </Grid>

        <Typography variant="subtitle2" fontWeight={700} mb={1} sx={{ color: '#60a5fa' }}>
          Delivery Appointment
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}><TextField fullWidth label="Delivery Date & Time" name="deliveryScheduledAt" type="datetime-local" value={form.deliveryScheduledAt} onChange={handle} InputLabelProps={{ shrink: true }} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Facility Name" name="deliveryFacility" value={form.deliveryFacility} onChange={handle} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Contact Name" name="deliveryContact" value={form.deliveryContact} onChange={handle} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="Phone" name="deliveryPhone" value={form.deliveryPhone} onChange={handle} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}>
          {saving ? 'Scheduling…' : 'Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Update Slot Dialog ────────────────────────────────────────────────────────
function UpdateSlotDialog({ open, onClose, apptId, apptType, currentSlot, onDone }) {
  const [form, setForm]   = useState({ scheduledAt: '', facilityName: '', contactName: '', contactPhone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => {
    if (open) {
      setErr('');
      setForm({
        scheduledAt:  currentSlot?.scheduledAt ? new Date(currentSlot.scheduledAt).toISOString().slice(0, 16) : '',
        facilityName: currentSlot?.facilityName || '',
        contactName:  currentSlot?.contactName  || '',
        contactPhone: currentSlot?.contactPhone  || '',
        notes:        currentSlot?.notes         || '',
      });
    }
  }, [open, currentSlot]);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async () => {
    if (!form.scheduledAt) { setErr('Date and time are required.'); return; }
    setSaving(true); setErr('');
    try {
      await api.patch(`/appointments/${apptId}/request`, { apptType, ...form });
      onDone();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to update.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Update {apptType === 'pickup' ? 'Pickup' : 'Delivery'} Slot</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="Date & Time" name="scheduledAt" type="datetime-local"
          value={form.scheduledAt} onChange={handle} InputLabelProps={{ shrink: true }} sx={{ mb: 2, mt: 1 }} />
        <TextField fullWidth label="Facility Name" name="facilityName" value={form.facilityName} onChange={handle} sx={{ mb: 2 }} />
        <TextField fullWidth label="Contact Name" name="contactName" value={form.contactName} onChange={handle} sx={{ mb: 2 }} />
        <TextField fullWidth label="Contact Phone" name="contactPhone" value={form.contactPhone} onChange={handle} sx={{ mb: 2 }} />
        <TextField fullWidth label="Notes" name="notes" value={form.notes} onChange={handle} multiline rows={2} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}>
          {saving ? 'Updating…' : 'Update'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Slot Panel ────────────────────────────────────────────────────────────────
function SlotPanel({ type, slot, apptId, onRefresh }) {
  const [updateOpen, setUpdateOpen] = useState(false);

  const isEditable = !slot?.status || ['pending', 'rescheduled'].includes(slot.status);

  return (
    <Paper sx={{ bgcolor: 'rgba(255,255,255,0.05)', p: 2, borderRadius: 2, mb: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {type === 'pickup'
            ? <AccessTimeIcon sx={{ color: '#a78bfa', fontSize: 18 }} />
            : <EventIcon sx={{ color: '#60a5fa', fontSize: 18 }} />}
          <Typography fontWeight={700} sx={{ textTransform: 'capitalize' }}>{type}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          {slot?.status && (
            <Chip label={slot.status} size="small" sx={{
              bgcolor: (SLOT_COLOR[slot.status] || '#888') + '33',
              color: SLOT_COLOR[slot.status] || '#888', fontWeight: 700,
            }} />
          )}
          {isEditable && (
            <Button size="small" onClick={() => setUpdateOpen(true)}
              sx={{ color: '#a78bfa', textTransform: 'none', fontSize: '0.75rem' }}>
              {slot?.scheduledAt ? 'Update' : 'Set Time'}
            </Button>
          )}
        </Stack>
      </Stack>

      {slot?.scheduledAt ? (
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
          {slot.confirmedAt && (
            <Grid item xs={12}>
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleIcon sx={{ color: '#34d399', fontSize: 16 }} />
                <Typography variant="caption" sx={{ color: '#34d399' }}>
                  Confirmed {fmtDateTime(slot.confirmedAt)}
                </Typography>
              </Stack>
            </Grid>
          )}
        </Grid>
      ) : (
        <Typography variant="body2" sx={{ color: '#94a3b8' }}>No time scheduled yet.</Typography>
      )}

      <UpdateSlotDialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        apptId={apptId} apptType={type}
        currentSlot={slot}
        onDone={onRefresh}
      />
    </Paper>
  );
}

// ── Appointment Detail Drawer ─────────────────────────────────────────────────
function ApptDetail({ apptId, open, onClose, onRefresh }) {
  const [appt, setAppt]       = useState(null);
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
        <Typography variant="h6" fontWeight={800}>Appointment</Typography>
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

          {/* Shipper */}
          <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>SHIPPER</Typography>
            <Typography fontWeight={600}>{appt.shipper?.companyName || appt.shipper?.name}</Typography>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>{appt.shipper?.email}</Typography>
          </Paper>

          {/* Agreed windows */}
          {(appt.load?.pickupTimeWindow?.start || appt.load?.deliveryTimeWindow?.start) && (
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.04)', p: 2, borderRadius: 2, mb: 2 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>AGREED TIME WINDOWS</Typography>
              {appt.load?.pickupTimeWindow?.start && (
                <Typography variant="body2" color="#fff">
                  Pickup: {fmtDateTime(appt.load.pickupTimeWindow.start)}
                </Typography>
              )}
              {appt.load?.deliveryTimeWindow?.start && (
                <Typography variant="body2" color="#fff">
                  Delivery: {fmtDateTime(appt.load.deliveryTimeWindow.start)}
                </Typography>
              )}
            </Paper>
          )}

          <SlotPanel type="pickup"   slot={appt.pickup}   apptId={apptId} onRefresh={refresh} />
          <SlotPanel type="delivery" slot={appt.delivery} apptId={apptId} onRefresh={refresh} />

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

  return (
    <Paper onClick={onClick} sx={{
      p: 2.5, borderRadius: 3, mb: 2, cursor: 'pointer',
      bgcolor: 'rgba(124,140,248,0.10)',
      border: '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.18s',
      '&:hover': { bgcolor: 'rgba(124,140,248,0.18)', borderColor: 'rgba(167,139,250,0.35)' },
    }}>
      <Typography fontWeight={700} color="#fff" mb={0.5}>{appt.load?.title}</Typography>
      <Typography variant="body2" sx={{ color: '#c4b5fd', mb: 1 }}>
        {appt.load?.origin} → {appt.load?.destination}
      </Typography>

      <Stack direction="row" spacing={3}>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Pickup</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip label={pickupStatus || 'not set'} size="small" sx={{
              bgcolor: (SLOT_COLOR[pickupStatus] || '#888') + '33',
              color: SLOT_COLOR[pickupStatus] || '#888', fontWeight: 700,
            }} />
            <Typography variant="caption" sx={{ color: '#aaa' }}>{fmtDate(appt.pickup?.scheduledAt)}</Typography>
          </Stack>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Delivery</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip label={deliveryStatus || 'not set'} size="small" sx={{
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
export default function CarrierAppointments() {
  const [tabIdx, setTabIdx]           = useState(0);
  const [appointments, setAppts]      = useState([]);
  const [loading, setLoading]         = useState(false);
  const [createOpen, setCreateOpen]   = useState(false);
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

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Appointments
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: '#6a1fcf', fontWeight: 800, borderRadius: 99, '&:hover': { bgcolor: '#5518a8' } }}>
          Schedule
        </Button>
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
          <ScheduleIcon sx={{ fontSize: 48, color: '#a78bfa', mb: 2 }} />
          <Typography color="#fff" fontWeight={700}>No appointments yet</Typography>
          <Typography sx={{ color: '#94a3b8', mt: 1 }}>
            Schedule pickup and delivery appointments for your accepted loads.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} sx={{ mt: 3, bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}
            onClick={() => setCreateOpen(true)}>
            Schedule First Appointment
          </Button>
        </Paper>
      ) : (
        appointments.map(a => (
          <ApptCard key={a._id} appt={a} onClick={() => { setDetailId(a._id); setDetailOpen(true); }} />
        ))
      )}

      <CreateApptDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchAppts}
      />

      <ApptDetail
        apptId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={fetchAppts}
      />
    </Box>
  );
}
