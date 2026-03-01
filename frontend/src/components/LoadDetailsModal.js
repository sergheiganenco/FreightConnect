// src/components/LoadDetailsModal.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, Paper, Typography, Button, Stack, DialogActions, Box,
  Divider, TextField, Chip, CircularProgress, Collapse, Alert,
  Tooltip, InputAdornment, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GavelIcon from '@mui/icons-material/Gavel';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PaymentIcon from '@mui/icons-material/Payment';
import LockIcon from '@mui/icons-material/Lock';
import ReceiptIcon from '@mui/icons-material/Receipt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import api from '../services/api';
import { getSocket } from '../services/socket';
import StatusChip from '../features/carrierDashboard/sections/components/StatusChip';
import ReeferMonitorPanel from '../features/shared/ReeferMonitorPanel';
import {
  brand, status as ST, semantic, severity as SEV, exceptionStatus as EXC_ST,
  bidStatus as BID_ST, surface, text as T, shadow, tint, darkFieldSx,
} from '../theme/tokens';

const EXCEPTION_TYPES = [
  { value: 'dispute',        label: 'Dispute' },
  { value: 'delay',          label: 'Delay' },
  { value: 'cargo_damage',   label: 'Cargo Damage' },
  { value: 'missed_pickup',  label: 'Missed Pickup' },
  { value: 'overcharge',     label: 'Overcharge' },
  { value: 'other',          label: 'Other' },
];
const EXCEPTION_SEVERITIES = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];
const CONFIDENCE_COLOR = { high: semantic.success, medium: semantic.warning, low: semantic.muted, none: '#475569' };

