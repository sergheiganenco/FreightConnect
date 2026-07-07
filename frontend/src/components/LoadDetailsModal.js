// src/components/LoadDetailsModal.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal, Paper, Typography, Button, Stack, DialogActions, Box,
  Divider, TextField, Chip, CircularProgress, Collapse, Alert,
  Tooltip, InputAdornment, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GavelIcon from '@mui/icons-material/Gavel';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PaymentIcon from '@mui/icons-material/Payment';
import LockIcon from '@mui/icons-material/Lock';
import ReceiptIcon from '@mui/icons-material/Receipt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StarIcon from '@mui/icons-material/Star';
import RatingDialog from './RatingDialog';
import FundEscrowDialog from './FundEscrowDialog';
import api from '../services/api';
import { getSocket } from '../services/socket';
import StatusChip from '../features/carrierDashboard/sections/components/StatusChip';
import ReeferMonitorPanel from '../features/shared/ReeferMonitorPanel';
import ReputationBadges from './ReputationBadges';
import {
  brand, status as ST, semantic, severity as SEV, exceptionStatus as EXC_ST,
  bidStatus as BID_ST, surface, text as T, shadow, tint, darkFieldSx, gradient,
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

// Dispute types must match the Load.disputeType enum on the backend.
const DISPUTE_TYPES = [
  { value: 'cargo_damage',           label: 'Cargo Damage' },
  { value: 'short_delivery',         label: 'Short Delivery' },
  { value: 'overcharge',             label: 'Overcharge' },
  { value: 'freight_misdescription', label: 'Freight Misdescription' },
  { value: 'payment',                label: 'Payment Issue' },
  { value: 'service',                label: 'Service Issue' },
  { value: 'general',                label: 'Other / General' },
];

// Detention is NOT carrier-requestable — it is auto-documented from facility
// dwell (see backend detentionBillingService). Carriers request the rest.
const ACCESSORIAL_TYPES = [
  { value: 'lumper',    label: 'Lumper' },
  { value: 'tonu',      label: 'TONU' },
  { value: 'layover',   label: 'Layover' },
  { value: 'other',     label: 'Other' },
];
const REDELIVERY_REASONS = [
  { value: 'receiver_closed',    label: 'Receiver Closed' },
  { value: 'missed_appointment', label: 'Missed Appointment' },
  { value: 'refused',            label: 'Refused' },
];
const ACC_STATUS_COLOR = { pending: semantic.warning, approved: semantic.success, rejected: semantic.error };

const TRUCK_ICON = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/1086/1086933.png',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30],
});

