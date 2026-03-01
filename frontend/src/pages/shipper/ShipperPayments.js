import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, Stack, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Skeleton, Pagination, Divider, Collapse, IconButton,
} from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { surface, chart } from '../../theme/tokens';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const token = () => localStorage.getItem('token');

const STATUS_CONFIG = {
  pending:   { label: 'Pending',    color: 'default' },
  in_escrow: { label: 'In Escrow',  color: 'warning' },
  released:  { label: 'Released',   color: 'success' },
  refunded:  { label: 'Refunded',   color: 'info'    },
  failed:    { label: 'Failed',     color: 'error'   },
};

function SummaryCard({ icon, label, value, sub, color }) {
  return (
    <Card sx={{ flex: 1, minWidth: 160, background: surface.cardBg, borderRadius: 3, border: `1px solid ${surface.glassBorder}` }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
          <Box sx={{ color: color || chart.purple, display: 'flex' }}>{icon}</Box>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={700} color="#fff">{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function InvoiceRow({ payment }) {
  const [open, setOpen] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchInvoice = async () => {
    if (invoice) { setOpen(o => !o); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/payments/invoice/${payment.loadId?._id}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) setInvoice(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
      setOpen(true);
    }
  };

  const load = payment.loadId;
  const cfg  = STATUS_CONFIG[payment.status] || { label: payment.status, color: 'default' };
  const fmt  = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const canViewInvoice = payment.status === 'released' && load?._id;

  return (
    <>
      <TableRow hover>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>{load?.title || 'Unnamed Load'}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary">
            {load?.origin || '—'} → {load?.destination || '—'}
          </Typography>
        </TableCell>
        <TableCell align="right">
          <Typography variant="body2" fontWeight={700}>{fmt(payment.amount)}</Typography>
        </TableCell>
        <TableCell>
          <Chip label={cfg.label} color={cfg.color} size="small" />
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary">
            {new Date(payment.createdAt).toLocaleDateString()}
          </Typography>
        </TableCell>
        <TableCell align="center">
          {canViewInvoice ? (
            <IconButton size="small" onClick={fetchInvoice} title="View Invoice">
              {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          ) : '—'}
        </TableCell>
      </TableRow>

      {canViewInvoice && (
        <TableRow>
          <TableCell colSpan={6} sx={{ py: 0, border: 0 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ p: 2, background: surface.glass, borderRadius: 2, mb: 1 }}>
                {loading ? (
                  <Skeleton variant="rounded" height={80} />
                ) : invoice ? (
                  <Stack spacing={0.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle2" fontWeight={700}>
                        Invoice #{invoice.invoiceNumber}
                      </Typography>
                      <Chip label={invoice.status.toUpperCase()} color="success" size="small" />
                    </Stack>
                    <Divider sx={{ borderColor: surface.glassBorder }} />
                    {invoice.lineItems?.map((li, i) => (
                      <Stack key={i} direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">{li.description}</Typography>
                        <Typography variant="caption">{fmt(li.total)}</Typography>
                      </Stack>
                    ))}
                    <Divider sx={{ borderColor: surface.glassBorder }} />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">Platform Fee (2%)</Typography>
                      <Typography variant="caption">{fmt(invoice.platformFee)}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={700}>Total Paid</Typography>
                      <Typography variant="body2" fontWeight={700} color={chart.green}>{fmt(invoice.total)}</Typography>
                    </Stack>
                    {invoice.issuedAt && (
                      <Typography variant="caption" color="text.secondary">
                        Issued: {new Date(invoice.issuedAt).toLocaleDateString()}
                        {invoice.paidAt && ` · Paid: ${new Date(invoice.paidAt).toLocaleDateString()}`}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} mt={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        Carrier: {invoice.carrierId?.companyName || invoice.carrierId?.name}
                      </Typography>
                    </Stack>
                  </Stack>
                ) : (
                  <Typography variant="caption" color="text.secondary">Invoice not available.</Typography>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ShipperPayments() {
  const [payments, setPayments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => { fetchPayments(1); }, [fetchPayments]);

  const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const totalSpent  = payments.filter(p => p.status === 'released').reduce((s, p) => s + (p.amount || 0), 0);
  const inEscrow    = payments.filter(p => p.status === 'in_escrow').reduce((s, p) => s + (p.amount || 0), 0);
  const completedCt = payments.filter(p => p.status === 'released').length;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={1}>Payments & Invoices</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        View your payment history, escrow status, and invoices for completed loads.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3} flexWrap="wrap">
        <SummaryCard
          icon={<AccountBalanceWalletIcon />}
          label="Total Spent"
          value={fmt(totalSpent)}
          sub={`across ${completedCt} completed loads`}
          color={chart.green}
        />
        <SummaryCard
          icon={<HourglassEmptyIcon />}
          label="In Escrow"
          value={fmt(inEscrow)}
          sub="funds held pending delivery"
          color={chart.gold}
        />
        <SummaryCard
          icon={<ReceiptLongIcon />}
          label="Total Payments"
          value={total}
          sub="all time"
          color={chart.purple}
        />
      </Stack>

      {/* ── Payment History ─────────────────────────────────────────── */}
      <Card sx={{ background: surface.cardBg, borderRadius: 3, border: `1px solid ${surface.glassBorder}` }}>
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
              <Typography color="text.secondary">
                No payments yet. When you pay for a load it will appear here.
              </Typography>
            </Box>
          ) : (
            <>
              <TableContainer component={Paper} sx={{ background: surface.glass, borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Load</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Route</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }} align="right">Amount</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }}>Date</TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontWeight: 700 }} align="center">Invoice</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payments.map((p) => (
                      <InvoiceRow key={p._id} payment={p} />
                    ))}
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
