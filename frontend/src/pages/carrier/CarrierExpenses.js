import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Paper, Button, Chip, Stack, Divider,
  CircularProgress, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Tooltip, Pagination, Drawer, InputAdornment,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ReceiptIcon from '@mui/icons-material/Receipt';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import BuildIcon from '@mui/icons-material/Build';
import TollIcon from '@mui/icons-material/Toll';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../services/api';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i);

const CATEGORY_LABELS = {
  fuel: 'Fuel', tolls: 'Tolls', maintenance: 'Maintenance & Repairs',
  insurance: 'Insurance', truck_payment: 'Truck Payment / Lease',
  permits: 'Permits & Licenses', parking: 'Parking', meals: 'Meals (per diem)',
  equipment: 'Equipment & Supplies', tires: 'Tires', washing: 'Truck Wash',
  scales: 'Scale / Weigh Station', lumper: 'Lumper Fees', detention: 'Detention Fees',
  office: 'Office Expenses', phone: 'Phone / Internet',
  subscriptions: 'Subscriptions / Software', other: 'Other',
};

const CATEGORY_ICONS = {
  fuel: <LocalGasStationIcon fontSize="small" />,
  maintenance: <BuildIcon fontSize="small" />,
  tolls: <TollIcon fontSize="small" />,
};

const CATEGORY_COLORS = {
  fuel: '#f97316', tolls: '#a855f7', maintenance: '#ef4444',
  insurance: '#3b82f6', truck_payment: '#6366f1', permits: '#14b8a6',
  parking: '#64748b', meals: '#fbbf24', equipment: '#8b5cf6',
  tires: '#ec4899', washing: '#06b6d4', scales: '#84cc16',
  lumper: '#f43f5e', detention: '#d946ef', office: '#0ea5e9',
  phone: '#22c55e', subscriptions: '#eab308', other: '#94a3b8',
};

