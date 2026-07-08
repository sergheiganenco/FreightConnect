import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Paper, Button, Chip, Stack, Divider,
  CircularProgress, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableFooter, IconButton, Tooltip, InputAdornment,
} from '@mui/material';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import LockIcon from '@mui/icons-material/Lock';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api from '../../services/api';

// NOTE: no Date.now() at module scope — selectors default to a fixed sensible
// value below and are user-changeable via state.
const YEARS = [2027, 2026, 2025, 2024, 2023];
const QUARTERS = [1, 2, 3, 4];
const DEFAULT_YEAR = 2026;
const DEFAULT_QUARTER = 3;
const DEFAULT_MPG = '6.0';

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];
const STATE_NAME = US_STATES.reduce((acc, s) => { acc[s.code] = s.name; return acc; }, {});

const FUEL_TYPES = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'gasoline', label: 'Gasoline' },
  { value: 'biodiesel', label: 'Biodiesel' },
  { value: 'propane', label: 'Propane (LPG)' },
  { value: 'cng', label: 'CNG' },
  { value: 'lng', label: 'LNG' },
  { value: 'other', label: 'Other' },
];

const DEFAULT_DISCLAIMER =
  'IFTA figures are self-reported. Distance and fuel entries are your responsibility, ' +
  'and every jurisdiction tax rate must be verified against the official IFTA, Inc. ' +
  'rate tables before filing. This worksheet is a record-keeping aid, not tax advice.';