export default function LoadDetailsModal({ load, userRole, onClose, onLoadAccepted }) {
  const [loadState, setLoadState] = useState(load);
  const [route, setRoute] = useState([]);
  const [distance, setDistance] = useState(null);
  const [eta, setEta] = useState(null);
  const [errorMessage, setError] = useState('');
  const [successMessage, setOk] = useState('');
  const [ratingOpen, setRatingOpen] = useState(false);

  // ── Payment state ───────────────────────────────────────────────
  const [payment, setPayment] = useState(null);     // existing payment record
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [fundOpen, setFundOpen] = useState(false);   // Fund Escrow dialog

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
  const [accepting, setAccepting] = useState(false);     // accept request in flight
  const bidSectionRef = useRef(null);                    // scroll target for "Place Bid"

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

  // ── Live carrier location ────────────────────────────────────────
  const [carrierPos, setCarrierPos] = useState(
    loadState.carrierLocation?.latitude ? loadState.carrierLocation : null,
  );

  // Fetch initial carrier location + subscribe to live updates
  useEffect(() => {
    const isTracked = ['accepted', 'in-transit'].includes(loadState.status);
    if (!isTracked) return;

    // Fetch current position
    (async () => {
      try {
        const { data } = await api.get(`/tracking/${loadState._id}`);
        if (data.carrierLocation?.latitude) setCarrierPos(data.carrierLocation);
      } catch { /* non-critical */ }
    })();

    // Listen for live updates
    const socket = getSocket();
    const handler = (data) => {
      if (data.loadId === loadState._id) {
        setCarrierPos({ ...data, updatedAt: data.updatedAt || new Date().toISOString() });
      }
    };
    if (socket) socket.on('carrierLocationUpdate', handler);
    return () => { if (socket) socket.off('carrierLocationUpdate', handler); };
  }, [loadState._id, loadState.status]);

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

  // ── Dispute state ───────────────────────────────────────────────
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [dispType, setDispType] = useState('cargo_damage');
  const [dispReason, setDispReason] = useState('');
  const [dispClaim, setDispClaim] = useState('');
  const [dispFiles, setDispFiles] = useState([]);
  const [dispSaving, setDispSaving] = useState(false);
  const [dispError, setDispError] = useState('');

  // ── Driver assignment state ─────────────────────────────────────
  const [drivers, setDrivers] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [assigningDriver, setAssigningDriver] = useState(false);

  // ── Accessorial state ───────────────────────────────────────────
  const [accType, setAccType] = useState('lumper');
  const [accAmount, setAccAmount] = useState('');
  const [accDesc, setAccDesc] = useState('');
  const [accSaving, setAccSaving] = useState(false);
  const [accBusyId, setAccBusyId] = useState(null);
  const [opError, setOpError] = useState('');

  // ── Reconsignment dialog state ──────────────────────────────────
  const [showReconForm, setShowReconForm] = useState(false);
  const [reconDest, setReconDest] = useState('');
  const [reconReason, setReconReason] = useState('');
  const [reconFee, setReconFee] = useState('');
  const [reconSaving, setReconSaving] = useState(false);

  // ── Redelivery dialog state ─────────────────────────────────────
  const [showRedeliverForm, setShowRedeliverForm] = useState(false);
  const [redelivReason, setRedelivReason] = useState('receiver_closed');
  const [redelivWhen, setRedelivWhen] = useState('');
  const [redelivFee, setRedelivFee] = useState('');
  const [redelivSaving, setRedelivSaving] = useState(false);

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
  }, [loadState._id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Disputes: either party, on in-transit/delivered loads only (matches backend).
  const canDispute = ['in-transit', 'delivered'].includes(loadState.status);

  const handleFileDispute = async () => {
    if (!dispReason.trim()) { setDispError('Please describe the issue.'); return; }
    setDispSaving(true);
    setDispError('');
    try {
      const claimCents = dispClaim ? Math.round(Number(dispClaim) * 100) : 0;
      const { data } = await api.put(`/loads/${loadState._id}/dispute`, {
        reason: dispReason.trim(),
        type: dispType,
        claimAmountCents: claimCents > 0 ? claimCents : undefined,
      });
      // Attach evidence files to the created Exception (non-fatal if it fails).
      if (data?.exceptionId && dispFiles.length > 0) {
        try {
          const fd = new FormData();
          dispFiles.forEach(f => fd.append('files', f));
          await api.post(`/exceptions/${data.exceptionId}/evidence`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (_) { /* dispute already filed — evidence can be re-attached later */ }
      }
      setLoadState(p => ({ ...p, status: 'disputed', disputeReason: dispReason.trim(), disputeType: dispType }));
      setShowDisputeForm(false);
      setDispFiles([]);
      setOk('Dispute filed. Escrow is frozen until an admin resolves it.');
    } catch (err) {
      setDispError(err.response?.data?.error || 'Failed to file dispute.');
    }
    setDispSaving(false);
  };

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

  // ── Role flags ──────────────────────────────────────────────────
  const isOwner = userRole === 'shipper';
  const isCarrier = userRole === 'carrier';
  const isOpen = loadState.status === 'open';

  // ── Operational: load this carrier's accepted load? ─────────────
  const isAssignedLoad = ['accepted', 'in-transit', 'delivered'].includes(loadState.status);
  const accCharges = loadState.accessorialCharges || [];

  // Fetch carrier's drivers (for driver assignment select)
  useEffect(() => {
    if (!isCarrier || !isAssignedLoad) return;
    (async () => {
      try {
        const { data } = await api.get('/drivers');
        const list = Array.isArray(data) ? data : (data.drivers || data.data || []);
        setDrivers(list);
      } catch { /* non-critical */ }
    })();
  }, [isCarrier, isAssignedLoad]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Assign driver ───────────────────────────────────────────────
  const handleAssignDriver = async () => {
    if (!selectedDriver) return;
    setAssigningDriver(true);
    setOpError('');
    try {
      const { data } = await api.put(`/loads/${loadState._id}/assign-driver`, { driverId: selectedDriver });
      const drv = drivers.find((d) => (d._id || d.driverId) === selectedDriver);
      setLoadState((p) => ({
        ...p,
        assignedDriverId: selectedDriver,
        assignedDriverName: data?.assignedDriverName || drv?.name || p.assignedDriverName,
      }));
      setOk('Driver assigned.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to assign driver.');
    }
    setAssigningDriver(false);
  };

  // ── Accessorials ────────────────────────────────────────────────
  const handleRequestAccessorial = async () => {
    const dollars = Number(accAmount);
    if (!dollars || dollars <= 0) { setOpError('Enter a valid amount.'); return; }
    setAccSaving(true);
    setOpError('');
    try {
      const { data } = await api.post(`/loads/${loadState._id}/accessorials`, {
        type: accType,
        description: accDesc.trim(),
        amountCents: Math.round(dollars * 100),
      });
      setLoadState((p) => ({ ...p, accessorialCharges: data?.accessorialCharges || data?.load?.accessorialCharges || [
        ...(p.accessorialCharges || []),
        { _id: data?.charge?._id || Math.random().toString(36), type: accType, description: accDesc.trim(), amountCents: Math.round(dollars * 100), status: 'pending' },
      ] }));
      setAccAmount(''); setAccDesc('');
      setOk('Accessorial requested.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to request accessorial.');
    }
    setAccSaving(false);
  };

  const updateChargeLocal = (chargeId, status) => {
    setLoadState((p) => ({
      ...p,
      accessorialCharges: (p.accessorialCharges || []).map((c) =>
        (c._id || c.id) === chargeId ? { ...c, status } : c),
    }));
  };

  const handleApproveCharge = async (charge) => {
    const chargeId = charge._id || charge.id;
    setAccBusyId(chargeId);
    setOpError('');
    try {
      // Detention is frozen: echo back the exact evidence hash we were shown so
      // the server can reject a stale amount (the chargeback defense).
      const body = charge.source === 'system_detention'
        ? { evidenceHashShown: charge.evidenceHash }
        : {};
      const { data } = await api.put(`/loads/${loadState._id}/accessorials/${chargeId}/approve`, body);
      updateChargeLocal(chargeId, 'approved');
      // Path B: the off-session charge may need bank authentication (SCA).
      setOk(data && data.requiresAction
        ? 'Approved — your bank needs to verify this payment. Complete authentication to finish collecting it.'
        : 'Charge approved.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to approve charge.');
    }
    setAccBusyId(null);
  };

  const handleRejectCharge = async (chargeId) => {
    setAccBusyId(chargeId);
    setOpError('');
    try {
      await api.put(`/loads/${loadState._id}/accessorials/${chargeId}/reject`, { reason: 'Rejected by shipper' });
      updateChargeLocal(chargeId, 'rejected');
      setOk('Charge rejected.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to reject charge.');
    }
    setAccBusyId(null);
  };

  // ── Reconsignment (shipper changes delivery destination) ────────
  const handleReconsign = async () => {
    if (!reconDest.trim()) { setOpError('Enter a new destination.'); return; }
    setReconSaving(true);
    setOpError('');
    try {
      const { data } = await api.put(`/loads/${loadState._id}/reconsign`, {
        newDestination: reconDest.trim(),
        reason: reconReason.trim(),
        feeCents: reconFee ? Math.round(Number(reconFee) * 100) : 0,
      });
      setLoadState((p) => ({
        ...p,
        destination: reconDest.trim(),
        reconsignment: data?.reconsignment || { newDestination: reconDest.trim(), reason: reconReason.trim(), feeCents: reconFee ? Math.round(Number(reconFee) * 100) : 0 },
      }));
      setShowReconForm(false);
      setReconDest(''); setReconReason(''); setReconFee('');
      setOk('Delivery reconsigned.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to reconsign.');
    }
    setReconSaving(false);
  };

  // ── Redelivery ──────────────────────────────────────────────────
  const handleRedeliver = async () => {
    setRedelivSaving(true);
    setOpError('');
    try {
      const { data } = await api.post(`/loads/${loadState._id}/redeliver`, {
        reason: redelivReason,
        rescheduledFor: redelivWhen || undefined,
        feeCents: redelivFee ? Math.round(Number(redelivFee) * 100) : 0,
      });
      setLoadState((p) => ({
        ...p,
        redelivery: data?.redelivery || { ...(p.redelivery || {}), count: ((p.redelivery?.count || 0) + 1) },
      }));
      setShowRedeliverForm(false);
      setRedelivWhen(''); setRedelivFee('');
      setOk('Redelivery reported.');
    } catch (err) {
      setOpError(err.response?.data?.error || 'Failed to report redelivery.');
    }
    setRedelivSaving(false);
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
    setError('');
    setAccepting(true);
    try {
      await api.put(`/loads/${loadState._id}/accept`, {});
      setLoadState((prev) => ({ ...prev, status: 'accepted' }));
      setOk('Load accepted!');
      onLoadAccepted?.(loadState._id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not accept load.');
    } finally {
      setAccepting(false);
    }
  };

  // ── Carrier: jump to the bidding section and open the bid form ──
  const scrollToBidSection = () => {
    setShowBidForm(true);
    // Wait for the form to expand before scrolling it into view.
    setTimeout(() => {
      bidSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
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
  // ── Render ───────────────────────────────────────────────────────
  return (
    <Modal open={!!load} onClose={onClose}
           sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: { xs: 1, md: 2 } }}>
      <Paper role="dialog" aria-modal="true" aria-label={loadState.title || 'Load details'} sx={{
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
          <Stack direction="row" spacing={1} alignItems="center">
            {loadState.delayAlertSentAt && loadState.status === 'in-transit' && (
              <Chip
                label="Running Late"
                size="small"
                sx={{ bgcolor: tint(semantic.error, 0.18), color: semantic.error, fontWeight: 700 }}
              />
            )}
            {loadState.status === 'disputed' && (
              <Chip
                label="Disputed — Escrow Frozen"
                size="small"
                sx={{ bgcolor: tint(semantic.error, 0.18), color: semantic.error, fontWeight: 700 }}
              />
            )}
            {loadState.escrowFunded ? (
              <Chip
                icon={<LockIcon sx={{ fontSize: 14 }} />}
                label="Escrow Funded ✓"
                size="small"
                sx={{ bgcolor: tint(semantic.success, 0.18), color: semantic.success, fontWeight: 700 }}
              />
            ) : (['accepted', 'in-transit'].includes(loadState.status) && (
              <Chip
                label="Escrow Pending"
                size="small"
                sx={{ bgcolor: tint(semantic.warning, 0.18), color: semantic.warning, fontWeight: 700 }}
              />
            ))}
            {userRole === 'shipper' && loadState.status === 'accepted' && !loadState.escrowFunded && (
              <Button
                size="small"
                variant="contained"
                startIcon={<LockIcon sx={{ fontSize: 14 }} />}
                onClick={() => setFundOpen(true)}
                sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700, textTransform: 'none', '&:hover': { bgcolor: '#5558e6' } }}
              >
                Fund Escrow
              </Button>
            )}
            <StatusChip status={loadState.status} />
          </Stack>
        </Box>

        {/* Counterparty Reputation — carriers see shipper, shippers see carrier */}
        {(loadState.postedBy || loadState.acceptedBy) && (
          <ReputationBadges
            userId={userRole === 'carrier' ? (loadState.postedBy?._id || loadState.postedBy) : (loadState.acceptedBy?._id || loadState.acceptedBy)}
            userRole={userRole}
            loadId={loadState._id}
            loadStatus={loadState.status}
          />
        )}

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
            {carrierPos?.latitude && carrierPos?.longitude && (
              <Marker position={[carrierPos.latitude, carrierPos.longitude]} icon={TRUCK_ICON}>
                <Popup>
                  <Typography variant="subtitle2" fontWeight={700}>Carrier Location</Typography>
                  {carrierPos.speed != null && (
                    <Typography variant="caption" display="block">Speed: {carrierPos.speed} km/h</Typography>
                  )}
                  <Typography variant="caption" display="block" sx={{
                    color: carrierPos.updatedAt && (Date.now() - new Date(carrierPos.updatedAt).getTime()) < 120000
                      ? 'green' : 'red',
                  }}>
                    {carrierPos.updatedAt
                      ? `Updated ${Math.round((Date.now() - new Date(carrierPos.updatedAt).getTime()) / 1000)}s ago`
                      : 'No timestamp'}
                  </Typography>
                </Popup>
              </Marker>
            )}
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
          <Box mb={2} ref={bidSectionRef}>
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

        {/* ── Operations: driver, accessorials, reconsign, redelivery ── */}
        {isAssignedLoad && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Operations</Typography>

            {opError && <Alert severity="error" sx={{ mb: 1.5 }}>{opError}</Alert>}

            {/* Driver assignment (carrier) */}
            {isCarrier && (
              <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: surface.indigoTint, border: `1px solid ${surface.indigoBorder}` }}>
                <Typography variant="body2" fontWeight={700} mb={1}>Driver Assignment</Typography>
                {loadState.assignedDriverName && (
                  <Typography variant="body2" sx={{ color: semantic.success, mb: 1 }}>
                    Current: {loadState.assignedDriverName}
                  </Typography>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <FormControl size="small" fullWidth sx={darkFieldSx}>
                    <InputLabel>Select Driver</InputLabel>
                    <Select value={selectedDriver} label="Select Driver" onChange={(e) => setSelectedDriver(e.target.value)}>
                      {drivers.length === 0 && <MenuItem value="" disabled>No drivers on roster</MenuItem>}
                      {drivers.map((d) => (
                        <MenuItem key={d._id || d.driverId} value={d._id || d.driverId}>{d.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    onClick={handleAssignDriver}
                    disabled={!selectedDriver || assigningDriver}
                    sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700, whiteSpace: 'nowrap', '&:hover': { bgcolor: '#5558e6' } }}
                  >
                    {assigningDriver ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Assign Driver'}
                  </Button>
                </Stack>
              </Box>
            )}

            {/* Accessorials */}
            <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: surface.glassSubtle, border: `1px solid ${surface.glassBorder}` }}>
              <Typography variant="body2" fontWeight={700} mb={1}>
                Accessorial Charges {accCharges.length > 0 ? `(${accCharges.length})` : ''}
              </Typography>

              {/* Existing charges */}
              {accCharges.length > 0 ? (
                <Stack spacing={1} mb={isCarrier ? 1.5 : 0}>
                  {accCharges.map((c) => {
                    const cid = c._id || c.id;
                    const cColor = ACC_STATUS_COLOR[c.status] || semantic.muted;
                    return (
                      <Box key={cid} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: surface.glass, border: `1px solid ${surface.glassBorder}` }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                          <Box>
                            <Typography variant="body2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>
                              {c.type} — ${((c.amountCents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Typography>
                            {c.description && (
                              <Typography variant="caption" sx={{ color: T.secondary }}>{c.description}</Typography>
                            )}
                            {c.source === 'system_detention' && c.evidence && (
                              <Box sx={{ mt: 0.75, p: 1, borderRadius: 1, bgcolor: surface.glassSubtle, border: `1px dashed ${surface.glassBorder}` }}>
                                <Typography variant="caption" sx={{ color: T.secondary, fontWeight: 700, display: 'block' }}>
                                  Auto-documented from facility dwell
                                </Typography>
                                <Typography variant="caption" sx={{ color: T.muted, display: 'block' }}>
                                  {c.evidence.facilityName ? `${c.evidence.facilityName} · ` : ''}
                                  dwell {c.evidence.dwellMinutes}m · free {c.evidence.freeMinutes}m · detention {c.evidence.detentionMinutes}m @ ${(((c.evidence.detentionRateCents || 0)) / 100).toFixed(0)}/hr
                                </Typography>
                                {c.evidence.arrivedAt && (
                                  <Typography variant="caption" sx={{ color: T.muted, display: 'block' }}>
                                    Arrived {new Date(c.evidence.arrivedAt).toLocaleString()} → Departed {c.evidence.departedAt ? new Date(c.evidence.departedAt).toLocaleString() : '—'}
                                  </Typography>
                                )}
                                {(c.evidence.dockInAt || c.evidence.dockOutAt) && (
                                  <Typography variant="caption" sx={{ color: T.muted, display: 'block' }}>
                                    Dock in {c.evidence.dockInAt ? new Date(c.evidence.dockInAt).toLocaleTimeString() : '—'} → out {c.evidence.dockOutAt ? new Date(c.evidence.dockOutAt).toLocaleTimeString() : '—'}
                                  </Typography>
                                )}
                              </Box>
                            )}
                          </Box>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Chip label={c.status} size="small"
                              sx={{ bgcolor: tint(cColor, 0.2), color: cColor, fontWeight: 700, fontSize: '0.65rem', textTransform: 'capitalize' }} />
                            {isOwner && c.status === 'pending' && (
                              <>
                                <Button size="small" variant="contained"
                                  disabled={accBusyId === cid}
                                  onClick={() => handleApproveCharge(c)}
                                  sx={{ bgcolor: semantic.success, color: '#000', fontWeight: 700, borderRadius: 9999, py: 0.25, minWidth: 0, px: 1.25, fontSize: '0.7rem' }}>
                                  {accBusyId === cid ? <CircularProgress size={12} /> : 'Approve'}
                                </Button>
                                <Button size="small" variant="outlined" color="error"
                                  disabled={accBusyId === cid}
                                  onClick={() => handleRejectCharge(cid)}
                                  sx={{ borderRadius: 9999, py: 0.25, minWidth: 0, px: 1.25, fontSize: '0.7rem' }}>
                                  Reject
                                </Button>
                              </>
                            )}
                          </Stack>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              ) : (
                <Typography variant="caption" sx={{ color: T.muted, display: 'block', mb: isCarrier ? 1.5 : 0 }}>
                  No accessorial charges yet.
                </Typography>
              )}

              {/* Carrier: request form */}
              {isCarrier && (
                <Stack spacing={1.5} sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.indigoTintLight, border: `1px solid ${surface.indigoBorderLight}` }}>
                  <Typography variant="caption" fontWeight={700} sx={{ color: T.secondary }}>Request Accessorial</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <FormControl size="small" fullWidth sx={darkFieldSx}>
                      <InputLabel>Type</InputLabel>
                      <Select value={accType} label="Type" onChange={(e) => setAccType(e.target.value)}>
                        {ACCESSORIAL_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField
                      size="small" label="Amount" type="number" value={accAmount}
                      onChange={(e) => setAccAmount(e.target.value)}
                      sx={{ ...darkFieldSx, width: { sm: 160 } }}
                      InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                    />
                  </Stack>
                  <TextField size="small" label="Description" fullWidth value={accDesc}
                    onChange={(e) => setAccDesc(e.target.value)} sx={darkFieldSx} placeholder="e.g. 3 hrs detention at receiver" />
                  <Box>
                    <Button variant="contained" onClick={handleRequestAccessorial} disabled={accSaving || !accAmount}
                      sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}>
                      {accSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Submit Request'}
                    </Button>
                  </Box>
                </Stack>
              )}
            </Box>

            {/* Reconsignment (shipper) */}
            {isOwner && ['accepted', 'in-transit'].includes(loadState.status) && (
              <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: surface.glassSubtle, border: `1px solid ${surface.glassBorder}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={showReconForm ? 1.5 : 0}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>Reconsignment</Typography>
                    {loadState.reconsignment?.newDestination && (
                      <Typography variant="caption" sx={{ color: semantic.warning }}>
                        Changed to: {loadState.reconsignment.newDestination}
                      </Typography>
                    )}
                  </Box>
                  <Button size="small" variant={showReconForm ? 'outlined' : 'contained'}
                    onClick={() => setShowReconForm((v) => !v)}
                    sx={{ borderRadius: 9999, fontWeight: 700, fontSize: '0.75rem',
                      bgcolor: showReconForm ? 'transparent' : brand.indigo,
                      borderColor: brand.indigo, color: showReconForm ? brand.indigoLight : '#fff',
                      '&:hover': { bgcolor: showReconForm ? surface.glassSubtle : '#5558e6' } }}>
                    {showReconForm ? 'Cancel' : 'Change Delivery'}
                  </Button>
                </Stack>
                <Collapse in={showReconForm}>
                  <Stack spacing={1.5}>
                    <TextField size="small" label="New Destination" fullWidth value={reconDest}
                      onChange={(e) => setReconDest(e.target.value)} sx={darkFieldSx} placeholder="City, State" />
                    <TextField size="small" label="Reason" fullWidth value={reconReason}
                      onChange={(e) => setReconReason(e.target.value)} sx={darkFieldSx} />
                    <TextField size="small" label="Fee (optional)" type="number" value={reconFee}
                      onChange={(e) => setReconFee(e.target.value)} sx={darkFieldSx}
                      InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
                    <Box>
                      <Button variant="contained" onClick={handleReconsign} disabled={reconSaving || !reconDest.trim()}
                        sx={{ bgcolor: brand.indigo, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#5558e6' } }}>
                        {reconSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Confirm Reconsignment'}
                      </Button>
                    </Box>
                  </Stack>
                </Collapse>
              </Box>
            )}

            {/* Redelivery (carrier or shipper) */}
            {['in-transit', 'delivered'].includes(loadState.status) && (
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.glassSubtle, border: `1px solid ${surface.glassBorder}` }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={showRedeliverForm ? 1.5 : 0}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>Redelivery</Typography>
                    {loadState.redelivery?.count > 0 && (
                      <Typography variant="caption" sx={{ color: semantic.orange }}>
                        Redelivery attempts: {loadState.redelivery.count}
                      </Typography>
                    )}
                  </Box>
                  <Button size="small" variant={showRedeliverForm ? 'outlined' : 'contained'}
                    onClick={() => setShowRedeliverForm((v) => !v)}
                    sx={{ borderRadius: 9999, fontWeight: 700, fontSize: '0.75rem',
                      bgcolor: showRedeliverForm ? 'transparent' : semantic.orange,
                      borderColor: semantic.orange, color: showRedeliverForm ? semantic.orange : '#fff',
                      '&:hover': { bgcolor: showRedeliverForm ? surface.glassSubtle : '#ea6c0d' } }}>
                    {showRedeliverForm ? 'Cancel' : 'Report Redelivery'}
                  </Button>
                </Stack>
                <Collapse in={showRedeliverForm}>
                  <Stack spacing={1.5}>
                    <FormControl size="small" fullWidth sx={darkFieldSx}>
                      <InputLabel>Reason</InputLabel>
                      <Select value={redelivReason} label="Reason" onChange={(e) => setRedelivReason(e.target.value)}>
                        {REDELIVERY_REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField size="small" label="Rescheduled For" type="datetime-local" value={redelivWhen}
                      onChange={(e) => setRedelivWhen(e.target.value)} sx={darkFieldSx} InputLabelProps={{ shrink: true }} />
                    <TextField size="small" label="Fee (optional)" type="number" value={redelivFee}
                      onChange={(e) => setRedelivFee(e.target.value)} sx={darkFieldSx}
                      InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
                    <Box>
                      <Button variant="contained" onClick={handleRedeliver} disabled={redelivSaving}
                        sx={{ bgcolor: semantic.orange, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#ea6c0d' } }}>
                        {redelivSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Submit Redelivery'}
                      </Button>
                    </Box>
                  </Stack>
                </Collapse>
              </Box>
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

        {/* ── Dispute section ── */}
        {loadState.status === 'disputed' && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <Alert severity="error" sx={{ bgcolor: tint(semantic.error, 0.08), color: T.primary }}>
              <Typography variant="body2" fontWeight={700}>
                Dispute filed{loadState.disputeType ? ` — ${String(loadState.disputeType).replace(/_/g, ' ')}` : ''}. Escrow is frozen pending admin resolution.
              </Typography>
              {loadState.disputeReason && (
                <Typography variant="caption" sx={{ color: T.secondary }}>{loadState.disputeReason}</Typography>
              )}
            </Alert>
          </Box>
        )}
        {canDispute && (
          <Box mb={2}>
            <Divider sx={{ mb: 2, borderColor: surface.glassBorder }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <WarningAmberIcon sx={{ color: semantic.error, fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={700}>Dispute</Typography>
              </Stack>
              <Button
                size="small"
                variant={showDisputeForm ? 'outlined' : 'contained'}
                color="error"
                onClick={() => setShowDisputeForm(v => !v)}
                sx={{ borderRadius: 9999, fontSize: '0.78rem', fontWeight: 700 }}
              >
                File Dispute
              </Button>
            </Stack>
            <Collapse in={showDisputeForm}>
              <Stack spacing={1.5} sx={{ p: 2, borderRadius: 2, bgcolor: tint(semantic.error, 0.06), border: `1px solid ${tint(semantic.error, 0.2)}` }}>
                <Typography variant="caption" sx={{ color: T.secondary }}>
                  Filing a dispute freezes escrow until an admin reviews the evidence and resolves it.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <FormControl size="small" fullWidth sx={darkFieldSx}>
                    <InputLabel>Dispute Type</InputLabel>
                    <Select value={dispType} label="Dispute Type" onChange={e => setDispType(e.target.value)}>
                      {DISPUTE_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField
                    label="Claim Amount (optional)" size="small" type="number" fullWidth
                    value={dispClaim} onChange={e => setDispClaim(e.target.value)}
                    sx={darkFieldSx}
                    InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                  />
                </Stack>
                <TextField
                  label="What happened?" size="small" fullWidth multiline minRows={3}
                  value={dispReason} onChange={e => setDispReason(e.target.value)}
                  placeholder="Describe the issue in detail…"
                  sx={darkFieldSx}
                />
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Button component="label" size="small" variant="outlined" sx={{ borderRadius: 9999, fontSize: '0.75rem' }}>
                    Attach Evidence
                    <input
                      type="file" hidden multiple
                      accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                      onChange={e => setDispFiles([...e.target.files].slice(0, 5))}
                    />
                  </Button>
                  <Typography variant="caption" sx={{ color: T.secondary }}>
                    {dispFiles.length > 0 ? `${dispFiles.length} file(s) selected` : 'Photos or PDFs (POD, damage photos) — up to 5'}
                  </Typography>
                </Stack>
                {dispError && <Alert severity="error" sx={{ py: 0 }}>{dispError}</Alert>}
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained" color="error"
                    onClick={handleFileDispute}
                    disabled={dispSaving || !dispReason.trim()}
                    sx={{ borderRadius: 9999, fontWeight: 700 }}
                  >
                    {dispSaving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Submit Dispute'}
                  </Button>
                  <Button variant="text" onClick={() => setShowDisputeForm(false)} sx={{ color: T.secondary }}>
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

        {/* Sticky primary action bar — always reachable without scrolling */}
        <Box
          sx={{
            position: 'sticky',
            bottom: { xs: -24, md: -32 }, // pin to the bottom edge of the scrollable Paper padding
            mx: { xs: -3, md: -4 },
            mt: 2,
            px: { xs: 3, md: 4 },
            py: 2,
            bgcolor: surface.modal,
            backdropFilter: 'blur(18px)',
            borderTop: `1px solid ${surface.glassBorder}`,
            zIndex: 5,
          }}
        >
          {isCarrier && isOpen ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={accepting}
                onClick={acceptLoad}
                sx={{
                  flex: 1,
                  py: 1.4,
                  fontSize: '1rem',
                  fontWeight: 800,
                  textTransform: 'none',
                  borderRadius: 9999,
                  background: gradient.primary,
                  boxShadow: shadow.modal,
                  '&:hover': { background: 'linear-gradient(90deg, #7b2fe0, #f0239f)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.7)' },
                }}
              >
                {accepting
                  ? <CircularProgress size={22} sx={{ color: '#fff' }} />
                  : 'Accept Load'}
              </Button>
              {loadState.allowCarrierBidding && (
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<GavelIcon />}
                  onClick={scrollToBidSection}
                  sx={{
                    py: 1.4,
                    px: 3,
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 9999,
                    whiteSpace: 'nowrap',
                    borderColor: brand.indigoLight,
                    color: brand.indigoLight,
                    '&:hover': { borderColor: brand.indigo, bgcolor: surface.glassSubtle },
                  }}
                >
                  Place Bid
                </Button>
              )}
              <Button
                variant="text"
                onClick={onClose}
                sx={{ color: T.secondary, textTransform: 'none', '&:hover': { bgcolor: surface.glassSubtle } }}
              >
                Close
              </Button>
            </Stack>
          ) : (
            <DialogActions disableSpacing sx={{ p: 0 }}>
              {isCarrier && (
                <Button
                  variant="contained"
                  sx={{ mr: 2, borderRadius: 9999, fontWeight: 700, textTransform: 'none', bgcolor: brand.indigo, '&:hover': { bgcolor: '#5558e6' } }}
                  disabled
                >
                  Accepted
                </Button>
              )}
              {loadState.status === 'delivered' && (
                <Button variant="outlined" color="secondary" onClick={() => setRatingOpen(true)} startIcon={<StarIcon />} sx={{ mr: 2, borderRadius: 9999, textTransform: 'none' }}>
                  Rate {userRole === 'carrier' ? 'Shipper' : 'Carrier'}
                </Button>
              )}
              <Button variant="outlined" onClick={onClose} sx={{ borderRadius: 9999, textTransform: 'none', borderColor: surface.glassBorder, color: T.primary, '&:hover': { borderColor: T.muted, bgcolor: surface.glassSubtle } }}>Close</Button>
            </DialogActions>
          )}
        </Box>

        {/* Dialogs must live INSIDE the single Modal child (Paper), not as
            sibling children of Modal — Modal accepts exactly one child element.
            They portal to <body> regardless of where they're declared. */}
        <RatingDialog
          open={ratingOpen}
          onClose={() => setRatingOpen(false)}
          loadId={load?._id}
          toUserId={userRole === 'carrier' ? load?.postedBy : load?.acceptedBy}
          toRole={userRole === 'carrier' ? 'shipper' : 'carrier'}
          fromRole={userRole}
        />
        <FundEscrowDialog
          open={fundOpen}
          onClose={() => setFundOpen(false)}
          loadId={loadState._id}
          onFunded={() => {
            // Optimistically reflect the funded hold + refresh related panels.
            setLoadState((p) => ({ ...p, escrowFunded: true }));
            setOk('Escrow authorized — funds held. Carrier can roll.');
            if (userRole === 'shipper' && ['accepted', 'in-transit', 'delivered'].includes(loadState.status)) {
              api.get(`/payments/invoice/${loadState._id}`).then(({ data }) => setInvoice(data)).catch(() => {});
            }
          }}
        />
      </Paper>
    </Modal>
  );
}