function KPICard({ label, value, sub, color = '#6366f1' }) {
  return (
    <Paper sx={{
      p: 3, borderRadius: 3,
      bgcolor: 'rgba(124,140,248,0.08)',
      border: '1.5px solid rgba(255,255,255,0.10)',
    }}>
      <Typography variant="body2" color="text.secondary" mb={0.5}>{label}</Typography>
      <Typography variant="h5" fontWeight={800} sx={{ color }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

const fmt$ = (cents) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const emptyForm = {
  category: 'fuel', amount: '', vendor: '', description: '',
  date: new Date().toISOString().slice(0, 10), location: '',
  mileageStart: '', mileageEnd: '', mileageMiles: '', mileagePurpose: '',
  isDeductible: true,
};

export default function CarrierExpenses() {
  const [expenses, setExpenses]         = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [pages, setPages]               = useState(1);
  const [loading, setLoading]           = useState(false);
  const [yearSummary, setYearSummary]   = useState(null);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [filterCat, setFilterCat]       = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [editingId, setEditingId]       = useState(null);
  const [form, setForm]                 = useState({ ...emptyForm });
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  // Detail drawer
  const [detailOpen, setDetailOpen]     = useState(false);
  const [detailExpense, setDetailExpense] = useState(null);

  // Receipt upload
  const [uploading, setUploading]       = useState(false);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 15, sort: '-date' };
      if (filterCat) params.category = filterCat;
      // Filter by selected year
      params.startDate = `${selectedYear}-01-01`;
      params.endDate = `${selectedYear}-12-31`;

      const { data } = await api.get('/expenses', { params });
      setExpenses(data.expenses);
      setTotal(data.total);
      setPages(data.pages);
    } catch { /* non-critical */ }
    setLoading(false);
  }, [page, filterCat, selectedYear]);

  const fetchYearlySummary = useCallback(async (year) => {
    try {
      const { data } = await api.get('/expenses/summary/yearly', { params: { year } });
      setYearSummary(data);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchExpenses();
    fetchYearlySummary(selectedYear);
  }, [fetchExpenses, fetchYearlySummary, selectedYear]);

  const handleYearChange = (year) => {
    setSelectedYear(year);
    setPage(1);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (exp) => {
    setEditingId(exp._id);
    setForm({
      category: exp.category,
      amount: (exp.amountCents / 100).toFixed(2),
      vendor: exp.vendor || '',
      description: exp.description || '',
      date: new Date(exp.date).toISOString().slice(0, 10),
      location: exp.location || '',
      mileageStart: exp.mileage?.odometerStart || '',
      mileageEnd: exp.mileage?.odometerEnd || '',
      mileageMiles: exp.mileage?.miles || '',
      mileagePurpose: exp.mileage?.purpose || '',
      isDeductible: exp.isDeductible !== false,
    });
    setError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const amountCents = Math.round(parseFloat(form.amount) * 100);
    if (!form.category || isNaN(amountCents) || amountCents < 1 || !form.date) {
      setError('Category, amount (> $0), and date are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        category: form.category,
        amountCents,
        vendor: form.vendor,
        description: form.description,
        date: form.date,
        location: form.location,
        isDeductible: form.isDeductible,
        mileage: {
          odometerStart: form.mileageStart ? Number(form.mileageStart) : null,
          odometerEnd: form.mileageEnd ? Number(form.mileageEnd) : null,
          miles: form.mileageMiles ? Number(form.mileageMiles) : null,
          purpose: form.mileagePurpose || '',
        },
      };

      if (editingId) {
        await api.put(`/expenses/${editingId}`, payload);
      } else {
        await api.post('/expenses', payload);
      }
      setDialogOpen(false);
      fetchExpenses();
      fetchYearlySummary(selectedYear);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save expense');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await api.delete(`/expenses/${id}`);
      fetchExpenses();
      fetchYearlySummary(selectedYear);
    } catch { /* non-critical */ }
  };

  const handleReceiptUpload = async (expenseId, file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const { data } = await api.post(`/expenses/${expenseId}/receipt`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Update in list
      setExpenses(prev => prev.map(e => e._id === expenseId ? { ...e, receiptUrl: data.receiptUrl, receiptName: data.receiptName } : e));
      if (detailExpense?._id === expenseId) {
        setDetailExpense(prev => ({ ...prev, receiptUrl: data.receiptUrl, receiptName: data.receiptName }));
      }
    } catch { /* non-critical */ }
    setUploading(false);
  };

  const openDetail = (exp) => {
    setDetailExpense(exp);
    setDetailOpen(true);
  };

  // Top categories from summary
  const topCats = yearSummary?.categories
    ? Object.entries(yearSummary.categories).sort((a, b) => b[1].total - a[1].total).slice(0, 5)
    : [];

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3} flexWrap="wrap" gap={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <ReceiptIcon sx={{ color: '#f97316', fontSize: 32 }} />
          <Typography variant="h4" fontWeight={800} color="#fff">Expenses</Typography>
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreate}
          sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}
        >
          Log Expense
        </Button>
      </Stack>

      {/* Year Selector */}
      <Stack direction="row" alignItems="center" spacing={2} mb={3} flexWrap="wrap">
        <Typography color="rgba(255,255,255,0.8)" fontWeight={600}>Year:</Typography>
        {YEARS.map(y => (
          <Chip
            key={y} label={y} onClick={() => handleYearChange(y)}
            sx={{
              fontWeight: 700,
              bgcolor: selectedYear === y ? '#6366f1' : 'rgba(255,255,255,0.08)',
              color: '#fff',
              '&:hover': { bgcolor: selectedYear === y ? '#4f46e5' : 'rgba(255,255,255,0.14)' },
            }}
          />
        ))}
      </Stack>

      {/* KPI Row */}
      <Grid container spacing={2} mb={3}>
        <Grid item xs={6} sm={3}>
          <KPICard label="Total Expenses" value={fmt$(yearSummary?.grandTotalCents)} color="#ef4444" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPICard label="Expense Count" value={yearSummary?.totalExpenses || 0} color="#6366f1" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPICard
            label="Avg / Expense"
            value={yearSummary?.totalExpenses ? fmt$(Math.round(yearSummary.grandTotalCents / yearSummary.totalExpenses)) : '$0.00'}
            color="#fbbf24"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPICard
            label="Logged Mileage"
            value={`${(yearSummary?.mileage?.totalMiles || 0).toLocaleString()} mi`}
            sub={yearSummary?.mileage?.entries ? `${yearSummary.mileage.entries} entries` : ''}
            color="#34d399"
          />
        </Grid>
      </Grid>

      {/* Top Categories Breakdown */}
      {topCats.length > 0 && (
        <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
          <Typography fontWeight={700} color="#fff" mb={2}>Top Categories — {selectedYear}</Typography>
          <Stack spacing={1}>
            {topCats.map(([cat, info]) => {
              const pct = yearSummary.grandTotalCents > 0 ? Math.round((info.total / yearSummary.grandTotalCents) * 100) : 0;
              return (
                <Stack key={cat} direction="row" alignItems="center" spacing={2}>
                  <Chip
                    size="small"
                    label={CATEGORY_LABELS[cat] || cat}
                    sx={{ bgcolor: CATEGORY_COLORS[cat] + '22', color: CATEGORY_COLORS[cat], fontWeight: 700, minWidth: 150 }}
                  />
                  <Box flex={1} sx={{ height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: CATEGORY_COLORS[cat], borderRadius: 4, transition: 'width 0.5s' }} />
                  </Box>
                  <Typography variant="body2" color="rgba(255,255,255,0.7)" fontWeight={600} sx={{ minWidth: 80, textAlign: 'right' }}>
                    {fmt$(info.total)}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.4)" sx={{ minWidth: 40, textAlign: 'right' }}>
                    {pct}%
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}

      {/* Filter + Export Row */}
      <Stack direction="row" alignItems="center" spacing={2} mb={2} flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Category</InputLabel>
          <Select value={filterCat} label="Category" onChange={e => { setFilterCat(e.target.value); setPage(1); }}>
            <MenuItem value="">All Categories</MenuItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </Select>
        </FormControl>
        <Typography variant="body2" color="rgba(255,255,255,0.5)" flex={1}>
          {total} expense{total !== 1 ? 's' : ''} found
        </Typography>
      </Stack>

      {/* Expenses Table */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : expenses.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }}>
          <ReceiptIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.2)', mb: 1 }} />
          <Typography color="rgba(255,255,255,0.5)">No expenses logged yet. Click "Log Expense" to start tracking.</Typography>
        </Paper>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Category</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Vendor</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>Description</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }} align="right">Amount</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }} align="center">Receipt</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {expenses.map(exp => (
                  <TableRow key={exp._id} hover sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' } }}>
                    <TableCell sx={{ color: '#fff' }} onClick={() => openDetail(exp)}>
                      {new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </TableCell>
                    <TableCell onClick={() => openDetail(exp)}>
                      <Chip
                        size="small"
                        icon={CATEGORY_ICONS[exp.category]}
                        label={CATEGORY_LABELS[exp.category] || exp.category}
                        sx={{ bgcolor: (CATEGORY_COLORS[exp.category] || '#94a3b8') + '22', color: CATEGORY_COLORS[exp.category] || '#94a3b8', fontWeight: 600, fontSize: '0.75rem' }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.8)' }} onClick={() => openDetail(exp)}>{exp.vendor || '—'}</TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.6)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => openDetail(exp)}>
                      {exp.description || '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#ef4444', fontWeight: 700 }} onClick={() => openDetail(exp)}>
                      {fmt$(exp.amountCents)}
                    </TableCell>
                    <TableCell align="center">
                      {exp.receiptUrl ? (
                        <Tooltip title="View Receipt">
                          <IconButton size="small" onClick={() => window.open(exp.receiptUrl, '_blank')} sx={{ color: '#34d399' }}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title="Upload Receipt">
                          <IconButton size="small" component="label" disabled={uploading} sx={{ color: 'rgba(255,255,255,0.3)' }}>
                            <UploadFileIcon fontSize="small" />
                            <input type="file" hidden accept="image/*,.pdf" onChange={e => { if (e.target.files[0]) handleReceiptUpload(exp._id, e.target.files[0]); }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(exp)} sx={{ color: '#6366f1' }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => handleDelete(exp._id)} sx={{ color: '#ef4444' }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {pages > 1 && (
            <Stack direction="row" justifyContent="center" mt={2}>
              <Pagination count={pages} page={page} onChange={(_, v) => setPage(v)} color="primary" />
            </Stack>
          )}
        </>
      )}

      {/* ── Create / Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: '#1e1e2f', borderRadius: 3 } }}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>
          {editingId ? 'Edit Expense' : 'Log New Expense'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} mt={0.5}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Category *</InputLabel>
                <Select value={form.category} label="Category *"
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Amount *" fullWidth size="small" type="number"
                value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                inputProps={{ min: 0.01, step: 0.01 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Date *" fullWidth size="small" type="date"
                value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Vendor" fullWidth size="small" placeholder="Shell, Pilot, etc."
                value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Description" fullWidth size="small" multiline rows={2}
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Location" fullWidth size="small" placeholder="City, State"
                value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} />
            </Grid>

            {/* Mileage section */}
            <Grid item xs={12}>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 1 }} />
              <Typography variant="caption" color="rgba(255,255,255,0.5)" fontWeight={600}>
                MILEAGE LOG (optional — for IRS deduction tracking)
              </Typography>
            </Grid>
            <Grid item xs={4}>
              <TextField label="Odometer Start" fullWidth size="small" type="number"
                value={form.mileageStart} onChange={e => setForm(p => ({ ...p, mileageStart: e.target.value }))} />
            </Grid>
            <Grid item xs={4}>
              <TextField label="Odometer End" fullWidth size="small" type="number"
                value={form.mileageEnd} onChange={e => setForm(p => ({ ...p, mileageEnd: e.target.value }))} />
            </Grid>
            <Grid item xs={4}>
              <TextField label="Miles" fullWidth size="small" type="number"
                value={form.mileageMiles} onChange={e => setForm(p => ({ ...p, mileageMiles: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Trip Purpose" fullWidth size="small" placeholder="Load #123 pickup to delivery"
                value={form.mileagePurpose} onChange={e => setForm(p => ({ ...p, mileagePurpose: e.target.value }))} />
            </Grid>
          </Grid>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}
            sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
            {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : editingId ? 'Update' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Detail Drawer ────────────────────────────────────────────────────── */}
      <Drawer anchor="right" open={detailOpen} onClose={() => setDetailOpen(false)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 400 }, bgcolor: '#1e1e2f', p: 3 } }}>
        {detailExpense && (
          <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
              <Typography variant="h6" fontWeight={700} color="#fff">Expense Detail</Typography>
              <IconButton onClick={() => setDetailOpen(false)} sx={{ color: 'rgba(255,255,255,0.5)' }}><CloseIcon /></IconButton>
            </Stack>

            <Stack spacing={2.5}>
              <Box>
                <Typography variant="caption" color="rgba(255,255,255,0.5)">CATEGORY</Typography>
                <Chip
                  label={CATEGORY_LABELS[detailExpense.category] || detailExpense.category}
                  sx={{ mt: 0.5, bgcolor: (CATEGORY_COLORS[detailExpense.category] || '#94a3b8') + '22', color: CATEGORY_COLORS[detailExpense.category], fontWeight: 700 }}
                />
              </Box>

              <Box>
                <Typography variant="caption" color="rgba(255,255,255,0.5)">AMOUNT</Typography>
                <Typography variant="h4" fontWeight={800} color="#ef4444">{fmt$(detailExpense.amountCents)}</Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="rgba(255,255,255,0.5)">DATE</Typography>
                  <Typography color="#fff">{new Date(detailExpense.date).toLocaleDateString('en-US')}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="rgba(255,255,255,0.5)">VENDOR</Typography>
                  <Typography color="#fff">{detailExpense.vendor || '—'}</Typography>
                </Grid>
              </Grid>

              {detailExpense.description && (
                <Box>
                  <Typography variant="caption" color="rgba(255,255,255,0.5)">DESCRIPTION</Typography>
                  <Typography color="rgba(255,255,255,0.8)">{detailExpense.description}</Typography>
                </Box>
              )}

              {detailExpense.location && (
                <Box>
                  <Typography variant="caption" color="rgba(255,255,255,0.5)">LOCATION</Typography>
                  <Typography color="rgba(255,255,255,0.8)">{detailExpense.location}</Typography>
                </Box>
              )}

              {detailExpense.mileage?.miles > 0 && (
                <Paper sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
                  <Typography variant="caption" color="#34d399" fontWeight={700}>MILEAGE LOG</Typography>
                  <Typography color="#fff">{detailExpense.mileage.miles} miles</Typography>
                  {detailExpense.mileage.odometerStart && (
                    <Typography variant="caption" color="rgba(255,255,255,0.5)">
                      Odometer: {detailExpense.mileage.odometerStart} → {detailExpense.mileage.odometerEnd}
                    </Typography>
                  )}
                  {detailExpense.mileage.purpose && (
                    <Typography variant="caption" color="rgba(255,255,255,0.5)" display="block">{detailExpense.mileage.purpose}</Typography>
                  )}
                </Paper>
              )}

              <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

              {/* Receipt */}
              <Box>
                <Typography variant="caption" color="rgba(255,255,255,0.5)" mb={1} display="block">RECEIPT</Typography>
                {detailExpense.receiptUrl ? (
                  <Button
                    variant="outlined" size="small"
                    startIcon={<VisibilityIcon />}
                    onClick={() => window.open(detailExpense.receiptUrl, '_blank')}
                    sx={{ borderColor: '#34d399', color: '#34d399', borderRadius: 9999 }}
                  >
                    View Receipt ({detailExpense.receiptName || 'file'})
                  </Button>
                ) : (
                  <Button
                    variant="outlined" size="small" component="label"
                    startIcon={<UploadFileIcon />} disabled={uploading}
                    sx={{ borderColor: '#6366f1', color: '#6366f1', borderRadius: 9999 }}
                  >
                    Upload Receipt
                    <input type="file" hidden accept="image/*,.pdf"
                      onChange={e => { if (e.target.files[0]) handleReceiptUpload(detailExpense._id, e.target.files[0]); }} />
                  </Button>
                )}
              </Box>

              <Chip
                label={detailExpense.isDeductible ? 'Tax Deductible' : 'Not Deductible'}
                size="small"
                sx={{
                  alignSelf: 'flex-start',
                  bgcolor: detailExpense.isDeductible ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)',
                  color: detailExpense.isDeductible ? '#34d399' : 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                }}
              />

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<EditIcon />} onClick={() => { setDetailOpen(false); openEdit(detailExpense); }}
                  sx={{ borderColor: '#6366f1', color: '#6366f1', borderRadius: 9999, fontWeight: 700, flex: 1 }}>
                  Edit
                </Button>
                <Button variant="outlined" startIcon={<DeleteIcon />} onClick={() => { handleDelete(detailExpense._id); setDetailOpen(false); }}
                  sx={{ borderColor: '#ef4444', color: '#ef4444', borderRadius: 9999, fontWeight: 700, flex: 1 }}>
                  Delete
                </Button>
              </Stack>
            </Stack>
          </>
        )}
      </Drawer>
    </Box>
  );
}
