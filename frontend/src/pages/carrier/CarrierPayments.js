import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, Stack, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Button, Skeleton, Pagination, Divider, Tooltip,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const token = () => localStorage.getItem('token');

const CARD_BG = 'rgba(35,13,71,0.88)';
const GLASS = 'rgba(255,255,255,0.06)';

const STATUS_CONFIG = {
  pending:   { label: 'Pending',    color: 'default' },
  in_escrow: { label: 'In Escrow',  color: 'warning' },
  released:  { label: 'Released',   color: 'success' },
  refunded:  { label: 'Refunded',   color: 'info'    },
  failed:    { label: 'Failed',     color: 'error'   },
};

function SummaryCard({ icon, label, value, sub, color }) {
  return (
    <Card sx={{ flex: 1, minWidth: 160, background: CARD_BG, borderRadius: 3, border: '1px solid rgba(255,255,255,0.10)' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
          <Box sx={{ color: color || '#a082e0', display: 'flex' }}>{icon}</Box>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={700} color="#fff">{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function CarrierPayments() {
  const [payments, setPayments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [stripeStatus, setStripeStatus] = useState(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  const fetchPayments = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/payments/my?page=${p}&limit=15`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setPayments(data.payments || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      setError('Failed to load payment history.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStripeStatus = useCallback(async () => {
    setStripeLoading(true);
    try {
      const res = await fetch(`${API}/payments/connect/status`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) setStripeStatus(await res.json());
    } catch { /* ignore */ } finally {
      setStripeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments(1);
    fetchStripeStatus();
  }, [fetchPayments, fetchStripeStatus]);

  // Handle return from Stripe onboarding
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const onboard = params.get('onboard');
    if (onboard === 'success') {
      fetchStripeStatus();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchStripeStatus]);

  const handleStripeOnboard = async () => {
    setOnboarding(true);
    try {
      const res = await fetch(`${API}/payments/connect/onboard`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || 'Could not start onboarding.');
    } catch {
      setError('Failed to start Stripe onboarding.');
    } finally {
      setOnboarding(false);
    }
  };

  // Compute summary stats from loaded payments
  const earned   = payments.filter(p => p.status === 'released').reduce((s, p) => s + (p.carrierPayout || 0), 0);
  const inEscrow = payments.filter(p => p.status === 'in_escrow').reduce((s, p) => s + (p.carrierPayout || 0), 0);
  const pending  = payments.filter(p => p.status === 'pending').length;

  const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={1}>Payments & Payouts</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Track your earnings, escrow balances, and Stripe payout status.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── Stripe Connect Status ────────────────────────────────────── */}
      <Card sx={{ mb: 3, background: CARD_BG, borderRadius: 3, border: '1px solid rgba(255,255,255,0.10)' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Payout Account</Typography>
          {stripeLoading ? (
            <Skeleton variant="rounded" height={40} />
          ) : stripeStatus?.payoutsEnabled ? (
            <Stack direction="row" alignItems="center" spacing={2}>
              <CheckCircleOutlineIcon color="success" />
              <Box flex={1}>
                <Typography fontWeight={600} color="success.main">Payouts Enabled</Typography>
                <Typography variant="caption" color="text.secondary">Your Stripe Connect account is active and receiving payouts.</Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                endIcon={<OpenInNewIcon />}
                onClick={handleStripeOnboard}
                disabled={onboarding}
              >
                Manage Account
              </Button>
            </Stack>
          ) : stripeStatus?.connected ? (
            <Stack direction="row" alignItems="center" spacing={2}>
              <HourglassEmptyIcon color="warning" />
              <Box flex={1}>
                <Typography fontWeight={600} color="warning.main">Setup Incomplete</Typography>
                <Typography variant="caption" color="text.secondary">Complete your Stripe onboarding to receive payouts.</Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                onClick={handleStripeOnboard}
                disabled={onboarding}
                sx={{ background: 'linear-gradient(90deg,#6a1fcf,#e1129a)' }}
              >
                Continue Setup
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" alignItems="center" spacing={2}>
              <ErrorOutlineIcon color="error" />
              <Box flex={1}>
                <Typography fontWeight={600} color="error.main">Not Connected</Typography>
                <Typography variant="caption" color="text.secondary">Connect your bank account to receive payments for delivered loads.</Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                onClick={handleStripeOnboard}
                disabled={onboarding}
                sx={{ background: 'linear-gradient(90deg,#6a1fcf,#e1129a)' }}
              >
                {onboarding ? 'Redirecting…' : 'Connect Bank Account'}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3} flexWrap="wrap">
        <SummaryCard
          icon={<AccountBalanceWalletIcon />}
          label="Total Earned"
          value={fmt(earned)}
          sub={`from ${payments.filter(p => p.status === 'released').length} loads`}
          color="#3ec17c"
        />
        <SummaryCard
          icon={<HourglassEmptyIcon />}
          label="In Escrow"
          value={fmt(inEscrow)}
          sub="awaiting delivery confirmation"
          color="#ffd86b"
        />
        <SummaryCard
          icon={<CheckCircleOutlineIcon />}
          label="Pending Payments"
          value={pending}
          sub="payment intents not yet captured"
          color="#a082e0"
        />
      </Stack>

      {/* ── Payment History ─────────────────────────────────────────── */}
      <Card sx={{ background: CARD_BG, borderRadius: 3, border: '1px solid rgba(255,255,255,0.10)' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} mb={2}>
            Payment History
            <Typography component="span" variant="body2" color="text.secondary" ml={1}>
              ({total} total)
            </Typography>
          </Typography>

          {loading ? (
            <Stack spacing={1}>
              {[...Array(5)].map((_, i) => <Skeleton key={i} variant="rounded" height={52} />)}
            </Stack>
          ) : payments.length === 0 ? (
            <Box py={4} textAlign="center">
              <AccountBalanceWalletIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
              <Typography color="text.secondary">No payments yet. Complete your first load to see earnings here.</Typography>
            </Box>
          ) : (
            <>
              <TableContainer component={Paper} sx={{ background: GLASS, borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Load</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Route</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }} align="right">Gross</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }} align="right">Your Payout</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payments.map((p) => {
                      const cfg = STATUS_CONFIG[p.status] || { label: p.status, color: 'default' };
                      const load = p.loadId;
                      return (
                        <TableRow key={p._id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {load?.title || 'Unnamed Load'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {load?.origin || '—'} → {load?.destination || '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">{fmt(p.amount)}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title={`Platform fee: ${fmt(p.platformFee)}`}>
                              <Typography variant="body2" fontWeight={700} color="#3ec17c">
                                {fmt(p.carrierPayout)}
                              </Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Chip label={cfg.label} color={cfg.color} size="small" />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {pages > 1 && (
                <Box mt={2} display="flex" justifyContent="center">
                  <Pagination
                    count={pages}
                    page={page}
                    onChange={(_, v) => { setPage(v); fetchPayments(v); }}
                    color="primary"
                  />
                </Box>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
