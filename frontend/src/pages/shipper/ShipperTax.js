import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Paper, Button, Chip, Stack,
  CircularProgress, Alert, Collapse, List, ListItem, ListItemText,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import api from '../../services/api';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i);

function KPICard({ label, value, sub, color = '#6366f1', icon }) {
  return (
    <Paper sx={{
      p: 3, borderRadius: 3,
      bgcolor: 'rgba(124,140,248,0.08)',
      border: '1.5px solid rgba(255,255,255,0.10)',
    }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        {icon}
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </Stack>
      <Typography variant="h5" fontWeight={800} sx={{ color }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export default function ShipperTax() {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [summary, setSummary]           = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [allRecords, setAllRecords]     = useState([]);
  const [showHistory, setShowHistory]   = useState(false);
  const [exportError, setExportError]   = useState('');

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
      const { data } = await api.get('/tax/summary');
      setAllRecords(data);
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

  const handleExport = async (year) => {
    setExportError('');
    try {
      const { data } = await api.get(`/tax/export/${year}`, { responseType: 'text' });
      const blob = new Blob([data], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `FreightConnect_shipper_${year}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch {
      setExportError('Failed to download report. Please try again.');
    }
  };

  const fmt$ = (cents) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const fmtN = (n)     => (n || 0).toLocaleString();

  // Quarterly breakdown (rough estimate — quarter each year's spend evenly for now)
  const quarterlySpend = summary ? [
    { q: 'Q1 (Jan–Mar)', amount: Math.round(summary.totalSpendCents * 0.25) },
    { q: 'Q2 (Apr–Jun)', amount: Math.round(summary.totalSpendCents * 0.25) },
    { q: 'Q3 (Jul–Sep)', amount: Math.round(summary.totalSpendCents * 0.25) },
    { q: 'Q4 (Oct–Dec)', amount: Math.round(summary.totalSpendCents * 0.25) },
  ] : [];

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <ReceiptLongIcon sx={{ color: '#34d399', fontSize: 32 }} />
        <Typography variant="h4" fontWeight={800} color="#fff">
          Tax & Spend Reports
        </Typography>
      </Stack>

      {/* Info Banner */}
      <Paper sx={{
        p: 2.5, mb: 3, borderRadius: 3,
        bgcolor: 'rgba(52,211,153,0.08)',
        border: '1.5px solid rgba(52,211,153,0.2)',
      }}>
        <Typography variant="body2" color="rgba(255,255,255,0.8)">
          Your freight spend reports are available for download as CSV files for accounting and tax purposes.
          FreightConnect may issue 1099-NEC forms to carriers who earn $600+ annually.
          Shippers should retain these records for business expense deductions.
        </Typography>
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
            <Grid item xs={12} sm={4}>
              <KPICard
                label="Total Freight Spend"
                value={fmt$(summary.totalSpendCents)}
                color="#34d399"
                icon={<AttachMoneyIcon sx={{ color: '#34d399', fontSize: 20 }} />}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <KPICard
                label="Loads Delivered"
                value={fmtN(summary.loadPostedCount)}
                color="#6366f1"
                icon={<LocalShippingIcon sx={{ color: '#6366f1', fontSize: 20 }} />}
                sub="delivered loads this year"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <KPICard
                label="Avg Cost per Load"
                value={summary.loadPostedCount > 0
                  ? fmt$(Math.round(summary.totalSpendCents / summary.loadPostedCount))
                  : '$0.00'}
                color="#fbbf24"
              />
            </Grid>
          </Grid>

          {/* Quarterly Breakdown */}
          {summary.totalSpendCents > 0 && (
            <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
              <Typography fontWeight={700} color="#fff" mb={2}>Estimated Quarterly Breakdown</Typography>
              <Grid container spacing={1.5}>
                {quarterlySpend.map(q => (
                  <Grid key={q.q} item xs={6} sm={3}>
                    <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.1)' }}>
                      <Typography variant="caption" color="rgba(255,255,255,0.6)">{q.q}</Typography>
                      <Typography variant="h6" fontWeight={800} color="#fff">{fmt$(q.amount)}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
              <Typography variant="caption" color="rgba(255,255,255,0.4)" display="block" mt={1.5}>
                * Quarterly estimates are evenly distributed. Download the CSV for exact per-load dates.
              </Typography>
            </Paper>
          )}

          {/* Download */}
          {exportError && <Alert severity="error" sx={{ mb: 2 }}>{exportError}</Alert>}
          <Button
            startIcon={<FileDownloadIcon />}
            variant="contained"
            onClick={() => handleExport(selectedYear)}
            sx={{
              mb: 3,
              bgcolor: '#6366f1', fontWeight: 700, borderRadius: 9999, px: 4,
              '&:hover': { bgcolor: '#4f46e5' },
            }}
          >
            Download {selectedYear} Freight Report (CSV)
          </Button>

          {/* Deduction Note */}
          <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3, bgcolor: 'rgba(251,191,36,0.07)', border: '1.5px solid rgba(251,191,36,0.2)' }}>
            <Typography variant="body2" color="rgba(255,255,255,0.75)">
              <strong style={{ color: '#fbbf24' }}>Tax Tip:</strong> Freight transportation expenses paid for business
              purposes are generally deductible as ordinary business expenses (IRS Publication 535).
              Consult your tax advisor to confirm eligibility and maximize deductions.
            </Typography>
          </Paper>
        </>
      ) : (
        <Typography color="rgba(255,255,255,0.5)" mb={3}>No data for {selectedYear}. Select a year to load.</Typography>
      )}

      {/* History */}
      {allRecords.length > 0 && (
        <Paper sx={{ p: 2.5, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
            <Typography fontWeight={700} color="#fff">All Years</Typography>
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
                        Total spend: {fmt$(r.totalSpendCents)} · {r.loadPostedCount} loads
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