export default function LoadDetailsModal({ load, userRole, onClose, onLoadAccepted }) {
  const [loadState, setLoadState] = useState(load);
  const [route, setRoute] = useState([]);
  const [distance, setDistance] = useState(null);
  const [eta, setEta] = useState(null);
  const [errorMessage, setError] = useState('');
  const [successMessage, setOk] = useState('');

  // ── Payment state ───────────────────────────────────────────────
  const [payment, setPayment] = useState(null);     // existing payment record
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [invoice, setInvoice] = useState(null);

  // ── Bidding state ───────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState(null);
  const [suggLoading, setSuggLoading] = useState(false);
  const [bids, setBids] = useState([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [myBid, setMyBid] = useState(null);          // carrier's own bid on this load
  const [bidAmount, setBidAmount] = useState('');
  const [bidMsg, setBidMsg] = useState('');
  const [bidSaving, setBidSaving] = useState(false);
  const [bidError, setBidError] = useState('');
  const [showBids, setShowBids] = useState(false);   // shipper accordion
  const [showBidForm, setShowBidForm] = useState(false); // carrier form toggle
  const [counterInput, setCounterInput] = useState({}); // {[bidId]: amount}

  // ── Multi-stop state ────────────────────────────────────────────
  const [stops, setStops] = useState(loadState.stops || []);
  const [stopUpdating, setStopUpdating] = useState(null); // index being updated

  const fetchStops = useCallback(async () => {
    try {
      const { data } = await api.get(`/loads/${loadState._id}/stops`);
      setStops(data.stops || []);
    } catch { /* non-critical */ }
  }, [loadState._id]);

  useEffect(() => {
    if ((loadState.stops?.length || 0) > 0) fetchStops();
  }, [loadState._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStopStatus = async (idx, status) => {
    setStopUpdating(idx);
    try {
      await api.put(`/loads/${loadState._id}/stops/${idx}/status`, { status });
      fetchStops();
    } catch { /* non-critical */ }
    setStopUpdating(null);
  };

  // ── Exception state ─────────────────────────────────────────────
  const [exceptions, setExceptions] = useState([]);
  const [showExceptions, setShowExceptions] = useState(false);
  const [showExcForm, setShowExcForm] = useState(false);
  const [excType, setExcType] = useState('dispute');
  const [excSeverity, setExcSeverity] = useState('medium');
  const [excTitle, setExcTitle] = useState('');
  const [excDesc, setExcDesc] = useState('');
  const [excClaim, setExcClaim] = useState('');
  const [excSaving, setExcSaving] = useState(false);
  const [excError, setExcError] = useState('');

  // ── Real-time status ────────────────────────────────────────────
  useEffect(() => {
    const handler = ({ loadId, status }) => {
      if (loadId === loadState._id) setLoadState((prev) => ({ ...prev, status }));
    };
    const s = getSocket();
    if (s) s.on('loadStatusUpdated', handler);

    // Bid accepted notification
    const bidHandler = ({ loadId }) => {
      if (loadId === loadState._id) {
        setLoadState((prev) => ({ ...prev, status: 'accepted' }));
        fetchBids();
      }
    };
    if (s) s.on('bid:accepted', bidHandler);

    return () => {
      if (s) s.off('loadStatusUpdated', handler);
      if (s) s.off('bid:accepted', bidHandler);
    };
  }, [loadState._id]);

  // ── Fetch route ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/loads/${loadState._id}/route`);
        if (data?.route) {
          setRoute(data.route.map(([lng, lat]) => [lat, lng]));
          setDistance(data.distance);
          setEta(data.estimatedTime);
        }
      } catch { setError('Failed to fetch route.'); }
    })();
  }, [loadState._id]);

  // ── Fetch payment & invoice status (shippers on accepted+ loads) ─
  useEffect(() => {
    if (userRole !== 'shipper' || !['accepted', 'in-transit', 'delivered'].includes(loadState.status)) return;
    api.get(`/payments/invoice/${loadState._id}`).then(({ data }) => setInvoice(data)).catch(() => {});
  }, [loadState._id, loadState.status, userRole]);

  // ── Rate suggestion ─────────────────────────────────────────────
  useEffect(() => {
    if (loadState.status !== 'open') return;
    setSuggLoading(true);
    api.get(`/bids/rate-suggestion/${loadState._id}`)
      .then(({ data }) => setSuggestion(data))
      .catch(() => {})
      .finally(() => setSuggLoading(false));
  }, [loadState._id, loadState.status]);

  // ── Fetch bids ──────────────────────────────────────────────────
  const fetchBids = useCallback(async () => {
    setBidsLoading(true);
    setBidError('');
    try {
      const { data } = await api.get(`/bids/load/${loadState._id}`);
      setBids(Array.isArray(data) ? data : []);
      if (userRole === 'carrier') {
        const own = (Array.isArray(data) ? data : []).find((b) => b.status !== 'withdrawn');
        setMyBid(own || null);
        if (own) setBidAmount(String(own.counterAmount || own.amount));
      }
    } catch (err) {
      console.error('fetchBids error:', err);
      setBidError('Could not load bid details. Please try refreshing.');
    }
    setBidsLoading(false);
  }, [loadState._id, userRole]);

  useEffect(() => { fetchBids(); }, [fetchBids]);

  // ── Fetch exceptions for this load ─────────────────────────────
  const fetchExceptions = useCallback(async () => {
    try {
      const { data } = await api.get(`/exceptions/load/${loadState._id}`);
      setExceptions(Array.isArray(data) ? data : []);
    } catch { /* non-critical */ }
  }, [loadState._id]);

  const canFileException = ['accepted', 'in-transit', 'delivered'].includes(loadState.status);

  useEffect(() => {
    if (canFileException) fetchExceptions();
  }, [canFileException, fetchExceptions]);

  // ── File a new exception ────────────────────────────────────────
  const handleFileException = async () => {
    if (!excTitle.trim() || !excDesc.trim()) {
      setExcError('Title and description are required.');
      return;
    }
    setExcSaving(true);
    setExcError('');
    try {
      await api.post('/exceptions', {
        loadId: loadState._id,
        type: excType,
        severity: excSeverity,
        title: excTitle.trim(),
        description: excDesc.trim(),
        claimAmount: excClaim ? Number(excClaim) : undefined,
      });
      setExcTitle(''); setExcDesc(''); setExcClaim('');
      setShowExcForm(false);
      setShowExceptions(true);
      fetchExceptions();
      setOk('Exception filed successfully. The other party and admins have been notified.');
    } catch (err) {
      setExcError(err.response?.data?.error || 'Failed to file exception');
    }
    setExcSaving(false);
  };

  // ── Carrier: place / update bid ─────────────────────────────────
  const handlePlaceBid = async () => {
    if (!bidAmount || Number(bidAmount) <= 0) return;
    setBidSaving(true);
    setBidError('');
    try {
      await api.post('/bids', { loadId: loadState._id, amount: Number(bidAmount), message: bidMsg });
      setOk('Bid placed!');
      setShowBidForm(false);
      fetchBids();
    } catch (err) {
      setBidError(err.response?.data?.error || 'Failed to place bid');
    }
    setBidSaving(false);
  };

  // ── Carrier: accept shipper counter ────────────────────────────
  const handleAcceptCounter = async (bidId) => {
    try {
      await api.put(`/bids/${bidId}/accept-counter`);
      setOk('Counter accepted! Load is now yours.');
      fetchBids();
      setLoadState((p) => ({ ...p, status: 'accepted' }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
  };

  // ── Carrier: withdraw ───────────────────────────────────────────
  const handleWithdraw = async (bidId) => {
    try {
      await api.delete(`/bids/${bidId}`);
      setMyBid(null);
      setOk('Bid withdrawn.');
      fetchBids();
    } catch { setError('Failed to withdraw bid'); }
  };

  // ── Shipper: initiate payment ──────────────────────────────────
  const handleInitiatePayment = async () => {
    setPaymentLoading(true);
    setPaymentError('');
    try {
      const { data } = await api.post(`/payments/intent/${loadState._id}`);
      setPayment(data);
      // In production: open Stripe Elements with data.clientSecret
      // For now: show confirmation that intent was created
      setOk('Payment authorized and held in escrow. Funds release automatically on delivery.');
    } catch (err) {
      setPaymentError(err.response?.data?.error || 'Failed to initiate payment');
    }
    setPaymentLoading(false);
  };

  // ── Direct accept (no bid negotiation) ─────────────────────────
  const acceptLoad = async () => {
    try {
      await api.put(`/loads/${loadState._id}/accept`, {});
      setLoadState((prev) => ({ ...prev, status: 'accepted' }));
      setOk('Load accepted!');
      onLoadAccepted?.(loadState._id);
    } catch (err) { setError(err.response?.data?.error || 'Could not accept load.'); }
  };

  // ── Shipper: accept bid ─────────────────────────────────────────
  const handleAcceptBid = async (bidId) => {
    try {
      const { data } = await api.put(`/bids/${bidId}/accept`);
      setOk(`Bid accepted at $${data.finalAmount?.toLocaleString()}!`);
      setLoadState((p) => ({ ...p, status: 'accepted' }));
      onLoadAccepted?.(loadState._id);
      fetchBids();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept bid');
    }
  };

  // ── Shipper: reject bid ─────────────────────────────────────────
  const handleRejectBid = async (bidId) => {
    try {
      await api.put(`/bids/${bidId}/reject`);
      fetchBids();
    } catch { setError('Failed to reject bid'); }
  };

  // ── Shipper: counter bid ────────────────────────────────────────
  const handleCounterBid = async (bidId) => {
    const amt = counterInput[bidId];
    if (!amt || Number(amt) <= 0) return;
    try {
      await api.put(`/bids/${bidId}/counter`, { counterAmount: Number(amt) });
      setCounterInput((p) => ({ ...p, [bidId]: '' }));
      fetchBids();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to counter');
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────
  const fmt = (d) => d
    ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'TBD';

  const pickup = loadState.pickupTimeWindow?.start || loadState.pickupStart
    ? `${fmt(loadState.pickupTimeWindow?.start || loadState.pickupStart)} → ${fmt(loadState.pickupTimeWindow?.end || loadState.pickupEnd)}`
    : 'TBD';

  const delivery = loadState.deliveryTimeWindow?.start || loadState.deliveryStart
    ? `${fmt(loadState.deliveryTimeWindow?.start || loadState.deliveryStart)} → ${fmt(loadState.deliveryTimeWindow?.end || loadState.deliveryEnd)}`
    : 'TBD';

  const pendingBids = bids.filter((b) => ['pending', 'countered'].includes(b.status));
  const isOwner = userRole === 'shipper';
  const isCarrier = userRole === 'carrier';
  const isOpen = loadState.status === 'open';

  // ── Render ───────────────────────────────────────────────────────
  return (
    <Modal open={!!load} onClose={onClose}
           sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: { xs: 1, md: 2 } }}>
      <Paper sx={{
        p: { xs: 3, md: 4 },
        maxWidth: 960,
        width: '100%',
        maxHeight: '94vh',
        overflowY: 'auto',
        borderRadius: 4,
        bgcolor: surface.modal,
        color: T.primary,
        border: `1.5px solid ${surface.indigoGlow}`,
        boxShadow: shadow.modal,
        backdropFilter: 'blur(24px)',
        '& strong': { color: T.strong },
      }}>

        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
          <Box>
            <Typography variant="h5" fontWeight={800} letterSpacing={0.5}>{loadState.title || 'Load Details'}</Typography>
            <Typography variant="body2" sx={{ color: T.secondary, mt: 0.5 }}>
              {loadState.origin} → {loadState.destination}
            </Typography>
          </Box>
          <StatusChip status={loadState.status} />
        </Box>

        {/* Rate + suggestion */}
        <Stack direction="row" alignItems="center" spacing={2} mb={2}
               sx={{ bgcolor: surface.indigoTint, borderRadius: 2, px: 2, py: 1.5 }}>
          <Typography variant="h5" fontWeight={900} sx={{ color: brand.indigoLight }}>
            ${loadState.rate?.toLocaleString()}
          </Typography>
          {suggestion && !suggLoading && suggestion.suggested && (
            <Tooltip
              title={`Basis: ${suggestion.basis}`}
              arrow
            >
              <Chip
                icon={<TrendingUpIcon sx={{ fontSize: 14 }} />}
                label={`Market: $${suggestion.min?.toLocaleString()}–$${suggestion.max?.toLocaleString()}`}
                size="small"
                sx={{
                  bgcolor: `${CONFIDENCE_COLOR[suggestion.confidence]}22`,
                  color: CONFIDENCE_COLOR[suggestion.confidence],
                  fontWeight: 600,
                  fontSize: '0.72rem',
                  cursor: 'help',
                }}
              />
            </Tooltip>
          )}
          {suggLoading && <CircularProgress size={14} />}
        </Stack>

        {/* Details grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
          mb: 2,
          bgcolor: surface.glassSubtle,
          borderRadius: 2,
          p: 2,
        }}>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Origin</Typography>
            <Typography fontWeight={600}>{loadState.origin}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Destination</Typography>
            <Typography fontWeight={600}>{loadState.destination}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Equipment</Typography>
            <Typography fontWeight={600}>{loadState.equipmentType}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Weight</Typography>
            <Typography fontWeight={600}>{loadState.loadWeight ? `${Number(loadState.loadWeight).toLocaleString()} lbs` : 'N/A'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Pickup Window</Typography>
            <Typography fontWeight={600}>{pickup}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Delivery Window</Typography>
            <Typography fontWeight={600}>{delivery}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Distance</Typography>
            <Typography fontWeight={600}>{distance ? `${distance} miles` : 'Calculating\u2026'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>ETA</Typography>
            <Typography fontWeight={600}>{eta ? `${eta} hours` : 'Calculating\u2026'}</Typography>
          </Box>
          {loadState.commodityType && (
            <Box>
              <Typography variant="caption" sx={{ color: T.muted, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>Commodity</Typography>
              <Typography fontWeight={600}>{loadState.commodityType}</Typography>
            </Box>
          )}
        </Box>

        {/* Overweight alert */}
        {loadState.overweightAcknowledged && (
          <Alert severity="warning" variant="outlined"
            sx={{ mt: 1.5, bgcolor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)',
              '& .MuiAlert-message': { color: '#fff' } }}>
            <Typography variant="body2" fontWeight={700} sx={{ color: '#ef4444' }}>
              Overweight Load — Permit {loadState.overweightPermitNumber ? `#${loadState.overweightPermitNumber}` : 'Required'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              This load exceeds the standard {loadState.equipmentType} weight limit. Shipper has acknowledged an overweight/oversize permit is required.
            </Typography>
          </Alert>
        )}

        {/* Map */}
        {route.length ? (
          <MapContainer center={route[0]} zoom={6}
                        style={{ height: 360, width: '100%', marginBottom: 16, borderRadius: 8 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={route[0]} />
            <Marker position={route[route.length - 1]} />
            <Polyline positions={route} color="#6366f1" weight={3} />
          </MapContainer>
        ) : (
          <Typography sx={{ mb: 2, color: T.muted }}>No route data available.</Typography>
        )}

        <Divider sx={{ my: 2, borderColor: surface.glassBorder }} />

        {/* ── Multi-Stop Progress ── */}
        {stops.length > 0 && (
          <Box mb={2}>
            <Typography variant="subtitle1" fontWeight={700} mb={1.5}>
              Stops ({stops.length})
            </Typography>
            <Box sx={{ position: 'relative', pl: 3 }}>
              {/* Vertical line */}
              <Box sx={{
                position: 'absolute', left: 10, top: 6, bottom: 6,
                width: 2, bgcolor: surface.indigoBorderLight, borderRadius: 1,
              }} />

              {stops.map((stop, idx) => {
                const STOP_COLOR = {
                  pending:   semantic.muted,
                  arrived:   semantic.warning,
                  departed:  semantic.success,
                  skipped:   ST.disputed,
                };
                const color = STOP_COLOR[stop.status] || semantic.muted;
                return (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', mb: 2, position: 'relative' }}>
                    {/* Stop dot */}
                    <Box sx={{
                      position: 'absolute', left: -18, top: 4,
                      width: 16, height: 16, borderRadius: '50%',
                      bgcolor: color, border: '2px solid #fff',
                      boxShadow: `0 0 0 2px ${color}44`,
                      flexShrink: 0,
                    }} />
                    <Box flex={1}>
                      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
                        <Typography variant="body2" fontWeight={700}>
                          Stop {stop.sequence} — {stop.type === 'pickup' ? 'Pickup' : 'Delivery'}
                        </Typography>
                        <Chip
                          label={stop.status}
                          size="small"
                          sx={{
                            bgcolor: `${color}22`, color, fontWeight: 700,
                            fontSize: '0.65rem', textTransform: 'capitalize',
                          }}
                        />
                      </Stack>
                      <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                        {stop.address}
                      </Typography>
                      {stop.timeWindow?.start && (
                        <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                          Window: {new Date(stop.timeWindow.start).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                          {stop.timeWindow.end && ` → ${new Date(stop.timeWindow.end).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`}
                        </Typography>
                      )}
                      {stop.contactName && (
                        <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                          Contact: {stop.contactName}{stop.contactPhone ? ` · ${stop.contactPhone}` : ''}
                        </Typography>
                      )}
                      {stop.arrivedAt && (
                        <Typography variant="caption" sx={{ color: semantic.warning, display: 'block' }}>
                          Arrived: {new Date(stop.arrivedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </Typography>
                      )}
                      {stop.departedAt && (
                        <Typography variant="caption" sx={{ color: semantic.success, display: 'block' }}>
                          Departed: {new Date(stop.departedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </Typography>
                      )}

                      {/* Carrier actions */}
                      {isCarrier && ['accepted', 'in-transit'].includes(loadState.status) && stop.status !== 'departed' && stop.status !== 'skipped' && (
                        <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
                          {stop.status === 'pending' && (
                            <Button
                              size="small" variant="outlined"
                              disabled={stopUpdating === idx}
                              onClick={() => handleStopStatus(idx, 'arrived')}
                              sx={{ fontSize: '0.72rem', borderRadius: 9999, borderColor: semantic.warning, color: semantic.warning, py: 0.25 }}
                            >
                              {stopUpdating === idx ? <CircularProgress size={12} /> : 'Mark Arrived'}
                            </Button>
                          )}
                          {stop.status === 'arrived' && (
                            <Button
                              size="small" variant="outlined"
                              disabled={stopUpdating === idx}
                              onClick={() => handleStopStatus(idx, 'departed')}
                              sx={{ fontSize: '0.72rem', borderRadius: 9999, borderColor: semantic.success, color: semantic.success, py: 0.25 }}
                            >
                              {stopUpdating === idx ? <CircularProgress size={12} /> : 'Mark Departed'}
                            </Button>
                          )}
                          <Button
                            size="small" variant="text"
                            disabled={stopUpdating === idx}
                            onClick={() => handleStopStatus(idx, 'skipped')}
                            sx={{ fontSize: '0.72rem', borderRadius: 9999, color: semantic.muted, py: 0.25 }}
                          >
                            Skip
                          </Button>
                        </Stack>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            <Divider sx={{ mt: 1, borderColor: surface.glassBorder }} />
          </Box>
        )}

        {/* ── Carrier bidding section ── */}
        {isCarrier && isOpen && (
          <Box mb={2}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
              <GavelIcon sx={{ fontSize: 18, color: brand.indigoLight }} />
              <Typography variant="subtitle1" fontWeight={700}>Bidding</Typography>
              {bidsLoading && <CircularProgress size={16} sx={{ ml: 1 }} />}
            </Stack>

            {bidError && <Alert severity="error" sx={{ mb: 1.5 }}>{bidError}</Alert>}

            {/* Existing bid status */}
            {myBid && (
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.indigoTint, border: `1px solid ${surface.indigoBorder}`, mb: 1.5 }}>
                <Typography variant="body2" fontWeight={700}>
                  Your bid: ${myBid.amount?.toLocaleString()} — <span style={{ textTransform: 'capitalize' }}>{myBid.status}</span>
                </Typography>
                {myBid.status === 'countered' && (
                  <>
                    <Typography variant="body2" sx={{ color: semantic.warning, mt: 0.5 }}>
                      Shipper countered: ${myBid.counterAmount?.toLocaleString()}
                    </Typography>
                    <Stack direction="row" spacing={1} mt={1}>
                      <Button size="small" variant="contained"
                              sx={{ bgcolor: semantic.success, color: '#000', fontWeight: 700, borderRadius: 9999 }}
                              onClick={() => handleAcceptCounter(myBid._id)}>
                        Accept Counter
                      </Button>
                      <Button size="small" variant="outlined" color="error"
                              sx={{ borderRadius: 9999 }}
                              onClick={() => handleWithdraw(myBid._id)}>
                        Withdraw
                      </Button>
                    </Stack>
                  </>
                )}
                {myBid.status === 'pending' && (
                  <Button size="small" variant="text" color="error" sx={{ mt: 0.5 }}
                          onClick={() => handleWithdraw(myBid._id)}>
                    Withdraw bid
                  </Button>
                )}
              </Box>
            )}

            {/* Bid form */}
            {(!myBid || myBid.status === 'rejected' || myBid.status === 'withdrawn') && (
              <>
                <Button
                  size="small"
                  variant={showBidForm ? 'outlined' : 'contained'}
                  startIcon={<GavelIcon />}
                  onClick={() => setShowBidForm((v) => !v)}
                  endIcon={showBidForm ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ borderRadius: 9999, bgcolor: showBidForm ? 'transparent' : brand.indigo, mb: 1 }}
                >
                  {myBid ? 'Place New Bid' : 'Place a Bid'}
                </Button>
                <Collapse in={showBidForm}>
                  <Stack spacing={1.5} sx={{ mt: 1, p: 2, borderRadius: 2, bgcolor: surface.indigoTintLight, border: `1px solid ${surface.indigoBorderLight}` }}>
                    {suggestion?.suggested && (
                      <Typography variant="caption" sx={{ color: T.secondary }}>
                        Suggested market rate: ${suggestion.suggested.toLocaleString()} · Click to pre-fill
                        <Button size="small" sx={{ ml: 1, p: 0, minWidth: 0, textDecoration: 'underline' }}
                                onClick={() => setBidAmount(String(suggestion.suggested))}>
                          Use
                        </Button>
                      </Typography>
                    )}
                    <TextField
                      label="Your bid amount"
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      size="small"
                      sx={darkFieldSx}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                      }}
                    />
                    <TextField
                      label="Note (optional)"
                      value={bidMsg}
                      onChange={(e) => setBidMsg(e.target.value)}
                      size="small"
                      multiline
                      maxRows={2}
                      placeholder="Why should they choose you?"
                      sx={darkFieldSx}
                    />
                    {bidError && <Alert severity="error" sx={{ py: 0 }}>{bidError}</Alert>}
                    <Button
                      variant="contained"
                      onClick={handlePlaceBid}
                      disabled={bidSaving || !bidAmount}
                      sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700 }}
                    >
                      {bidSaving ? <CircularProgress size={18} /> : 'Submit Bid'}
                    </Button>
                  </Stack>
                </Collapse>
              </>
            )}
          </Box>
        )}

        {/* ── Shipper: view bids ── */}
        {isOwner && (
          <Box mb={2}>
            <Button
              variant="text"
              startIcon={<GavelIcon />}
              endIcon={showBids ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setShowBids((v) => !v)}
              sx={{ fontWeight: 700, mb: 1 }}
            >
              Bids ({pendingBids.length} active{bids.length > pendingBids.length ? `, ${bids.length - pendingBids.length} resolved` : ''})
            </Button>
            <Collapse in={showBids}>
              {bidsLoading && <CircularProgress size={20} />}
              {bidError && <Alert severity="error" sx={{ mb: 1 }}>{bidError}</Alert>}
              {!bidsLoading && bids.length === 0 && !bidError && (
                <Typography variant="body2" sx={{ color: T.muted, pl: 1 }}>
                  No bids yet.
                </Typography>
              )}
              {bids.map((bid) => (
                <Box key={bid._id}
                     sx={{ p: 2, mb: 1, borderRadius: 2, border: `1px solid ${surface.glassBorder}`, bgcolor: surface.glassLight }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="body2" fontWeight={700}>
                        {bid.carrierId?.companyName || bid.carrierId?.name} — ${bid.amount?.toLocaleString()}
                      </Typography>
                      {bid.message && (
                        <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                          "{bid.message}"
                        </Typography>
                      )}
                      <Chip
                        label={bid.status}
                        size="small"
                        sx={{
                          mt: 0.5,
                          bgcolor: tint(BID_ST[bid.status] || BID_ST.pending, 0.13),
                          color: BID_ST[bid.status] || BID_ST.pending,
                          fontWeight: 700,
                          textTransform: 'capitalize',
                          fontSize: '0.68rem',
                        }}
                      />
                    </Box>
                    {isOpen && ['pending', 'countered'].includes(bid.status) && (
                      <Stack spacing={1} alignItems="flex-end">
                        {bid.status !== 'countered' && (
                          <>
                            <Stack direction="row" spacing={0.75}>
                              <Button size="small" variant="contained"
                                      sx={{ bgcolor: semantic.success, color: '#000', fontWeight: 700, borderRadius: 9999, fontSize: '0.72rem' }}
                                      onClick={() => handleAcceptBid(bid._id)}>
                                Accept
                              </Button>
                              <Button size="small" variant="outlined" color="error"
                                      sx={{ borderRadius: 9999, fontSize: '0.72rem' }}
                                      onClick={() => handleRejectBid(bid._id)}>
                                Reject
                              </Button>
                            </Stack>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <TextField
                                size="small"
                                placeholder="Counter $"
                                type="number"
                                value={counterInput[bid._id] || ''}
                                onChange={(e) => setCounterInput((p) => ({ ...p, [bid._id]: e.target.value }))}
                                sx={{ width: 110, ...darkFieldSx }}
                                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                              />
                              <Button size="small" variant="outlined"
                                      sx={{ borderRadius: 9999, fontSize: '0.72rem', borderColor: semantic.warning, color: semantic.warning }}
                                      onClick={() => handleCounterBid(bid._id)}>
                                Counter
                              </Button>
                            </Stack>
                          </>
                        )}
                        {bid.status === 'countered' && (
                          <Typography variant="caption" sx={{ color: semantic.warning }}>
                            Awaiting carrier response to ${bid.counterAmount?.toLocaleString()}
                          </Typography>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Box>
              ))}
            </Collapse>
          </Box>
        )}

        {/* ── Shipper: payment panel ── */}
        {isOwner && loadState.status === 'accepted' && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
              <PaymentIcon sx={{ color: brand.indigo }} />
              <Typography variant="subtitle1" fontWeight={700}>Payment</Typography>
            </Stack>
            {invoice ? (
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: tint(semantic.success, 0.08), border: `1px solid ${tint(semantic.success, 0.25)}` }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                  <ReceiptIcon sx={{ color: semantic.success, fontSize: 18 }} />
                  <Typography fontWeight={700} sx={{ color: semantic.success }}>
                    Invoice {invoice.invoiceNumber} — {invoice.status.toUpperCase()}
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: T.secondary }}>
                  Total: ${invoice.total?.toLocaleString()} · Paid: {invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : 'Pending'}
                </Typography>
              </Box>
            ) : payment ? (
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: surface.indigoTint, border: `1px solid ${surface.indigoBorder}` }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <LockIcon sx={{ color: brand.indigo, fontSize: 18 }} />
                  <Typography variant="body2" fontWeight={700} sx={{ color: brand.indigo }}>
                    ${loadState.rate?.toLocaleString()} held in escrow — releases automatically on delivery
                  </Typography>
                </Stack>
              </Box>
            ) : (
              <Stack spacing={1}>
                <Typography variant="body2" sx={{ color: T.secondary }}>
                  Secure your load by placing the payment in escrow. Funds are released to the carrier only after delivery is confirmed.
                </Typography>
                {paymentError && <Alert severity="error" sx={{ py: 0 }}>{paymentError}</Alert>}
                <Button
                  variant="contained"
                  startIcon={paymentLoading ? <CircularProgress size={16} /> : <LockIcon />}
                  disabled={paymentLoading}
                  onClick={handleInitiatePayment}
                  sx={{ alignSelf: 'flex-start', bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700 }}
                >
                  {paymentLoading ? 'Processing…' : `Pay $${loadState.rate?.toLocaleString()} into Escrow`}
                </Button>
              </Stack>
            )}
          </Box>
        )}

        {/* ── Exceptions section ── */}
        {canFileException && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <WarningAmberIcon sx={{ color: semantic.orange, fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={700}>
                  Exceptions {exceptions.length > 0 ? `(${exceptions.length})` : ''}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1}>
                {exceptions.length > 0 && (
                  <Button
                    size="small" variant="text"
                    endIcon={showExceptions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => setShowExceptions(v => !v)}
                    sx={{ color: T.secondary, fontSize: '0.78rem' }}
                  >
                    {showExceptions ? 'Hide' : 'View'}
                  </Button>
                )}
                <Button
                  size="small"
                  variant={showExcForm ? 'outlined' : 'contained'}
                  startIcon={<WarningAmberIcon />}
                  onClick={() => setShowExcForm(v => !v)}
                  sx={{
                    borderRadius: 9999, fontSize: '0.78rem', fontWeight: 700,
                    bgcolor: showExcForm ? 'transparent' : semantic.orange,
                    borderColor: semantic.orange, color: showExcForm ? semantic.orange : T.primary,
                    '&:hover': { bgcolor: showExcForm ? tint(semantic.orange, 0.08) : '#ea6c0d' },
                  }}
                >
                  File Exception
                </Button>
              </Stack>
            </Stack>

            {/* Existing exceptions list */}
            <Collapse in={showExceptions && exceptions.length > 0}>
              <Stack spacing={1} mb={1.5}>
                {exceptions.map(exc => (
                  <Box key={exc._id} sx={{
                    p: 1.5, borderRadius: 2, border: `1px solid ${SEV[exc.severity]}44`,
                    bgcolor: `${SEV[exc.severity]}0a`,
                  }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                      <Typography variant="body2" fontWeight={700}>{exc.title}</Typography>
                      <Stack direction="row" spacing={0.5}>
                        <Chip label={exc.severity} size="small"
                              sx={{ bgcolor: `${SEV[exc.severity]}22`, color: SEV[exc.severity], fontWeight: 700, fontSize: '0.65rem', textTransform: 'capitalize' }} />
                        <Chip label={exc.status} size="small"
                              sx={{ bgcolor: `${EXC_ST[exc.status]}22`, color: EXC_ST[exc.status], fontWeight: 700, fontSize: '0.65rem', textTransform: 'capitalize' }} />
                      </Stack>
                    </Stack>
                    <Typography variant="caption" sx={{ color: T.secondary, display: 'block', mt: 0.25 }}>
                      {exc.type.replace('_', ' ')} · Filed {new Date(exc.createdAt).toLocaleDateString()}
                    </Typography>
                    {exc.description && (
                      <Typography variant="caption" sx={{ color: T.secondary, display: 'block', mt: 0.5 }}>
                        {exc.description.length > 120 ? exc.description.slice(0, 120) + '…' : exc.description}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Collapse>

            {/* File exception form */}
            <Collapse in={showExcForm}>
              <Stack spacing={1.5} sx={{ p: 2, borderRadius: 2, bgcolor: tint(semantic.orange, 0.06), border: `1px solid ${tint(semantic.orange, 0.2)}` }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <FormControl size="small" fullWidth sx={darkFieldSx}>
                    <InputLabel>Type</InputLabel>
                    <Select value={excType} label="Type" onChange={e => setExcType(e.target.value)}>
                      {EXCEPTION_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth sx={darkFieldSx}>
                    <InputLabel>Severity</InputLabel>
                    <Select value={excSeverity} label="Severity" onChange={e => setExcSeverity(e.target.value)}>
                      {EXCEPTION_SEVERITIES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Stack>
                <TextField
                  label="Title" size="small" fullWidth
                  value={excTitle} onChange={e => setExcTitle(e.target.value)}
                  placeholder="Brief summary of the issue"
                  sx={darkFieldSx}
                />
                <TextField
                  label="Description" size="small" fullWidth multiline minRows={3}
                  value={excDesc} onChange={e => setExcDesc(e.target.value)}
                  placeholder="Describe the issue in detail…"
                  sx={darkFieldSx}
                />
                {['dispute', 'cargo_damage', 'overcharge'].includes(excType) && (
                  <TextField
                    label="Claim Amount (optional)" size="small" type="number"
                    value={excClaim} onChange={e => setExcClaim(e.target.value)}
                    sx={darkFieldSx}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                )}
                {excError && <Alert severity="error" sx={{ py: 0 }}>{excError}</Alert>}
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={handleFileException}
                    disabled={excSaving || !excTitle.trim() || !excDesc.trim()}
                    sx={{ bgcolor: semantic.orange, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#ea6c0d' } }}
                  >
                    {excSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Submit Exception'}
                  </Button>
                  <Button variant="text" onClick={() => setShowExcForm(false)} sx={{ color: T.secondary }}>
                    Cancel
                  </Button>
                </Stack>
              </Stack>
            </Collapse>
          </Box>
        )}

        {/* ── Reefer Temperature Monitor ── */}
        {loadState.reefer?.enabled && ['accepted', 'in-transit', 'delivered'].includes(loadState.status) && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <ReeferMonitorPanel
              loadId={loadState._id}
              role={userRole}
              reefer={loadState.reefer}
            />
          </Box>
        )}

        {/* Messages */}
        {successMessage && <Alert severity="success" sx={{ mb: 1 }}>{successMessage}</Alert>}
        {errorMessage && <Alert severity="error" sx={{ mb: 1 }}>{errorMessage}</Alert>}

        {/* Footer actions */}
        <DialogActions disableSpacing sx={{ position: 'sticky', bottom: 0, bgcolor: surface.modal, pt: 2, borderTop: `1px solid ${surface.glassBorder}` }}>
          {isCarrier && (
            <Button
              variant="contained"
              sx={{ mr: 2, bgcolor: brand.indigo, '&:hover': { bgcolor: '#5558e6' } }}
              disabled={loadState.status !== 'open'}
              onClick={acceptLoad}
            >
              {loadState.status === 'open' ? 'Accept at Listed Rate' : 'Accepted'}
            </Button>
          )}
          <Button variant="outlined" onClick={onClose} sx={{ borderColor: surface.glassBorder, color: T.primary, '&:hover': { borderColor: T.muted, bgcolor: surface.glassSubtle } }}>Close</Button>
        </DialogActions>
      </Paper>
    </Modal>
  );
}
