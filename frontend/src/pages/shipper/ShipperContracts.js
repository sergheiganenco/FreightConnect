/**
 * ShipperContracts — Dedicated Lanes & Recurring Freight
 *
 * Allows shippers to create, manage, and monitor long-term contracts
 * with assigned carriers on specific lanes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, TextField, MenuItem, Dialog, DialogTitle,
  DialogContent, DialogActions, Drawer, Divider, Grid,
  IconButton, Tooltip, Alert, Switch, FormControlLabel,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SearchIcon from '@mui/icons-material/Search';
import AssignmentIcon from '@mui/icons-material/Assignment';
import api from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const EQUIPMENT_TYPES = [
  'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Lowboy',
  'Box Truck', 'Power Only', 'Tanker', 'Other',
];

const STATUS_TABS = [
  { label: 'All',      value: 'all' },
  { label: 'Draft',    value: 'draft' },
  { label: 'Pending',  value: 'pending_approval' },
  { label: 'Active',   value: 'active' },
  { label: 'Paused',   value: 'paused' },
  { label: 'Expired',  value: 'expired' },
];

const STATUS_COLOR = {
  draft:            '#94a3b8',
  pending_approval: '#fbbf24',
  active:           '#34d399',
  paused:           '#60a5fa',
  expired:          '#f87171',
  cancelled:        '#94a3b8',
  terminated:       '#ef4444',
};

const FREQ_OPTIONS = ['daily', 'weekly', 'biweekly', 'monthly'];
const RATE_TYPES   = ['per_load', 'per_mile'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCents(c) {
  if (!c && c !== 0) return '—';
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Create Contract Dialog ────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: '', originCity: '', originState: '', destCity: '', destState: '',
  equipmentType: 'Dry Van', rateType: 'per_load', rateDollars: '',
  frequency: 'weekly', loadsPerPeriod: 1,
  startDate: '', endDate: '', autoRenew: false,
};

function CreateContractDialog({ open, onClose, onCreated }) {
  const [form, setForm]   = useState(EMPTY_FORM);
  const [err, setErr]     = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setForm(EMPTY_FORM); setErr(''); } }, [open]);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const toggle = e => setForm(f => ({ ...f, [e.target.name]: e.target.checked }));

  const save = async () => {
    if (!form.title || !form.originCity || !form.destCity || !form.rateDollars || !form.startDate || !form.endDate) {
      setErr('Title, origin, destination, rate, and dates are required.'); return;
    }
    setSaving(true); setErr('');
    try {
      const payload = {
        title: form.title,
        equipmentType: form.equipmentType,
        lane: {
          origin:      { name: form.originCity, city: form.originCity, state: form.originState },
          destination: { name: form.destCity,   city: form.destCity,   state: form.destState },
        },
        pricing: {
          rateType:  form.rateType,
          rateCents: Math.round(parseFloat(form.rateDollars) * 100),
        },
        volume: {
          frequency:      form.frequency,
          loadsPerPeriod: Number(form.loadsPerPeriod),
        },
        terms: {
          startDate:  form.startDate,
          endDate:    form.endDate,
          autoRenew:  form.autoRenew,
        },
      };
      await api.post('/contracts', payload);
      onCreated();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to create contract.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Create New Contract</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="Contract Title" name="title" value={form.title}
          onChange={handle} sx={{ mb: 2, mt: 1 }} />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={8}><TextField fullWidth label="Origin City" name="originCity" value={form.originCity} onChange={handle} /></Grid>
          <Grid item xs={4}><TextField fullWidth label="State" name="originState" value={form.originState} onChange={handle} inputProps={{ maxLength: 2 }} /></Grid>
        </Grid>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={8}><TextField fullWidth label="Destination City" name="destCity" value={form.destCity} onChange={handle} /></Grid>
          <Grid item xs={4}><TextField fullWidth label="State" name="destState" value={form.destState} onChange={handle} inputProps={{ maxLength: 2 }} /></Grid>
        </Grid>
        <TextField fullWidth select label="Equipment Type" name="equipmentType" value={form.equipmentType} onChange={handle} sx={{ mb: 2 }}>
          {EQUIPMENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={5}>
            <TextField fullWidth select label="Rate Type" name="rateType" value={form.rateType} onChange={handle}>
              {RATE_TYPES.map(t => <MenuItem key={t} value={t}>{t.replace('_', ' ')}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={7}>
            <TextField fullWidth label="Rate ($)" name="rateDollars" type="number" value={form.rateDollars} onChange={handle} />
          </Grid>
        </Grid>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6}>
            <TextField fullWidth select label="Frequency" name="frequency" value={form.frequency} onChange={handle}>
              {FREQ_OPTIONS.map(f => <MenuItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth label="Loads per Period" name="loadsPerPeriod" type="number" value={form.loadsPerPeriod}
              onChange={handle} inputProps={{ min: 1 }} />
          </Grid>
        </Grid>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6}><TextField fullWidth label="Start Date" name="startDate" type="date" value={form.startDate} onChange={handle} InputLabelProps={{ shrink: true }} /></Grid>
          <Grid item xs={6}><TextField fullWidth label="End Date"   name="endDate"   type="date" value={form.endDate}   onChange={handle} InputLabelProps={{ shrink: true }} /></Grid>
        </Grid>
        <FormControlLabel
          control={<Switch name="autoRenew" checked={form.autoRenew} onChange={toggle} />}
          label="Auto-renew on expiration"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}
          sx={{ bgcolor: '#f04ca7', '&:hover': { bgcolor: '#d12e8b' } }}>
          {saving ? 'Creating…' : 'Create Contract'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Assign Carrier Dialog ─────────────────────────────────────────────────────
function AssignCarrierDialog({ open, onClose, contractId, onAssigned }) {
  const [carriers, setCarriers]   = useState([]);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [allocation, setAlloc]    = useState(100);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch(''); setSelected(null); setAlloc(100); setErr('');
    setLoading(true);
    api.get('/partnerships/directory').then(r => {
      setCarriers(r.data.carriers || []);
    }).catch(() => setCarriers([])).finally(() => setLoading(false));
  }, [open]);

  const filtered = carriers.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.companyName || '').toLowerCase().includes(search.toLowerCase())
  );

  const save = async () => {
    if (!selected) { setErr('Select a carrier first.'); return; }
    setSaving(true); setErr('');
    try {
      await api.post(`/contracts/${contractId}/assign-carrier`, { carrierId: selected._id, allocation });
      onAssigned();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to assign carrier.');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign Carrier</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth placeholder="Search carriers…" value={search} onChange={e => setSearch(e.target.value)}
          sx={{ mb: 2, mt: 1 }} slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: '#aaa' }} /> } }} />
        {loading ? <CircularProgress size={24} /> : (
          <Box sx={{ maxHeight: 260, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2 }}>
            {filtered.length === 0
              ? <Typography sx={{ p: 2, color: '#aaa' }}>No carriers found.</Typography>
              : filtered.map(c => (
                <Box key={c._id} onClick={() => setSelected(c)}
                  sx={{
                    p: 1.5, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    bgcolor: selected?._id === c._id ? 'rgba(106,31,207,0.2)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                  }}>
                  <Typography fontWeight={600}>{c.companyName || c.name}</Typography>
                  <Typography variant="caption" sx={{ color: '#aaa' }}>{c.email}</Typography>
                </Box>
              ))
            }
          </Box>
        )}
        {selected && (
          <TextField fullWidth label="Allocation %" type="number" value={allocation}
            onChange={e => setAlloc(Number(e.target.value))} sx={{ mt: 2 }}
            inputProps={{ min: 1, max: 100 }} helperText="Percentage of loads for this carrier" />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || !selected}
          sx={{ bgcolor: '#6a1fcf', '&:hover': { bgcolor: '#5518a8' } }}>
          {saving ? 'Assigning…' : 'Assign Carrier'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Contract Detail Drawer ────────────────────────────────────────────────────
function ContractDetail({ contractId, open, onClose, onRefresh }) {
  const [contract, setContract]     = useState(null);
  const [perf, setPerf]             = useState(null);
  const [loads, setLoads]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [actionErr, setActionErr]   = useState('');

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true); setActionErr('');
    try {
      const [cRes, pRes, lRes] = await Promise.all([
        api.get(`/contracts/${contractId}`),
        api.get(`/contracts/${contractId}/performance`),
        api.get(`/contracts/${contractId}/loads?limit=10`),
      ]);
      setContract(cRes.data);
      setPerf(pRes.data);
      setLoads(lRes.data.loads || []);
    } catch { /* swallow */ }
    setLoading(false);
  }, [contractId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const action = async (endpoint, method = 'post') => {
    setActionErr('');
    try {
      await api[method](`/contracts/${contractId}/${endpoint}`);
      await load();
      onRefresh();
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Action failed.');
    }
  };

  const terminate = async () => {
    if (!window.confirm('Terminate this contract? This cannot be undone.')) return;
    setActionErr('');
    try {
      await api.delete(`/contracts/${contractId}`);
      onClose();
      onRefresh();
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Failed to terminate.');
    }
  };

  const removeCarrier = async (carrierId) => {
    setActionErr('');
    try {
      await api.delete(`/contracts/${contractId}/carrier/${carrierId}`);
      await load();
      onRefresh();
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Failed to remove carrier.');
    }
  };

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose}
        PaperProps={{ sx: { width: { xs: '100%', md: 600 }, p: 3, bgcolor: '#1a1230', color: '#fff' } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" fontWeight={800}>Contract Detail</Typography>
          <IconButton onClick={onClose} sx={{ color: '#fff' }}><CloseIcon /></IconButton>
        </Stack>

        {loading ? (
          <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
        ) : !contract ? (
          <Typography sx={{ color: '#aaa' }}>Failed to load contract.</Typography>
        ) : (
          <Box>
            {actionErr && <Alert severity="error" sx={{ mb: 2 }}>{actionErr}</Alert>}

            {/* Header */}
            <Stack direction="row" alignItems="flex-start" spacing={2} mb={3}>
              <AssignmentIcon sx={{ color: '#a78bfa', mt: 0.5 }} />
              <Box flex={1}>
                <Typography fontWeight={800} fontSize="1.1rem">{contract.title}</Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>{contract.contractNumber}</Typography>
              </Box>
              <Chip label={contract.status.replace('_', ' ')} size="small" sx={{
                bgcolor: (STATUS_COLOR[contract.status] || '#888') + '33',
                color:   STATUS_COLOR[contract.status] || '#888',
                fontWeight: 700, textTransform: 'capitalize',
              }} />
            </Stack>

            {/* Lane */}
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>LANE</Typography>
              <Typography fontWeight={600}>
                {contract.lane?.origin?.city}, {contract.lane?.origin?.state}
                {' → '}
                {contract.lane?.destination?.city}, {contract.lane?.destination?.state}
              </Typography>
              <Stack direction="row" spacing={2} mt={1}>
                <Typography variant="body2" sx={{ color: '#c4b5fd' }}>{contract.equipmentType}</Typography>
                <Typography variant="body2" sx={{ color: '#c4b5fd' }}>
                  {fmtCents(contract.pricing?.rateCents)} / {contract.pricing?.rateType?.replace('_', ' ')}
                </Typography>
              </Stack>
            </Paper>

            {/* Volume & Dates */}
            <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>VOLUME</Typography>
                  <Typography fontWeight={600}>{contract.volume?.loadsPerPeriod} loads / {contract.volume?.frequency}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>TERM</Typography>
                  <Typography fontWeight={600}>{fmtDate(contract.terms?.startDate)} — {fmtDate(contract.terms?.endDate)}</Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Performance */}
            {perf && (
              <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>PERFORMANCE</Typography>
                <Grid container spacing={1} mt={0.5}>
                  {[
                    ['Total Loads', perf.realTime?.totalLoads],
                    ['Completed',   perf.realTime?.completed],
                    ['In Progress', perf.realTime?.inProgress],
                    ['Revenue',     `$${(perf.realTime?.totalRevenue || 0).toLocaleString()}`],
                    ['Completion',  `${perf.realTime?.completionRate}%`],
                  ].map(([label, val]) => (
                    <Grid item xs={4} key={label}>
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>{label}</Typography>
                      <Typography fontWeight={700} color="#c4b5fd">{val ?? '—'}</Typography>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            )}

            {/* Assigned Carriers */}
            <Box mb={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle2" fontWeight={700}>Assigned Carriers</Typography>
                {['draft', 'pending_approval', 'active', 'paused'].includes(contract.status) && (
                  <Button size="small" startIcon={<PersonAddIcon />}
                    onClick={() => setAssignOpen(true)}
                    sx={{ color: '#a78bfa', textTransform: 'none' }}>
                    Assign
                  </Button>
                )}
              </Stack>
              {(contract.assignedCarriers || []).filter(ac => ac.status !== 'removed').length === 0
                ? <Typography sx={{ color: '#aaa', fontSize: '0.9rem' }}>No carriers assigned yet.</Typography>
                : (contract.assignedCarriers || []).filter(ac => ac.status !== 'removed').map(ac => (
                  <Paper key={ac._id} sx={{ bgcolor: 'rgba(255,255,255,0.05)', p: 1.5, borderRadius: 2, mb: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Box>
                        <Typography fontWeight={600}>{ac.carrier?.companyName || ac.carrier?.name}</Typography>
                        <Typography variant="caption" sx={{ color: '#94a3b8' }}>{ac.carrier?.email}</Typography>
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip label={ac.status} size="small" sx={{
                          bgcolor: (STATUS_COLOR[ac.status] || '#888') + '33',
                          color: STATUS_COLOR[ac.status] || '#888',
                          fontWeight: 700,
                        }} />
                        <Tooltip title="Remove carrier">
                          <IconButton size="small" onClick={() => removeCarrier(ac.carrier._id)} sx={{ color: '#ef4444' }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </Paper>
                ))
              }
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

            {/* Recent Loads */}
            <Typography variant="subtitle2" fontWeight={700} mb={1}>Recent Loads</Typography>
            {loads.length === 0
              ? <Typography sx={{ color: '#aaa', fontSize: '0.9rem', mb: 2 }}>No loads generated yet.</Typography>
              : (
                <Table size="small" sx={{ mb: 2 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: '#94a3b8' }}>Title</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>Status</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>Rate</TableCell>
                      <TableCell sx={{ color: '#94a3b8' }}>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loads.map(l => (
                      <TableRow key={l._id}>
                        <TableCell sx={{ color: '#fff' }}>{l.title}</TableCell>
                        <TableCell><Chip label={l.status} size="small" sx={{ color: '#c4b5fd', bgcolor: 'rgba(164,117,248,0.15)' }} /></TableCell>
                        <TableCell sx={{ color: '#fff' }}>${l.rate}</TableCell>
                        <TableCell sx={{ color: '#94a3b8' }}>{fmtDate(l.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            }

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

            {/* Actions */}
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {contract.status === 'active' && (
                <Button size="small" startIcon={<PauseIcon />}
                  onClick={() => action('pause')} variant="outlined"
                  sx={{ color: '#60a5fa', borderColor: '#60a5fa' }}>
                  Pause
                </Button>
              )}
              {contract.status === 'paused' && (
                <Button size="small" startIcon={<PlayArrowIcon />}
                  onClick={() => action('resume')} variant="outlined"
                  sx={{ color: '#34d399', borderColor: '#34d399' }}>
                  Resume
                </Button>
              )}
              {!['expired', 'cancelled', 'terminated'].includes(contract.status) && (
                <Button size="small" startIcon={<DeleteIcon />}
                  onClick={terminate} variant="outlined"
                  sx={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  {contract.status === 'draft' ? 'Cancel' : 'Terminate'}
                </Button>
              )}
            </Stack>
          </Box>
        )}
      </Drawer>

      <AssignCarrierDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        contractId={contractId}
        onAssigned={() => { load(); onRefresh(); }}
      />
    </>
  );
}

// ── Contract Card ─────────────────────────────────────────────────────────────
function ContractCard({ contract, onClick }) {
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
          <Typography fontWeight={700} color="#fff">{contract.title}</Typography>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>{contract.contractNumber}</Typography>
        </Box>
        <Chip label={contract.status.replace('_', ' ')} size="small" sx={{
          bgcolor: (STATUS_COLOR[contract.status] || '#888') + '33',
          color:   STATUS_COLOR[contract.status] || '#888',
          fontWeight: 700, textTransform: 'capitalize',
        }} />
      </Stack>

      <Typography sx={{ color: '#c4b5fd', mb: 1 }}>
        {contract.lane?.origin?.city}, {contract.lane?.origin?.state}
        {' → '}
        {contract.lane?.destination?.city}, {contract.lane?.destination?.state}
      </Typography>

      <Stack direction="row" spacing={3} flexWrap="wrap">
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Equipment</Typography>
          <Typography variant="body2" color="#fff">{contract.equipmentType}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Rate</Typography>
          <Typography variant="body2" color="#fff">
            {fmtCents(contract.pricing?.rateCents)} / {contract.pricing?.rateType?.replace('_', ' ')}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Volume</Typography>
          <Typography variant="body2" color="#fff">
            {contract.volume?.loadsPerPeriod} / {contract.volume?.frequency}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Carriers</Typography>
          <Typography variant="body2" color="#fff">
            {(contract.assignedCarriers || []).filter(ac => ac.status !== 'removed').length}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Expires</Typography>
          <Typography variant="body2" color="#fff">{fmtDate(contract.terms?.endDate)}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ShipperContracts() {
  const [tabIdx, setTabIdx]           = useState(0);
  const [contracts, setContracts]     = useState([]);
  const [loading, setLoading]         = useState(false);
  const [createOpen, setCreateOpen]   = useState(false);
  const [detailId, setDetailId]       = useState(null);
  const [detailOpen, setDetailOpen]   = useState(false);

  const currentStatus = STATUS_TABS[tabIdx].value;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = currentStatus !== 'all' ? `?status=${currentStatus}` : '';
      const res = await api.get(`/contracts${params}`);
      setContracts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setContracts([]);
    }
    setLoading(false);
  }, [currentStatus]);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  const openDetail = (id) => { setDetailId(id); setDetailOpen(true); };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Contracts &amp; Dedicated Lanes
        </Typography>
        <Button
          variant="contained" startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: '#f04ca7', fontWeight: 800, borderRadius: 99, '&:hover': { bgcolor: '#d12e8b' } }}>
          New Contract
        </Button>
      </Stack>

      <Tabs
        value={tabIdx} onChange={(_, v) => setTabIdx(v)}
        sx={{ mb: 3, '& .MuiTab-root': { color: '#a78bfa', fontWeight: 600 }, '& .Mui-selected': { color: '#fff' } }}>
        {STATUS_TABS.map(t => <Tab key={t.value} label={t.label} />)}
      </Tabs>

      {loading ? (
        <Box display="flex" justifyContent="center" pt={6}><CircularProgress /></Box>
      ) : contracts.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', bgcolor: 'rgba(124,140,248,0.08)', borderRadius: 3 }}>
          <AssignmentIcon sx={{ fontSize: 48, color: '#a78bfa', mb: 2 }} />
          <Typography color="#fff" fontWeight={700}>No contracts found</Typography>
          <Typography sx={{ color: '#94a3b8', mt: 1 }}>
            Create a contract to set up dedicated lanes with recurring freight.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} sx={{ mt: 3, bgcolor: '#f04ca7', '&:hover': { bgcolor: '#d12e8b' } }}
            onClick={() => setCreateOpen(true)}>
            Create First Contract
          </Button>
        </Paper>
      ) : (
        contracts.map(c => (
          <ContractCard key={c._id} contract={c} onClick={() => openDetail(c._id)} />
        ))
      )}

      <CreateContractDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchContracts}
      />

      <ContractDetail
        contractId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={fetchContracts}
      />
    </Box>
  );
}
