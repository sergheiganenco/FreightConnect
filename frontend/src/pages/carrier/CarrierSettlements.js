// src/pages/carrier/CarrierSettlements.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Stack, Grid, Divider,
  CircularProgress, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, IconButton, Tooltip, Dialog, DialogTitle, DialogContent,
  DialogActions,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import CalculateIcon from '@mui/icons-material/Calculate';
import PostAddIcon from '@mui/icons-material/PostAdd';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PaidIcon from '@mui/icons-material/Paid';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import api from '../../services/api';
import {
  glassCard, surface, text as T, brand, semantic, tint, darkFieldSx, radius,
} from '../../theme/tokens';

/* ── constants ──────────────────────────────────────────────────────────── */
const STATUS_COLOR = {
  draft:     semantic.warning,
  finalized: brand.indigo,
  paid:      semantic.success,
  void:      semantic.error,
  cancelled: semantic.error,
};

const PAY_METHODS = [
  { value: 'ach',   label: 'ACH / Direct Deposit' },
  { value: 'check', label: 'Check' },
  { value: 'wire',  label: 'Wire Transfer' },
  { value: 'cash',  label: 'Cash' },
  { value: 'other', label: 'Other' },
];

/* ── helpers ────────────────────────────────────────────────────────────── */
const fmt$ = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const grossOf = (s) => (s?.grossCents ?? s?.grossPayCents ?? 0);
const netOf = (s) => (s?.netCents ?? s?.netPayCents ?? 0);
const dedOf = (s) => (s?.deductionsCents ?? s?.totalDeductionsCents ?? 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const prettify = (v) => String(v || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

export default function CarrierSettlements() {
  /* roster + list */
  const [drivers, setDrivers]         = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [forbidden, setForbidden]     = useState(false);
  const [snack, setSnack]             = useState('');
  const [busyId, setBusyId]           = useState(null);

  /* generation form */
  const [driverId, setDriverId]       = useState('');
  const [periodStart, setPeriodStart] = useState(isoDay(-6));
  const [periodEnd, setPeriodEnd]     = useState(isoDay(0));

  /* preview */
  const [preview, setPreview]         = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]     = useState('');
  const [generating, setGenerating]         = useState(false);

  /* mark-paid dialog */
  const [payForm, setPayForm] = useState({
    open: false, settlement: null, payMethod: 'ach', reference: '', saving: false, error: '',
  });

  /* ── data loaders ─────────────────────────────────────────────────────── */
  const fetchDrivers = useCallback(async () => {
    try {
      const { data } = await api.get('/drivers');
      const list = Array.isArray(data) ? data : (data.drivers || data.data || []);
      setDrivers(list);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      // non-critical otherwise — driver picker just stays empty
    }
  }, []);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settlements');
      const list = Array.isArray(data) ? data : (data.settlements || data.data || []);
      setSettlements(list);
      setError('');
    } catch (err) {
      if (err.response?.status === 403) {
        setForbidden(true);
      } else {
        setError(err.response?.data?.error || 'Failed to load settlements.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrivers();
    fetchSettlements();
  }, [fetchDrivers, fetchSettlements]);

  /* ── form handlers ────────────────────────────────────────────────────── */
  // Any change to the inputs invalidates the current preview.
  const changeDriver = (v) => { setDriverId(v); setPreview(null); setPreviewError(''); };
  const changeStart = (v) => { setPeriodStart(v); setPreview(null); setPreviewError(''); };
  const changeEnd = (v) => { setPeriodEnd(v); setPreview(null); setPreviewError(''); };

  const formValid = driverId && periodStart && periodEnd && periodStart <= periodEnd;

  const handlePreview = async () => {
    if (!formValid) {
      setPreviewError('Select a driver and a valid period (start on or before end).');
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const { data } = await api.get('/settlements/preview', {
        params: { driverId, periodStart, periodEnd },
      });
      setPreview(data);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else setPreviewError(err.response?.data?.error || 'Failed to compute preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!formValid) return;
    setGenerating(true);
    setError('');
    try {
      const { data } = await api.post('/settlements/generate', { driverId, periodStart, periodEnd });
      setSnack(`Draft settlement ${data?.settlementNumber || ''} created.`.trim());
      setPreview(null);
      fetchSettlements();
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else setError(err.response?.data?.error || 'Failed to generate settlement.');
    } finally {
      setGenerating(false);
    }
  };

  /* ── row actions ──────────────────────────────────────────────────────── */
  const handleFinalize = async (s) => {
    setBusyId(s._id);
    setError('');
    try {
      await api.patch(`/settlements/${s._id}/finalize`);
      setSnack(`Settlement ${s.settlementNumber || ''} finalized.`.trim());
      fetchSettlements();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to finalize settlement.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePdf = async (s) => {
    try {
      // The endpoint renders the statement and returns { url } — a path to the
      // statically-served PDF on the API origin (same as BOL/POD documents).
      const { data } = await api.get(`/settlements/${s._id}/pdf`);
      const rel = data?.url;
      if (!rel) throw new Error('No PDF url returned');
      const origin = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
      const href = /^https?:\/\//.test(rel) ? rel : origin + rel;
      window.open(href, '_blank', 'noopener');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download PDF.');
    }
  };

  const openPay = (s) =>
    setPayForm({ open: true, settlement: s, payMethod: 'ach', reference: '', saving: false, error: '' });
  const closePay = () => setPayForm((p) => ({ ...p, open: false }));
  const setPayField = (k, v) => setPayForm((p) => ({ ...p, [k]: v }));

  const submitPay = async () => {
    if (!payForm.payMethod) { setPayField('error', 'Payment method is required.'); return; }
    setPayForm((p) => ({ ...p, saving: true, error: '' }));
    try {
      await api.patch(`/settlements/${payForm.settlement._id}/pay`, {
        payMethod: payForm.payMethod,
        reference: payForm.reference.trim(),
      });
      setSnack(`Settlement ${payForm.settlement.settlementNumber || ''} marked paid.`.trim());
      setPayForm((p) => ({ ...p, open: false, saving: false }));
      fetchSettlements();
    } catch (err) {
      setPayForm((p) => ({ ...p, saving: false, error: err.response?.data?.error || 'Failed to mark as paid.' }));
    }
  };

  const driverName = (id) => {
    const d = drivers.find((x) => (x.driverId || x._id) === id);
    return d ? d.name : id;
  };

  const rowDriverLabel = (s) =>
    s.driverName || s.driver?.name || driverName(s.driverId) || '—';

  /* ── forbidden state ──────────────────────────────────────────────────── */
  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%', pt: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
          <PaymentsIcon sx={{ color: brand.indigoLight, fontSize: 30 }} />
          <Typography variant="h5" fontWeight={800} sx={{ color: T.primary }}>Driver Settlements</Typography>
        </Stack>
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          Settlements are available to company managers only. If you believe this is an error,
          contact your company owner.
        </Alert>
      </Box>
    );
  }

  const lineItems = Array.isArray(preview?.lineItems)
    ? preview.lineItems
    : (Array.isArray(preview?.items) ? preview.items : []);

  /* ── render ───────────────────────────────────────────────────────────── */
  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%', pt: 2, pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <PaymentsIcon sx={{ color: brand.indigoLight, fontSize: 30 }} />
        <Typography variant="h5" fontWeight={800} sx={{ color: T.primary }}>Driver Settlements</Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {snack && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSnack('')}>{snack}</Alert>}

      {/* ── Build / Preview card ───────────────────────────────────────────── */}
      <Paper sx={{ ...glassCard.standard, p: 2.5, mb: 3 }}>
        <Typography fontWeight={700} sx={{ color: T.primary, mb: 2 }}>Build a Settlement</Typography>
        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth size="small" sx={darkFieldSx}>
              <InputLabel>Driver</InputLabel>
              <Select value={driverId} label="Driver" onChange={(e) => changeDriver(e.target.value)}>
                <MenuItem value=""><em>Select a driver…</em></MenuItem>
                {drivers.map((d) => {
                  const id = d.driverId || d._id;
                  return <MenuItem key={id} value={id}>{d.name || id}</MenuItem>;
                })}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6} sm={3} md={3}>
            <TextField
              label="Period Start" type="date" fullWidth size="small"
              value={periodStart} onChange={(e) => changeStart(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={darkFieldSx}
            />
          </Grid>
          <Grid item xs={6} sm={3} md={3}>
            <TextField
              label="Period End" type="date" fullWidth size="small"
              value={periodEnd} onChange={(e) => changeEnd(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={darkFieldSx}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              variant="outlined" fullWidth startIcon={<CalculateIcon />}
              onClick={handlePreview} disabled={!formValid || previewLoading}
              sx={{ borderRadius: radius.pill, borderColor: surface.glassBorder, color: T.primary, fontWeight: 700, '&:hover': { borderColor: T.muted, bgcolor: surface.glassSubtle } }}
            >
              {previewLoading ? <CircularProgress size={18} /> : 'Preview'}
            </Button>
          </Grid>
        </Grid>

        {previewError && <Alert severity="error" sx={{ mt: 2 }}>{previewError}</Alert>}

        {/* Preview result */}
        {preview && (
          <>
            <Divider sx={{ my: 2.5, borderColor: surface.glassBorder }} />
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={4}>
                <StatBox label="Gross" value={fmt$(grossOf(preview))} color={semantic.success} />
              </Grid>
              <Grid item xs={4}>
                <StatBox label="Deductions" value={fmt$(dedOf(preview))} color={semantic.error} />
              </Grid>
              <Grid item xs={4}>
                <StatBox label="Net Pay" value={fmt$(netOf(preview))} color={brand.indigoLight} />
              </Grid>
            </Grid>

            {lineItems.length > 0 ? (
              <TableContainer component={Paper} sx={{ ...glassCard.subtle, mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: T.secondary, fontWeight: 700 }}>Type</TableCell>
                      <TableCell sx={{ color: T.secondary, fontWeight: 700 }}>Description</TableCell>
                      <TableCell sx={{ color: T.secondary, fontWeight: 700 }} align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.map((li, i) => {
                      const amt = li.amountCents ?? li.amount ?? 0;
                      const deduction = li.kind === 'deduction' || li.type === 'deduction' || amt < 0;
                      const amtColor = deduction ? semantic.error : semantic.success;
                      return (
                        <TableRow key={li._id || i}>
                          <TableCell>
                            <Chip
                              size="small"
                              label={prettify(li.type || li.kind || 'line')}
                              sx={{ bgcolor: tint(brand.indigo, 0.18), color: brand.indigoLight, fontWeight: 600, fontSize: '0.7rem' }}
                            />
                          </TableCell>
                          <TableCell sx={{ color: T.strong }}>
                            {li.label || li.description || li.loadNumber || li.reference || '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ color: amtColor, fontWeight: 700 }}>
                            {deduction ? '-' : ''}{fmt$(Math.abs(amt))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" sx={{ color: T.secondary, mb: 2 }}>
                No line items for this period.
              </Typography>
            )}

            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="contained" startIcon={<PostAddIcon />}
                onClick={handleGenerate} disabled={generating}
                sx={{ bgcolor: brand.indigo, borderRadius: radius.pill, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}
              >
                {generating ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Generate Draft'}
              </Button>
            </Stack>
          </>
        )}
      </Paper>

      {/* ── Existing settlements ──────────────────────────────────────────── */}
      <Typography fontWeight={700} sx={{ color: T.primary, mb: 1.5 }}>Settlements</Typography>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress sx={{ color: '#fff' }} />
        </Box>
      ) : settlements.length === 0 ? (
        <Paper sx={{ ...glassCard.subtle, p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: T.secondary }}>
            No settlements yet. Build one above to get started.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ ...glassCard.standard }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }}>Settlement #</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }}>Driver</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }}>Period</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }} align="right">Gross</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }} align="right">Net</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }} align="center">Status</TableCell>
                <TableCell sx={{ color: T.secondary, fontWeight: 700 }} align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {settlements.map((s) => {
                const sColor = STATUS_COLOR[s.status] || semantic.muted;
                return (
                  <TableRow key={s._id} hover>
                    <TableCell sx={{ color: T.primary, fontWeight: 600 }}>{s.settlementNumber || '—'}</TableCell>
                    <TableCell sx={{ color: T.strong }}>{rowDriverLabel(s)}</TableCell>
                    <TableCell sx={{ color: T.secondary, whiteSpace: 'nowrap' }}>
                      {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: T.primary }}>{fmt$(grossOf(s))}</TableCell>
                    <TableCell align="right" sx={{ color: semantic.success, fontWeight: 700 }}>{fmt$(netOf(s))}</TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small" label={prettify(s.status || 'draft')}
                        sx={{ bgcolor: tint(sColor, 0.2), color: sColor, fontWeight: 700, textTransform: 'capitalize' }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        {s.status === 'draft' && (
                          <Tooltip title="Finalize">
                            <span>
                              <IconButton size="small" onClick={() => handleFinalize(s)} disabled={busyId === s._id} sx={{ color: brand.indigo }}>
                                {busyId === s._id ? <CircularProgress size={16} /> : <TaskAltIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        {s.status === 'finalized' && (
                          <Tooltip title="Mark Paid">
                            <IconButton size="small" onClick={() => openPay(s)} sx={{ color: semantic.success }}>
                              <PaidIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Download PDF">
                          <IconButton size="small" onClick={() => handlePdf(s)} sx={{ color: T.secondary }}>
                            <PictureAsPdfIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Mark-paid dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={payForm.open} onClose={closePay} maxWidth="xs" fullWidth
        PaperProps={{ sx: { bgcolor: surface.modal, color: T.primary, borderRadius: 3, border: `1px solid ${surface.indigoGlow}` } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          Mark {payForm.settlement?.settlementNumber || 'Settlement'} Paid
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth sx={darkFieldSx}>
              <InputLabel>Payment Method</InputLabel>
              <Select value={payForm.payMethod} label="Payment Method" onChange={(e) => setPayField('payMethod', e.target.value)}>
                {PAY_METHODS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Reference / Check #" fullWidth value={payForm.reference}
              onChange={(e) => setPayField('reference', e.target.value)} sx={darkFieldSx}
              placeholder="Optional"
            />
            {payForm.error && <Alert severity="error">{payForm.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closePay} sx={{ color: T.secondary }}>Cancel</Button>
          <Button
            variant="contained" onClick={submitPay} disabled={payForm.saving}
            sx={{ bgcolor: semantic.success, color: '#04371f', borderRadius: radius.pill, fontWeight: 700, '&:hover': { bgcolor: '#2bbe86' } }}
          >
            {payForm.saving ? <CircularProgress size={18} sx={{ color: '#04371f' }} /> : 'Confirm Paid'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ── small stat box for the preview summary ───────────────────────────────── */
function StatBox({ label, value, color }) {
  return (
    <Paper sx={{ ...glassCard.subtle, p: 1.5, textAlign: 'center' }}>
      <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.62rem' }}>
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={800} sx={{ color }}>{value}</Typography>
    </Paper>
  );
}
