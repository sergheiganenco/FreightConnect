// src/pages/carrier/CarrierDrivers.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Button, Grid, Paper, Chip, Stack, IconButton,
  CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, OutlinedInput, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BadgeIcon from '@mui/icons-material/Badge';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import VerifiedIcon from '@mui/icons-material/Verified';
import api from '../../services/api';
import {
  glassCard, surface, text as T, brand, semantic, tint, darkFieldSx, radius,
} from '../../theme/tokens';

const ENDORSEMENT_OPTIONS = [
  { value: 'hazmat',          label: 'Hazmat' },
  { value: 'tanker',          label: 'Tanker' },
  { value: 'doubles_triples', label: 'Doubles/Triples' },
  { value: 'passenger',       label: 'Passenger' },
  { value: 'school_bus',      label: 'School Bus' },
];
const ENDORSEMENT_LABEL = Object.fromEntries(ENDORSEMENT_OPTIONS.map(e => [e.value, e.label]));

const STATUS_COLOR = {
  active:    semantic.success,
  inactive:  semantic.muted,
  suspended: semantic.error,
};

const emptyForm = {
  name: '',
  phone: '',
  licenseNumber: '',
  licenseState: '',
  licenseExpiry: '',
  medicalExpiry: '',
  hazmatExpiry: '',
  endorsements: [],
  status: 'active',
};

