import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Paper, Button, Chip, Stack, Divider,
  CircularProgress, Alert, TextField, Select, MenuItem, FormControl,
  InputLabel, Drawer, List, ListItem, ListItemText, Collapse,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import api from '../../services/api';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i);

const TAX_CLASSIFICATIONS = [
  { value: 'individual',       label: 'Individual / Sole Proprietor' },
  { value: 'sole_proprietor',  label: 'Sole Proprietor' },
  { value: 'llc_single',       label: 'LLC — Single Member' },
  { value: 'llc_partnership',  label: 'LLC — Partnership' },
  { value: 'llc_corp',         label: 'LLC — Corp' },
  { value: 'c_corp',           label: 'C Corporation' },
  { value: 's_corp',           label: 'S Corporation' },
  { value: 'partnership',      label: 'Partnership' },
  { value: 'trust',            label: 'Trust / Estate' },
  { value: 'other',            label: 'Other' },
];

const W9_STATUS_COLOR = {
  not_submitted: '#94a3b8',
  submitted:     '#fbbf24',
  verified:      '#34d399',
  rejected:      '#ef4444',
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

export default function CarrierTax() {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [summary, setSummary]           = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [allRecords, setAllRecords]     = useState([]);
  const [w9Status, setW9Status]         = useState(null);
  const [showW9Form, setShowW9Form]     = useState(false);
  const [w9Saving, setW9Saving]         = useState(false);
  const [w9Error, setW9Error]           = useState('');
  const [w9Success, setW9Success]       = useState(false);
  const [showHistory, setShowHistory]   = useState(false);

  // W-9 form state
  const [w9Form, setW9Form] = useState({
    legalName: '', businessName: '', taxClassification: 'individual',
    ein: '', ssnLast4: '', address: '', city: '', state: '', zip: '',
  });

  const fetchSummary = useCallback(async (year) => {
    setSummaryLoading(true);
    try {
      const { data } = await api.get(`/tax/summary/${year}`);
      setSummary(data);
    } catch { /* non-critical */ }
    setSummaryLoading(false);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [allRes, w9Res] = await Promise.all([
        api.get('/tax/summary'),
        api.get('/tax/w9'),
      ]);
      setAllRecords(allRes.data);
      setW9Status(w9Res.data);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchSummary(CURRENT_YEAR);
  }, [fetchAll, fetchSummary]);

  const handleYearChange = (year) => {
    setSelectedYear(year);
    fetchSummary(year);
  };

  const handleW9Submit = async () => {
    if (!w9Form.legalName || !w9Form.taxClassification) {
      setW9Error('Legal name and tax classification are required.');
      return;
    }
    if (!w9Form.ein && !w9Form.ssnLast4) {
      setW9Error('Please provide either an EIN or the last 4 digits of your SSN.');
      return;
    }
    setW9Saving(true);
    setW9Error('');
    try {
      await api.post('/tax/w9', w9Form);
      setW9Success(true);
      setShowW9Form(false);
      fetchAll();
    } catch (err) {
      setW9Error(err.response?.data?.error || 'Failed to submit W-9');
    }
    setW9Saving(false);
  };

  const handleExport = async (year) => {
    try {
      const { data } = await api.get(`/tax/export/${year}`, { responseType: 'text' });
      const blob = new Blob([data], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `FreightConnect_carrier_${year}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { /* non-critical */ }
  };

  const fmt$ = (cents) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const fmtN = (n)     => (n || 0).toLocaleString();

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <ReceiptLongIcon sx={{ color: '#34d399', fontSize: 32 }} />
        <Typography variant="h4" fontWeight={800} color="#fff">
          Tax & Compliance
        </Typography>
      </Stack>

      {/* W-9 Status Banner */}
      <Paper sx={{
        p: 2.5, mb: 3, borderRadius: 3,
        bgcolor: w9Status?.w9Status === 'verified'  ? 'rgba(52,211,153,0.10)'
               : w9Status?.w9Status === 'submitted' ? 'rgba(251,191,36,0.10)'
               : 'rgba(249,115,22,0.10)',
        border: `1.5px solid ${W9_STATUS_COLOR[w9Status?.w9Status || 'not_submitted']}44`,
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            {w9Status?.w9Status === 'verified'
              ? <CheckCircleIcon sx={{ color: '#34d399' }} />
              : <WarningAmberIcon sx={{ color: W9_STATUS_COLOR[w9Status?.w9Status || 'not_submitted'] }} />
            }
            <Box>
              <Typography fontWeight={700} color="#fff">
                W-9 Status: {(w9Status?.w9Status || 'not_submitted').replace('_', ' ').toUpperCase()}
              </Typography>
              <Typography variant="caption" color="rgba(255,255,255,0.6)">
                {w9Status?.w9Status === 'verified'  && 'Your tax information is on file and verified.'}
                {w9Status?.w9Status === 'submitted' && 'Your W-9 is under review. Expect verification within 2 business days.'}
                {(!w9Status?.w9Status || w9Status.w9Status === 'not_submitted') && 'Please submit your W-9 to receive payments and for 1099 filing.'}
                {w9Status?.w9Status === 'rejected'  && 'Your W-9 was rejected. Please resubmit with correct information.'}
              </Typography>
            </Box>
          </Stack>
          {w9Status?.w9Status !== 'verified' && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AssignmentIndIcon />}
              onClick={() => setShowW9Form(v => !v)}
              sx={{ borderColor: '#34d399', color: '#34d399', borderRadius: 9999, fontWeight: 700 }}
            >
              {w9Status?.w9Status === 'not_submitted' ? 'Submit W-9' : 'Update W-9'}
            </Button>
          )}
        </Stack>

        {/* W-9 Form */}
        <Collapse in={showW9Form}>
          <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.1)' }} />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField label="Legal Name *" fullWidth size="small" value={w9Form.legalName}
                onChange={e => setW9Form(p => ({ ...p, legalName: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Business Name (if different)" fullWidth size="small" value={w9Form.businessName}
                onChange={e => setW9Form(p => ({ ...p, businessName: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Tax Classification *</InputLabel>
                <Select value={w9Form.taxClassification} label="Tax Classification *"
                  onChange={e => setW9Form(p => ({ ...p, taxClassification: e.target.value }))}>
                  {TAX_CLASSIFICATIONS.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="EIN (xx-xxxxxxx)" fullWidth size="small" value={w9Form.ein}
                onChange={e => setW9Form(p => ({ ...p, ein: e.target.value }))}
                helperText="Required if business" />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="SSN Last 4 Digits" fullWidth size="small" value={w9Form.ssnLast4}
                onChange={e => setW9Form(p => ({ ...p, ssnLast4: e.target.value.slice(0, 4) }))}
                helperText="If no EIN" inputProps={{ maxLength: 4 }} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Address" fullWidth size="small" value={w9Form.address}
                onChange={e => setW9Form(p => ({ ...p, address: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField label="City" fullWidth size="small" value={w9Form.city}
                onChange={e => setW9Form(p => ({ ...p, city: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="State" fullWidth size="small" value={w9Form.state}
                onChange={e => setW9Form(p => ({ ...p, state: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="ZIP" fullWidth size="small" value={w9Form.zip}
                onChange={e => setW9Form(p => ({ ...p, zip: e.target.value }))} />
            </Grid>
          </Grid>
          {w9Error && <Alert severity="error" sx={{ mt: 2 }}>{w9Error}</Alert>}
          {w9Success && <Alert severity="success" sx={{ mt: 2 }}>W-9 submitted successfully!</Alert>}
          <Stack direction="row" spacing={1} mt={2}>
            <Button
              variant="contained" onClick={handleW9Submit} disabled={w9Saving}
              sx={{ bgcolor: '#34d399', color: '#000', fontWeight: 700, borderRadius: 9999 }}
            >
              {w9Saving ? <CircularProgress size={18} sx={{ color: '#000' }} /> : 'Submit W-9'}
            </Button>
            <Button variant="text" onClick={() => setShowW9Form(false)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </Button>
          </Stack>
        </Collapse>
      </Paper>

      {/* Year Selector */}
      <Stack direction="row" alignItems="center" spacing={2} mb={3} flexWrap="wrap">
        <Typography color="rgba(255,255,255,0.8)" fontWeight={600}>Tax Year:</Typography>
        {YEARS.map(y => (
          <Chip
            key={y}
            label={y}
            onClick={() => handleYearChange(y)}
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
      {summaryLoading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
      ) : summary ? (
        <>
          <Grid container spacing={2} mb={3}>
            <Grid item xs={6} sm={3}>
              <KPICard label="Gross Earnings" value={fmt$(summary.totalEarningsCents)} color="#34d399" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Platform Fees (5%)" value={fmt$(summary.platformFeeCents)} color="#f97316" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Net Earnings" value={fmt$(summary.netEarningsCents)} color="#6366f1" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <KPICard label="Loads Delivered" value={fmtN(summary.loadCount)} color="#fbbf24" />
            </Grid>
          </Grid>

          {/* Tax Notes */}
          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3, bgcolor: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.2)' }}>
            <Stack spacing={1}>
              {summary.requires1099 && (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  Your earnings exceed $600 for {selectedYear}. FreightConnect will file a 1099-NEC on your behalf.
                  Current status: <strong>{(summary.form1099Status || 'pending').replace('_', ' ')}</strong>
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Box flex={1}>
                  <Typography variant="body2" color="rgba(255,255,255,0.7)">
                    <strong style={{ color: '#fff' }}>Estimated Miles Driven:</strong>{' '}
                    {fmtN(summary.estimatedMilesDriven)} mi
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.45)">
                    At IRS standard rate (67¢/mi for {selectedYear}), potential deduction:{' '}
                    <strong style={{ color: '#fbbf24' }}>${((summary.estimatedMilesDriven || 0) * 0.67).toFixed(0)}</strong>
                  </Typography>
                </Box>
                <Button
                  startIcon={<FileDownloadIcon />}
                  variant="outlined"
                  onClick={() => handleExport(selectedYear)}
                  sx={{ borderColor: '#6366f1', color: '#6366f1', borderRadius: 9999, fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  Download {selectedYear} CSV
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </>
      ) : (
        <Typography color="rgba(255,255,255,0.5)" mb={3}>No data yet for {selectedYear}. Click a year to calculate.</Typography>
      )}

      {/* Tax History */}
      {allRecords.length > 0 && (
        <Paper sx={{ p: 2.5, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
            <Typography fontWeight={700} color="#fff">Year-over-Year History</Typography>
            <Button size="small" onClick={() => setShowHistory(v => !v)}
              endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>
              {showHistory ? 'Hide' : 'Show'}
            </Button>
          </Stack>
          <Collapse in={showHistory}>
            <List dense disablePadding>
              {allRecords.map(r => (
                <ListItem
                  key={r._id}
                  secondaryAction={
                    <Button size="small" startIcon={<FileDownloadIcon />}
                      onClick={() => handleExport(r.taxYear)}
                      sx={{ color: '#6366f1', fontSize: '0.72rem' }}>
                      CSV
                    </Button>
                  }
                  sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)', py: 1 }}
                >
                  <ListItemText
                    primary={<Typography fontWeight={700} color="#fff">{r.taxYear}</Typography>}
                    secondary={
                      <Typography variant="caption" color="rgba(255,255,255,0.55)">
                        Gross: {fmt$(r.totalEarningsCents)} · Net: {fmt$(r.netEarningsCents)} · {r.loadCount} loads
                        {r.requires1099 ? ' · 1099 required' : ''}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Collapse>
        </Paper>
      )}
    </Box>
  );
}
