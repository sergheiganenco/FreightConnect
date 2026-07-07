/**
 * AdminClaims.js
 *
 * Admin view of all cargo claims filed across the platform.
 *
 * Features:
 *  - Filter by status (all / open / investigating / resolved / denied / withdrawn)
 *  - Filter by type (all / damage / loss / shortage / overage)
 *  - Paginated list cards showing parties / load / type / amount / status
 *  - Click to open detail drawer: notes thread (POST /claims/:id/notes) +
 *    admin resolve form (PUT /claims/:id/resolve).
 *
 * Cloned from AdminExceptions.js — money is stored as integer cents in the DB;
 * the UI divides by 100 for display and multiplies dollars by 100 on submit.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Chip, CircularProgress, Pagination,
  FormControl, InputLabel, Select, MenuItem, Paper, Button,
  Drawer, Divider, TextField, Alert, IconButton, Tooltip, InputAdornment,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import GavelIcon from '@mui/icons-material/Gavel';
import SendIcon from '@mui/icons-material/Send';
import api from '../../services/api';
import {
  brand, semantic, claimStatus as EX_STATUS, surface,
  text as T, tint, status as ST, gradient,
} from '../../theme/tokens';

const STATUS_OPTIONS = [
  { value: 'all',           label: 'All Statuses' },
  { value: 'open',          label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved',      label: 'Resolved' },
  { value: 'denied',        label: 'Denied' },
  { value: 'withdrawn',     label: 'Withdrawn' },
];

const TYPE_OPTIONS = [
  { value: 'all',      label: 'All Types' },
  { value: 'damage',   label: 'Damage' },
  { value: 'loss',     label: 'Loss' },
  { value: 'shortage', label: 'Shortage' },
  { value: 'overage',  label: 'Overage' },
];

// Claim statuses reuse the shared exception palette where they overlap;
// 'denied' and 'withdrawn' get their own semantic colors.
const STATUS_COLOR = {
  open:          EX_STATUS.open,
  investigating: EX_STATUS.investigating,
  resolved:      EX_STATUS.resolved,
  denied:        semantic.error,
  withdrawn:     semantic.muted,
};

const PAGE_SIZE = 10;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDollars(cents) {
  return `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function partyName(p) {
  if (!p || typeof p === 'string') return null;
  return p.companyName || p.name || p.email || null;
}

function StatusChipEl({ status }) {
  const color = STATUS_COLOR[status] || semantic.muted;
  return (
    <Chip
      label={status}
      size="small"
      sx={{
        bgcolor: `${color}22`,
        color,
        fontWeight: 700, fontSize: '0.68rem', textTransform: 'capitalize',
      }}
    />
  );
}

function TypeChipEl({ type }) {
  return (
    <Chip
      label={type}
      size="small"
      sx={{ bgcolor: surface.glass, color: brand.indigoLight, fontWeight: 600, fontSize: '0.65rem', textTransform: 'capitalize' }}
    />
  );
}

// ── Detail Drawer ──────────────────────────────────────────────────────────
function ClaimDrawer({ claim, onClose, onUpdated }) {
  const [newStatus, setNewStatus] = useState('resolved');
  const [resolution, setResolution] = useState('');
  const [resolvedAmount, setResolvedAmount] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (claim) {
      setNewStatus('resolved');
      setResolution('');
      // Seed the resolved amount from the claimed amount (dollars) for convenience.
      setResolvedAmount(claim.amountCents != null ? String(claim.amountCents / 100) : '');
      setNoteContent('');
      setError('');
      setSuccess('');
    }
    // Keyed on _id only: re-running on every new `claim` object reference
    // (e.g. after a refetch) would wipe in-progress form input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim?._id]);

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/claims/${claim._id}/notes`, { content: noteContent.trim() });
      setNoteContent('');
      setSuccess('Note added.');
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add note');
    }
    setSaving(false);
  };

  const handleResolve = async () => {
    setSaving(true);
    setError('');
    try {
      const resolvedAmountCents = newStatus === 'resolved'
        ? Math.round((Number(resolvedAmount) || 0) * 100)
        : 0;
      await api.put(`/claims/${claim._id}/resolve`, {
        status: newStatus,
        resolution: resolution.trim() || undefined,
        resolvedAmountCents,
      });
      setSuccess(newStatus === 'resolved' ? 'Claim resolved.' : 'Claim denied.');
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resolve claim');
    }
    setSaving(false);
  };

  if (!claim) return null;

  const load = claim.loadId || claim.load;
  const isClosed = ['resolved', 'denied', 'withdrawn'].includes(claim.status);

  return (
    <Drawer
      anchor="right"
      open={!!claim}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: 520 },
          bgcolor: surface.background,
          color: T.primary,
          p: 3,
          overflowY: 'auto',
        },
      }}
    >
      {/* Header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={2}>
        <Box flex={1}>
          <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
            <GavelIcon sx={{ color: STATUS_COLOR[claim.status] || brand.indigoLight, fontSize: 22 }} />
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
              Cargo Claim
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5}>
            <StatusChipEl status={claim.status} />
            <TypeChipEl type={claim.type} />
          </Stack>
        </Box>
        <IconButton onClick={onClose} sx={{ color: T.primary, mt: -0.5 }}><CloseIcon /></IconButton>
      </Stack>

      <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />

      {/* Amount */}
      <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: tint(semantic.orange, 0.1), border: `1px solid ${tint(semantic.orange, 0.3)}` }}>
        <Typography variant="caption" sx={{ color: semantic.orange, fontWeight: 700, display: 'block' }}>
          CLAIMED AMOUNT
        </Typography>
        <Typography variant="h6" fontWeight={800} sx={{ color: semantic.orange }}>
          {fmtDollars(claim.amountCents)}
        </Typography>
        {claim.status === 'resolved' && claim.resolvedAmountCents != null && (
          <Typography variant="caption" sx={{ color: semantic.success, fontWeight: 700 }}>
            Resolved for {fmtDollars(claim.resolvedAmountCents)}
          </Typography>
        )}
      </Box>

      {/* Load info */}
      {load && (
        <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.glassSubtle }}>
          <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.25 }}>
            LOAD
          </Typography>
          <Typography fontWeight={700} fontSize="0.95rem">
            {load.origin} → {load.destination}
          </Typography>
          <Typography variant="caption" sx={{ color: T.secondary }}>
            {load.title}{load.status ? ` · Status: ${load.status}` : ''}
          </Typography>
        </Box>
      )}

      {/* Parties */}
      <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.glassSubtle }}>
        <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.25 }}>
          PARTIES
        </Typography>
        <Typography fontWeight={700} fontSize="0.95rem">
          {partyName(claim.claimant) || claim.claimantRole || 'Claimant'}
          {' → '}
          {partyName(claim.respondent) || claim.respondentRole || 'Respondent'}
        </Typography>
        <Typography variant="caption" sx={{ color: T.muted, display: 'block', mt: 0.25 }}>
          Filed {fmtDate(claim.createdAt)}
        </Typography>
      </Box>

      {/* Description */}
      <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.5 }}>
        DESCRIPTION
      </Typography>
      <Typography variant="body2" sx={{ color: T.strong, mb: 2, lineHeight: 1.6 }}>
        {claim.description || 'No description provided.'}
      </Typography>

      {/* Evidence */}
      {Array.isArray(claim.evidence) && claim.evidence.length > 0 && (
        <>
          <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.5 }}>
            EVIDENCE ({claim.evidence.length})
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" gap={0.5} mb={2}>
            {claim.evidence.map((ev, i) => (
              <Chip
                key={ev._id || ev.url || i}
                component="a"
                clickable
                href={ev.url || ev.path}
                target="_blank"
                rel="noopener noreferrer"
                label={ev.name || ev.filename || `File ${i + 1}`}
                size="small"
                sx={{ bgcolor: surface.glassHover, color: brand.indigoLight, fontSize: '0.68rem' }}
              />
            ))}
          </Stack>
        </>
      )}

      <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />

      {/* Notes thread */}
      <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 1 }}>
        NOTES ({claim.notes?.length || 0})
      </Typography>
      <Stack spacing={1} mb={2}>
        {(claim.notes || []).map((note, i) => (
          <Box key={note._id || i} sx={{
            p: 1.5, borderRadius: 2,
            bgcolor: note.authorRole === 'admin' ? surface.indigoTint : surface.glassSubtle,
            border: `1px solid ${note.authorRole === 'admin' ? surface.indigoBorder : surface.glassHover}`,
          }}>
            <Stack direction="row" justifyContent="space-between" mb={0.25}>
              <Typography variant="caption" fontWeight={700} sx={{ color: brand.indigoLight, textTransform: 'capitalize' }}>
                {note.authorRole === 'system' ? 'System' : note.author?.name || note.authorRole}
              </Typography>
              <Typography variant="caption" sx={{ color: T.muted }}>
                {fmtDate(note.createdAt)}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: T.strong, lineHeight: 1.5 }}>
              {note.content}
            </Typography>
          </Box>
        ))}
        {(!claim.notes || claim.notes.length === 0) && (
          <Typography variant="caption" sx={{ color: T.muted }}>No notes yet.</Typography>
        )}
      </Stack>

      {/* Add note */}
      <Stack direction="row" spacing={1} mb={2}>
        <TextField
          size="small" fullWidth multiline maxRows={3}
          placeholder="Add a note…"
          value={noteContent}
          onChange={e => setNoteContent(e.target.value)}
          sx={{
            '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
          }}
        />
        <Tooltip title="Add note">
          <span>
            <IconButton
              onClick={handleAddNote}
              disabled={saving || !noteContent.trim()}
              sx={{ bgcolor: brand.indigo, color: T.primary, borderRadius: 2, '&:hover': { bgcolor: '#4f46e5' }, '&.Mui-disabled': { bgcolor: tint(brand.indigo, 0.3) } }}
            >
              {saving ? <CircularProgress size={18} sx={{ color: T.primary }} /> : <SendIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />

      {/* Resolve form (or read-only outcome when already closed) */}
      {isClosed ? (
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.glassSubtle }}>
          <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.5 }}>
            OUTCOME
          </Typography>
          <StatusChipEl status={claim.status} />
          {claim.resolution && (
            <Typography variant="body2" sx={{ color: T.strong, mt: 1, lineHeight: 1.5 }}>
              {claim.resolution}
            </Typography>
          )}
        </Box>
      ) : (
        <>
          <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 1 }}>
            RESOLVE CLAIM
          </Typography>
          <Stack spacing={1.5}>
            <FormControl size="small" fullWidth>
              <InputLabel sx={{ color: T.secondary }}>Decision</InputLabel>
              <Select
                value={newStatus}
                label="Decision"
                onChange={e => setNewStatus(e.target.value)}
                sx={{ color: T.primary, bgcolor: surface.glass, '& .MuiSvgIcon-root': { color: T.primary }, '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.indigoBorderLight } }}
              >
                <MenuItem value="resolved">Resolved (approve payout)</MenuItem>
                <MenuItem value="denied">Denied</MenuItem>
              </Select>
            </FormControl>
            {newStatus === 'resolved' && (
              <TextField
                size="small" fullWidth type="number"
                label="Resolved amount"
                value={resolvedAmount}
                onChange={e => setResolvedAmount(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start" sx={{ color: T.secondary }}>$</InputAdornment> }}
                inputProps={{ min: 0, step: '0.01' }}
                sx={{
                  '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
                  '& label': { color: T.secondary },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
                }}
              />
            )}
            <TextField
              size="small" fullWidth multiline maxRows={4}
              label="Resolution note"
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              sx={{
                '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
                '& label': { color: T.secondary },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
              }}
            />
            {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ py: 0 }}>{success}</Alert>}
            <Button
              variant="contained"
              onClick={handleResolve}
              disabled={saving}
              sx={{ bgcolor: brand.pink, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#d63a90' } }}
            >
              {saving ? <CircularProgress size={18} sx={{ color: T.primary }} /> : 'Submit Decision'}
            </Button>
          </Stack>
        </>
      )}
    </Drawer>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function AdminClaims() {
  const [claims, setClaims] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const { data } = await api.get(`/claims?${params}`);
      setClaims(data.claims || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load claims');
    }
    setLoading(false);
  }, [page, statusFilter, typeFilter]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter]);

  // Re-fetch detail when admin updates a claim (to refresh notes / status).
  const handleUpdated = async () => {
    fetchClaims();
    if (selected) {
      try {
        const { data } = await api.get(`/claims/${selected._id}`);
        setSelected(data.claim || data);
      } catch { /* ignore */ }
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      {/* Page header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }}
             justifyContent="space-between" mb={3} gap={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <GavelIcon sx={{ color: brand.indigoLight, fontSize: 28 }} />
            <Typography variant="h4" fontWeight={900} sx={{ color: T.primary, letterSpacing: 1 }}>
              Cargo Claims
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: T.secondary, mt: 0.5 }}>
            {total} claim{total !== 1 ? 's' : ''} filed across the platform
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel sx={{ color: T.primary }}>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={e => setStatusFilter(e.target.value)}
              sx={{ bgcolor: surface.appBar, color: T.primary, borderRadius: 2, '& .MuiSvgIcon-root': { color: T.primary } }}
            >
              {STATUS_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel sx={{ color: T.primary }}>Type</InputLabel>
            <Select
              value={typeFilter}
              label="Type"
              onChange={e => setTypeFilter(e.target.value)}
              sx={{ bgcolor: surface.appBar, color: T.primary, borderRadius: 2, '& .MuiSvgIcon-root': { color: T.primary } }}
            >
              {TYPE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* List */}
      {loading ? (
        <Stack alignItems="center" mt={8}><CircularProgress sx={{ color: ST.accepted }} /></Stack>
      ) : claims.length === 0 ? (
        <Typography sx={{ color: T.muted, textAlign: 'center', mt: 8 }}>
          No claims match the current filters.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {claims.map(claim => {
            const load = claim.loadId || claim.load;
            const accent = STATUS_COLOR[claim.status] || semantic.muted;
            return (
              <Paper
                key={claim._id}
                elevation={6}
                onClick={() => setSelected(claim)}
                sx={{
                  background: gradient.background,
                  borderRadius: 4,
                  px: { xs: 2, sm: 3 },
                  py: 2,
                  cursor: 'pointer',
                  border: `1px solid ${accent}33`,
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  '&:hover': {
                    borderColor: accent,
                    boxShadow: `0 0 0 2px ${accent}40`,
                  },
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
                  {/* Left */}
                  <Box flex={1} minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap">
                      <Typography fontWeight={800} sx={{ color: T.primary, fontSize: '1rem', textTransform: 'capitalize' }}>
                        {claim.type} claim
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5} mb={1}>
                      <StatusChipEl status={claim.status} />
                      <TypeChipEl type={claim.type} />
                    </Stack>
                    <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                      {(partyName(claim.claimant) || claim.claimantRole || 'Claimant')}
                      {' → '}
                      {(partyName(claim.respondent) || claim.respondentRole || 'Respondent')}
                    </Typography>
                    {load && (
                      <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                        Load: {load.origin} → {load.destination}{load.title ? ` · ${load.title}` : ''}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ color: T.muted }}>
                      Filed {fmtDate(claim.createdAt)}
                    </Typography>
                  </Box>

                  {/* Right */}
                  <Stack alignItems="flex-end" justifyContent="center" spacing={0.75} flexShrink={0}>
                    <Typography fontWeight={800} sx={{ color: semantic.orange, fontSize: '1.1rem' }}>
                      {fmtDollars(claim.amountCents)}
                    </Typography>
                    <Chip
                      label={`${claim.notes?.length || 0} note${claim.notes?.length !== 1 ? 's' : ''}`}
                      size="small"
                      sx={{ bgcolor: surface.glassHover, color: T.secondary, fontSize: '0.68rem' }}
                    />
                    <Button
                      size="small" variant="outlined"
                      sx={{ borderColor: brand.pink, color: brand.pink, borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, '&:hover': { bgcolor: surface.pinkTint } }}
                      onClick={e => { e.stopPropagation(); setSelected(claim); }}
                    >
                      Manage
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <Stack direction="row" justifyContent="center" mt={4}>
          <Pagination
            count={pages}
            page={page}
            onChange={(_, val) => setPage(val)}
            sx={{
              '& .MuiPaginationItem-root': {
                bgcolor: surface.appBar, color: T.primary, borderRadius: 2, fontWeight: 700,
                '&.Mui-selected': { bgcolor: brand.pink, color: T.primary },
              },
            }}
          />
        </Stack>
      )}

      {/* Detail Drawer */}
      <ClaimDrawer
        claim={selected}
        onClose={() => setSelected(null)}
        onUpdated={handleUpdated}
      />
    </Box>
  );
}