function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function CarrierDrivers() {
  const [drivers, setDrivers]   = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [snack, setSnack]       = useState('');

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState(null); // driverId being edited or null
  const [form, setForm]         = useState(emptyForm);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');

  // Carrier-level endorsements
  const [carrierEndorsements, setCarrierEndorsements] = useState([]);
  const [savingCarrierEnd, setSavingCarrierEnd] = useState(false);

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/drivers');
      const list = Array.isArray(data) ? data : (data.drivers || data.data || []);
      setDrivers(list);
      if (data && Array.isArray(data.carrierEndorsements)) {
        setCarrierEndorsements(data.carrierEndorsements);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load drivers.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await api.get('/drivers/compliance-alerts');
      setAlerts(Array.isArray(data) ? data : (data.alerts || data.data || []));
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchDrivers();
    fetchAlerts();
  }, [fetchDrivers, fetchAlerts]);

  /* ── dialog helpers ──────────────────────────────────────────── */
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (d) => {
    setEditing(d._id || d.driverId);
    setForm({
      name: d.name || '',
      phone: d.phone || '',
      licenseNumber: d.licenseNumber || '',
      licenseState: d.licenseState || '',
      licenseExpiry: toDateInput(d.licenseExpiry),
      medicalExpiry: toDateInput(d.medicalExpiry),
      hazmatExpiry: toDateInput(d.hazmatExpiry),
      endorsements: Array.isArray(d.endorsements) ? d.endorsements : [],
      status: d.status || 'active',
    });
    setFormError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError('Driver name is required.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      licenseNumber: form.licenseNumber.trim(),
      licenseState: form.licenseState.trim(),
      licenseExpiry: form.licenseExpiry || undefined,
      medicalExpiry: form.medicalExpiry || undefined,
      hazmatExpiry: form.hazmatExpiry || undefined,
      endorsements: form.endorsements,
      status: form.status,
    };
    try {
      if (editing) {
        await api.put(`/drivers/${editing}`, payload);
        setSnack('Driver updated.');
      } else {
        await api.post('/drivers', payload);
        setSnack('Driver added.');
      }
      closeDialog();
      fetchDrivers();
      fetchAlerts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save driver.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d) => {
    const id = d._id || d.driverId;
    if (!window.confirm(`Remove driver ${d.name}?`)) return;
    try {
      await api.delete(`/drivers/${id}`);
      setDrivers((prev) => prev.filter((x) => (x._id || x.driverId) !== id));
      setSnack('Driver removed.');
      fetchAlerts();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove driver.');
    }
  };

  const handleSaveCarrierEndorsements = async () => {
    setSavingCarrierEnd(true);
    try {
      await api.put('/drivers/endorsements', { endorsements: carrierEndorsements });
      setSnack('Carrier endorsements updated.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update endorsements.');
    } finally {
      setSavingCarrierEnd(false);
    }
  };

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', width: '100%', pt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <BadgeIcon sx={{ color: brand.indigoLight, fontSize: 30, mr: 1.5 }} />
        <Typography variant="h5" fontWeight={800} sx={{ color: T.primary, flex: 1 }}>
          Drivers
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAdd}
          sx={{ bgcolor: brand.indigo, borderRadius: radius.pill, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}
        >
          Add Driver
        </Button>
      </Box>

      {/* Compliance alerts banner */}
      {alerts.length > 0 && (
        <Paper sx={{ ...glassCard.standard, p: 2, mb: 3, border: `1px solid ${tint(semantic.warning, 0.4)}`, bgcolor: tint(semantic.warning, 0.06) }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
            <WarningAmberIcon sx={{ color: semantic.warning }} />
            <Typography fontWeight={700} sx={{ color: T.primary }}>
              Compliance Alerts ({alerts.length})
            </Typography>
          </Stack>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {alerts.map((a, i) => {
              const days = a.daysUntilExpiry ?? a.days ?? null;
              const expired = a.expired || (typeof days === 'number' && days < 0);
              const color = expired ? semantic.error : (typeof days === 'number' && days <= 7 ? semantic.error : semantic.warning);
              const kind = (a.type || a.field || 'Document').toString().replace(/_/g, ' ');
              const label = `${a.driverName || a.name || 'Driver'} — ${kind}${
                expired ? ' EXPIRED' : (typeof days === 'number' ? ` (${days}d)` : '')
              }`;
              return (
                <Chip
                  key={i}
                  label={label}
                  size="small"
                  sx={{ bgcolor: tint(color, 0.18), color, fontWeight: 700, textTransform: 'capitalize' }}
                />
              );
            })}
          </Stack>
        </Paper>
      )}

      {/* Carrier-level endorsements */}
      <Paper sx={{ ...glassCard.standard, p: 2.5, mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
          <VerifiedIcon sx={{ color: brand.indigoLight }} />
          <Typography fontWeight={700} sx={{ color: T.primary }}>Carrier Operating Authority / Endorsements</Typography>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ ...darkFieldSx, minWidth: 280, flex: 1 }}>
            <InputLabel>Endorsements</InputLabel>
            <Select
              multiple
              value={carrierEndorsements}
              onChange={(e) => setCarrierEndorsements(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
              input={<OutlinedInput label="Endorsements" />}
              renderValue={(sel) => (
                <Stack direction="row" flexWrap="wrap" gap={0.5}>
                  {sel.map((v) => <Chip key={v} label={ENDORSEMENT_LABEL[v] || v} size="small" sx={{ bgcolor: tint(brand.indigo, 0.3), color: '#fff' }} />)}
                </Stack>
              )}
            >
              {ENDORSEMENT_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            onClick={handleSaveCarrierEndorsements}
            disabled={savingCarrierEnd}
            sx={{ borderRadius: radius.pill, borderColor: surface.glassBorder, color: T.primary, fontWeight: 700, '&:hover': { borderColor: T.muted, bgcolor: surface.glassSubtle } }}
          >
            {savingCarrierEnd ? <CircularProgress size={18} /> : 'Save'}
          </Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {snack && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSnack('')}>{snack}</Alert>}

      {/* Driver roster */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress sx={{ color: '#fff' }} />
        </Box>
      ) : drivers.length === 0 ? (
        <Paper sx={{ ...glassCard.subtle, p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: T.secondary }}>No drivers yet. Add your first driver to start tracking compliance.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {drivers.map((d) => {
            const sColor = STATUS_COLOR[d.status] || semantic.muted;
            return (
              <Grid item xs={12} sm={6} md={4} key={d._id || d.driverId}>
                <Paper sx={{ ...glassCard.standard, p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Box>
                      <Typography fontWeight={700} sx={{ color: T.primary }}>{d.name}</Typography>
                      {d.phone && <Typography variant="caption" sx={{ color: T.secondary }}>{d.phone}</Typography>}
                    </Box>
                    <Chip label={d.status || 'active'} size="small"
                      sx={{ bgcolor: tint(sColor, 0.2), color: sColor, fontWeight: 700, textTransform: 'capitalize' }} />
                  </Stack>

                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.62rem' }}>License</Typography>
                    <Typography variant="body2" sx={{ color: T.primary }}>
                      {d.licenseNumber || '—'}{d.licenseState ? ` (${d.licenseState})` : ''}
                    </Typography>
                    {d.licenseExpiry && (
                      <Typography variant="caption" sx={{ color: T.secondary }}>
                        CDL exp: {new Date(d.licenseExpiry).toLocaleDateString()}
                      </Typography>
                    )}
                  </Box>

                  {(d.medicalExpiry || d.hazmatExpiry) && (
                    <Box sx={{ mb: 1 }}>
                      {d.medicalExpiry && (
                        <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                          Medical exp: {new Date(d.medicalExpiry).toLocaleDateString()}
                        </Typography>
                      )}
                      {d.hazmatExpiry && (
                        <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                          Hazmat exp: {new Date(d.hazmatExpiry).toLocaleDateString()}
                        </Typography>
                      )}
                    </Box>
                  )}

                  {Array.isArray(d.endorsements) && d.endorsements.length > 0 && (
                    <Stack direction="row" flexWrap="wrap" gap={0.5} mb={1}>
                      {d.endorsements.map((e) => (
                        <Chip key={e} label={ENDORSEMENT_LABEL[e] || e} size="small"
                          sx={{ bgcolor: tint(brand.indigo, 0.25), color: brand.indigoLight, fontWeight: 600, fontSize: '0.65rem' }} />
                      ))}
                    </Stack>
                  )}

                  <Stack direction="row" justifyContent="flex-end" spacing={0.5} sx={{ mt: 'auto', pt: 1 }}>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(d)}>
                        <EditIcon sx={{ color: T.secondary }} fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton size="small" onClick={() => handleDelete(d)}>
                        <DeleteIcon sx={{ color: semantic.error }} fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: surface.modal, color: T.primary, borderRadius: 3, border: `1px solid ${surface.indigoGlow}` } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit Driver' : 'Add Driver'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Driver Name" required value={form.name}
              onChange={(e) => setField('name', e.target.value)} fullWidth sx={darkFieldSx} />
            <TextField label="Phone" value={form.phone}
              onChange={(e) => setField('phone', e.target.value)} fullWidth sx={darkFieldSx} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="License Number" value={form.licenseNumber}
                onChange={(e) => setField('licenseNumber', e.target.value)} fullWidth sx={darkFieldSx} />
              <TextField label="License State" value={form.licenseState}
                onChange={(e) => setField('licenseState', e.target.value)}
                inputProps={{ maxLength: 2, style: { textTransform: 'uppercase' } }}
                sx={{ ...darkFieldSx, width: { sm: 140 } }} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="CDL Expiry" type="date" value={form.licenseExpiry}
                onChange={(e) => setField('licenseExpiry', e.target.value)}
                InputLabelProps={{ shrink: true }} fullWidth sx={darkFieldSx} />
              <TextField label="Medical Cert Expiry" type="date" value={form.medicalExpiry}
                onChange={(e) => setField('medicalExpiry', e.target.value)}
                InputLabelProps={{ shrink: true }} fullWidth sx={darkFieldSx} />
            </Stack>
            <TextField label="Hazmat Endorsement Expiry" type="date" value={form.hazmatExpiry}
              onChange={(e) => setField('hazmatExpiry', e.target.value)}
              InputLabelProps={{ shrink: true }} fullWidth sx={darkFieldSx} />
            <FormControl fullWidth sx={darkFieldSx}>
              <InputLabel>Endorsements</InputLabel>
              <Select
                multiple
                value={form.endorsements}
                onChange={(e) => setField('endorsements', typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                input={<OutlinedInput label="Endorsements" />}
                renderValue={(sel) => (
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {sel.map((v) => <Chip key={v} label={ENDORSEMENT_LABEL[v] || v} size="small" sx={{ bgcolor: tint(brand.indigo, 0.3), color: '#fff' }} />)}
                  </Stack>
                )}
              >
                {ENDORSEMENT_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth sx={darkFieldSx}>
              <InputLabel>Status</InputLabel>
              <Select value={form.status} label="Status" onChange={(e) => setField('status', e.target.value)}>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
                <MenuItem value="suspended">Suspended</MenuItem>
              </Select>
            </FormControl>
            {formError && <Alert severity="error">{formError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeDialog} sx={{ color: T.secondary }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}
            sx={{ bgcolor: brand.indigo, borderRadius: radius.pill, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}>
            {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : (editing ? 'Save Changes' : 'Add Driver')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