const fmt$ = (cents) =>
  `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMiles = (n) => Math.round(Number(n) || 0).toLocaleString();
const fmtGal = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

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

const emptyFuelForm = {
  date: '', jurisdiction: '', gallons: '', cost: '', fuelType: 'diesel', vendor: '',
};

export default function CarrierIFTA() {
  const [selectedYear, setSelectedYear]       = useState(DEFAULT_YEAR);
  const [selectedQuarter, setSelectedQuarter] = useState(DEFAULT_QUARTER);

  const [report, setReport]                   = useState(null);
  const [milesHint, setMilesHint]             = useState(0);
  const [disclaimer, setDisclaimer]           = useState('');
  const [fuel, setFuel]                        = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState('');

  // Editable worksheet state
  const [fleetMpg, setFleetMpg]               = useState(DEFAULT_MPG);
  const [rows, setRows]                       = useState([]); // {jurisdiction, totalMiles, taxableMiles, taxRate}
  const [addState, setAddState]               = useState('');
  const [saving, setSaving]                   = useState(false);
  const [saveError, setSaveError]             = useState('');
  const [saveSuccess, setSaveSuccess]         = useState(false);
  const [finalizing, setFinalizing]           = useState(false);

  // Fuel dialog state
  const [fuelDialogOpen, setFuelDialogOpen]   = useState(false);
  const [editingFuelId, setEditingFuelId]     = useState(null);
  const [fuelForm, setFuelForm]               = useState({ ...emptyFuelForm });
  const [fuelSaving, setFuelSaving]           = useState(false);
  const [fuelError, setFuelError]             = useState('');

  const isFinalized = !!(report && report.status && report.status !== 'draft');
  const canEdit = !isFinalized;

  const buildRows = useCallback((rep, fuelList) => {
    const map = {};
    (rep?.jurisdictions || []).forEach((j) => {
      map[j.jurisdiction] = {
        jurisdiction: j.jurisdiction,
        totalMiles: j.totalMiles != null ? String(j.totalMiles) : '',
        taxableMiles: j.taxableMiles != null ? String(j.taxableMiles) : '',
        taxRate: j.taxRateCents ? String(j.taxRateCents / 100) : '',
      };
    });
    (fuelList || []).forEach((f) => {
      if (f.jurisdiction && !map[f.jurisdiction]) {
        map[f.jurisdiction] = { jurisdiction: f.jurisdiction, totalMiles: '', taxableMiles: '', taxRate: '' };
      }
    });
    return Object.values(map).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  }, []);

  const loadData = useCallback(async (year, quarter) => {
    setLoading(true);
    setError('');
    setSaveSuccess(false);
    try {
      const [rRes, fRes] = await Promise.all([
        api.get(`/ifta/${year}/${quarter}`),
        api.get('/ifta/fuel', { params: { year, quarter } }),
      ]);
      const rep = rRes.data?.report || null;
      const fuelList = Array.isArray(fRes.data)
        ? fRes.data
        : (fRes.data?.fuel || fRes.data?.purchases || []);

      setReport(rep);
      setMilesHint(rRes.data?.quarterTotalMilesHint || 0);
      setDisclaimer(rRes.data?.disclaimer || '');
      setFuel(fuelList);
      setFleetMpg(rep?.fleetMpg != null ? String(rep.fleetMpg) : DEFAULT_MPG);
      setRows(buildRows(rep, fuelList));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load IFTA data.');
      setReport(null);
      setFuel([]);
      setRows([]);
    }
    setLoading(false);
  }, [buildRows]);

  useEffect(() => {
    loadData(selectedYear, selectedQuarter);
  }, [loadData, selectedYear, selectedQuarter]);

  // ── Derived / computed ────────────────────────────────────────────────────
  const mpgNum = Number(fleetMpg) || 0;

  const paidGallonsByState = fuel.reduce((acc, f) => {
    if (!f.jurisdiction) return acc;
    acc[f.jurisdiction] = (acc[f.jurisdiction] || 0) + (Number(f.gallons) || 0);
    return acc;
  }, {});

  const computeRow = (r) => {
    const taxableMiles = Number(r.taxableMiles) || 0;
    const taxableGallons = mpgNum > 0 ? taxableMiles / mpgNum : 0;
    const taxPaidGallons = paidGallonsByState[r.jurisdiction] || 0;
    const netTaxableGallons = taxableGallons - taxPaidGallons;
    const taxRateCents = Math.round((Number(r.taxRate) || 0) * 100);
    const netTaxCents = Math.round(netTaxableGallons * taxRateCents);
    return { taxableGallons, taxPaidGallons, netTaxableGallons, taxRateCents, netTaxCents };
  };

  const totals = rows.reduce((acc, r) => {
    const c = computeRow(r);
    acc.totalMiles += Number(r.totalMiles) || 0;
    acc.taxableGallons += c.taxableGallons;
    acc.taxPaidGallons += c.taxPaidGallons;
    acc.netTaxableGallons += c.netTaxableGallons;
    acc.netTaxCents += c.netTaxCents;
    return acc;
  }, { totalMiles: 0, taxableGallons: 0, taxPaidGallons: 0, netTaxableGallons: 0, netTaxCents: 0 });

  const gallonsPurchased = fuel.reduce((sum, f) => sum + (Number(f.gallons) || 0), 0);

  // ── Worksheet editing ─────────────────────────────────────────────────────
  const handleRowChange = (jurisdiction, field, value) => {
    setSaveSuccess(false);
    setRows((prev) => prev.map((r) => (r.jurisdiction === jurisdiction ? { ...r, [field]: value } : r)));
  };

  const handleAddStateRow = (code) => {
    if (!code) return;
    setRows((prev) => {
      if (prev.some((r) => r.jurisdiction === code)) return prev;
      const next = [...prev, { jurisdiction: code, totalMiles: '', taxableMiles: '', taxRate: '' }];
      return next.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
    });
    setAddState('');
  };

  const handleRemoveRow = (jurisdiction) => {
    setRows((prev) => prev.filter((r) => r.jurisdiction !== jurisdiction));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const payload = {
        fleetMpg: Number(fleetMpg) || 0,
        jurisdictions: rows.map((r) => ({
          jurisdiction: r.jurisdiction,
          totalMiles: Number(r.totalMiles) || 0,
          taxableMiles: Number(r.taxableMiles) || 0,
          taxRateCents: Math.round((Number(r.taxRate) || 0) * 100),
        })),
      };
      await api.put(`/ifta/${selectedYear}/${selectedQuarter}`, payload);
      setSaveSuccess(true);
      await loadData(selectedYear, selectedQuarter);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to save worksheet.');
    }
    setSaving(false);
  };

  const handleFinalize = async () => {
    if (!window.confirm(
      `Finalize Q${selectedQuarter} ${selectedYear}? Once finalized the worksheet is locked and can no longer be edited.`
    )) return;
    setFinalizing(true);
    setSaveError('');
    try {
      await api.post(`/ifta/${selectedYear}/${selectedQuarter}/finalize`);
      await loadData(selectedYear, selectedQuarter);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to finalize quarter.');
    }
    setFinalizing(false);
  };

  const handleExport = async () => {
    try {
      const { data } = await api.get(`/ifta/${selectedYear}/${selectedQuarter}/export`, { responseType: 'text' });
      const blob = new Blob([data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FreightConnect_IFTA_${selectedYear}_Q${selectedQuarter}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* non-critical */ }
  };

  // ── Fuel purchases ────────────────────────────────────────────────────────
  const openAddFuel = () => {
    setEditingFuelId(null);
    setFuelForm({ ...emptyFuelForm, date: todayISO() });
    setFuelError('');
    setFuelDialogOpen(true);
  };

  const openEditFuel = (f) => {
    setEditingFuelId(f._id);
    setFuelForm({
      date: f.date ? new Date(f.date).toISOString().slice(0, 10) : '',
      jurisdiction: f.jurisdiction || '',
      gallons: f.gallons != null ? String(f.gallons) : '',
      cost: f.totalCostCents != null ? (f.totalCostCents / 100).toFixed(2) : '',
      fuelType: f.fuelType || 'diesel',
      vendor: f.vendor || '',
    });
    setFuelError('');
    setFuelDialogOpen(true);
  };

  const handleSaveFuel = async () => {
    const gallons = Number(fuelForm.gallons);
    const costCents = Math.round((Number(fuelForm.cost) || 0) * 100);
    if (!fuelForm.date || !fuelForm.jurisdiction || !gallons || gallons <= 0) {
      setFuelError('Date, jurisdiction, and gallons (> 0) are required.');
      return;
    }
    setFuelSaving(true);
    setFuelError('');
    try {
      const payload = {
        date: fuelForm.date,
        jurisdiction: fuelForm.jurisdiction,
        gallons,
        totalCostCents: costCents,
        fuelType: fuelForm.fuelType,
        vendor: fuelForm.vendor,
      };
      if (editingFuelId) {
        await api.put(`/ifta/fuel/${editingFuelId}`, payload);
      } else {
        await api.post('/ifta/fuel', payload);
      }
      setFuelDialogOpen(false);
      await loadData(selectedYear, selectedQuarter);
    } catch (err) {
      setFuelError(err.response?.data?.error || 'Failed to save fuel purchase.');
    }
    setFuelSaving(false);
  };

  const handleDeleteFuel = async (id) => {
    if (!window.confirm('Delete this fuel purchase?')) return;
    try {
      await api.delete(`/ifta/fuel/${id}`);
      await loadData(selectedYear, selectedQuarter);
    } catch { /* non-critical */ }
  };

  const availableStates = US_STATES.filter((s) => !rows.some((r) => r.jurisdiction === s.code));
  const headCell = { color: 'rgba(255,255,255,0.6)', fontWeight: 700, whiteSpace: 'nowrap' };

  return (
    <Box sx={{ maxWidth: 1150, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3} flexWrap="wrap" gap={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <LocalGasStationIcon sx={{ color: '#22d3ee', fontSize: 32 }} />
          <Typography variant="h4" fontWeight={800} color="#fff">IFTA Fuel Tax</Typography>
          {isFinalized && (
            <Chip icon={<LockIcon sx={{ fontSize: 16 }} />} label="Finalized" size="small"
              sx={{ bgcolor: 'rgba(52,211,153,0.15)', color: '#34d399', fontWeight: 700 }} />
          )}
        </Stack>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={handleExport}
            sx={{ borderColor: '#6366f1', color: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
            Export CSV
          </Button>
          <Button variant="contained" startIcon={<LockIcon />} onClick={handleFinalize}
            disabled={!canEdit || finalizing || !report}
            sx={{ bgcolor: '#34d399', color: '#000', borderRadius: 9999, fontWeight: 700 }}>
            {finalizing ? <CircularProgress size={18} sx={{ color: '#000' }} /> : 'Finalize Quarter'}
          </Button>
        </Stack>
      </Stack>

      {/* Period Selectors */}
      <Stack direction="row" alignItems="center" spacing={2} mb={3} flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Year</InputLabel>
          <Select value={selectedYear} label="Year" onChange={(e) => setSelectedYear(e.target.value)}>
            {YEARS.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </Select>
        </FormControl>
        <Stack direction="row" spacing={1}>
          {QUARTERS.map((q) => (
            <Chip
              key={q}
              label={`Q${q}`}
              onClick={() => setSelectedQuarter(q)}
              sx={{
                fontWeight: 700,
                bgcolor: selectedQuarter === q ? '#6366f1' : 'rgba(255,255,255,0.08)',
                color: '#fff',
                '&:hover': { bgcolor: selectedQuarter === q ? '#4f46e5' : 'rgba(255,255,255,0.14)' },
              }}
            />
          ))}
        </Stack>
        {milesHint > 0 && (
          <Typography variant="body2" color="rgba(255,255,255,0.5)">
            Tracked distance this quarter: <strong style={{ color: '#22d3ee' }}>{fmtMiles(milesHint)} mi</strong>
          </Typography>
        )}
      </Stack>

      {/* Persistent disclaimer */}
      <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 3, borderRadius: 3 }}>
        {disclaimer || DEFAULT_DISCLAIMER}
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <>
          {/* KPI Row */}
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} sm={3}>
              <KPICard label="Total Miles" value={fmtMiles(totals.totalMiles)} sub={`Q${selectedQuarter} ${selectedYear}`} color="#22d3ee" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Gallons Purchased" value={fmtGal(gallonsPurchased)} sub={`${fuel.length} receipt${fuel.length !== 1 ? 's' : ''}`} color="#f97316" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Fleet MPG" value={mpgNum ? mpgNum.toFixed(1) : '—'} color="#a78bfa" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Net Taxable Gallons" value={fmtGal(totals.netTaxableGallons)} sub="taxable − tax-paid" color="#34d399" />
            </Grid>
          </Grid>

          {/* ── Fuel Purchases ─────────────────────────────────────────────── */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5} mt={1}>
            <Typography variant="h6" fontWeight={800} color="#fff">Fuel Purchases</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openAddFuel} disabled={!canEdit}
              sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
              Add Fuel Purchase
            </Button>
          </Stack>

          {fuel.length === 0 ? (
            <Paper sx={{ p: 4, mb: 4, textAlign: 'center', borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }}>
              <LocalGasStationIcon sx={{ fontSize: 44, color: 'rgba(255,255,255,0.2)', mb: 1 }} />
              <Typography color="rgba(255,255,255,0.5)">
                No fuel purchases logged for this quarter. Click "Add Fuel Purchase" to record tax-paid gallons.
              </Typography>
            </Paper>
          ) : (
            <>
            {/* Desktop / tablet: full table (md and up) */}
            <TableContainer component={Paper} sx={{ display: { xs: 'none', md: 'block' }, mb: 4, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={headCell}>Date</TableCell>
                    <TableCell sx={headCell}>Jurisdiction</TableCell>
                    <TableCell sx={headCell}>Fuel Type</TableCell>
                    <TableCell sx={headCell} align="right">Gallons</TableCell>
                    <TableCell sx={headCell} align="right">Total Cost</TableCell>
                    <TableCell sx={headCell}>Vendor</TableCell>
                    <TableCell sx={headCell} align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {fuel.map((f) => (
                    <TableRow key={f._id} hover>
                      <TableCell sx={{ color: '#fff' }}>
                        {f.date ? new Date(f.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </TableCell>
                      <TableCell sx={{ color: '#fff' }}>
                        {f.jurisdiction}{STATE_NAME[f.jurisdiction] ? ` — ${STATE_NAME[f.jurisdiction]}` : ''}
                      </TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.8)', textTransform: 'capitalize' }}>{f.fuelType || '—'}</TableCell>
                      <TableCell align="right" sx={{ color: '#fff', fontWeight: 600 }}>{fmtGal(f.gallons)}</TableCell>
                      <TableCell align="right" sx={{ color: '#f97316', fontWeight: 700 }}>{fmt$(f.totalCostCents)}</TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.7)' }}>{f.vendor || '—'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="Edit">
                          <span>
                            <IconButton size="small" onClick={() => openEditFuel(f)} disabled={!canEdit} sx={{ color: '#6366f1' }}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <span>
                            <IconButton size="small" onClick={() => handleDeleteFuel(f._id)} disabled={!canEdit} sx={{ color: '#ef4444' }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Phone: stacked cards (below md) so nothing overflows the screen */}
            <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 4 }}>
              {fuel.map((f) => (
                <Paper key={f._id} sx={{ p: 2, mb: 1.5, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ color: '#fff', fontWeight: 700, wordBreak: 'break-word' }}>
                        {f.jurisdiction}{STATE_NAME[f.jurisdiction] ? ` — ${STATE_NAME[f.jurisdiction]}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
                        {f.date ? new Date(f.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                      <Tooltip title="Edit">
                        <span>
                          <IconButton size="small" onClick={() => openEditFuel(f)} disabled={!canEdit} sx={{ color: '#6366f1' }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <span>
                          <IconButton size="small" onClick={() => handleDeleteFuel(f._id)} disabled={!canEdit} sx={{ color: '#ef4444' }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Stack>
                  <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.08)' }} />
                  <Stack direction="row" flexWrap="wrap" gap={1.5}>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Fuel Type</Typography>
                      <Typography sx={{ color: 'rgba(255,255,255,0.85)', textTransform: 'capitalize' }}>{f.fuelType || '—'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Gallons</Typography>
                      <Typography sx={{ color: '#fff', fontWeight: 600 }}>{fmtGal(f.gallons)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Total Cost</Typography>
                      <Typography sx={{ color: '#f97316', fontWeight: 700 }}>{fmt$(f.totalCostCents)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Vendor</Typography>
                      <Typography sx={{ color: 'rgba(255,255,255,0.7)' }}>{f.vendor || '—'}</Typography>
                    </Box>
                  </Stack>
                </Paper>
              ))}
            </Box>
            </>
          )}

          {/* ── Jurisdiction Worksheet ─────────────────────────────────────── */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5} flexWrap="wrap" gap={2}>
            <Typography variant="h6" fontWeight={800} color="#fff">Jurisdiction Worksheet</Typography>
            <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
              <TextField
                label="Fleet MPG"
                size="small"
                type="number"
                value={fleetMpg}
                onChange={(e) => { setFleetMpg(e.target.value); setSaveSuccess(false); }}
                disabled={!canEdit}
                inputProps={{ min: 0, step: 0.1 }}
                sx={{ width: 130 }}
              />
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}
                disabled={!canEdit || saving}
                sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
                {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Worksheet'}
              </Button>
            </Stack>
          </Stack>

          {saveError && <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>{saveError}</Alert>}
          {saveSuccess && <Alert severity="success" sx={{ mb: 2, borderRadius: 3 }}>Worksheet saved.</Alert>}

          {/* Desktop / tablet: full worksheet table (md and up) */}
          <TableContainer component={Paper} sx={{ display: { xs: 'none', md: 'block' }, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={headCell}>Jurisdiction</TableCell>
                  <TableCell sx={headCell} align="right">Total Miles</TableCell>
                  <TableCell sx={headCell} align="right">Taxable Miles</TableCell>
                  <TableCell sx={headCell} align="right">Taxable Gal</TableCell>
                  <TableCell sx={headCell} align="right">Tax-Paid Gal</TableCell>
                  <TableCell sx={headCell} align="right">Net Taxable Gal</TableCell>
                  <TableCell sx={headCell} align="right">Tax Rate ($/gal)</TableCell>
                  <TableCell sx={headCell} align="right">Net Tax</TableCell>
                  <TableCell sx={headCell} align="center" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} sx={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', py: 3 }}>
                      No jurisdictions yet. Add a state below or log a fuel purchase to begin.
                    </TableCell>
                  </TableRow>
                ) : rows.map((r) => {
                  const c = computeRow(r);
                  return (
                    <TableRow key={r.jurisdiction} hover>
                      <TableCell sx={{ color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <Tooltip title={STATE_NAME[r.jurisdiction] || ''}><span>{r.jurisdiction}</span></Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          variant="standard" type="number" size="small" value={r.totalMiles}
                          onChange={(e) => handleRowChange(r.jurisdiction, 'totalMiles', e.target.value)}
                          disabled={!canEdit} inputProps={{ min: 0, style: { textAlign: 'right', color: '#fff', width: 70 } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          variant="standard" type="number" size="small" value={r.taxableMiles}
                          onChange={(e) => handleRowChange(r.jurisdiction, 'taxableMiles', e.target.value)}
                          disabled={!canEdit} inputProps={{ min: 0, style: { textAlign: 'right', color: '#fff', width: 70 } }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'rgba(255,255,255,0.7)' }}>{fmtGal(c.taxableGallons)}</TableCell>
                      <TableCell align="right" sx={{ color: 'rgba(255,255,255,0.7)' }}>{fmtGal(c.taxPaidGallons)}</TableCell>
                      <TableCell align="right" sx={{ color: c.netTaxableGallons >= 0 ? '#fbbf24' : '#34d399', fontWeight: 700 }}>
                        {fmtGal(c.netTaxableGallons)}
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          variant="standard" type="number" size="small" value={r.taxRate}
                          onChange={(e) => handleRowChange(r.jurisdiction, 'taxRate', e.target.value)}
                          disabled={!canEdit}
                          InputProps={{ startAdornment: <InputAdornment position="start" sx={{ '& p': { color: 'rgba(255,255,255,0.5)' } }}>$</InputAdornment> }}
                          inputProps={{ min: 0, step: 0.001, style: { textAlign: 'right', color: '#fff', width: 60 } }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ color: c.netTaxCents >= 0 ? '#ef4444' : '#34d399', fontWeight: 700 }}>{fmt$(c.netTaxCents)}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="Remove row">
                          <span>
                            <IconButton size="small" onClick={() => handleRemoveRow(r.jurisdiction)} disabled={!canEdit} sx={{ color: 'rgba(255,255,255,0.4)' }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell sx={{ color: '#fff', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>Totals</TableCell>
                    <TableCell align="right" sx={{ color: '#fff', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>{fmtMiles(totals.totalMiles)}</TableCell>
                    <TableCell sx={{ borderTop: '2px solid rgba(255,255,255,0.12)' }} />
                    <TableCell align="right" sx={{ color: '#fff', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>{fmtGal(totals.taxableGallons)}</TableCell>
                    <TableCell align="right" sx={{ color: '#fff', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>{fmtGal(totals.taxPaidGallons)}</TableCell>
                    <TableCell align="right" sx={{ color: '#fbbf24', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>{fmtGal(totals.netTaxableGallons)}</TableCell>
                    <TableCell sx={{ borderTop: '2px solid rgba(255,255,255,0.12)' }} />
                    <TableCell align="right" sx={{ color: '#ef4444', fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.12)' }}>{fmt$(totals.netTaxCents)}</TableCell>
                    <TableCell sx={{ borderTop: '2px solid rgba(255,255,255,0.12)' }} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableContainer>

          {/* Phone: stacked worksheet cards (below md) so nothing overflows the screen */}
          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            {rows.length === 0 ? (
              <Paper sx={{ p: 3, borderRadius: 3, textAlign: 'center', bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.5)' }}>
                  No jurisdictions yet. Add a state below or log a fuel purchase to begin.
                </Typography>
              </Paper>
            ) : (
              <>
                {rows.map((r) => {
                  const c = computeRow(r);
                  return (
                    <Paper key={r.jurisdiction} sx={{ p: 2, mb: 1.5, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ color: '#fff', fontWeight: 800, wordBreak: 'break-word' }}>
                          {r.jurisdiction}{STATE_NAME[r.jurisdiction] ? ` — ${STATE_NAME[r.jurisdiction]}` : ''}
                        </Typography>
                        <Tooltip title="Remove row">
                          <span>
                            <IconButton size="small" onClick={() => handleRemoveRow(r.jurisdiction)} disabled={!canEdit} sx={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                      <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.08)' }} />
                      <Grid container spacing={1.5}>
                        <Grid item xs={6}>
                          <TextField
                            label="Total Miles" variant="standard" type="number" size="small" fullWidth value={r.totalMiles}
                            onChange={(e) => handleRowChange(r.jurisdiction, 'totalMiles', e.target.value)}
                            disabled={!canEdit} inputProps={{ min: 0, style: { color: '#fff' } }}
                            InputLabelProps={{ sx: { color: 'rgba(255,255,255,0.5)' } }}
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            label="Taxable Miles" variant="standard" type="number" size="small" fullWidth value={r.taxableMiles}
                            onChange={(e) => handleRowChange(r.jurisdiction, 'taxableMiles', e.target.value)}
                            disabled={!canEdit} inputProps={{ min: 0, style: { color: '#fff' } }}
                            InputLabelProps={{ sx: { color: 'rgba(255,255,255,0.5)' } }}
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            label="Tax Rate ($/gal)" variant="standard" type="number" size="small" fullWidth value={r.taxRate}
                            onChange={(e) => handleRowChange(r.jurisdiction, 'taxRate', e.target.value)}
                            disabled={!canEdit}
                            InputProps={{ startAdornment: <InputAdornment position="start" sx={{ '& p': { color: 'rgba(255,255,255,0.5)' } }}>$</InputAdornment> }}
                            inputProps={{ min: 0, step: 0.001, style: { color: '#fff' } }}
                            InputLabelProps={{ sx: { color: 'rgba(255,255,255,0.5)' } }}
                          />
                        </Grid>
                      </Grid>
                      <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mt: 1.5 }}>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Taxable Gal</Typography>
                          <Typography sx={{ color: 'rgba(255,255,255,0.8)' }}>{fmtGal(c.taxableGallons)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Tax-Paid Gal</Typography>
                          <Typography sx={{ color: 'rgba(255,255,255,0.8)' }}>{fmtGal(c.taxPaidGallons)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Net Taxable Gal</Typography>
                          <Typography sx={{ color: c.netTaxableGallons >= 0 ? '#fbbf24' : '#34d399', fontWeight: 700 }}>{fmtGal(c.netTaxableGallons)}</Typography>
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Net Tax</Typography>
                          <Typography sx={{ color: c.netTaxCents >= 0 ? '#ef4444' : '#34d399', fontWeight: 700 }}>{fmt$(c.netTaxCents)}</Typography>
                        </Box>
                      </Stack>
                    </Paper>
                  );
                })}
                {/* Totals card */}
                <Paper sx={{ p: 2, mb: 1.5, borderRadius: 3, bgcolor: 'rgba(99,102,241,0.10)', border: '1.5px solid rgba(255,255,255,0.12)' }}>
                  <Typography sx={{ color: '#fff', fontWeight: 800, mb: 1 }}>Totals</Typography>
                  <Stack direction="row" flexWrap="wrap" gap={1.5}>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Total Miles</Typography>
                      <Typography sx={{ color: '#fff', fontWeight: 800 }}>{fmtMiles(totals.totalMiles)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Taxable Gal</Typography>
                      <Typography sx={{ color: '#fff', fontWeight: 800 }}>{fmtGal(totals.taxableGallons)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Tax-Paid Gal</Typography>
                      <Typography sx={{ color: '#fff', fontWeight: 800 }}>{fmtGal(totals.taxPaidGallons)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Net Taxable Gal</Typography>
                      <Typography sx={{ color: '#fbbf24', fontWeight: 800 }}>{fmtGal(totals.netTaxableGallons)}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>Net Tax</Typography>
                      <Typography sx={{ color: '#ef4444', fontWeight: 800 }}>{fmt$(totals.netTaxCents)}</Typography>
                    </Box>
                  </Stack>
                </Paper>
              </>
            )}
          </Box>

          {/* Add jurisdiction row */}
          {canEdit && availableStates.length > 0 && (
            <Stack direction="row" alignItems="center" spacing={2} mt={2}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Add jurisdiction</InputLabel>
                <Select value={addState} label="Add jurisdiction" onChange={(e) => handleAddStateRow(e.target.value)}>
                  {availableStates.map((s) => (
                    <MenuItem key={s.code} value={s.code}>{s.code} — {s.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="rgba(255,255,255,0.4)">
                Add every state you drove in this quarter, then enter miles.
              </Typography>
            </Stack>
          )}

          <Divider sx={{ my: 3, borderColor: 'rgba(255,255,255,0.08)' }} />
          <Typography variant="caption" color="rgba(255,255,255,0.4)">
            Taxable Gallons = Taxable Miles ÷ Fleet MPG. Net Taxable Gallons = Taxable Gallons − Tax-Paid Gallons.
            Net Tax = Net Taxable Gallons × Tax Rate. Verify all rates against IFTA, Inc. before filing.
          </Typography>
        </>
      )}

      {/* ── Fuel Add / Edit Dialog ───────────────────────────────────────────── */}
      <Dialog open={fuelDialogOpen} onClose={() => setFuelDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: '#1e1e2f', borderRadius: 3 } }}>
        <DialogTitle sx={{ color: '#fff', fontWeight: 700 }}>
          {editingFuelId ? 'Edit Fuel Purchase' : 'Add Fuel Purchase'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} mt={0.5}>
            <Grid item xs={12} sm={6}>
              <TextField label="Date *" fullWidth size="small" type="date"
                value={fuelForm.date} onChange={(e) => setFuelForm((p) => ({ ...p, date: e.target.value }))}
                InputLabelProps={{ shrink: true }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Jurisdiction *</InputLabel>
                <Select value={fuelForm.jurisdiction} label="Jurisdiction *"
                  onChange={(e) => setFuelForm((p) => ({ ...p, jurisdiction: e.target.value }))}>
                  {US_STATES.map((s) => <MenuItem key={s.code} value={s.code}>{s.code} — {s.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Gallons *" fullWidth size="small" type="number"
                value={fuelForm.gallons} onChange={(e) => setFuelForm((p) => ({ ...p, gallons: e.target.value }))}
                inputProps={{ min: 0.01, step: 0.01 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Total Cost" fullWidth size="small" type="number"
                value={fuelForm.cost} onChange={(e) => setFuelForm((p) => ({ ...p, cost: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                inputProps={{ min: 0, step: 0.01 }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Fuel Type</InputLabel>
                <Select value={fuelForm.fuelType} label="Fuel Type"
                  onChange={(e) => setFuelForm((p) => ({ ...p, fuelType: e.target.value }))}>
                  {FUEL_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Vendor" fullWidth size="small" placeholder="Pilot, Love's, etc."
                value={fuelForm.vendor} onChange={(e) => setFuelForm((p) => ({ ...p, vendor: e.target.value }))} />
            </Grid>
          </Grid>
          {fuelError && <Alert severity="error" sx={{ mt: 2 }}>{fuelError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFuelDialogOpen(false)} sx={{ color: 'rgba(255,255,255,0.5)' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveFuel} disabled={fuelSaving}
            sx={{ bgcolor: '#6366f1', borderRadius: 9999, fontWeight: 700 }}>
            {fuelSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : editingFuelId ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
