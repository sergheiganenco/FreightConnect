/**
 * CarrierContracts — Contract Management for Carriers
 *
 * Carriers can review pending contract assignments, accept/reject them,
 * and monitor active contract performance and generated loads.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, Drawer, Grid, IconButton, Alert, Divider,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AssignmentIcon from '@mui/icons-material/Assignment';
import api from '../../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { label: 'Pending Approval', value: 'pending_approval' },
  { label: 'Active',           value: 'active' },
  { label: 'All',              value: 'all' },
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

const AC_STATUS_COLOR = {
  pending:  '#fbbf24',
  active:   '#34d399',
  paused:   '#60a5fa',
  removed:  '#94a3b8',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCents(c) {
  if (!c && c !== 0) return '—';
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMyStatus(contract) {
  const uid = localStorage.getItem('userId');
  const ac = (contract.assignedCarriers || []).find(a => a.carrier?._id === uid || a.carrier === uid);
  return ac?.status || null;
}

// ── Contract Detail Drawer ────────────────────────────────────────────────────
function ContractDetail({ contractId, open, onClose, onRefresh }) {
  const [contract, setContract] = useState(null);
  const [perf, setPerf]         = useState(null);
  const [loads, setLoads]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');

  const uid = localStorage.getItem('userId');

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true); setErr('');
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

  const myAc = contract
    ? (contract.assignedCarriers || []).find(ac =>
        (ac.carrier?._id || ac.carrier) === uid
      )
    : null;

  const doAction = async (endpoint) => {
    setErr('');
    try {
      await api.post(`/contracts/${contractId}/${endpoint}`);
      await load();
      onRefresh();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Action failed.');
    }
  };

  return (
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
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

          {/* Accept / Reject banner for pending */}
          {myAc?.status === 'pending' && (
            <Paper sx={{ bgcolor: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf2444', p: 2, borderRadius: 2, mb: 3 }}>
              <Typography fontWeight={700} sx={{ color: '#fbbf24', mb: 1 }}>
                Action Required — Accept or Decline this contract
              </Typography>
              <Stack direction="row" spacing={2}>
                <Button variant="contained" startIcon={<CheckCircleIcon />}
                  onClick={() => doAction('approve')}
                  sx={{ bgcolor: '#34d399', '&:hover': { bgcolor: '#059669' } }}>
                  Accept Contract
                </Button>
                <Button variant="outlined" startIcon={<CancelIcon />}
                  onClick={() => doAction('reject')}
                  sx={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  Decline
                </Button>
              </Stack>
            </Paper>
          )}

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

          {/* Shipper Info */}
          <Paper sx={{ bgcolor: 'rgba(255,255,255,0.06)', p: 2, borderRadius: 2, mb: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>SHIPPER</Typography>
            <Typography fontWeight={600}>{contract.shipper?.companyName || contract.shipper?.name}</Typography>
            <Typography variant="body2" sx={{ color: '#94a3b8' }}>{contract.shipper?.email}</Typography>
          </Paper>

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
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>MY STATUS</Typography>
                <Chip label={myAc?.status || 'N/A'} size="small" sx={{
                  bgcolor: (AC_STATUS_COLOR[myAc?.status] || '#888') + '33',
                  color: AC_STATUS_COLOR[myAc?.status] || '#888',
                  fontWeight: 700,
                }} />
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>ALLOCATION</Typography>
                <Typography fontWeight={600}>{myAc?.allocation ?? '—'}%</Typography>
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

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

          {/* Recent Loads */}
          <Typography variant="subtitle2" fontWeight={700} mb={1}>Recent Loads</Typography>
          {loads.length === 0
            ? <Typography sx={{ color: '#aaa', fontSize: '0.9rem' }}>No loads generated yet.</Typography>
            : (
              <Table size="small">
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
        </Box>
      )}
    </Drawer>
  );
}

// ── Contract Card ─────────────────────────────────────────────────────────────
function ContractCard({ contract, onClick }) {
  const myAc = getMyStatus(contract);

  return (
    <Paper onClick={onClick} sx={{
      p: 2.5, borderRadius: 3, mb: 2, cursor: 'pointer',
      bgcolor: 'rgba(124,140,248,0.10)',
      border: myAc === 'pending'
        ? '1px solid rgba(251,191,36,0.45)'
        : '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.18s',
      '&:hover': { bgcolor: 'rgba(124,140,248,0.18)', borderColor: 'rgba(167,139,250,0.35)' },
    }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1}>
        <Box>
          <Typography fontWeight={700} color="#fff">{contract.title}</Typography>
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>{contract.contractNumber}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {myAc === 'pending' && (
            <Chip label="Action Required" size="small" sx={{ bgcolor: '#fbbf2433', color: '#fbbf24', fontWeight: 700 }} />
          )}
          <Chip label={contract.status.replace('_', ' ')} size="small" sx={{
            bgcolor: (STATUS_COLOR[contract.status] || '#888') + '33',
            color:   STATUS_COLOR[contract.status] || '#888',
            fontWeight: 700, textTransform: 'capitalize',
          }} />
        </Stack>
      </Stack>

      <Typography sx={{ color: '#94a3b8', mb: 0.5 }}>
        Shipper: <span style={{ color: '#c4b5fd' }}>{contract.shipper?.companyName || contract.shipper?.name}</span>
      </Typography>
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
          <Typography variant="caption" sx={{ color: '#94a3b8' }}>Expires</Typography>
          <Typography variant="body2" color="#fff">{fmtDate(contract.terms?.endDate)}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CarrierContracts() {
  const [tabIdx, setTabIdx]         = useState(0);
  const [contracts, setContracts]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [detailId, setDetailId]     = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const pendingCount = contracts.filter(c => {
    const uid = localStorage.getItem('userId');
    return (c.assignedCarriers || []).some(
      ac => (ac.carrier?._id || ac.carrier) === uid && ac.status === 'pending'
    );
  }).length;

  const openDetail = (id) => { setDetailId(id); setDetailOpen(true); };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: '100%' }}>
      <Stack direction="row" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={900} sx={{ color: '#fff', flex: 1 }}>
          Contracts &amp; Dedicated Lanes
        </Typography>
        {pendingCount > 0 && (
          <Chip
            label={`${pendingCount} Pending Approval`}
            sx={{ bgcolor: '#fbbf2433', color: '#fbbf24', fontWeight: 700 }}
          />
        )}
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
            When a shipper assigns you to a dedicated lane contract, it will appear here.
          </Typography>
        </Paper>
      ) : (
        contracts.map(c => (
          <ContractCard key={c._id} contract={c} onClick={() => openDetail(c._id)} />
        ))
      )}

      <ContractDetail
        contractId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={fetchContracts}
      />
    </Box>
  );
}
