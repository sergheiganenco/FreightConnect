// ── src/pages/CarrierMyLoads.js ─────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Typography,
  Box,
  Paper,
  Grid,
  Snackbar,
  Alert,
  Button,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Skeleton,
} from '@mui/material';
import api from '../../services/api';
import StatusChip from '../../features/carrierDashboard/sections/components/StatusChip';
import LoadDetailsModal from '../../components/LoadDetailsModal';
import PickupWindowPanel from '../../features/shared/PickupWindowPanel';
import ReturnLoadSuggestions from '../../components/ReturnLoadSuggestions';
import PickupRiskPanel from '../../features/shared/PickupRiskPanel';
import SignaturePad from '../../components/SignaturePad';
import ProofOfDeliveryDialog from '../../features/shared/ProofOfDeliveryDialog';
import { glassCard, radius } from '../../theme/tokens';

// Short date like the load board ("Nov 12, 8:00 AM"); a window shows its end time too.
const fmtShort = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtWindow = (w) => (w?.end ? `${fmtShort(w.start)} - ${fmtShort(w.end)}` : fmtShort(w.start));

// Loads someone else booked where this carrier had a bid: "You're on standby" with an opt-out.
function StandbyBids() {
  const [bids, setBids] = useState([]);
  const load = useCallback(() => {
    api.get('/bids/my')
      .then(({ data }) => setBids(data.filter((b) => b.standby?.rank && !b.standby.optedOut && b.loadId?.status === 'accepted')))
      .catch(() => setBids([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!bids.length) return null;
  return (
    <Box mb={2}>
      {bids.map((b) => (
        <Alert key={b._id} severity="info" sx={{ mb: 1 }}
          action={<Button color="inherit" size="small" onClick={async () => { try { await api.put(`/bids/${b._id}/standby-opt-out`); } catch { /* shown again on reload */ } load(); }}>Don't keep me on standby</Button>}>
          You're on standby for {b.loadId.origin} → {b.loadId.destination}. If the booked carrier falls through you'll be notified; you are never booked automatically.
        </Alert>
      ))}
    </Box>
  );
}

export default function CarrierMyLoads({ embedded = false }) {
  /* ── state ────────────────────────────────────────────────── */
  const [loads, setLoads] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snack, setSnack] = useState(false);

  // state for modal
  const [selected, setSelected] = useState(null);
  // Pickup e-signature pad (opened when a load transitions to in-transit)
  const [sigPad, setSigPad] = useState({ open: false, loadId: null });
  // Proof-of-delivery dialog: the server refuses 'delivered' without a POD on the load
  const [podLoad, setPodLoad] = useState(null);
  // Load that cannot start yet because its pickup handshake is required but unverified
  const [blocked, setBlocked] = useState(null);
  // Blocking explanation shown inside the modal (and on the page): { text, focus: 'photos' | 'pickup' }
  const [notice, setNotice] = useState(null);

  /* ── fetch loads once ─────────────────────────────────────── */
  const fetchLoads = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const { data } = await api.get('/loads/my-loads', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLoads(data);
    } catch (err) {
      setError('Failed to fetch loads. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLoads(); }, [fetchLoads]);

  /* ── sort helper ──────────────────────────────────────────── */
  const sortLoads = (list) => {
    const rank = { accepted: 0, 'in-transit': 1, delivered: 2 };
    return [...list].sort((a, b) => {
      const rA = rank[a.status] ?? 99;
      const rB = rank[b.status] ?? 99;
      if (rA !== rB) return rA - rB;
      if (a.status === 'delivered' && b.status === 'delivered') {
        const dateA = new Date(a.deliveredAt || a.updatedAt || 0).getTime();
        const dateB = new Date(b.deliveredAt || b.updatedAt || 0).getTime();
        return dateB - dateA;
      }
      return 0;
    });
  };

  /* ── filtered + sorted list (memoised) ────────────────────── */
  const viewLoads = useMemo(() => {
    const base =
      statusFilter === 'all'
        ? loads
        : loads.filter((l) => l.status === statusFilter);
    return sortLoads(base);
  }, [loads, statusFilter]);

  /* ── apply a status change (the actual PUT) ───────────────── */
  const applyStatus = async (id, newStatus) => {
    setError(null);
    try {
      const token = localStorage.getItem('token');
      await api.put(
        `/loads/${id}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLoads((prev) =>
        prev.map((l) =>
          l._id === id
            ? { ...l, status: newStatus, updatedAt: new Date().toISOString() }
            : l
        )
      );
      setNotice(null);
      setSnack(true);
    } catch (err) {
      if (newStatus === 'delivered' && err?.response?.data?.reason === 'pod_required') {
        const load = loads.find((l) => l._id === id);
        if (load) { setPodLoad(load); return; }
      }
      setError(err?.response?.data?.error || 'Failed to update status.');
      console.error(err);
    }
  };

  /* ── required photos: explain BEFORE the signature pad / status call ── */
  // Returns true (and opens the load's photo section) when the shipper required photos that are missing.
  const photosMissing = async (load, stages) => {
    const req = load?.evidenceRequired || {};
    if (!stages.some((s) => req[s])) return false;
    try {
      const { data } = await api.get(`/loads/${load._id}/evidence`);
      const has = (s, kinds) => data.data.items.some((i) => i.stage === s && (!kinds || kinds.includes(i.kind)));
      const need = [];
      if (stages.includes('pickup') && req.pickup && !has('pickup', ['cargo', 'seal'])) need.push('at least one pickup photo of the freight or the seal');
      if (stages.includes('delivery') && req.delivery && !has('delivery')) need.push('at least one delivery photo');
      if (!need.length) return false;
      const text = `The shipper requires ${need.join(' and ')} before this can continue. Add the photo(s) under "Photo record".`;
      setError(text);
      setNotice({ text, focus: 'photos' });
      setSelected(load);
      return true;
    } catch (err) {
      return false; // the server enforces the rule and its message is shown by applyStatus
    }
  };

  /* ── update status on dropdown change ─────────────────────── */
  // Transitioning to in-transit = pickup: capture a BOL e-signature first.
  const updateStatus = async (id, newStatus) => {
    setError(null);
    setNotice(null);
    if (newStatus === 'in-transit') {
      const load = loads.find((l) => l._id === id);
      const pv = load?.pickupVerification;
      // Required handshake not yet verified: the server would refuse, so explain instead of asking for a signature.
      if (pv?.required && !pv.verifiedAt) {
        setBlocked(load);
        return;
      }
      setBlocked(null);
      if (await photosMissing(load, ['pickup'])) return;
      setSigPad({ open: true, loadId: id });
      return;
    }
    if (newStatus === 'delivered') {
      const load = loads.find((l) => l._id === id);
      if (await photosMissing(load, load?.status === 'accepted' ? ['pickup', 'delivery'] : ['delivery'])) return;
      if (load) { setPodLoad(load); return; }
    }
    await applyStatus(id, newStatus);
  };

  /* ── pickup signature captured → save it, then transition ─── */
  const handlePickupSigned = async ({ dataUrl, signerName }) => {
    const id = sigPad.loadId;
    setSigPad({ open: false, loadId: null });
    if (!id) return;
    try {
      // Non-fatal: even if signature capture fails, still mark the pickup.
      await api.post(`/documents/${id}/pickup-signature`, { dataUrl, signerName });
    } catch (err) {
      // A 409 means the server will also refuse the status change; applyStatus shows its message.
      console.error('Pickup signature failed (continuing):', err?.response?.data?.error || err.message);
    }
    await applyStatus(id, 'in-transit');
  };

  /* ── accent colours for card strips ───────────────────────── */
  const accent = {
    accepted: '#a78bfa',
    'in-transit': '#fbbf24',
    delivered: '#34d399',
    open: '#22d3ee',
  };

  /* ── UI ───────────────────────────────────────────────────── */
  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', pt: embedded ? 0 : 2 }}>
      <Typography variant="h5" component="h1" fontWeight={700} mb={2}>
        My Loads
      </Typography>

      {/* filter dropdown */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
            <MenuItem value="in-transit">In Transit</MenuItem>
            <MenuItem value="delivered">Delivered</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {blocked && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          onClose={() => setBlocked(null)}
          action={<Button color="inherit" size="small" onClick={() => {
            setNotice({ text: "Pickup verification is required. Show your pickup code to the dock; it must be verified before you can start this load.", focus: 'pickup' });
            setSelected(blocked);
            setBlocked(null);
          }}>Show my code</Button>}
        >
          {blocked.origin} → {blocked.destination} can't start yet: pickup verification is required and has not been done.
          Show your pickup code to the dock. The dock or shipper must verify it before you can start this load.
        </Alert>
      )}

      <StandbyBids />

      {loading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid item xs={12} md={6} key={i}>
              <Skeleton
                variant="rectangular"
                height={120}
                sx={{ borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)' }}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Grid container spacing={2}>
          {viewLoads.length ? (
            viewLoads.map((l) => (
              <Grid item xs={12} md={6} key={l._id}>
                <Paper
                  sx={{
                    ...glassCard.standard,
                    borderRadius: `${radius.lg}px`,
                    p: 2,
                    pl: 2.5,
                    borderLeft: `6px solid ${accent[l.status] || accent.open}`,
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelected(l)}
                >
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    flexWrap="wrap"
                    gap={1.5}
                    mb={1}
                  >
                    <Typography fontWeight={600} sx={{ minWidth: 0, flex: '1 1 160px' }}>
                      {l.origin} → {l.destination}
                    </Typography>
                    <FormControl
                      size="small"
                      sx={{ minWidth: 160 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <InputLabel>Update status</InputLabel>
                      <Select
                        label="Update status"
                        value={l.status}
                        onChange={(e) => updateStatus(l._id, e.target.value)}
                      >
                        <MenuItem value="accepted">Accepted</MenuItem>
                        <MenuItem value="in-transit">In Transit</MenuItem>
                        <MenuItem value="delivered">Delivered</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  <Typography variant="body2" color="text.secondary" mb={1}>
                    Rate: ${l.rate.toLocaleString()}
                  </Typography>
                  {(l.bookedWindow?.start || l.pickupTimeWindow?.start) && (
                    <Typography variant="body2" color="text.secondary" mb={1}>
                      Pickup: {fmtWindow(l.bookedWindow?.start ? l.bookedWindow : l.pickupTimeWindow)}
                      {l.deliveryTimeWindow?.start && <><br />Delivery: {fmtWindow(l.deliveryTimeWindow)}</>}
                    </Typography>
                  )}

                  <PickupRiskPanel load={l} userRole="carrier" onChanged={fetchLoads} />
                  <PickupWindowPanel load={l} userRole="carrier" onChanged={fetchLoads} />

                  {l.status === 'delivered' && (
                    <Box
                      sx={{
                        mt: 1,
                        px: 1.5,
                        py: 0.5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        bgcolor: 'rgba(52,211,153,0.15)',
                        borderRadius: 1,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <Typography
                        variant="body2"
                        sx={{ color: '#34d399', fontWeight: 600 }}
                      >
                        Delivered
                      </Typography>
                    </Box>
                  )}

                  {l.status !== 'delivered' && (
                    <StatusChip status={l.status} />
                  )}

                  {/* Return-load suggestions: collapsed, fetched on expand */}
                  {['accepted', 'in-transit'].includes(l.status) && (
                    <Box mt={1.5} onClick={(e) => e.stopPropagation()}>
                      <ReturnLoadSuggestions loadId={l._id} onViewLoad={setSelected} />
                    </Box>
                  )}
                </Paper>
              </Grid>
            ))
          ) : (
            <Typography>No loads match this filter.</Typography>
          )}
        </Grid>
      )}

      {/* success snackbar */}
      <Snackbar
        open={snack}
        autoHideDuration={3000}
        onClose={() => setSnack(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Status updated!
        </Alert>
      </Snackbar>

      {/* details modal */}
      {selected && (
        <LoadDetailsModal
          load={selected}
          userRole="carrier"
          notice={notice?.text}
          noticeFocus={notice?.focus}
          onClose={() => { setSelected(null); setNotice(null); fetchLoads(); }}
          onLoadAccepted={() => {
            // The accepted load may not be in this list yet (e.g. a return-load suggestion) — refetch.
            fetchLoads();
            setSelected(null);
          }}
        />
      )}

      <ProofOfDeliveryDialog
        open={!!podLoad}
        load={podLoad}
        onClose={() => setPodLoad(null)}
        onDelivered={() => { setPodLoad(null); setNotice(null); setSnack(true); fetchLoads(); }}
      />

      {/* Pickup e-signature pad — captured before the in-transit transition */}
      <SignaturePad
        open={sigPad.open}
        title="Pickup Signature"
        subtitle="Sign to confirm the freight was picked up in good order. This is embedded into the Bill of Lading."
        onClose={() => setSigPad({ open: false, loadId: null })}
        onSave={handlePickupSigned}
      />
    </Box>
  );
}
