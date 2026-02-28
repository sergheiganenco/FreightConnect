/**
 * CarrierFactoring — Invoice Factoring Dashboard
 *
 * Carriers can:
 *  • See delivered loads eligible for factoring
 *  • Submit a factoring request (select loads → see advance amount → confirm)
 *  • Track all factoring requests (pending / approved / rejected / funded / collected)
 *  • View request detail drawer (loads, financial breakdown, history timeline)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  Drawer,
  Stack,
  TextField,
  Tooltip,
  IconButton,
} from '@mui/material';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CancelIcon from '@mui/icons-material/Cancel';
import PaidIcon from '@mui/icons-material/Paid';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const ADVANCE_PCT = 95; // standard advance rate

const STATUS_META = {
  pending:   { label: 'Pending Review', color: '#f59e0b', icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} /> },
  approved:  { label: 'Approved',       color: '#6366f1', icon: <CheckCircleIcon sx={{ fontSize: 16 }} /> },
  rejected:  { label: 'Rejected',       color: '#ef4444', icon: <CancelIcon sx={{ fontSize: 16 }} /> },
  funded:    { label: 'Funded',         color: '#10b981', icon: <PaidIcon sx={{ fontSize: 16 }} /> },
  collected: { label: 'Collected',      color: '#6b7280', icon: <CheckCircleIcon sx={{ fontSize: 16 }} /> },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <Chip
      icon={m.icon}
      label={m.label}
      size="small"
      sx={{ bgcolor: `${m.color}22`, color: m.color, fontWeight: 700, border: `1px solid ${m.color}44` }}
    />
  );
}

function fmtCents(cents) {
  return `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(dt) {
  if (!dt) return '--';
  return new Date(dt).toLocaleDateString();
}

const CARD_SX = {
  bgcolor: 'rgba(124,140,248,0.10)',
  border: '1.5px solid rgba(255,255,255,0.10)',
  borderRadius: 3,
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, color = '#e5e7eb', sub }) {
  return (
    <Card sx={CARD_SX}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>{label}</Typography>
        <Typography variant="h5" fontWeight={700} sx={{ color }}>{value}</Typography>
        {sub && <Typography variant="caption" sx={{ color: '#6b7280' }}>{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

// ── Submit Request Dialog ─────────────────────────────────────────────────────
function SubmitDialog({ open, onClose, onSuccess }) {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState([]);
  const [notes, setNotes]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    fetch(`${API}/api/factoring/eligible`, { headers })
      .then(r => r.json())
      .then(data => { setEligible(Array.isArray(data) ? data : []); })
      .catch(() => setError('Failed to load eligible loads'))
      .finally(() => setFetching(false));
    // eslint-disable-next-line
  }, [open]);

  const totalRate   = selected.reduce((s, id) => {
    const l = eligible.find(e => e._id === id);
    return s + (l?.rate || 0);
  }, 0);
  const totalCents  = Math.round(totalRate * 100);
  const advanceCents = Math.round(totalCents * ADVANCE_PCT / 100);
  const feeCents     = totalCents - advanceCents;

  const toggle = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const submit = async () => {
    if (selected.length === 0) { setError('Select at least one load'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/factoring`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ loadIds: selected, notes, advancePct: ADVANCE_PCT }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      setSelected([]); setNotes(''); setError('');
      onSuccess(data);
    } catch {
      setError('Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <MonetizationOnIcon sx={{ color: '#10b981' }} />
        Submit Factoring Request
        <IconButton onClick={onClose} sx={{ ml: 'auto', color: '#9ca3af' }} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* How it works */}
        <Card sx={{ ...CARD_SX, mb: 2 }}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" sx={{ color: '#9ca3af' }}>
              FreightConnect Finance advances <strong style={{ color: '#10b981' }}>{ADVANCE_PCT}%</strong> of your invoice value immediately.
              The remaining {100 - ADVANCE_PCT}% is our factoring fee. No waiting 30-60 days.
            </Typography>
          </CardContent>
        </Card>

        <Typography variant="subtitle2" sx={{ color: '#e5e7eb', mb: 1 }}>
          Select Eligible Loads ({eligible.length} available):
        </Typography>

        {fetching
          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={28} /></Box>
          : eligible.length === 0
            ? <Typography variant="body2" sx={{ color: '#6b7280', py: 2, textAlign: 'center' }}>No eligible loads — deliver loads to qualify</Typography>
            : (
              <Box sx={{ maxHeight: 260, overflowY: 'auto', pr: 0.5 }}>
                {eligible.map(load => (
                  <Box
                    key={load._id}
                    onClick={() => toggle(load._id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      p: 1.5, mb: 1, borderRadius: 2, cursor: 'pointer',
                      bgcolor: selected.includes(load._id) ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${selected.includes(load._id) ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <Checkbox
                      checked={selected.includes(load._id)}
                      size="small"
                      sx={{ color: '#6b7280', '&.Mui-checked': { color: '#6366f1' }, p: 0 }}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggle(load._id)}
                    />
                    <LocalShippingIcon sx={{ color: '#9ca3af', fontSize: 18 }} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ color: '#e5e7eb' }}>{load.title}</Typography>
                      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                        {load.origin} → {load.destination}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ color: '#10b981' }}>
                      ${load.rate?.toLocaleString()}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )
        }

        {/* Financial summary */}
        {selected.length > 0 && (
          <Card sx={{ ...CARD_SX, mt: 2 }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Grid container spacing={1}>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>Invoice Total</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: '#e5e7eb' }}>{fmtCents(totalCents)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>You Receive ({ADVANCE_PCT}%)</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: '#10b981' }}>{fmtCents(advanceCents)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>Fee ({100 - ADVANCE_PCT}%)</Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ color: '#f59e0b' }}>{fmtCents(feeCents)}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        <TextField
          label="Notes (optional)"
          fullWidth
          size="small"
          multiline
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          sx={{ mt: 2, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }, label: { color: '#9ca3af' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: '#9ca3af' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={loading || selected.length === 0}
          sx={{ bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}
        >
          {loading ? <CircularProgress size={20} /> : `Submit — Receive ${fmtCents(advanceCents)}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Request Detail Drawer ─────────────────────────────────────────────────────
function DetailDrawer({ request, open, onClose }) {
  if (!request) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, bgcolor: '#1a1740', color: '#fff', p: 3 } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>Factoring Request</Typography>
        <IconButton onClick={onClose} sx={{ ml: 'auto', color: '#9ca3af' }}><CloseIcon /></IconButton>
      </Box>

      <StatusChip status={request.status} />
      <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 0.5, mb: 2 }}>
        Submitted {fmtDate(request.createdAt)}
      </Typography>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mb: 2 }} />

      {/* Financial breakdown */}
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1 }}>Financial Breakdown</Typography>
      {[
        { label: 'Invoice Total',     value: fmtCents(request.invoiceTotalCents), color: '#e5e7eb' },
        { label: `Advance (${request.advancePct}%)`, value: fmtCents(request.advanceCents), color: '#10b981' },
        { label: 'Factoring Fee',     value: fmtCents(request.feeCents),          color: '#f59e0b' },
      ].map(row => (
        <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>{row.label}</Typography>
          <Typography variant="body2" fontWeight={700} sx={{ color: row.color }}>{row.value}</Typography>
        </Box>
      ))}

      {request.fundingRef && (
        <Box sx={{ mt: 1, p: 1, bgcolor: 'rgba(16,185,129,0.1)', borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: '#34d399' }}>Funding ref: {request.fundingRef}</Typography>
        </Box>
      )}

      {request.rejectionReason && (
        <Alert severity="error" sx={{ mt: 1, bgcolor: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
          {request.rejectionReason}
        </Alert>
      )}

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 2 }} />

      {/* Included loads */}
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1 }}>
        Included Loads ({(request.loads || []).length})
      </Typography>
      {(request.loads || []).map(load => (
        <Box
          key={load._id}
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, p: 1.5, bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2 }}
        >
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ color: '#e5e7eb' }}>{load.title || load._id}</Typography>
            {load.origin && (
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>{load.origin} → {load.destination}</Typography>
            )}
          </Box>
          <Typography variant="body2" fontWeight={700} sx={{ color: '#10b981' }}>
            ${load.rate?.toLocaleString()}
          </Typography>
        </Box>
      ))}

      {/* History timeline */}
      {(request.history || []).length > 0 && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1 }}>Activity</Typography>
          {request.history.map((h, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#6366f1', mt: 0.6, flexShrink: 0 }} />
              <Box>
                <Typography variant="body2" sx={{ color: '#e5e7eb', textTransform: 'capitalize' }}>{h.action}</Typography>
                {h.details && <Typography variant="caption" sx={{ color: '#9ca3af' }}>{h.details}</Typography>}
                <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>{fmtDate(h.timestamp)}</Typography>
              </Box>
            </Box>
          ))}
        </>
      )}
    </Drawer>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function CarrierFactoring() {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [detail, setDetail]     = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/factoring`, { headers });
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
      setError('');
    } catch {
      setError('Failed to load factoring requests');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openDetail = async (req) => {
    try {
      const res  = await fetch(`${API}/api/factoring/${req._id}`, { headers });
      const data = await res.json();
      setDetail(data);
      setDrawerOpen(true);
    } catch { /* show what we have */ }
  };

  // KPI stats
  const funded  = requests.filter(r => r.status === 'funded' || r.status === 'collected');
  const pending = requests.filter(r => r.status === 'pending' || r.status === 'approved');
  const totalFunded  = funded.reduce((s, r) => s + (r.advanceCents || 0), 0);
  const totalPending = pending.reduce((s, r) => s + (r.advanceCents || 0), 0);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <MonetizationOnIcon sx={{ color: '#10b981', fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} sx={{ color: '#fff' }}>Invoice Factoring</Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            Get paid immediately — FreightConnect Finance advances {ADVANCE_PCT}% of your invoices
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <IconButton onClick={fetchRequests} size="small" sx={{ color: '#9ca3af' }}><RefreshIcon /></IconButton>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setSubmitOpen(true)}
            sx={{ bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}
          >
            New Request
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <KPI label="Total Requests" value={requests.length} color="#e5e7eb" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPI label="Pending / Approved" value={pending.length} color="#f59e0b" sub={fmtCents(totalPending) + ' pending'} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPI label="Funded" value={funded.length} color="#10b981" sub={fmtCents(totalFunded) + ' received'} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KPI
            label="Advance Rate"
            value={`${ADVANCE_PCT}%`}
            color="#6366f1"
            sub="of invoice value"
          />
        </Grid>
      </Grid>

      {/* How Factoring Works */}
      <Card sx={{ ...CARD_SX, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
            How Factoring Works
          </Typography>
          <Grid container spacing={2}>
            {[
              { step: '1', title: 'Deliver Loads', desc: 'Complete delivery — load status becomes Delivered' },
              { step: '2', title: 'Submit Request', desc: `Select delivered loads and submit for factoring` },
              { step: '3', title: 'Get Approved', desc: 'FreightConnect Finance reviews (typically same day)' },
              { step: '4', title: 'Receive Advance', desc: `${ADVANCE_PCT}% of invoice value wired to your account` },
            ].map(s => (
              <Grid item xs={6} sm={3} key={s.step}>
                <Box sx={{ textAlign: 'center' }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
                    <Typography variant="body2" fontWeight={700}>{s.step}</Typography>
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ color: '#e5e7eb' }}>{s.title}</Typography>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>{s.desc}</Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* Requests table */}
      <Card sx={CARD_SX}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 2 }}>
            My Requests
          </Typography>

          {loading
            ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
            : requests.length === 0
              ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <MonetizationOnIcon sx={{ fontSize: 48, color: '#374151', mb: 2 }} />
                  <Typography sx={{ color: '#6b7280' }}>No factoring requests yet</Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setSubmitOpen(true)}
                    sx={{ mt: 2, bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}
                  >
                    Submit Your First Request
                  </Button>
                </Box>
              )
              : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Date', 'Loads', 'Invoice Total', `Advance (${ADVANCE_PCT}%)`, 'Status', ''].map(h => (
                          <TableCell key={h} sx={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.08)', fontWeight: 600 }}>
                            {h}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {requests.map(req => (
                        <TableRow
                          key={req._id}
                          hover
                          sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' } }}
                          onClick={() => openDetail(req)}
                        >
                          <TableCell sx={{ color: '#e5e7eb', borderColor: 'rgba(255,255,255,0.06)' }}>
                            {fmtDate(req.createdAt)}
                          </TableCell>
                          <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.06)' }}>
                            {(req.loads || []).length} load{(req.loads || []).length !== 1 ? 's' : ''}
                          </TableCell>
                          <TableCell sx={{ color: '#e5e7eb', borderColor: 'rgba(255,255,255,0.06)' }}>
                            {fmtCents(req.invoiceTotalCents)}
                          </TableCell>
                          <TableCell sx={{ color: '#10b981', fontWeight: 700, borderColor: 'rgba(255,255,255,0.06)' }}>
                            {fmtCents(req.advanceCents)}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                            <StatusChip status={req.status} />
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                            <Tooltip title="View details">
                              <IconButton size="small" sx={{ color: '#9ca3af' }} onClick={e => { e.stopPropagation(); openDetail(req); }}>
                                <InfoOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )
          }
        </CardContent>
      </Card>

      {/* Submit Dialog */}
      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSuccess={(newReq) => {
          setSubmitOpen(false);
          setRequests(prev => [newReq, ...prev]);
        }}
      />

      {/* Detail Drawer */}
      <DetailDrawer
        request={detail}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </Box>
  );
}
