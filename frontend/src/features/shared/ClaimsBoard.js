/**
 * ClaimsBoard.js — shared cargo-claims board for shipper & carrier roles.
 *
 * Props:
 *   role: 'shipper' | 'carrier'   — drives which loads endpoint is used and copy.
 *
 * Renders:
 *   - The current user's claims (GET /claims → { claims, total, page, pages }).
 *   - A "File a claim" dialog: pick one of my delivered loads, type, amount
 *     (dollars → *100 cents), description, optional evidence file(s) uploaded
 *     via POST /claims/:id/evidence after the claim is created.
 *   - A detail Drawer with the notes thread (POST /claims/:id/notes) and a
 *     Withdraw button (PUT /claims/:id/withdraw) shown only when the current
 *     user is the claimant and the status is open|investigating.
 *
 * Money is integer cents in the DB: divide by 100 to display, multiply by 100
 * on submit.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Chip, CircularProgress, Pagination, Paper, Button,
  Drawer, Divider, TextField, Alert, IconButton, Tooltip, InputAdornment,
  FormControl, InputLabel, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import GavelIcon from '@mui/icons-material/Gavel';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import api from '../../services/api';
import {
  brand, semantic, claimStatus as EX_STATUS, surface,
  text as T, tint, status as ST, gradient,
} from '../../theme/tokens';

const TYPE_OPTIONS = [
  { value: 'damage',   label: 'Damage' },
  { value: 'loss',     label: 'Loss' },
  { value: 'shortage', label: 'Shortage' },
  { value: 'overage',  label: 'Overage' },
];

const STATUS_COLOR = {
  open:          EX_STATUS.open,
  investigating: EX_STATUS.investigating,
  resolved:      EX_STATUS.resolved,
  denied:        semantic.error,
  withdrawn:     semantic.muted,
};

const PAGE_SIZE = 10;

// Loads endpoint per role (both return a plain array of the user's loads).
const LOADS_ENDPOINT = {
  shipper: '/loads/shipper-my-loads',
  carrier: '/loads/my-loads',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDollars(cents) {
  return `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusChipEl({ status }) {
  const color = STATUS_COLOR[status] || semantic.muted;
  return (
    <Chip
      label={status}
      size="small"
      sx={{ bgcolor: `${color}22`, color, fontWeight: 700, fontSize: '0.68rem', textTransform: 'capitalize' }}
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

// Whether the current user may withdraw this claim.
function canWithdraw(claim, myId) {
  if (!claim) return false;
  if (!['open', 'investigating'].includes(claim.status)) return false;
  // Honor an explicit backend flag if present.
  if (typeof claim.canWithdraw === 'boolean') return claim.canWithdraw;
  const claimantId =
    claim.claimant?._id || claim.claimant ||
    claim.filedBy?._id || claim.filedBy ||
    claim.claimantId;
  return !!(myId && claimantId && String(claimantId) === String(myId));
}

// ── File-a-claim Dialog ──────────────────────────────────────────────────────
function FileClaimDialog({ open, onClose, onCreated, role }) {
  const [loads, setLoads] = useState([]);
  const [fetchingLoads, setFetchingLoads] = useState(false);
  const [loadId, setLoadId] = useState('');
  const [type, setType] = useState('damage');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoadId('');
    setType('damage');
    setAmount('');
    setDescription('');
    setFiles([]);
    setError('');
    setFetchingLoads(true);
    (async () => {
      try {
        const { data } = await api.get(LOADS_ENDPOINT[role] || LOADS_ENDPOINT.carrier);
        const list = Array.isArray(data) ? data : (data.loads || []);
        // Claims are filed against delivered freight.
        setLoads(list.filter(l => l.status === 'delivered'));
      } catch {
        setError('Failed to load your delivered loads.');
      }
      setFetchingLoads(false);
    })();
  }, [open, role]);

  const submit = async () => {
    if (!loadId) { setError('Select a load.'); return; }
    const amountCents = Math.round((Number(amount) || 0) * 100);
    if (amountCents <= 0) { setError('Enter a claim amount greater than $0.'); return; }
    if (!description.trim()) { setError('Enter a description.'); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/claims', {
        loadId,
        type,
        amountCents,
        description: description.trim(),
      });
      const created = data.claim || data;
      // Optionally attach evidence to the freshly created claim.
      if (created?._id && files.length > 0) {
        try {
          const fd = new FormData();
          files.forEach(f => fd.append('files', f));
          await api.post(`/claims/${created._id}/evidence`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch { /* claim already filed — evidence can be re-attached later */ }
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to file claim');
    }
    setSaving(false);
  };

  const fieldSx = {
    '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
    '& label': { color: T.secondary },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
    '& .MuiSvgIcon-root': { color: T.primary },
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { bgcolor: surface.background, color: T.primary, borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <GavelIcon sx={{ color: brand.indigoLight }} />
        File a Cargo Claim
        <IconButton onClick={onClose} sx={{ ml: 'auto', color: T.secondary }} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl size="small" fullWidth sx={fieldSx}>
            <InputLabel>Load (delivered)</InputLabel>
            <Select
              value={loadId}
              label="Load (delivered)"
              onChange={e => setLoadId(e.target.value)}
              disabled={fetchingLoads}
            >
              {fetchingLoads && (
                <MenuItem value="" disabled>Loading…</MenuItem>
              )}
              {!fetchingLoads && loads.length === 0 && (
                <MenuItem value="" disabled>No delivered loads available</MenuItem>
              )}
              {loads.map(l => (
                <MenuItem key={l._id} value={l._id}>
                  {(l.title ? `${l.title} — ` : '')}{l.origin} → {l.destination}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth sx={fieldSx}>
            <InputLabel>Claim type</InputLabel>
            <Select value={type} label="Claim type" onChange={e => setType(e.target.value)}>
              {TYPE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>

          <TextField
            size="small" fullWidth type="number"
            label="Claim amount"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start" sx={{ color: T.secondary }}>$</InputAdornment> }}
            inputProps={{ min: 0, step: '0.01' }}
            sx={fieldSx}
          />

          <TextField
            size="small" fullWidth multiline minRows={3}
            label="Description"
            placeholder="Describe the damage, loss, shortage or overage…"
            value={description}
            onChange={e => setDescription(e.target.value)}
            sx={fieldSx}
          />

          <Box>
            <Button
              component="label"
              variant="outlined"
              startIcon={<AttachFileIcon />}
              sx={{ borderColor: surface.glassBorder, color: T.primary, borderRadius: 2, textTransform: 'none' }}
            >
              Attach evidence (optional)
              <input
                hidden
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={e => setFiles(Array.from(e.target.files || []))}
              />
            </Button>
            {files.length > 0 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5} mt={1}>
                {files.map((f, i) => (
                  <Chip
                    key={`${f.name}-${i}`}
                    label={f.name}
                    size="small"
                    onDelete={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                    sx={{ bgcolor: surface.glassHover, color: T.secondary, fontSize: '0.68rem' }}
                  />
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: T.secondary }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving}
          sx={{ bgcolor: brand.pink, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#d63a90' } }}
        >
          {saving ? <CircularProgress size={18} sx={{ color: T.primary }} /> : 'File Claim'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Detail Drawer ────────────────────────────────────────────────────────────
function ClaimDrawer({ claim, myId, onClose, onUpdated }) {
  const [noteContent, setNoteContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (claim) {
      setNoteContent('');
      setError('');
      setSuccess('');
    }
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

  const handleWithdraw = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/claims/${claim._id}/withdraw`);
      setSuccess('Claim withdrawn.');
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to withdraw claim');
    }
    setSaving(false);
  };

  if (!claim) return null;

  const load = claim.loadId || claim.load;

  return (
    <Drawer
      anchor="right"
      open={!!claim}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: 480 },
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
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2, textTransform: 'capitalize' }}>
              {claim.type} Claim
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

      {/* Load */}
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

      {/* Resolution (read-only, if closed) */}
      {claim.resolution && (
        <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: surface.glassSubtle }}>
          <Typography variant="caption" sx={{ color: ST.accepted, fontWeight: 700, display: 'block', mb: 0.25 }}>
            OUTCOME
          </Typography>
          <Typography variant="body2" sx={{ color: T.strong, lineHeight: 1.5 }}>
            {claim.resolution}
          </Typography>
        </Box>
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

      {error && <Alert severity="error" sx={{ py: 0, mb: 1 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ py: 0, mb: 1 }}>{success}</Alert>}

      {/* Withdraw — claimant only, while still open/investigating */}
      {canWithdraw(claim, myId) && (
        <>
          <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />
          <Button
            variant="outlined"
            fullWidth
            onClick={handleWithdraw}
            disabled={saving}
            sx={{ borderColor: semantic.error, color: semantic.error, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: tint(semantic.error, 0.1), borderColor: semantic.error } }}
          >
            {saving ? <CircularProgress size={18} sx={{ color: semantic.error }} /> : 'Withdraw Claim'}
          </Button>
        </>
      )}
    </Drawer>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────
export default function ClaimsBoard({ role = 'carrier' }) {
  const myId = localStorage.getItem('userId');

  const [claims, setClaims] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: PAGE_SIZE });
      const { data } = await api.get(`/claims?${params}`);
      setClaims(data.claims || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load claims');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

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
      {/* Header */}
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
            {total} claim{total !== 1 ? 's' : ''} on your account
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ bgcolor: brand.pink, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#d63a90' } }}
        >
          File a Claim
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* List */}
      {loading ? (
        <Stack alignItems="center" mt={8}><CircularProgress sx={{ color: ST.accepted }} /></Stack>
      ) : claims.length === 0 ? (
        <Stack alignItems="center" mt={8} spacing={2}>
          <GavelIcon sx={{ fontSize: 48, color: surface.glassBadge }} />
          <Typography sx={{ color: T.muted, textAlign: 'center' }}>
            You have not filed any claims yet.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setDialogOpen(true)}
            sx={{ borderColor: brand.pink, color: brand.pink, borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: surface.pinkTint } }}
          >
            File Your First Claim
          </Button>
        </Stack>
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
                  <Box flex={1} minWidth={0}>
                    <Typography fontWeight={800} sx={{ color: T.primary, fontSize: '1rem', textTransform: 'capitalize', mb: 0.5 }}>
                      {claim.type} claim
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5} mb={1}>
                      <StatusChipEl status={claim.status} />
                      <TypeChipEl type={claim.type} />
                    </Stack>
                    {load && (
                      <Typography variant="caption" sx={{ color: T.secondary, display: 'block' }}>
                        Load: {load.origin} → {load.destination}{load.title ? ` · ${load.title}` : ''}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ color: T.muted }}>
                      Filed {fmtDate(claim.createdAt)}
                    </Typography>
                  </Box>

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
                      View
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

      {/* File-a-claim dialog */}
      <FileClaimDialog
        open={dialogOpen}
        role={role}
        onClose={() => setDialogOpen(false)}
        onCreated={fetchClaims}
      />

      {/* Detail drawer */}
      <ClaimDrawer
        claim={selected}
        myId={myId}
        onClose={() => setSelected(null)}
        onUpdated={handleUpdated}
      />
    </Box>
  );
}
