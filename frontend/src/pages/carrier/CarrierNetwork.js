/**
 * CarrierNetwork
 *
 * Three-tab page:
 *   1. Capacity Board  — browse active capacity posts from other carriers
 *   2. My Capacity     — manage your own posts (post new, cancel, view bookings)
 *   3. Partners        — carrier directory + pending partnership requests
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Tabs, Tab, Paper, Chip, Button,
  CircularProgress, TextField, FormControl, InputLabel, Select,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions,
  Pagination, Alert, IconButton, Tooltip, Badge, Divider,
  InputAdornment,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PeopleIcon from '@mui/icons-material/People';
import GridViewIcon from '@mui/icons-material/GridView';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import VerifiedIcon from '@mui/icons-material/Verified';
import SearchIcon from '@mui/icons-material/Search';
import api from '../../services/api';

// ── Constants ──────────────────────────────────────────────────────────────
const EQUIPMENT_TYPES = [
  'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Lowboy',
  'Box Truck', 'Power Only', 'Tanker', 'Other',
];

const STATUS_COLOR = {
  active: '#34d399', booked: '#fbbf24', cancelled: '#94a3b8', expired: '#ef4444',
};
const TRUST_COLOR = { high: '#34d399', medium: '#fbbf24', low: '#ef4444' };

function trustLabel(score) {
  if (!score) return { label: 'N/A', color: '#94a3b8' };
  if (score >= 75) return { label: `${score}`, color: TRUST_COLOR.high };
  if (score >= 50) return { label: `${score}`, color: TRUST_COLOR.medium };
  return { label: `${score}`, color: TRUST_COLOR.low };
}

function fmtDate(d) {
  if (!d) return 'TBD';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Post Capacity Dialog ───────────────────────────────────────────────────
function PostCapacityDialog({ open, onClose, onSuccess, editPost = null }) {
  const [form, setForm] = useState({
    equipmentType: 'Dry Van', truckId: '', weightCapacity: '',
    availableFrom: '', availableTo: '',
    originCity: '', originState: '', destCity: '', destState: '',
    ratePerMile: '', minLoadValue: '', notes: '', contactPhone: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editPost) {
      setForm({
        equipmentType: editPost.equipmentType || 'Dry Van',
        truckId: editPost.truckId || '',
        weightCapacity: editPost.weightCapacity || '',
        availableFrom: editPost.availableFrom ? editPost.availableFrom.slice(0, 10) : '',
        availableTo: editPost.availableTo ? editPost.availableTo.slice(0, 10) : '',
        originCity: editPost.originCity || '',
        originState: editPost.originState || '',
        destCity: editPost.destCity || '',
        destState: editPost.destState || '',
        ratePerMile: editPost.ratePerMile || '',
        minLoadValue: editPost.minLoadValue || '',
        notes: editPost.notes || '',
        contactPhone: editPost.contactPhone || '',
      });
    } else {
      setForm({
        equipmentType: 'Dry Van', truckId: '', weightCapacity: '',
        availableFrom: '', availableTo: '',
        originCity: '', originState: '', destCity: '', destState: '',
        ratePerMile: '', minLoadValue: '', notes: '', contactPhone: '',
      });
    }
    setError('');
  }, [open, editPost]);

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.originCity || !form.originState || !form.availableFrom || !form.availableTo) {
      setError('Origin city, state, and availability dates are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        weightCapacity: form.weightCapacity ? Number(form.weightCapacity) : undefined,
        ratePerMile: form.ratePerMile ? Number(form.ratePerMile) : undefined,
        minLoadValue: form.minLoadValue ? Number(form.minLoadValue) : undefined,
      };
      if (editPost) {
        await api.put(`/capacity/${editPost._id}`, payload);
      } else {
        await api.post('/capacity', payload);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {editPost ? 'Edit Capacity Post' : 'Post Available Capacity'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Equipment Type</InputLabel>
            <Select value={form.equipmentType} label="Equipment Type" onChange={set('equipmentType')}>
              {EQUIPMENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={2}>
            <TextField label="Truck ID (optional)" size="small" fullWidth value={form.truckId} onChange={set('truckId')} />
            <TextField label="Weight Capacity (lbs)" size="small" fullWidth type="number" value={form.weightCapacity} onChange={set('weightCapacity')} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Available From" size="small" fullWidth type="date" value={form.availableFrom} onChange={set('availableFrom')} InputLabelProps={{ shrink: true }} />
            <TextField label="Available To" size="small" fullWidth type="date" value={form.availableTo} onChange={set('availableTo')} InputLabelProps={{ shrink: true }} />
          </Stack>
          <Typography variant="caption" fontWeight={700} sx={{ color: 'text.secondary', mt: 0.5 }}>ORIGIN (required)</Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="City" size="small" fullWidth value={form.originCity} onChange={set('originCity')} />
            <TextField label="State (abbr.)" size="small" sx={{ maxWidth: 100 }} value={form.originState} onChange={set('originState')} inputProps={{ maxLength: 2 }} />
          </Stack>
          <Typography variant="caption" fontWeight={700} sx={{ color: 'text.secondary' }}>PREFERRED DESTINATION (optional)</Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="City" size="small" fullWidth value={form.destCity} onChange={set('destCity')} />
            <TextField label="State (abbr.)" size="small" sx={{ maxWidth: 100 }} value={form.destState} onChange={set('destState')} inputProps={{ maxLength: 2 }} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Rate per mile (optional)" size="small" fullWidth type="number"
              value={form.ratePerMile} onChange={set('ratePerMile')}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField
              label="Min. load value (optional)" size="small" fullWidth type="number"
              value={form.minLoadValue} onChange={set('minLoadValue')}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
          </Stack>
          <TextField label="Contact Phone (optional)" size="small" fullWidth value={form.contactPhone} onChange={set('contactPhone')} />
          <TextField label="Notes (optional)" size="small" fullWidth multiline maxRows={3} value={form.notes} onChange={set('notes')} placeholder="Cargo restrictions, special requirements, etc." />
          {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button
          variant="contained" onClick={handleSubmit} disabled={saving}
          sx={{ bgcolor: '#7c3aed', borderRadius: 9999, fontWeight: 700 }}
        >
          {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : (editPost ? 'Save Changes' : 'Post Capacity')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Capacity Card ──────────────────────────────────────────────────────────
function CapacityCard({ post, isOwn, onBook, onCancel, onEdit }) {
  const carrier = post.carrierId;
  const trust = trustLabel(carrier?.trustScore?.overall);
  const isVerified = carrier?.verification?.status === 'verified';

  return (
    <Paper elevation={6} sx={{
      background: 'linear-gradient(135deg,#1e1050 60%,#2d1b69 100%)',
      borderRadius: 4, px: { xs: 2, sm: 3 }, py: 2,
      border: `1px solid ${STATUS_COLOR[post.status] || '#334'}33`,
    }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
        {/* Left */}
        <Box flex={1}>
          <Stack direction="row" alignItems="center" spacing={1} mb={0.75} flexWrap="wrap">
            <LocalShippingIcon sx={{ color: '#a78bfa', fontSize: 20 }} />
            <Typography fontWeight={800} sx={{ color: '#fff', fontSize: '1.05rem' }}>
              {post.equipmentType}
            </Typography>
            {post.weightCapacity && (
              <Chip label={`${post.weightCapacity.toLocaleString()} lbs`} size="small"
                    sx={{ bgcolor: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontWeight: 700, fontSize: '0.65rem' }} />
            )}
            <Chip label={post.status} size="small"
                  sx={{ bgcolor: `${STATUS_COLOR[post.status]}22`, color: STATUS_COLOR[post.status], fontWeight: 700, fontSize: '0.65rem', textTransform: 'capitalize' }} />
          </Stack>

          <Typography sx={{ color: '#e2d9ff', fontWeight: 700, mb: 0.25 }}>
            {post.originCity}, {post.originState}
            {(post.destCity || post.destState) && ` → ${post.destCity || ''} ${post.destState || ''}`.trim()}
            {(!post.destCity && !post.destState) && ' → Any destination'}
          </Typography>

          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Available: {fmtDate(post.availableFrom)} – {fmtDate(post.availableTo)}
          </Typography>

          {(post.ratePerMile || post.minLoadValue) && (
            <Stack direction="row" spacing={1.5} mt={0.75} flexWrap="wrap">
              {post.ratePerMile && (
                <Typography variant="caption" sx={{ color: '#34d399', fontWeight: 700 }}>
                  ${post.ratePerMile}/mi
                </Typography>
              )}
              {post.minLoadValue && (
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.55)' }}>
                  Min: ${post.minLoadValue.toLocaleString()}
                </Typography>
              )}
            </Stack>
          )}

          {post.notes && (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', display: 'block', mt: 0.5 }} noWrap>
              {post.notes}
            </Typography>
          )}

          {!isOwn && carrier && (
            <Stack direction="row" alignItems="center" spacing={0.75} mt={1}>
              {isVerified && <VerifiedIcon sx={{ color: '#34d399', fontSize: 15 }} />}
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                {carrier.companyName || carrier.name}
              </Typography>
              <Chip label={`Trust: ${trust.label}`} size="small"
                    sx={{ bgcolor: `${trust.color}22`, color: trust.color, fontWeight: 700, fontSize: '0.6rem' }} />
            </Stack>
          )}
        </Box>

        {/* Right actions */}
        <Stack alignItems="flex-end" justifyContent="center" spacing={1} flexShrink={0}>
          {isOwn ? (
            <>
              {post.status === 'active' && (
                <Button size="small" variant="outlined"
                        sx={{ borderColor: '#a78bfa', color: '#a78bfa', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700 }}
                        onClick={() => onEdit(post)}>
                  Edit
                </Button>
              )}
              {post.status === 'active' && (
                <Button size="small" variant="text"
                        sx={{ color: '#ef4444', fontSize: '0.72rem' }}
                        onClick={() => onCancel(post._id)}>
                  Cancel Post
                </Button>
              )}
              {post.status === 'booked' && (
                <Chip label="Booked!" sx={{ bgcolor: '#fbbf2422', color: '#fbbf24', fontWeight: 700, fontSize: '0.75rem' }} />
              )}
            </>
          ) : (
            post.status === 'active' && (
              <Button size="small" variant="contained"
                      sx={{ bgcolor: '#7c3aed', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700 }}
                      onClick={() => onBook(post._id)}>
                Contact & Book
              </Button>
            )
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

// ── Carrier Directory Card ─────────────────────────────────────────────────
function CarrierCard({ carrier, onConnect, onAccept, onDecline }) {
  const trust = trustLabel(carrier.trustScore?.overall);
  const isVerified = carrier.verification?.status === 'verified';
  const ps = carrier.partnershipStatus;

  return (
    <Paper elevation={5} sx={{
      background: 'linear-gradient(135deg,#1e1050 60%,#2d1b69 100%)',
      borderRadius: 4, px: { xs: 2, sm: 3 }, py: 2,
      border: '1px solid rgba(124,58,237,0.2)',
    }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
        <Box flex={1}>
          <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap">
            {isVerified && <VerifiedIcon sx={{ color: '#34d399', fontSize: 18 }} />}
            <Typography fontWeight={800} sx={{ color: '#fff' }}>
              {carrier.companyName || carrier.name}
            </Typography>
            <Chip label={`Trust: ${trust.label}`} size="small"
                  sx={{ bgcolor: `${trust.color}22`, color: trust.color, fontWeight: 700, fontSize: '0.65rem' }} />
          </Stack>
          {carrier.preferences?.equipmentTypes?.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5} mb={0.5}>
              {carrier.preferences.equipmentTypes.slice(0, 4).map(e => (
                <Chip key={e} label={e} size="small"
                      sx={{ bgcolor: 'rgba(167,139,250,0.12)', color: '#c4b5fd', fontSize: '0.62rem', fontWeight: 600 }} />
              ))}
            </Stack>
          )}
          {carrier.preferences?.homeBase && (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
              Based in: {carrier.preferences.homeBase}
            </Typography>
          )}
          {carrier.verification?.fmcsaData?.dotNumber && (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', display: 'block' }}>
              DOT# {carrier.verification.fmcsaData.dotNumber}
            </Typography>
          )}
        </Box>

        <Stack alignItems="flex-end" justifyContent="center" spacing={1} flexShrink={0}>
          {!ps && (
            <Button size="small" variant="contained" startIcon={<PersonAddIcon />}
                    sx={{ bgcolor: '#7c3aed', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700 }}
                    onClick={() => onConnect(carrier._id)}>
              Connect
            </Button>
          )}
          {ps?.status === 'pending' && ps?.sentByMe && (
            <Chip label="Request sent" size="small"
                  sx={{ bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700 }} />
          )}
          {ps?.status === 'pending' && !ps?.sentByMe && (
            <Stack direction="row" spacing={0.75}>
              <Tooltip title="Accept"><IconButton size="small" onClick={() => onAccept(ps.partnershipId._id || ps.partnershipId)}
                sx={{ bgcolor: '#34d39922', '&:hover': { bgcolor: '#34d39944' } }}><CheckCircleIcon sx={{ color: '#34d399', fontSize: 20 }} /></IconButton></Tooltip>
              <Tooltip title="Decline"><IconButton size="small" onClick={() => onDecline(ps.partnershipId._id || ps.partnershipId)}
                sx={{ bgcolor: '#ef444422', '&:hover': { bgcolor: '#ef444444' } }}><CancelIcon sx={{ color: '#ef4444', fontSize: 20 }} /></IconButton></Tooltip>
            </Stack>
          )}
          {ps?.status === 'accepted' && (
            <Chip label="Connected" icon={<CheckCircleIcon sx={{ color: '#34d399 !important', fontSize: 16 }} />}
                  sx={{ bgcolor: '#34d39922', color: '#34d399', fontWeight: 700 }} />
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function CarrierNetwork() {
  const [tab, setTab] = useState(0);

  // Capacity board state
  const [boardPosts, setBoardPosts] = useState([]);
  const [boardTotal, setBoardTotal] = useState(0);
  const [boardPages, setBoardPages] = useState(1);
  const [boardPage, setBoardPage] = useState(1);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardFilter, setBoardFilter] = useState({ equipmentType: 'all', originState: '' });

  // My capacity state
  const [myPosts, setMyPosts] = useState([]);
  const [myLoading, setMyLoading] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [editPost, setEditPost] = useState(null);

  // Partners / directory state
  const [directory, setDirectory] = useState([]);
  const [dirTotal, setDirTotal] = useState(0);
  const [dirPages, setDirPages] = useState(1);
  const [dirPage, setDirPage] = useState(1);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirSearch, setDirSearch] = useState('');
  const [pendingCount, setPendingCount] = useState(0);

  const [alert, setAlert] = useState({ type: '', msg: '' });

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert({ type: '', msg: '' }), 4000);
  };

  // ── Fetch capacity board ───────────────────────────────────────────────
  const fetchBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const params = new URLSearchParams({ page: boardPage, limit: 10 });
      if (boardFilter.equipmentType !== 'all') params.set('equipmentType', boardFilter.equipmentType);
      if (boardFilter.originState) params.set('originState', boardFilter.originState);
      const { data } = await api.get(`/capacity?${params}`);
      setBoardPosts(data.posts || []);
      setBoardTotal(data.total || 0);
      setBoardPages(data.pages || 1);
    } catch { /* silent */ }
    setBoardLoading(false);
  }, [boardPage, boardFilter]);

  // ── Fetch own posts ───────────────────────────────────────────────────
  const fetchMyPosts = useCallback(async () => {
    setMyLoading(true);
    try {
      const { data } = await api.get('/capacity/my');
      setMyPosts(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    setMyLoading(false);
  }, []);

  // ── Fetch carrier directory ───────────────────────────────────────────
  const fetchDirectory = useCallback(async () => {
    setDirLoading(true);
    try {
      const params = new URLSearchParams({ page: dirPage, limit: 12 });
      if (dirSearch) params.set('search', dirSearch);
      const { data } = await api.get(`/partnerships/directory?${params}`);
      setDirectory(data.carriers || []);
      setDirTotal(data.total || 0);
      setDirPages(data.pages || 1);

      // Count inbound pending requests
      const psRes = await api.get('/partnerships?status=pending');
      const myId = localStorage.getItem('userId');
      const inbound = (psRes.data || []).filter(p => p.requestedTo?._id === myId || p.requestedTo === myId);
      setPendingCount(inbound.length);
    } catch { /* silent */ }
    setDirLoading(false);
  }, [dirPage, dirSearch]);

  useEffect(() => { if (tab === 0) fetchBoard(); }, [tab, fetchBoard]);
  useEffect(() => { if (tab === 1) fetchMyPosts(); }, [tab, fetchMyPosts]);
  useEffect(() => { if (tab === 2) fetchDirectory(); }, [tab, fetchDirectory]);
  useEffect(() => { setBoardPage(1); }, [boardFilter]);
  useEffect(() => { setDirPage(1); }, [dirSearch]);

  // ── Actions ───────────────────────────────────────────────────────────
  const handleBook = async (id) => {
    try {
      await api.put(`/capacity/${id}/book`);
      showAlert('success', 'Capacity booked! The carrier has been notified.');
      fetchBoard();
    } catch (err) {
      showAlert('error', err.response?.data?.error || 'Failed to book');
    }
  };

  const handleCancelPost = async (id) => {
    try {
      await api.put(`/capacity/${id}/cancel`);
      fetchMyPosts();
      showAlert('success', 'Post cancelled.');
    } catch (err) {
      showAlert('error', 'Failed to cancel post');
    }
  };

  const handleConnect = async (carrierId) => {
    try {
      await api.post('/partnerships', { carrierId });
      showAlert('success', 'Partnership request sent!');
      fetchDirectory();
    } catch (err) {
      showAlert('error', err.response?.data?.error || 'Failed to send request');
    }
  };

  const handleAccept = async (partnershipId) => {
    try {
      await api.put(`/partnerships/${partnershipId}/accept`);
      showAlert('success', 'Partnership accepted!');
      fetchDirectory();
    } catch (err) {
      showAlert('error', 'Failed to accept');
    }
  };

  const handleDecline = async (partnershipId) => {
    try {
      await api.put(`/partnerships/${partnershipId}/decline`);
      fetchDirectory();
    } catch { /* silent */ }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Box sx={{ pb: 6 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} mb={3}>
        <PeopleIcon sx={{ color: '#a78bfa', fontSize: 32 }} />
        <Box>
          <Typography variant="h4" fontWeight={900} sx={{ color: '#fff', letterSpacing: 1 }}>
            Carrier Network
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Post capacity, find sub-contractors, and build your carrier network
          </Typography>
        </Box>
      </Stack>

      {alert.msg && (
        <Alert severity={alert.type} sx={{ mb: 2 }} onClose={() => setAlert({ type: '', msg: '' })}>
          {alert.msg}
        </Alert>
      )}

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 3,
          '& .MuiTab-root': { color: 'rgba(255,255,255,0.5)', fontWeight: 700, textTransform: 'none', fontSize: '0.95rem' },
          '& .Mui-selected': { color: '#a78bfa' },
          '& .MuiTabs-indicator': { bgcolor: '#7c3aed', height: 3, borderRadius: 9999 },
        }}
      >
        <Tab icon={<GridViewIcon sx={{ fontSize: 18 }} />} iconPosition="start" label={`Board (${boardTotal})`} />
        <Tab icon={<LocalShippingIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="My Capacity" />
        <Tab
          icon={
            <Badge badgeContent={pendingCount} color="error" sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem' } }}>
              <PeopleIcon sx={{ fontSize: 18 }} />
            </Badge>
          }
          iconPosition="start"
          label="Partners"
        />
      </Tabs>

      {/* ── Tab 0: Capacity Board ── */}
      {tab === 0 && (
        <Box>
          {/* Filters */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel sx={{ color: '#fff' }}>Equipment</InputLabel>
              <Select
                value={boardFilter.equipmentType}
                label="Equipment"
                onChange={e => setBoardFilter(p => ({ ...p, equipmentType: e.target.value }))}
                sx={{ bgcolor: '#4c318f', color: '#fff', borderRadius: 2, '& .MuiSvgIcon-root': { color: '#fff' } }}
              >
                <MenuItem value="all">All Types</MenuItem>
                {EQUIPMENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              size="small" placeholder="Filter by origin state (e.g. TX)"
              value={boardFilter.originState}
              onChange={e => setBoardFilter(p => ({ ...p, originState: e.target.value }))}
              InputProps={{ startAdornment: <SearchIcon sx={{ color: 'rgba(255,255,255,0.4)', mr: 0.5, fontSize: 18 }} /> }}
              sx={{ minWidth: 200, '& .MuiInputBase-root': { bgcolor: '#4c318f', color: '#fff', borderRadius: 2 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' } }}
            />
          </Stack>

          {boardLoading ? (
            <Stack alignItems="center" mt={6}><CircularProgress sx={{ color: '#a78bfa' }} /></Stack>
          ) : boardPosts.length === 0 ? (
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', mt: 8 }}>
              No active capacity posts match your filters.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {boardPosts.map(post => (
                <CapacityCard key={post._id} post={post} isOwn={false} onBook={handleBook} />
              ))}
            </Stack>
          )}

          {boardPages > 1 && (
            <Stack direction="row" justifyContent="center" mt={4}>
              <Pagination
                count={boardPages} page={boardPage}
                onChange={(_, v) => setBoardPage(v)}
                sx={{ '& .MuiPaginationItem-root': { bgcolor: '#4c318f', color: '#fff', fontWeight: 700, '&.Mui-selected': { bgcolor: '#7c3aed' } } }}
              />
            </Stack>
          )}
        </Box>
      )}

      {/* ── Tab 1: My Capacity ── */}
      {tab === 1 && (
        <Box>
          <Stack direction="row" justifyContent="flex-end" mb={3}>
            <Button
              variant="contained" startIcon={<AddIcon />}
              onClick={() => { setEditPost(null); setPostDialogOpen(true); }}
              sx={{ bgcolor: '#7c3aed', borderRadius: 9999, fontWeight: 700 }}
            >
              Post Capacity
            </Button>
          </Stack>

          {myLoading ? (
            <Stack alignItems="center" mt={6}><CircularProgress sx={{ color: '#a78bfa' }} /></Stack>
          ) : myPosts.length === 0 ? (
            <Paper elevation={3} sx={{ p: 5, textAlign: 'center', borderRadius: 4, background: 'linear-gradient(135deg,#1e1050 60%,#2d1b69 100%)' }}>
              <LocalShippingIcon sx={{ color: 'rgba(255,255,255,0.2)', fontSize: 48, mb: 1 }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.5)' }}>
                No capacity posts yet. Let other carriers know you have available trucks!
              </Typography>
              <Button
                variant="contained" startIcon={<AddIcon />} sx={{ mt: 2, bgcolor: '#7c3aed', borderRadius: 9999 }}
                onClick={() => { setEditPost(null); setPostDialogOpen(true); }}
              >
                Post Capacity
              </Button>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {myPosts.map(post => (
                <CapacityCard
                  key={post._id} post={post} isOwn
                  onCancel={handleCancelPost}
                  onEdit={(p) => { setEditPost(p); setPostDialogOpen(true); }}
                />
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ── Tab 2: Partners / Directory ── */}
      {tab === 2 && (
        <Box>
          <Stack direction="row" spacing={2} mb={3}>
            <TextField
              size="small" placeholder="Search carriers, DOT#, company…"
              fullWidth
              value={dirSearch}
              onChange={e => setDirSearch(e.target.value)}
              InputProps={{ startAdornment: <SearchIcon sx={{ color: 'rgba(255,255,255,0.4)', mr: 0.5, fontSize: 18 }} /> }}
              sx={{ '& .MuiInputBase-root': { bgcolor: '#4c318f', color: '#fff', borderRadius: 2 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' } }}
            />
          </Stack>

          {pendingCount > 0 && (
            <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
              You have {pendingCount} pending partnership request{pendingCount > 1 ? 's' : ''}. Check the cards below to accept or decline.
            </Alert>
          )}

          {dirLoading ? (
            <Stack alignItems="center" mt={6}><CircularProgress sx={{ color: '#a78bfa' }} /></Stack>
          ) : directory.length === 0 ? (
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', mt: 8 }}>
              No carriers found.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {directory.map(carrier => (
                <CarrierCard
                  key={carrier._id}
                  carrier={carrier}
                  onConnect={handleConnect}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))}
            </Stack>
          )}

          {dirPages > 1 && (
            <Stack direction="row" justifyContent="center" mt={4}>
              <Pagination
                count={dirPages} page={dirPage}
                onChange={(_, v) => setDirPage(v)}
                sx={{ '& .MuiPaginationItem-root': { bgcolor: '#4c318f', color: '#fff', fontWeight: 700, '&.Mui-selected': { bgcolor: '#7c3aed' } } }}
              />
            </Stack>
          )}
        </Box>
      )}

      {/* Post Capacity Dialog */}
      <PostCapacityDialog
        open={postDialogOpen}
        onClose={() => { setPostDialogOpen(false); setEditPost(null); }}
        onSuccess={() => { fetchMyPosts(); showAlert('success', 'Capacity posted successfully!'); }}
        editPost={editPost}
      />
    </Box>
  );
}
